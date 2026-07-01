import type {
  ClientEvent,
  FacetAgent,
  FacetSession,
  ServerMessage,
} from "@facet/core";
import { Stage } from "./stage.js";

export interface FacetContext {
  readonly event: ClientEvent;
  readonly session: FacetSession;
  /** The control surface for this viewer's page. */
  readonly stage: Stage;
}

/** The logic you write: react to an event by driving the stage. */
export type FacetLogic = (ctx: FacetContext) => void | Promise<void>;

/**
 * Wraps your logic into a `FacetAgent` the runtime can call. You drive `stage`;
 * the recorded commands are flushed into the messages sent back to the viewer.
 */
export function defineAgent(logic: FacetLogic): FacetAgent {
  return async (
    event: ClientEvent,
    session: FacetSession,
  ): Promise<readonly ServerMessage[]> => {
    const stage = new Stage();
    await logic({ event, session, stage });
    return stage.flush();
  };
}
