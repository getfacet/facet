import type { AgentEvent } from "@facet/core";

export const OFFLINE_TEXT = "This page's agent is offline right now — check back soon.";

export function offlineFor(_event: AgentEvent): string {
  return OFFLINE_TEXT;
}
