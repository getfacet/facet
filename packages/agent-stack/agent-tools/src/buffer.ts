import { MAX_PATCH_OPS, applyPatch } from "@facet/core";
import type { FacetNode, FacetTree, JsonPatchOperation, NodeId, ServerMessage } from "@facet/core";
import { executeStageTool } from "./executor.js";
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
  assets: StageToolAssets = {},
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
    for (const message of messages) {
      if (message.kind !== "patch") continue;
      for (const patch of message.patches) batchPatches.push(patch);
    }
    shadow = applyPatch(batchBaseShadow, batchPatches);
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
      { shadow, assets },
    );
    if (result.status !== "ok" || wouldExceedPatchCap(result)) return undefined;
    emittedPatchOps += result.patchCount;
    recordMessages(result.messages);
    return result.messages;
  };

  const flushReady = (): readonly ServerMessage[] => {
    const messages: ServerMessage[] = [];
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const [id, op] of pending) {
        if (op.kind === "append" && !hasBox(shadow, op.parentId)) continue;
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
    const input = inputOf(call);
    const stampName = input["name"];
    const observation =
      call.name === "use_stamp" && typeof stampName === "string" && stampName.length > 0
        ? `error: use_stamp — expanded "${stampName}" would exceed the patch op cap (${String(MAX_PATCH_OPS)}) for this streamed batch`
        : `error: ${call.name} — this step would exceed the patch op cap (${String(MAX_PATCH_OPS)}) for this streamed batch`;
    return failedOutcome(observation, shadow);
  };

  const execute = (call: ToolCall): StageToolBufferOutcome => {
    const result = executeStageTool(call, { shadow, assets });
    if (wouldExceedPatchCap(result)) return cumulativePatchLimitOutcome(call);

    if (result.status !== "ok") return failedOutcome(formatObservation(result), shadow);
    if (call.name === "render_page") pending.clear();

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
    const boxNode = boxNodeCandidate(input["node"]);
    if (boxNode !== undefined && !isClosed(boxNode, shadow)) {
      pending.set(boxNode.id, { kind: "set", node: boxNode });
      return failedOutcome(
        queuedObservation(boxNode.id, missingChildRefs(boxNode, shadow)),
        shadow,
      );
    }
    if (nodeId !== undefined) pending.delete(nodeId);
    return execute(call);
  };

  const runAppendNode = (call: ToolCall): StageToolBufferOutcome => {
    const input = inputOf(call);
    const parentId = input["parentId"];
    if (typeof parentId === "string" && parentId.length > 0) {
      if (!hasNode(shadow, parentId)) {
        const missing = pendingMissing(parentId);
        if (missing !== undefined) {
          return failedOutcome(
            `error: append_node — parent "${parentId}" was created this turn but is still waiting for child node(s): ${summarizeIds(missing)}. Define those child nodes before appending into it.`,
            shadow,
          );
        }
      } else if (hasBox(shadow, parentId)) {
        const boxNode = boxNodeCandidate(input["node"]);
        if (boxNode !== undefined && !isClosed(boxNode, shadow)) {
          pending.set(boxNode.id, { kind: "append", parentId, node: boxNode });
          return failedOutcome(
            queuedObservation(boxNode.id, missingChildRefs(boxNode, shadow)),
            shadow,
          );
        }
        const nodeId = nodeIdCandidate(input["node"]);
        if (nodeId !== undefined) pending.delete(nodeId);
      }
    }
    return execute(call);
  };

  const runUseStamp = (call: ToolCall): StageToolBufferOutcome => {
    const at = inputOf(call)["at"];
    const parent = isRecord(at) ? at["parent"] : undefined;
    if (typeof parent === "string" && parent.length > 0 && !hasNode(shadow, parent)) {
      const missing = pendingMissing(parent);
      if (missing !== undefined) {
        return failedOutcome(
          `error: use_stamp — parent "${parent}" was created this turn but is still waiting for child node(s): ${summarizeIds(missing)}. Define those child nodes before using a stamp inside it.`,
          shadow,
        );
      }
    }
    return execute(call);
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
        case "use_stamp":
          return runUseStamp(call);
        case "remove_node":
          return runRemoveNode(call);
        default:
          return execute(call);
      }
    },
    resetEmittedPatchOps() {
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
  return node.type === "box" && Array.isArray((node as { children?: unknown }).children)
    ? node.children
    : [];
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

function boxNodeCandidate(value: unknown): FacetNode | undefined {
  if (!isRecord(value)) return undefined;
  if (value["type"] !== "box") return undefined;
  const id = nodeIdCandidate(value);
  if (id === undefined) return undefined;
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
    type: "box",
    children: children ?? [],
  } as unknown as FacetNode;
}

function hasNode(shadow: FacetTree, id: NodeId): boolean {
  return shadow.nodes[id] !== undefined;
}

function hasBox(shadow: FacetTree, id: NodeId): boolean {
  return shadow.nodes[id]?.type === "box";
}

function queuedObservation(id: NodeId, missing: readonly NodeId[]): string {
  return `queued: "${id}" waits for child node(s): ${summarizeIds(missing)}`;
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

function changedSummary(ids: readonly NodeId[]): string {
  if (ids.length === 0) return "none";
  const shown = ids.slice(0, 8).join(", ");
  return ids.length > 8 ? `${shown}, +${String(ids.length - 8)} more` : shown;
}

function summarizeIds(ids: readonly NodeId[]): string {
  const shown = ids.slice(0, MAX_ID_LIST_PREVIEW);
  const suffix = ids.length > shown.length ? `, +${String(ids.length - shown.length)} more` : "";
  return `${shown.join(", ")}${suffix}`;
}

function formatObservation(result: StageToolResult): string {
  const text = result.observation.text;
  if (
    result.status !== "ok" ||
    (result.patchCount === 0 && result.changedNodeIds.length === 0 && result.issues.length === 0)
  ) {
    return text;
  }

  const issuePart = result.issues.length > 0 ? `; issues=${String(result.issues.length)}` : "";
  const metadata = `(patches=${String(result.patchCount)}; changed=${changedSummary(
    result.changedNodeIds,
  )}; summary=${result.summary}${issuePart})`;
  const jsonStart = text.indexOf(' {"');
  if (jsonStart >= 0) {
    return `${text.slice(0, jsonStart)} ${metadata}${text.slice(jsonStart)}`;
  }
  return `${text} ${metadata}`;
}

function appendMessages(target: ServerMessage[], messages: readonly ServerMessage[]): void {
  for (const message of messages) target.push(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
