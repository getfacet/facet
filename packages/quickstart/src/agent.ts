/**
 * The quickstart's built-in agent (spec Decision 5) — the turn loop that turns
 * one visitor event into provider messages and a safe stage update:
 *
 *   sink.history → buildSystem/buildTurnMessages → provider.generate →
 *   parseReply → validateTree → render-only-if-renderable + say.
 *
 * Fail-safe posture (DC-006, mirroring apps/playground generatePage +
 * live-agent.ts): at most MAX_ATTEMPTS provider calls per turn (single retry —
 * covering provider rejection, unparseable output, AND a tree that validates
 * down to nothing renderable); on final failure the stage is left UNTOUCHED
 * (no render is ever issued) and the visitor gets one apologetic say. The
 * agent never throws out of a turn, and never logs more than one concise
 * error line (never a key — keys live inside the provider's auth header only).
 */
import { validateTree } from "@facet/core";
import type { FacetAgent, FacetTree } from "@facet/core";
import { defineAgent } from "@facet/agent";
import type { Sink } from "@facet/runtime";
import { parseReply } from "./parse.js";
import { DEFAULT_GUIDE, HISTORY_TURNS, buildSystem, buildTurnMessages } from "./prompt.js";
import type { QuickstartProvider } from "./provider.js";

export interface QuickstartAgentOptions {
  readonly provider: QuickstartProvider;
  /** Deployer's page brief (layer ②). Defaults to the built-in DEFAULT_GUIDE. */
  readonly guide?: string;
  /** Conversation history source for prompt layer ③ (shared with the runtime). */
  readonly sink: Sink;
  readonly agentId: string;
  /** How many stored interactions layer ③ replays. Defaults to HISTORY_TURNS. */
  readonly historyTurns?: number;
}

/** Provider calls per turn: one attempt + one retry, matching generatePage. */
const MAX_ATTEMPTS = 2;

const FAILURE_SAY =
  "Sorry — I couldn't update the page this time, so I've left it as it was. Please try again.";

/**
 * A tree renders something only if its root box has at least one child — the
 * playground's isRenderable rule. This rejects validateTree's EMPTY_TREE
 * fallback (garbage that "validates" down to a blank page must not wipe the
 * visitor's current stage).
 */
function isRenderable(tree: FacetTree): boolean {
  const root = tree.nodes[tree.root];
  return root !== undefined && root.type === "box" && root.children.length > 0;
}

export function createQuickstartAgent(options: QuickstartAgentOptions): FacetAgent {
  const system = buildSystem(options.guide ?? DEFAULT_GUIDE);
  const historyTurns = options.historyTurns ?? HISTORY_TURNS;

  return defineAgent(async ({ event, session, stage }) => {
    let failure: unknown = new Error("quickstart turn made no attempt");
    try {
      const history = await options.sink.history(options.agentId, session.visitor.visitorId);
      const turn = {
        system,
        // buildTurnMessages is the single owner of the history cap (passing the
        // full history + the resolved limit); slicing here too would double-cap.
        messages: buildTurnMessages(event, session, history, historyTurns),
      };

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        try {
          const reply = parseReply(await options.provider.generate(turn));

          let tree: FacetTree | undefined;
          if (reply.tree !== undefined) {
            const validated = validateTree(reply.tree);
            if (!isRenderable(validated.tree)) {
              throw new Error(
                `model tree validated down to nothing renderable (${String(validated.issues.length)} issue(s))`,
              );
            }
            tree = validated.tree;
          }

          // Success: apply ONLY now — a failed attempt must never touch the stage.
          if (tree !== undefined) stage.render(tree);
          if (reply.say !== undefined) stage.say(reply.say);
          return;
        } catch (error) {
          failure = error;
        }
      }
    } catch (error) {
      failure = error;
    }

    // Final failure: stage untouched, one concise line, one apologetic say.
    console.error(
      "[facet-quickstart] turn failed:",
      failure instanceof Error ? failure.message : String(failure),
    );
    stage.say(FAILURE_SAY);
  });
}
