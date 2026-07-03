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
import { validateTree } from "@facet/core";
import type { FacetNode, FacetTree, NodeId } from "@facet/core";
import { defineAgent } from "@facet/agent";
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
}

/** Safety cap on tool-loop iterations per turn (one provider call each). */
const MAX_STEPS = 8;

const FAILURE_SAY =
  "Sorry — I couldn't update the page this time, so I've left it as it was. Please try again.";

const NODE_TYPES = new Set(["box", "text", "image", "field"]);

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * A tree renders something only if its root box has at least one child. This
 * rejects validateTree's EMPTY_TREE fallback so a render_page of garbage can't
 * wipe the visitor's current stage.
 */
function isRenderable(tree: FacetTree): boolean {
  const root = tree.nodes[tree.root];
  return root !== undefined && root.type === "box" && root.children.length > 0;
}

/** Lightweight node shape-check for the incremental tools; deep sanitization
 * still happens at apply time (runtime validateTree) and render time. */
function asNode(value: unknown): FacetNode | null {
  if (!isRecord(value)) return null;
  if (typeof value["id"] !== "string" || value["id"].length === 0) return null;
  if (typeof value["type"] !== "string" || !NODE_TYPES.has(value["type"])) return null;
  return value as unknown as FacetNode;
}

interface ToolOutcome {
  readonly observation: string;
  readonly mutated: boolean;
  readonly said: boolean;
}

/** Execute one tool call against the Stage, returning an observation for the
 * model. Never throws — bad arguments become an "error: ..." observation. */
function executeTool(call: ToolCall, stage: Stage): ToolOutcome {
  const input: Record<string, unknown> = isRecord(call.input) ? call.input : {};
  switch (call.name) {
    case "render_page": {
      const { tree, issues } = validateTree(input["tree"]);
      if (!isRenderable(tree)) {
        return {
          observation: `error: the tree has no renderable root box (${String(issues.length)} validation issue(s))`,
          mutated: false,
          said: false,
        };
      }
      stage.render(tree);
      return { observation: "ok: page replaced", mutated: true, said: false };
    }
    case "append_node": {
      const parentId = input["parentId"];
      const node = asNode(input["node"]);
      if (typeof parentId !== "string" || parentId.length === 0) {
        return {
          observation: "error: append_node needs a string parentId",
          mutated: false,
          said: false,
        };
      }
      if (node === null) {
        return {
          observation: "error: append_node needs a valid node (id + box|text|image|field type)",
          mutated: false,
          said: false,
        };
      }
      stage.append(parentId as NodeId, node);
      return {
        observation: `ok: appended ${node.id} under ${parentId}`,
        mutated: true,
        said: false,
      };
    }
    case "set_node": {
      const node = asNode(input["node"]);
      if (node === null) {
        return {
          observation: "error: set_node needs a valid node (id + box|text|image|field type)",
          mutated: false,
          said: false,
        };
      }
      stage.set(node);
      return { observation: `ok: set ${node.id}`, mutated: true, said: false };
    }
    case "remove_node": {
      const nodeId = input["nodeId"];
      if (typeof nodeId !== "string" || nodeId.length === 0) {
        return {
          observation: "error: remove_node needs a string nodeId",
          mutated: false,
          said: false,
        };
      }
      stage.remove(nodeId as NodeId);
      return { observation: `ok: removed ${nodeId}`, mutated: true, said: false };
    }
    case "say": {
      const text = input["text"];
      if (typeof text !== "string" || text.length === 0) {
        return { observation: "error: say needs non-empty text", mutated: false, said: false };
      }
      stage.say(text);
      return { observation: "ok: said", mutated: false, said: true };
    }
    default:
      return { observation: `error: unknown tool "${call.name}"`, mutated: false, said: false };
  }
}

export function createQuickstartAgent(
  options: QuickstartAgentOptions,
): ReturnType<typeof defineAgent> {
  const system = buildSystem(options.guide ?? DEFAULT_GUIDE);
  const historyTurns = options.historyTurns ?? HISTORY_TURNS;
  const maxSteps = options.maxSteps ?? MAX_STEPS;

  return defineAgent(async ({ event, session, stage }) => {
    const history = await options.sink.history(options.agentId, session.visitor.visitorId);
    const messages: TurnMessage[] = buildInitialMessages(event, session, history, historyTurns);

    let mutated = false;
    let said = false;
    let lastText = "";
    let failure: unknown;

    try {
      for (let step = 0; step < maxSteps; step += 1) {
        const result = await options.provider.run({ system, messages }, TOOLS);
        lastText = result.text;
        if (result.toolCalls.length === 0) break; // the model is done

        messages.push({ role: "assistant_tools", text: result.text, toolCalls: result.toolCalls });
        for (const call of result.toolCalls) {
          const outcome = executeTool(call, stage);
          mutated = mutated || outcome.mutated;
          said = said || outcome.said;
          messages.push({ role: "tool_result", callId: call.id, content: outcome.observation });
        }
      }
    } catch (error) {
      // Provider/network failure mid-loop: keep whatever the stage already has.
      failure = error;
    }

    // The model ended with prose and never called say ⇒ surface the prose as a
    // chat line (a chat answer shouldn't be swallowed).
    if (!said && lastText.trim().length > 0) {
      stage.say(lastText.trim());
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
