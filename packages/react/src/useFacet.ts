import { useCallback, useEffect, useState } from "react";
import {
  EMPTY_TREE,
  foldPatchIntoStage,
  type ClientEvent,
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
  send(event: ClientEvent): void;
}

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

/**
 * Subscribes to a transport and keeps the stage in sync by folding patches
 * client-side with the very same `foldPatchIntoStage` the server uses (apply +
 * validate), so the rendered tree is the same normalized fold as the server's
 * stored stage by construction — the two views never diverge (invariant #2).
 */
export function useFacet(transport: FacetTransport, options?: UseFacetOptions): FacetState {
  const [tree, setTree] = useState<FacetTree>(options?.initialTree ?? EMPTY_TREE);
  const [chat, setChat] = useState<readonly string[]>([]);

  useEffect(() => {
    return transport.subscribe((message: ServerMessage) => {
      if (message.kind === "patch") {
        setTree((current) => {
          // Fold with the shared function: it applies the batch atomically,
          // salvages good ops on a throw, and validateTree-normalizes the
          // result — the exact steps the server runs, so both hold the SAME
          // tree. It never throws and always returns a FacetTree; the try/catch
          // is belt-and-braces so an impossible helper failure keeps the current
          // tree rather than crashing the render (invariant #2, fail-safe).
          try {
            return foldPatchIntoStage(current, message.patches).tree;
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

  return { tree, chat, send };
}
