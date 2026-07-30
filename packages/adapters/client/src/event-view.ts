import type { AgentEvent, StageRevision } from "@facet/core";

export interface AgentEventDraft {
  readonly eventName: string;
  readonly sourceNodeId: string;
  readonly arg?: string;
  readonly collect: AgentEvent["collect"];
}

export interface EventViewState {
  readonly eventId: string;
  readonly screen: string;
  readonly stageRevision: StageRevision;
  readonly [key: string]: unknown;
}

/**
 * Stamps the browser-owned event id and current stage revision onto the renderer
 * event draft. D-07's deleted view fields are intentionally not copied: the
 * outgoing object is exactly AgentEvent's closed wire shape.
 */
export function withEventView(draft: AgentEventDraft, view: EventViewState): AgentEvent {
  return Object.freeze({
    eventId: view.eventId,
    eventName: draft.eventName,
    sourceNodeId: draft.sourceNodeId,
    screen: view.screen,
    stageRevision: view.stageRevision,
    ...(typeof draft.arg === "string" ? { arg: draft.arg } : {}),
    collect: draft.collect,
  });
}
