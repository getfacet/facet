import { treeHasContent } from "@facet/core";
import type { ClientEvent, FacetSession, FacetTree, ServerMessage } from "@facet/core";

/** The page shown to a fresh visitor when no agent is connected. */
export const DEFAULT_OFFLINE_FACE: FacetTree = {
  root: "root",
  nodes: {
    root: {
      id: "root",
      type: "box",
      style: { direction: "col", gap: "sm", pad: "2xl", align: "center" },
      children: ["o1", "o2"],
    },
    o1: {
      id: "o1",
      type: "text",
      value: "This page is offline right now",
      style: { size: "xl", weight: "bold" },
    },
    o2: {
      id: "o2",
      type: "text",
      value: "Its agent isn't connected. Check back soon.",
      style: { color: "fg-muted" },
    },
  },
};

/** Does this session already hold a real page (beyond an empty root)? Delegates
 * to core's `treeHasContent` — the one canonical "shows something" predicate. */
function hasBuiltStage(session: FacetSession): boolean {
  return treeHasContent(session.stage);
}

/** What a visitor gets when no agent is connected: the offline face on a FRESH
 * visit, a short note otherwise. A RETURNING visitor's built page must never be
 * overwritten (the offline patch would be persisted over their real stage). */
export function offlineFor(
  offlineFace: FacetTree,
  event: ClientEvent,
  session?: FacetSession,
): readonly ServerMessage[] {
  return event.kind === "visit" && (session === undefined || !hasBuiltStage(session))
    ? [{ kind: "patch", patches: [{ op: "replace", path: "", value: offlineFace }] }]
    : [{ kind: "say", text: "This page's agent is offline right now — check back soon." }];
}
