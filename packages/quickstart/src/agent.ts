/**
 * The quickstart's built-in agent (a tool-calling loop, spec Decision 5):
 *
 *   sink.history → buildInitialMessages → [ provider.run(tools) →
 *   execute each tool against the Stage → observe ]* → flush.
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
import {
  MAX_PATCH_OPS,
  expandStamp,
  isSafeMediaSrc,
  isValidThemeName,
  MEDIA_KINDS,
  validateTree,
} from "@facet/core";
import type { FacetNode, FacetStamp, FacetTheme, FacetTree, NodeId } from "@facet/core";
import { defineStreamingAgent } from "@facet/agent";
import type { Stage } from "@facet/agent";
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
  return typeof value === "object" && value !== null;
}

function isObjectMap(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value);
}

function isBoxWithChildren(tree: FacetTree, id: NodeId | undefined): boolean {
  if (id === undefined) return false;
  const node = tree.nodes[id];
  return (
    node !== undefined &&
    node.type === "box" &&
    Array.isArray((node as { children?: unknown }).children) &&
    node.children.length > 0
  );
}

/**
 * The node the renderer will actually show first — mirrors
 * `StageRenderer.resolveScreenRoot` (entry screen → first live screen → plain
 * root). Kept in sync by hand: importing @facet/react would pull the browser
 * renderer into the node path.
 */
function renderRoot(tree: FacetTree): NodeId {
  const screens = tree.screens;
  if (screens !== undefined && Object.keys(screens).length > 0) {
    const entryRoot = typeof tree.entry === "string" ? screens[tree.entry] : undefined;
    if (entryRoot !== undefined && tree.nodes[entryRoot] !== undefined) return entryRoot;
    for (const id of Object.values(screens)) if (tree.nodes[id] !== undefined) return id;
  }
  return tree.root;
}

/**
 * A tree renders something only if the node the renderer WILL show (the entry
 * screen when there are screens, else the plain root) is a box with at least
 * one child. This rejects validateTree's EMPTY_TREE fallback so a render_page
 * of garbage can't wipe the stage — while correctly accepting a screens-only
 * page whose shell root is empty but whose entry screen has content.
 */
function isRenderable(tree: FacetTree): boolean {
  return isBoxWithChildren(tree, renderRoot(tree));
}

/**
 * Shape-check a node for the incremental tools, returning a SPECIFIC, actionable
 * reason on failure so the model can fix it (not a generic "invalid node"). It
 * rejects exactly the fields `validateTree` would DROP the node for
 * (text.value, media.src/kind, field.name), so a tool can't report "ok" for a
 * node that silently vanishes on apply. Deeper sanitization (tokens, poster,
 * dangling children) still happens at apply time. */
function asNode(value: unknown): { node: FacetNode } | { error: string } {
  if (!isRecord(value)) return { error: 'the "node" argument must be an object' };
  if (typeof value["id"] !== "string" || value["id"].length === 0) {
    return { error: 'the node needs a non-empty string "id"' };
  }
  switch (value["type"]) {
    case "box":
      if (value["children"] !== undefined) {
        if (
          !Array.isArray(value["children"]) ||
          !value["children"].every((child): child is string => typeof child === "string")
        ) {
          return { error: 'a "box" node needs "children" as an array of string ids' };
        }
      }
      return {
        node: {
          ...value,
          id: value["id"],
          type: "box",
          children: value["children"] ?? [],
        } as unknown as FacetNode,
      };
    case "text":
      if (typeof value["value"] !== "string") {
        return { error: 'a "text" node needs a string "value"' };
      }
      break;
    case "media":
      if (typeof value["src"] !== "string") {
        return { error: 'a "media" node needs string "src"' };
      }
      if (!isSafeMediaSrc(value["src"])) {
        return { error: 'a "media" node needs a safe static "src"' };
      }
      if (
        value["kind"] !== undefined &&
        (typeof value["kind"] !== "string" ||
          !(MEDIA_KINDS as readonly string[]).includes(value["kind"]))
      ) {
        return { error: 'a "media" node kind must be "image" or "video"' };
      }
      break;
    case "field":
      if (typeof value["name"] !== "string") {
        return { error: 'a "field" node needs a string "name"' };
      }
      break;
    default:
      return { error: '"type" must be one of "box" | "text" | "media" | "field"' };
  }
  return { node: value as unknown as FacetNode };
}

/** Join the first few validateTree issues into a compact, model-readable hint. */
function issueHint(issues: readonly string[]): string {
  if (issues.length === 0) return "";
  const shown = issues.slice(0, 5).join("; ");
  return issues.length > 5 ? `${shown}; …(+${String(issues.length - 5)} more)` : shown;
}

/** Derived from the single-source TOOLS so it can't drift from the real set. */
const TOOL_NAMES = TOOLS.map((t) => t.name).join(", ");

interface ClosureBuffer {
  render(tree: FacetTree): number;
  set(node: FacetNode): number;
  append(parentId: NodeId, node: FacetNode): number;
  remove(id: NodeId): number;
  recordPatchOps(count: number): void;
  emittedPatchOps(): number;
  resetEmittedPatchOps(): void;
  pendingMissing(id: NodeId): readonly NodeId[] | undefined;
  drainUnresolved(): readonly string[];
}

type PendingOp =
  | { readonly kind: "set"; readonly node: FacetNode }
  | { readonly kind: "append"; readonly parentId: NodeId; readonly node: FacetNode };

function childRefs(node: FacetNode): readonly NodeId[] {
  return node.type === "box" && Array.isArray((node as { children?: unknown }).children)
    ? node.children
    : [];
}

function missingChildRefs(node: FacetNode, knownIds: ReadonlySet<string>): readonly NodeId[] {
  return childRefs(node).filter((id) => !knownIds.has(id));
}

function isClosed(node: FacetNode, knownIds: ReadonlySet<string>): boolean {
  return missingChildRefs(node, knownIds).length === 0;
}

function createClosureBuffer(
  stage: Stage,
  knownIds: Set<string>,
  knownBoxIds: Set<string>,
): ClosureBuffer {
  const pending = new Map<NodeId, PendingOp>();
  let emittedPatchOps = 0;

  const rememberNode = (node: FacetNode): void => {
    knownIds.add(node.id);
    if (node.type === "box") knownBoxIds.add(node.id);
    else knownBoxIds.delete(node.id);
  };

  const emit = (op: PendingOp): number => {
    const patchOps = op.kind === "set" ? 1 : 2;
    if (op.kind === "set") stage.set(op.node);
    else stage.append(op.parentId, op.node);
    rememberNode(op.node);
    emittedPatchOps += patchOps;
    return patchOps;
  };

  const flushReady = (): number => {
    let emitted = 0;
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const [id, op] of pending) {
        if (op.kind === "append" && !knownBoxIds.has(op.parentId)) continue;
        if (!isClosed(op.node, knownIds)) continue;
        emitted += emit(op);
        pending.delete(id);
        progressed = true;
      }
    }
    return emitted;
  };
  const unresolvedObservation = (op: PendingOp): string => {
    const missing = missingChildRefs(op.node, knownIds);
    return `"${op.node.id}" still waits for child node(s): ${missing.join(", ")}`;
  };

  return {
    render(tree) {
      pending.clear();
      stage.render(tree);
      knownIds.clear();
      knownBoxIds.clear();
      for (const id of Object.keys(tree.nodes)) knownIds.add(id);
      for (const node of Object.values(tree.nodes)) {
        if (node.type === "box") knownBoxIds.add(node.id);
      }
      emittedPatchOps += 1;
      return 1;
    },
    set(node) {
      let emitted = 0;
      if (isClosed(node, knownIds)) {
        pending.delete(node.id);
        emitted += emit({ kind: "set", node });
      } else {
        pending.set(node.id, { kind: "set", node });
      }
      return emitted + flushReady();
    },
    append(parentId, node) {
      let emitted = 0;
      if (knownBoxIds.has(parentId) && isClosed(node, knownIds)) {
        pending.delete(node.id);
        emitted += emit({ kind: "append", parentId, node });
      } else {
        pending.set(node.id, { kind: "append", parentId, node });
      }
      return emitted + flushReady();
    },
    remove(id) {
      pending.delete(id);
      knownIds.delete(id);
      knownBoxIds.delete(id);
      stage.remove(id);
      emittedPatchOps += 1;
      return 1;
    },
    recordPatchOps(count) {
      emittedPatchOps += count;
    },
    emittedPatchOps() {
      return emittedPatchOps;
    },
    resetEmittedPatchOps() {
      emittedPatchOps = 0;
    },
    pendingMissing(id) {
      const op = pending.get(id);
      return op === undefined ? undefined : missingChildRefs(op.node, knownIds);
    },
    drainUnresolved() {
      const unresolved = Array.from(pending.values(), unresolvedObservation);
      pending.clear();
      return unresolved;
    },
  };
}

function queuedObservation(id: NodeId, missing: readonly NodeId[]): string {
  return `queued: "${id}" waits for child node(s): ${missing.join(", ")}`;
}

function emitExpandedStamp(
  closure: ClosureBuffer,
  parentId: NodeId,
  rootId: NodeId,
  nodes: Readonly<Record<NodeId, FacetNode>>,
): number {
  const root = nodes[rootId];
  if (root === undefined) return 0;
  let emitted = closure.append(parentId, root);
  for (const node of Object.values(nodes)) {
    if (node.id !== rootId) emitted += closure.set(node);
  }
  return emitted;
}

interface ToolOutcome {
  readonly observation: string;
  readonly mutated: boolean;
  readonly said: boolean;
}

/** Execute one tool call against the Stage, returning an observation for the
 * model. Never throws — bad arguments become an "error: ..." observation.
 * `knownIds` tracks which node ids exist so far this turn (seeded from the
 * current stage, updated by each tool) so append_node can reject a nonexistent
 * parent BEFORE it queues a child-link op the runtime would silently drop. */
function executeTool(
  call: ToolCall,
  stage: Stage,
  knownIds: Set<string>,
  knownBoxIds: Set<string>,
  closure: ClosureBuffer,
  stamps: ReadonlyMap<string, FacetStamp>,
): ToolOutcome {
  const fail = (observation: string): ToolOutcome => ({ observation, mutated: false, said: false });
  const input: Record<string, unknown> = isRecord(call.input) ? call.input : {};
  switch (call.name) {
    case "render_page": {
      const { tree, issues } = validateTree(input["tree"]);
      if (!isRenderable(tree)) {
        const hint = issueHint(issues);
        return fail(
          `error: render_page needs a full tree { root, nodes } whose entry screen (or root) is a box with at least one child. ` +
            (hint.length > 0
              ? `Fix these and retry: ${hint}`
              : "Provide a non-empty root/entry box and retry."),
        );
      }
      const emitted = closure.render(tree);
      const note =
        issues.length > 0 ? ` (note: dropped invalid node(s): ${issueHint(issues)})` : "";
      return { observation: `ok: page replaced${note}`, mutated: emitted > 0, said: false };
    }
    case "append_node": {
      const parentId = input["parentId"];
      if (typeof parentId !== "string" || parentId.length === 0) {
        return fail(
          'error: append_node needs a non-empty string "parentId" (the box to append into)',
        );
      }
      if (!knownIds.has(parentId)) {
        const pendingMissing = closure.pendingMissing(parentId as NodeId);
        if (pendingMissing !== undefined) {
          return fail(
            `error: append_node — parent "${parentId}" was created this turn but is still waiting for child node(s): ${pendingMissing.join(", ")}. Define those child nodes before appending into it.`,
          );
        }
        return fail(
          `error: append_node — parent "${parentId}" does not exist yet. Create it first with render_page or set_node, or append into an existing node.`,
        );
      }
      if (!knownBoxIds.has(parentId)) {
        return fail(`error: append_node — parent "${parentId}" is not a box`);
      }
      const result = asNode(input["node"]);
      if ("error" in result) return fail(`error: append_node — ${result.error}`);
      const emitted = closure.append(parentId as NodeId, result.node);
      if (emitted === 0) {
        return {
          observation: queuedObservation(result.node.id, missingChildRefs(result.node, knownIds)),
          mutated: false,
          said: false,
        };
      }
      return {
        observation: `ok: appended "${result.node.id}" under "${parentId}"`,
        mutated: true,
        said: false,
      };
    }
    case "set_node": {
      const result = asNode(input["node"]);
      if ("error" in result) return fail(`error: set_node — ${result.error}`);
      const emitted = closure.set(result.node);
      if (emitted === 0) {
        return {
          observation: queuedObservation(result.node.id, missingChildRefs(result.node, knownIds)),
          mutated: false,
          said: false,
        };
      }
      return { observation: `ok: set "${result.node.id}"`, mutated: true, said: false };
    }
    case "use_stamp": {
      const name = input["name"];
      if (typeof name !== "string" || name.length === 0) {
        return fail('error: use_stamp needs a non-empty string "name" from the STAMPS list');
      }
      const at = input["at"];
      if (!isObjectMap(at) || typeof at["parent"] !== "string" || at["parent"].length === 0) {
        return fail('error: use_stamp needs at={ "parent": "<box node id>" }');
      }
      const parent = at["parent"];
      if (!knownIds.has(parent)) {
        const pendingMissing = closure.pendingMissing(parent as NodeId);
        if (pendingMissing !== undefined) {
          return fail(
            `error: use_stamp — parent "${parent}" was created this turn but is still waiting for child node(s): ${pendingMissing.join(", ")}. Define those child nodes before using a stamp inside it.`,
          );
        }
        return fail(`error: use_stamp — parent "${parent}" does not exist yet`);
      }
      if (!knownBoxIds.has(parent)) {
        return fail(`error: use_stamp — parent "${parent}" is not a box`);
      }
      const stamp = stamps.get(name);
      if (stamp === undefined) {
        return fail(`error: use_stamp — unknown stamp "${name}". Pick a name from STAMPS.`);
      }
      const params = input["params"] ?? {};
      const expanded = expandStamp(stamp, params, { parent }, { existingIds: knownIds });
      if (expanded.root === undefined) {
        const hint = issueHint(expanded.issues);
        return fail(
          `error: use_stamp — could not expand "${name}"` + (hint.length > 0 ? `: ${hint}` : ""),
        );
      }
      const expansionPatchOps = Object.keys(expanded.nodes).length + 1;
      if (closure.emittedPatchOps() + expansionPatchOps > MAX_PATCH_OPS) {
        return fail(
          `error: use_stamp — expanded "${name}" would exceed the patch op cap (${String(MAX_PATCH_OPS)}) for this streamed batch`,
        );
      }
      const emitted = emitExpandedStamp(closure, parent, expanded.root, expanded.nodes);
      if (emitted === 0) {
        return fail(`error: use_stamp — expanded "${name}" but the subtree did not close`);
      }
      const note = expanded.issues.length > 0 ? ` note: ${issueHint(expanded.issues)}` : "";
      return {
        observation: `ok: used stamp "${name}"${note} ${JSON.stringify({
          root: expanded.root,
          slots: expanded.slots,
          ids: expanded.ids,
        })}`,
        mutated: true,
        said: false,
      };
    }
    case "remove_node": {
      const nodeId = input["nodeId"];
      if (typeof nodeId !== "string" || nodeId.length === 0) {
        return fail('error: remove_node needs a non-empty string "nodeId"');
      }
      const emitted = closure.remove(nodeId as NodeId);
      return { observation: `ok: removed "${nodeId}"`, mutated: emitted > 0, said: false };
    }
    case "say": {
      const text = input["text"];
      if (typeof text !== "string" || text.length === 0) {
        return fail('error: say needs a non-empty string "text"');
      }
      stage.say(text);
      return { observation: "ok: said", mutated: false, said: true };
    }
    case "set_theme": {
      const name = input["name"];
      if (typeof name !== "string" || name.length === 0) {
        return fail(
          'error: set_theme needs a non-empty string "name" (a theme from the THEMES list — a name only, never a CSS value)',
        );
      }
      // Gate the name with the same rule validateTree applies at save time. An
      // invalid name would be stripped from the stored stage while the raw
      // `add /theme` frame still reached live clients — a stored-vs-live divergence.
      // Refusing it here stops the frame from ever being emitted.
      if (!isValidThemeName(name)) {
        return fail(
          `error: "${name}" is not a valid theme name (letters/digits/_/-, max 64) — pick a name from the THEMES list`,
        );
      }
      stage.theme(name);
      closure.recordPatchOps(1);
      return { observation: `ok: theme set to "${name}"`, mutated: true, said: false };
    }
    default:
      return fail(`error: unknown tool "${call.name}". Available tools: ${TOOL_NAMES}`);
  }
}

export function createQuickstartAgent(
  options: QuickstartAgentOptions,
): ReturnType<typeof defineStreamingAgent> {
  const stamps = (options.stamps ?? []).map((stamp) => structuredClone(stamp));
  const stampMap = new Map(stamps.map((stamp) => [stamp.name, stamp]));
  const system = buildSystem(options.guide ?? DEFAULT_GUIDE, {
    themes: options.themes ?? [],
    stamps,
  });
  const historyTurns = options.historyTurns ?? HISTORY_TURNS;
  const maxSteps = options.maxSteps ?? MAX_STEPS;

  return defineStreamingAgent(async function* ({ event, session, stage }) {
    let mutated = false;
    let said = false;
    let finalText = "";
    let failure: unknown;
    let closure: ClosureBuffer | undefined;

    try {
      // Inside the try: a throwing sink must degrade like any other turn failure,
      // not blow up the whole agent.
      const history = await options.sink.history(options.agentId, session.visitor.visitorId);
      const messages: TurnMessage[] = buildInitialMessages(event, session, history, historyTurns);
      // Ids that exist so far this turn (seeded from the current stage) — lets
      // append_node reject a nonexistent parent instead of orphaning the node.
      const knownIds = new Set<string>(Object.keys(session.stage.nodes));
      const knownBoxIds = new Set<string>(
        Object.values(session.stage.nodes)
          .filter((node) => node.type === "box")
          .map((node) => node.id),
      );
      closure = createClosureBuffer(stage, knownIds, knownBoxIds);

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
        for (const call of result.toolCalls) {
          const outcome = executeTool(call, stage, knownIds, knownBoxIds, closure, stampMap);
          mutated = mutated || outcome.mutated;
          said = said || outcome.said;
          messages.push({ role: "tool_result", callId: call.id, content: outcome.observation });
        }
        yield;
        closure.resetEmittedPatchOps();
      }
    } catch (error) {
      // Provider/network/sink failure: keep whatever the stage already has.
      failure = error;
    }

    const unresolved = closure?.drainUnresolved() ?? [];
    if (unresolved.length > 0) {
      console.error("[facet-quickstart] unresolved buffered edits:", unresolved.join("; "));
      stage.say(FAILURE_SAY);
      said = true;
      finalText = "";
    }

    // The model ended cleanly with prose and never called say ⇒ surface the
    // prose as its chat reply (a chat answer shouldn't be swallowed).
    if (!said && finalText.trim().length > 0) {
      stage.say(finalText.trim());
      said = true;
    }

    // Nothing happened at all (no edits, no reply) ⇒ one concise line + apology.
    if (!mutated && !said) {
      console.error(
        "[facet-quickstart] turn produced nothing:",
        failure !== undefined ? errMsg(failure) : "no tool calls",
      );
      stage.say(FAILURE_SAY);
    }
  });
}
