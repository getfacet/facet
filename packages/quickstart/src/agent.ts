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
import { isValidThemeName, validateTree } from "@facet/core";
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
  /** Operator stamps (reusable fragments) injected into prompt ② for the model
   * to copy under the id-prefix rule (validated by the caller). */
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

function isBoxWithChildren(tree: FacetTree, id: NodeId | undefined): boolean {
  if (id === undefined) return false;
  const node = tree.nodes[id];
  return node !== undefined && node.type === "box" && node.children.length > 0;
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
 * (text.value, image.src+alt, field.name), so a tool can't report "ok" for a
 * node that silently vanishes on apply. Deeper sanitization (tokens, safe src,
 * dangling children) still happens at apply time. */
function asNode(value: unknown): { node: FacetNode } | { error: string } {
  if (!isRecord(value)) return { error: 'the "node" argument must be an object' };
  if (typeof value["id"] !== "string" || value["id"].length === 0) {
    return { error: 'the node needs a non-empty string "id"' };
  }
  switch (value["type"]) {
    case "box":
      break; // validateTree defaults a missing/non-array children to []
    case "text":
      if (typeof value["value"] !== "string") {
        return { error: 'a "text" node needs a string "value"' };
      }
      break;
    case "image":
      if (typeof value["src"] !== "string" || typeof value["alt"] !== "string") {
        return { error: 'an "image" node needs string "src" and "alt"' };
      }
      break;
    case "field":
      if (typeof value["name"] !== "string") {
        return { error: 'a "field" node needs a string "name"' };
      }
      break;
    default:
      return { error: '"type" must be one of "box" | "text" | "image" | "field"' };
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
  render(tree: FacetTree): void;
  set(node: FacetNode): void;
  noteKnown(id: NodeId): void;
  remove(id: NodeId): void;
}

function childRefs(node: FacetNode): readonly NodeId[] {
  return node.type === "box" ? node.children : [];
}

function isClosed(node: FacetNode, knownIds: ReadonlySet<string>): boolean {
  return childRefs(node).every((id) => knownIds.has(id));
}

function createClosureBuffer(stage: Stage, knownIds: Set<string>): ClosureBuffer {
  const pending = new Map<NodeId, FacetNode>();

  const flushReady = (): void => {
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const [id, node] of pending) {
        if (!isClosed(node, knownIds)) continue;
        stage.set(node);
        pending.delete(id);
        knownIds.add(id);
        progressed = true;
      }
    }
  };

  return {
    render(tree) {
      pending.clear();
      stage.render(tree);
      knownIds.clear();
      for (const id of Object.keys(tree.nodes)) knownIds.add(id);
    },
    set(node) {
      knownIds.add(node.id);
      if (isClosed(node, knownIds)) stage.set(node);
      else pending.set(node.id, node);
      flushReady();
    },
    noteKnown(id) {
      knownIds.add(id);
      flushReady();
    },
    remove(id) {
      pending.delete(id);
      knownIds.delete(id);
    },
  };
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
  closure: ClosureBuffer,
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
      closure.render(tree);
      const note =
        issues.length > 0 ? ` (note: dropped invalid node(s): ${issueHint(issues)})` : "";
      return { observation: `ok: page replaced${note}`, mutated: true, said: false };
    }
    case "append_node": {
      const parentId = input["parentId"];
      if (typeof parentId !== "string" || parentId.length === 0) {
        return fail(
          'error: append_node needs a non-empty string "parentId" (the box to append into)',
        );
      }
      if (!knownIds.has(parentId)) {
        return fail(
          `error: append_node — parent "${parentId}" does not exist yet. Create it first with render_page or set_node, or append into an existing node.`,
        );
      }
      const result = asNode(input["node"]);
      if ("error" in result) return fail(`error: append_node — ${result.error}`);
      stage.append(parentId as NodeId, result.node);
      closure.noteKnown(result.node.id);
      return {
        observation: `ok: appended "${result.node.id}" under "${parentId}"`,
        mutated: true,
        said: false,
      };
    }
    case "set_node": {
      const result = asNode(input["node"]);
      if ("error" in result) return fail(`error: set_node — ${result.error}`);
      closure.set(result.node);
      return { observation: `ok: set "${result.node.id}"`, mutated: true, said: false };
    }
    case "remove_node": {
      const nodeId = input["nodeId"];
      if (typeof nodeId !== "string" || nodeId.length === 0) {
        return fail('error: remove_node needs a non-empty string "nodeId"');
      }
      stage.remove(nodeId as NodeId);
      closure.remove(nodeId as NodeId);
      return { observation: `ok: removed "${nodeId}"`, mutated: true, said: false };
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
      return { observation: `ok: theme set to "${name}"`, mutated: true, said: false };
    }
    default:
      return fail(`error: unknown tool "${call.name}". Available tools: ${TOOL_NAMES}`);
  }
}

export function createQuickstartAgent(
  options: QuickstartAgentOptions,
): ReturnType<typeof defineStreamingAgent> {
  const system = buildSystem(options.guide ?? DEFAULT_GUIDE, {
    themes: options.themes ?? [],
    stamps: options.stamps ?? [],
  });
  const historyTurns = options.historyTurns ?? HISTORY_TURNS;
  const maxSteps = options.maxSteps ?? MAX_STEPS;

  return defineStreamingAgent(async function* ({ event, session, stage }) {
    let mutated = false;
    let said = false;
    let finalText = "";
    let failure: unknown;

    try {
      // Inside the try: a throwing sink must degrade like any other turn failure,
      // not blow up the whole agent.
      const history = await options.sink.history(options.agentId, session.visitor.visitorId);
      const messages: TurnMessage[] = buildInitialMessages(event, session, history, historyTurns);
      // Ids that exist so far this turn (seeded from the current stage) — lets
      // append_node reject a nonexistent parent instead of orphaning the node.
      const knownIds = new Set<string>(Object.keys(session.stage.nodes));
      const closure = createClosureBuffer(stage, knownIds);

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
          const outcome = executeTool(call, stage, knownIds, closure);
          mutated = mutated || outcome.mutated;
          said = said || outcome.said;
          messages.push({ role: "tool_result", callId: call.id, content: outcome.observation });
        }
        yield;
      }
    } catch (error) {
      // Provider/network/sink failure: keep whatever the stage already has.
      failure = error;
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
