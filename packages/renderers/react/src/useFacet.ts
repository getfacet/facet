import { useCallback, useEffect, useState } from "react";
import {
  EMPTY_TREE,
  foldPatchIntoStage,
  type ClientEvent,
  type CollectedEvent,
  type FacetTransport,
  type FacetTree,
  type ServerMessage,
} from "@facet/core";

// FacetTransport lives in @facet/core (it's a protocol type). Re-exported here
// so a consumer wiring up the renderer can pull both `useFacet` and the type it
// takes from one import, without reaching into @facet/core directly.
export type { FacetTransport } from "@facet/core";

export interface FacetState {
  readonly tree: FacetTree;
  readonly chat: readonly string[];
  readonly transition?: StageTransitionHint;
  send(event: ClientEvent): void;
  /**
   * Best-effort record of a locally-resolved tap (navigate/toggle) to the
   * runtime log — wired to the transport's optional `record`. When the transport
   * doesn't implement `record` (e.g. an in-process/test double), this is a safe
   * no-op, so the renderer's fire-and-forget `onRecord` can call it either way.
   */
  record(event: CollectedEvent): void;
}

export interface StageTransitionHint {
  readonly revision: number;
  readonly rootReplaced: boolean;
  /**
   * The latest revision whose applied patch batch wrote the root document.
   * Preserved across later non-root revisions so a renderer that observes a
   * batched final state can still detect the root replacement.
   */
  readonly rootReplacedRevision?: number;
}

export type UseFacetState = FacetState & { readonly transition: StageTransitionHint };

export interface UseFacetOptions {
  /**
   * A boot-shipped seed tree the host can hand in so the first paint doesn't
   * wait for the first server frame (e.g. inlined into the page shell). The
   * server's seed frame — a root replace with the same validated tree — then
   * applies idempotently, so the server stays the only writer of stage content;
   * this only moves the first paint earlier. Absent ⇒ starts from `EMPTY_TREE`.
   */
  readonly initialTree?: FacetTree;
}

interface StageState {
  readonly tree: FacetTree;
  readonly transition: StageTransitionHint;
}

const INITIAL_TRANSITION: StageTransitionHint = { revision: 0, rootReplaced: false };

/**
 * Subscribes to a transport and keeps the stage in sync by folding patches
 * client-side with the very same `foldPatchIntoStage` the server uses (apply +
 * validate), so the rendered tree is the same normalized fold as the server's
 * stored stage by construction — the two views never diverge (invariant #2).
 */
export function useFacet(transport: FacetTransport, options?: UseFacetOptions): UseFacetState {
  const [stage, setStage] = useState<StageState>({
    tree: options?.initialTree ?? EMPTY_TREE,
    transition: INITIAL_TRANSITION,
  });
  const [chat, setChat] = useState<readonly string[]>([]);

  useEffect(() => {
    return transport.subscribe((message: ServerMessage) => {
      if (message.kind === "patch") {
        setStage((current) => {
          // Fold with the shared function: it applies the batch atomically,
          // salvages good ops on a throw, and validateTree-normalizes the
          // result — the exact steps the server runs, so both hold the SAME
          // tree. It never throws and always returns a FacetTree; the try/catch
          // is belt-and-braces so an impossible helper failure keeps the current
          // tree rather than crashing the render (invariant #2, fail-safe).
          try {
            const folded = foldPatchIntoStage(current.tree, message.patches);
            if (!folded.mutated) {
              return { tree: folded.tree, transition: current.transition };
            }
            const revision = current.transition.revision + 1;
            const rootReplaced = folded.rootReplaced === true;
            const rootReplacedRevision = rootReplaced
              ? revision
              : current.transition.rootReplacedRevision;
            return {
              tree: folded.tree,
              transition: {
                revision,
                rootReplaced,
                ...(rootReplacedRevision !== undefined ? { rootReplacedRevision } : {}),
              },
            };
          } catch {
            return current;
          }
        });
      } else if (message.kind === "reset") {
        // Server-emitted on a full rehydrate: it is about to replay the session
        // (stage snapshot + full chat history), so clear accumulated chat or
        // every rehydrate would duplicate the whole conversation.
        setChat([]);
      } else if (message.kind === "say" && typeof message.text === "string") {
        setChat((current) => [...current, message.text]);
      }
      // Unknown kinds are ignored (fail-safe) — never push undefined into chat.
    });
  }, [transport]);

  const send = useCallback((event: ClientEvent) => transport.send(event), [transport]);
  // `transport.record` is optional (additive protocol method): absent it, the
  // optional-chained call is a safe no-op, so the renderer can wire `onRecord`
  // to this unconditionally.
  const record = useCallback((event: CollectedEvent) => transport.record?.(event), [transport]);

  return { tree: stage.tree, chat, transition: stage.transition, send, record };
}
