import { MAX_PATCH_OPS, applyPatch, foldPatchIntoStage, isContainer } from "@facet/core";
import type { FacetNode, FacetTree, JsonPatchOperation, NodeId, ServerMessage } from "@facet/core";
import { executeStageTool } from "./executor.js";
import { formatAgentToolObservation } from "./observation.js";
import type { StageToolAssets, StageToolResult, ToolCall } from "./types.js";

export interface StageToolBufferOutcome {
  readonly observation: string;
  readonly messages: readonly ServerMessage[];
  readonly mutated: boolean;
  readonly said: boolean;
  readonly shadow: FacetTree;
}

export interface StageToolBuffer {
  run(call: ToolCall): StageToolBufferOutcome;
  resetEmittedPatchOps(): void;
  drainUnresolved(): readonly string[];
  readonly shadow: FacetTree;
}

type PendingOp =
  | { readonly kind: "set"; readonly node: FacetNode }
  | { readonly kind: "append"; readonly parentId: NodeId; readonly node: FacetNode };

const MAX_ID_LIST_PREVIEW = 20;

export function createStageToolBuffer(
  initialShadow: FacetTree,
  assets?: StageToolAssets,
): StageToolBuffer {
  const pending = new Map<NodeId, PendingOp>();
  const batchPatches: JsonPatchOperation[] = [];
  let batchBaseShadow = initialShadow;
  let shadow = initialShadow;
  let emittedPatchOps = 0;

  const pendingMissing = (id: NodeId): readonly NodeId[] | undefined => {
    const op = pending.get(id);
    return op === undefined ? undefined : missingChildRefs(op.node, shadow);
  };

  const unresolvedObservation = (op: PendingOp): string => {
    const missing = missingChildRefs(op.node, shadow);
    return `"${op.node.id}" still waits for child node(s): ${summarizeIds(missing)}`;
  };

  const recordMessages = (messages: readonly ServerMessage[]): void => {
    let recordedPatch = false;
    for (const message of messages) {
      if (message.kind !== "patch") continue;
      for (const patch of message.patches) {
        batchPatches.push(patch);
        recordedPatch = true;
      }
    }
    if (recordedPatch) shadow = applyPatch(batchBaseShadow, batchPatches);
  };

  const wouldExceedPatchCap = (result: StageToolResult): boolean =>
    result.status === "ok" &&
    result.patchCount > 0 &&
    emittedPatchOps + result.patchCount > MAX_PATCH_OPS;

  const executeReady = (op: PendingOp): readonly ServerMessage[] | undefined => {
    const result = executeStageTool(
      op.kind === "set"
        ? { id: `buffered:${op.node.id}`, name: "set_node", input: { node: op.node } }
        : {
            id: `buffered:${op.node.id}`,
            name: "append_node",
            input: { parentId: op.parentId, node: op.node },
          },
      { shadow, ...(assets === undefined ? {} : { assets }) },
    );
    if (result.status !== "ok" || wouldExceedPatchCap(result)) return undefined;
    emittedPatchOps += result.patchCount;
    recordMessages(result.messages);
    return result.messages;
  };

  const queuedPreflightObservation = (
    op: PendingOp,
    toolName: "append_node" | "set_node",
  ): string | undefined => {
    const node = { ...op.node, children: [] };
    const result = executeStageTool(
      toolName === "set_node"
        ? { id: `buffer-preflight:${op.node.id}`, name: "set_node", input: { node } }
        : {
            id: `buffer-preflight:${op.node.id}`,
            name: "append_node",
            input: { parentId: op.kind === "append" ? op.parentId : "", node },
          },
      { shadow, ...(assets === undefined ? {} : { assets }) },
    );
    return result.status === "ok" ? undefined : formatObservation(result);
  };

  const flushReady = (): readonly ServerMessage[] => {
    const messages: ServerMessage[] = [];
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const [id, op] of pending) {
        if (op.kind === "append" && !hasContainer(shadow, op.parentId)) continue;
        if (!isClosed(op.node, shadow)) continue;
        const readyMessages = executeReady(op);
        if (readyMessages === undefined) continue;
        appendMessages(messages, readyMessages);
        pending.delete(id);
        progressed = true;
      }
    }
    return messages;
  };

  const cumulativePatchLimitOutcome = (call: ToolCall): StageToolBufferOutcome => {
    return failedOutcome(
      rejectedObservation(
        call.name,
        "patch_limit",
        `error: ${call.name} — this step would exceed the patch op cap (${String(MAX_PATCH_OPS)}) for this streamed batch`,
        "Split the change into smaller edits.",
      ),
      shadow,
    );
  };

  const execute = (call: ToolCall, onAccepted?: () => void): StageToolBufferOutcome => {
    const result = executeStageTool(call, {
      shadow,
      ...(assets === undefined ? {} : { assets }),
    });
    if (wouldExceedPatchCap(result)) return cumulativePatchLimitOutcome(call);

    if (result.status !== "ok") return failedOutcome(formatObservation(result), shadow);
    if (call.name === "render_page") pending.clear();
    onAccepted?.();

    emittedPatchOps += result.patchCount;
    const messages: ServerMessage[] = [];
    appendMessages(messages, result.messages);
    recordMessages(result.messages);
    appendMessages(messages, flushReady());
    const stats = messageStats(messages);
    return {
      observation: formatObservation(result),
      messages,
      mutated: stats.mutated,
      said: stats.said,
      shadow,
    };
  };

  const runSetNode = (call: ToolCall): StageToolBufferOutcome => {
    const input = inputOf(call);
    const nodeId = nodeIdCandidate(input["node"]);
    const containerNode = containerNodeCandidate(input["node"]);
    if (containerNode !== undefined && !isClosed(containerNode, shadow)) {
      const op: PendingOp = { kind: "set", node: containerNode };
      const preflight = queuedPreflightObservation(op, "set_node");
      if (preflight !== undefined) return failedOutcome(preflight, shadow);
      pending.set(containerNode.id, op);
      return failedOutcome(
        queuedObservation("set_node", containerNode.id, missingChildRefs(containerNode, shadow)),
        shadow,
      );
    }
    return execute(call, nodeId !== undefined ? () => pending.delete(nodeId) : undefined);
  };

  const runAppendNode = (call: ToolCall): StageToolBufferOutcome => {
    const input = inputOf(call);
    const parentId = input["parentId"];
    if (typeof parentId === "string" && parentId.length > 0) {
      if (!hasNode(shadow, parentId)) {
        const missing = pendingMissing(parentId);
        if (missing !== undefined) {
          return failedOutcome(
            pendingObservation(
              "append_node",
              `error: append_node — parent "${parentId}" was created this turn but is still waiting for child node(s): ${summarizeIds(missing)}. Define those child nodes before appending into it.`,
              "Define the parent node's missing child node(s), then append into it.",
            ),
            shadow,
          );
        }
      } else if (hasContainer(shadow, parentId)) {
        const containerNode = containerNodeCandidate(input["node"]);
        if (containerNode !== undefined && !isClosed(containerNode, shadow)) {
          const op: PendingOp = { kind: "append", parentId, node: containerNode };
          const preflight = queuedPreflightObservation(op, "append_node");
          if (preflight !== undefined) return failedOutcome(preflight, shadow);
          pending.set(containerNode.id, op);
          return failedOutcome(
            queuedObservation(
              "append_node",
              containerNode.id,
              missingChildRefs(containerNode, shadow),
            ),
            shadow,
          );
        }
      }
    }
    const nodeId = nodeIdCandidate(input["node"]);
    return execute(call, nodeId !== undefined ? () => pending.delete(nodeId) : undefined);
  };

  const runRemoveNode = (call: ToolCall): StageToolBufferOutcome => {
    const nodeId = inputOf(call)["nodeId"];
    if (typeof nodeId === "string" && nodeId.length > 0) pending.delete(nodeId);
    return execute(call);
  };

  return {
    run(call) {
      switch (call.name) {
        case "set_node":
          return runSetNode(call);
        case "append_node":
          return runAppendNode(call);
        case "remove_node":
          return runRemoveNode(call);
        default:
          return execute(call);
      }
    },
    resetEmittedPatchOps() {
      if (batchPatches.length > 0) {
        shadow = foldPatchIntoStage(batchBaseShadow, batchPatches).tree;
      }
      emittedPatchOps = 0;
      batchBaseShadow = shadow;
      batchPatches.length = 0;
    },
    drainUnresolved() {
      const unresolved = Array.from(pending.values(), unresolvedObservation);
      pending.clear();
      return unresolved;
    },
    get shadow() {
      return shadow;
    },
  };
}

function childRefs(node: FacetNode): readonly NodeId[] {
  return isContainer(node) ? node.children : [];
}

function missingChildRefs(node: FacetNode, shadow: FacetTree): readonly NodeId[] {
  return childRefs(node).filter((id) => shadow.nodes[id] === undefined);
}

function isClosed(node: FacetNode, shadow: FacetTree): boolean {
  return missingChildRefs(node, shadow).length === 0;
}

function inputOf(call: ToolCall): Readonly<Record<string, unknown>> {
  return isRecord(call.input) ? call.input : {};
}

function nodeIdCandidate(value: unknown): NodeId | undefined {
  return isRecord(value) && typeof value["id"] === "string" && value["id"].length > 0
    ? value["id"]
    : undefined;
}

function containerNodeCandidate(value: unknown): FacetNode | undefined {
  if (!isRecord(value)) return undefined;
  const id = nodeIdCandidate(value);
  if (id === undefined) return undefined;
  const type = value["type"];
  if (type !== "box") return undefined;
  const children = value["children"];
  if (
    children !== undefined &&
    (!Array.isArray(children) ||
      !children.every((child): child is string => typeof child === "string"))
  ) {
    return undefined;
  }
  return {
    ...value,
    id,
    type,
    children: children ?? [],
  } as unknown as FacetNode;
}

function hasNode(shadow: FacetTree, id: NodeId): boolean {
  return shadow.nodes[id] !== undefined;
}

function hasContainer(shadow: FacetTree, id: NodeId): boolean {
  const node = shadow.nodes[id];
  return node !== undefined && isContainer(node);
}

function queuedObservation(tool: string, id: NodeId, missing: readonly NodeId[]): string {
  return pendingObservation(
    tool,
    `queued: "${id}" waits for child node(s): ${summarizeIds(missing)}`,
    "Define the missing child node(s), then continue the edit.",
  );
}

function failedOutcome(observation: string, shadow: FacetTree): StageToolBufferOutcome {
  return { observation, messages: [], mutated: false, said: false, shadow };
}

function messageStats(messages: readonly ServerMessage[]): {
  readonly mutated: boolean;
  readonly said: boolean;
} {
  return {
    mutated: messages.some((message) => message.kind === "patch" && message.patches.length > 0),
    said: messages.some((message) => message.kind === "say"),
  };
}

function summarizeIds(ids: readonly NodeId[]): string {
  const shown = ids.slice(0, MAX_ID_LIST_PREVIEW);
  const suffix = ids.length > shown.length ? `, +${String(ids.length - shown.length)} more` : "";
  return `${shown.join(", ")}${suffix}`;
}

function formatObservation(result: StageToolResult): string {
  return result.observation.text;
}

function pendingObservation(tool: string, message: string, nextAction: string): string {
  return formatAgentToolObservation({
    tool,
    status: "pending",
    outcome: "pending",
    code: "pending",
    message,
    applied: false,
    stageChanged: false,
    visibleToVisitor: false,
    patchCount: 0,
    nextAction,
    summary: "no stage changes",
  }).text;
}

function rejectedObservation(
  tool: string,
  code: "patch_limit",
  message: string,
  nextAction: string,
): string {
  return formatAgentToolObservation({
    tool,
    status: "error",
    outcome: "rejected",
    code,
    message,
    applied: false,
    stageChanged: false,
    visibleToVisitor: false,
    patchCount: 0,
    nextAction,
    summary: "no stage changes",
  }).text;
}

function appendMessages(target: ServerMessage[], messages: readonly ServerMessage[]): void {
  for (const message of messages) target.push(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
