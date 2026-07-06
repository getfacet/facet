import type { ClientEvent, FacetAgent, FacetSession, ServerMessage } from "@facet/core";
import { Stage } from "./stage.js";

export interface FacetContext {
  readonly event: ClientEvent;
  readonly session: FacetSession;
  /** The control surface for this visitor's page. */
  readonly stage: Stage;
}

/** The logic you write: react to an event by driving the stage. */
export type FacetLogic = (ctx: FacetContext) => void | Promise<void>;
export type StreamingFacetLogic = (
  ctx: FacetContext,
) => Iterable<unknown> | AsyncIterable<unknown> | Promise<Iterable<unknown> | AsyncIterable<unknown>>;

/**
 * Wraps your logic into a `FacetAgent` the runtime can call. You drive `stage`;
 * the recorded commands are flushed into the messages sent back to the visitor.
 */
export function defineAgent(logic: FacetLogic): FacetAgent {
  return async (event: ClientEvent, session: FacetSession): Promise<readonly ServerMessage[]> => {
    const stage = new Stage();
    await logic({ event, session, stage });
    return stage.flush();
  };
}

function flushNonEmpty(stage: Stage): readonly ServerMessage[] | undefined {
  const messages = stage.flush();
  return messages.length > 0 ? messages : undefined;
}

/**
 * Wraps async-generator logic into a streaming `FacetAgent`.
 *
 * Each yielded step is a producer-chosen boundary. Any commands recorded since
 * the previous boundary are flushed as one batch; empty boundaries are skipped.
 * A final tail flush preserves commands recorded after the last yielded step.
 */
export function defineStreamingAgent(logic: StreamingFacetLogic): FacetAgent {
  return async function* (
    event: ClientEvent,
    session: FacetSession,
  ): AsyncIterable<readonly ServerMessage[]> {
    const stage = new Stage();
    const steps = await logic({ event, session, stage });
    for await (const step of steps) {
      void step;
      const messages = flushNonEmpty(stage);
      if (messages !== undefined) yield messages;
    }

    const tail = flushNonEmpty(stage);
    if (tail !== undefined) yield tail;
  };
}
