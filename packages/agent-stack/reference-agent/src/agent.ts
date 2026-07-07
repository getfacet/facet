/**
 * The Facet reference agent (a tool-calling loop):
 *
 *   sink.history → buildInitialMessages → [ provider.run(tools) →
 *   execute each tool with @facet/agent-tools → observe ]* → flush.
 *
 * Each turn the model calls tools across up to MAX_STEPS steps — appending /
 * setting / removing a node for incremental edits, render_page for a full
 * redraw, say to chat — observing the result of each before deciding the next.
 *
 * Fail-safe posture (DC-006): a bad tool argument becomes an "error" observation
 * the model can recover from, never a throw; a provider/network failure ends the
 * loop keeping whatever the stage already has; and a turn that accomplished
 * nothing gets one apologetic say. The agent never throws out of a turn and
 * never logs more than one concise error line (never a key — keys live inside
 * the provider's auth header only).
 */
import { MAX_PATCH_OPS } from "@facet/core";
import { executeStageTool } from "@facet/agent-tools";
import type {
  FacetAgent,
  FacetNode,
  FacetStamp,
  FacetTheme,
  FacetTree,
  NodeId,
  ServerMessage,
} from "@facet/core";
import type { StageToolAssets, StageToolResult } from "@facet/agent-tools";
import type { Sink } from "@facet/runtime";
import {
  DEFAULT_GUIDE,
  HISTORY_TURNS,
  TOOLS,
  buildInitialMessages,
  buildSystem,
} from "./prompt.js";
import type { QuickstartProvider, ToolCall, TurnMessage } from "./provider.js";

export interface QuickstartAgentOptions {
  readonly provider: QuickstartProvider;
  /** Deployer's page brief (layer ②). Defaults to the built-in DEFAULT_GUIDE. */
  readonly guide?: string;
  /** Conversation history source for prompt layer ③ (shared with the runtime). */
  readonly sink: Sink;
  readonly agentId: string;
  /** How many stored interactions layer ③ replays. Defaults to HISTORY_TURNS. */
  readonly historyTurns?: number;
  /** Max provider calls (tool steps) per turn. Defaults to MAX_STEPS. */
  readonly maxSteps?: number;
  /** Operator themes offered to the model by NAME in prompt ② (validated by the
   * caller). The model selects one with `set_theme`; values never reach it. */
  readonly themes?: readonly FacetTheme[];
  /** Operator stamps (reusable fragments) advertised by name for server-side expansion. */
  readonly stamps?: readonly FacetStamp[];
}

/**
 * Runaway-loop backstop, not a working constraint: a turn should end well
 * before this. It exists only so a model that never stops calling tools can't
 * burn the deployer's key forever on one visitor turn. Override with
 * `maxSteps` for a longer (or, set very high, effectively unbounded) budget.
 */
const MAX_STEPS = 50;

const FAILURE_SAY =
  "Sorry — I couldn't update the page this time, so I've left it as it was. Please try again.";

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type PendingOp =
  | { readonly kind: "set"; readonly node: FacetNode }
  | { readonly kind: "append"; readonly parentId: NodeId; readonly node: FacetNode };

interface ToolOutcome {
  readonly observation: string;
  readonly messages: readonly ServerMessage[];
  readonly mutated: boolean;
  readonly said: boolean;
}

interface StageToolBuffer {
  run(call: ToolCall): ToolOutcome;
  resetEmittedPatchOps(): void;
  drainUnresolved(): readonly string[];
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
  return `queued: "${id}" waits for child node(s): ${missing.join(", ")}`;
}

function failedOutcome(observation: string): ToolOutcome {
  return { observation, messages: [], mutated: false, said: false };
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

function appendCoalesced(target: ServerMessage[], messages: readonly ServerMessage[]): void {
  for (const message of messages) {
    const last = target[target.length - 1];
    if (last?.kind === "patch" && message.kind === "patch") {
      target[target.length - 1] = {
        kind: "patch",
        patches: [...last.patches, ...message.patches],
      };
    } else {
      target.push(message);
    }
  }
}

function sayBatch(text: string): readonly ServerMessage[] {
  return [{ kind: "say", text }];
}

function createStageToolBuffer(initialShadow: FacetTree, assets: StageToolAssets): StageToolBuffer {
  const pending = new Map<NodeId, PendingOp>();
  let shadow = initialShadow;
  let emittedPatchOps = 0;

  const pendingMissing = (id: NodeId): readonly NodeId[] | undefined => {
    const op = pending.get(id);
    return op === undefined ? undefined : missingChildRefs(op.node, shadow);
  };

  const unresolvedObservation = (op: PendingOp): string => {
    const missing = missingChildRefs(op.node, shadow);
    return `"${op.node.id}" still waits for child node(s): ${missing.join(", ")}`;
  };

  const executeReady = (op: PendingOp): readonly ServerMessage[] => {
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
    if (result.status !== "ok") return [];
    shadow = result.shadow;
    emittedPatchOps += result.patchCount;
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
        appendCoalesced(messages, executeReady(op));
        pending.delete(id);
        progressed = true;
      }
    }
    return messages;
  };

  const cumulativePatchLimitOutcome = (call: ToolCall): ToolOutcome => {
    const name = inputOf(call)["name"];
    return failedOutcome(
      typeof name === "string" && name.length > 0
        ? `error: use_stamp — expanded "${name}" would exceed the patch op cap (${String(MAX_PATCH_OPS)}) for this streamed batch`
        : `error: use_stamp — expanded stamp would exceed the patch op cap (${String(MAX_PATCH_OPS)}) for this streamed batch`,
    );
  };

  const execute = (call: ToolCall): ToolOutcome => {
    const result = executeStageTool(call, { shadow, assets });
    if (
      call.name === "use_stamp" &&
      result.status === "ok" &&
      result.patchCount > 0 &&
      emittedPatchOps + result.patchCount > MAX_PATCH_OPS
    ) {
      return cumulativePatchLimitOutcome(call);
    }

    if (result.status !== "ok") return failedOutcome(formatObservation(result));
    if (call.name === "render_page") pending.clear();
    shadow = result.shadow;
    emittedPatchOps += result.patchCount;

    const messages: ServerMessage[] = [];
    appendCoalesced(messages, result.messages);
    appendCoalesced(messages, flushReady());
    const stats = messageStats(messages);
    return {
      observation: formatObservation(result),
      messages,
      mutated: stats.mutated,
      said: stats.said,
    };
  };

  const runSetNode = (call: ToolCall): ToolOutcome => {
    const input = inputOf(call);
    const nodeId = nodeIdCandidate(input["node"]);
    const boxNode = boxNodeCandidate(input["node"]);
    if (boxNode !== undefined && !isClosed(boxNode, shadow)) {
      pending.set(boxNode.id, { kind: "set", node: boxNode });
      return failedOutcome(queuedObservation(boxNode.id, missingChildRefs(boxNode, shadow)));
    }
    if (nodeId !== undefined) pending.delete(nodeId);
    return execute(call);
  };

  const runAppendNode = (call: ToolCall): ToolOutcome => {
    const input = inputOf(call);
    const parentId = input["parentId"];
    if (typeof parentId === "string" && parentId.length > 0) {
      if (!hasNode(shadow, parentId)) {
        const missing = pendingMissing(parentId);
        if (missing !== undefined) {
          return failedOutcome(
            `error: append_node — parent "${parentId}" was created this turn but is still waiting for child node(s): ${missing.join(", ")}. Define those child nodes before appending into it.`,
          );
        }
      } else if (hasBox(shadow, parentId)) {
        const boxNode = boxNodeCandidate(input["node"]);
        if (boxNode !== undefined && !isClosed(boxNode, shadow)) {
          pending.set(boxNode.id, { kind: "append", parentId, node: boxNode });
          return failedOutcome(queuedObservation(boxNode.id, missingChildRefs(boxNode, shadow)));
        }
        const nodeId = nodeIdCandidate(input["node"]);
        if (nodeId !== undefined) pending.delete(nodeId);
      }
    }
    return execute(call);
  };

  const runUseStamp = (call: ToolCall): ToolOutcome => {
    const at = inputOf(call)["at"];
    const parent = isRecord(at) ? at["parent"] : undefined;
    if (typeof parent === "string" && parent.length > 0 && !hasNode(shadow, parent)) {
      const missing = pendingMissing(parent);
      if (missing !== undefined) {
        return failedOutcome(
          `error: use_stamp — parent "${parent}" was created this turn but is still waiting for child node(s): ${missing.join(", ")}. Define those child nodes before using a stamp inside it.`,
        );
      }
    }
    return execute(call);
  };

  const runRemoveNode = (call: ToolCall): ToolOutcome => {
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
    },
    drainUnresolved() {
      const unresolved = Array.from(pending.values(), unresolvedObservation);
      pending.clear();
      return unresolved;
    },
  };
}

export function createQuickstartAgent(options: QuickstartAgentOptions): FacetAgent {
  const stamps = (options.stamps ?? []).map((stamp) => structuredClone(stamp));
  const assets: StageToolAssets = { stamps };
  const system = buildSystem(options.guide ?? DEFAULT_GUIDE, {
    themes: options.themes ?? [],
    stamps,
  });
  const historyTurns = options.historyTurns ?? HISTORY_TURNS;
  const maxSteps = options.maxSteps ?? MAX_STEPS;

  return async function* (event, session) {
    let mutated = false;
    let said = false;
    let finalText = "";
    let failure: unknown;
    let buffer: StageToolBuffer | undefined;

    try {
      // Inside the try: a throwing sink must degrade like any other turn failure,
      // not blow up the whole agent.
      const history = await options.sink.history(options.agentId, session.visitor.visitorId);
      const messages: TurnMessage[] = buildInitialMessages(event, session, history, historyTurns);
      buffer = createStageToolBuffer(session.stage, assets);

      for (let step = 0; step < maxSteps; step += 1) {
        const result = await options.provider.run({ system, messages }, TOOLS);
        if (result.toolCalls.length === 0) {
          // Clean exit: the model stopped. Any prose here is its final chat reply
          // (captured ONLY on a clean stop — intermediate reasoning from a
          // partial/failed/truncated turn must never surface as the answer).
          finalText = result.text;
          break;
        }

        messages.push({ role: "assistant_tools", text: result.text, toolCalls: result.toolCalls });
        const batch: ServerMessage[] = [];
        for (const call of result.toolCalls) {
          const outcome = buffer.run(call);
          mutated = mutated || outcome.mutated;
          said = said || outcome.said;
          appendCoalesced(batch, outcome.messages);
          messages.push({ role: "tool_result", callId: call.id, content: outcome.observation });
        }
        if (batch.length > 0) yield batch;
        buffer.resetEmittedPatchOps();
      }
    } catch (error) {
      // Provider/network/sink failure: keep whatever the stage already has.
      failure = error;
    }

    const unresolved = buffer?.drainUnresolved() ?? [];
    if (unresolved.length > 0) {
      console.error("[facet-quickstart] unresolved buffered edits:", unresolved.join("; "));
      yield sayBatch(FAILURE_SAY);
      said = true;
      finalText = "";
    }

    // The model ended cleanly with prose and never called say ⇒ surface the
    // prose as its chat reply (a chat answer shouldn't be swallowed).
    if (!said && finalText.trim().length > 0) {
      yield sayBatch(finalText.trim());
      said = true;
    }

    // Nothing happened at all (no edits, no reply) ⇒ one concise line + apology.
    if (!mutated && !said) {
      console.error(
        "[facet-quickstart] turn produced nothing:",
        failure !== undefined ? errMsg(failure) : "no tool calls",
      );
      yield sayBatch(FAILURE_SAY);
    }
  };
}
