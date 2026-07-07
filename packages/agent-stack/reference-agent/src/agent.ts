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
import { createStageToolBuffer } from "@facet/agent-tools";
import type { FacetAgent, FacetStamp, FacetTheme, ServerMessage } from "@facet/core";
import type { JsonPatchOperation } from "@facet/core";
import type { StageToolAssets, StageToolBuffer } from "@facet/agent-tools";
import type { Sink } from "@facet/runtime";
import {
  DEFAULT_GUIDE,
  HISTORY_TURNS,
  TOOLS,
  buildInitialMessages,
  buildSystem,
} from "./prompt.js";
import type { QuickstartProvider, TurnMessage } from "./provider.js";

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

function appendMessages(target: ServerMessage[], messages: readonly ServerMessage[]): void {
  for (const message of messages) target.push(message);
}

function sayBatch(text: string): readonly ServerMessage[] {
  return [{ kind: "say", text }];
}

function coalescePatchMessages(messages: readonly ServerMessage[]): readonly ServerMessage[] {
  const patches: JsonPatchOperation[] = [];
  const out: ServerMessage[] = [];
  let placed = false;
  for (const message of messages) {
    if (message.kind !== "patch") {
      out.push(message);
      continue;
    }
    if (!placed) {
      out.push({ kind: "patch", patches });
      placed = true;
    }
    for (const patch of message.patches) patches.push(patch);
  }
  return out;
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
          appendMessages(batch, outcome.messages);
          messages.push({ role: "tool_result", callId: call.id, content: outcome.observation });
        }
        if (batch.length > 0) yield coalescePatchMessages(batch);
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
