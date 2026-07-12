import {
  foldPatchIntoStage,
  MAX_PATCH_OPS,
  type FacetSession,
  type JsonPatchOperation,
  type ServerMessage,
} from "@facet/core";

export interface FoldedTurn {
  readonly session: FacetSession;
  readonly issues: readonly string[];
  readonly messages: readonly ServerMessage[];
  readonly recordMessages: readonly ServerMessage[];
  /** Whether the fold actually changed the stage. */
  readonly mutated: boolean;
}

/**
 * Fold a turn's patch messages through the same pure stage fold the client uses.
 * Multiple patch messages are concatenated and folded once so intermediate
 * dangling references cannot be pruned before a later operation resolves them.
 * The delivered list contains one coalesced patch at the first patch position.
 */
export function foldTurnIntoSession(
  session: FacetSession,
  messages: readonly ServerMessage[],
): FoldedTurn {
  // Avoid spread-push: an unsafe in-process agent could provide a huge array.
  const turnOps: JsonPatchOperation[] = [];
  let sawPatchMessage = false;
  let droppedPatchMessage = false;
  let hasPatch = false;
  for (const message of messages) {
    if (message.kind !== "patch") continue;
    sawPatchMessage = true;
    // This guard is reachable for untyped JS agents and unsafe casts before the
    // shared fold can perform its own array check.
    if (!Array.isArray(message.patches)) {
      console.error("[facet] dropped a patch message with non-array patches");
      droppedPatchMessage = true;
      continue;
    }
    hasPatch = true;
    for (const op of message.patches) turnOps.push(op);
  }

  if (!hasPatch) {
    const cleanMessages = sawPatchMessage ? messages.filter((m) => m.kind !== "patch") : messages;
    return {
      session,
      issues: [],
      messages: cleanMessages,
      recordMessages: cleanMessages,
      mutated: false,
    };
  }

  // Enforce the cap on the per-turn aggregate. Individually valid patch frames
  // can exceed it after coalescing and must be dropped as one non-mutating turn.
  if (turnOps.length > MAX_PATCH_OPS) {
    return {
      session,
      issues: [
        `patch turn dropped: ${String(turnOps.length)} ops exceeds the ${String(MAX_PATCH_OPS)}-op cap`,
      ],
      messages: messages.filter((m) => m.kind !== "patch"),
      recordMessages: messages.filter((m) => m.kind !== "patch"),
      mutated: false,
    };
  }

  const { tree, issues, mutated } = foldPatchIntoStage(session.stage, turnOps);
  const allIssues: string[] = [];
  for (const issue of issues) allIssues.push(issue);

  const coalescedPatch: ServerMessage = { kind: "patch", patches: turnOps };
  const delivered: ServerMessage[] = [];
  const recordMessages: ServerMessage[] = [];
  let placed = false;
  for (const message of messages) {
    if (message.kind === "patch") {
      if (!Array.isArray(message.patches)) continue;
      if (!placed) {
        delivered.push(coalescedPatch);
        placed = true;
      }
    } else {
      delivered.push(message);
    }
    recordMessages.push(message);
  }

  return {
    session: { ...session, stage: tree },
    issues: allIssues,
    messages: delivered,
    recordMessages: droppedPatchMessage ? recordMessages : messages,
    mutated,
  };
}
