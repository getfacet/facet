import { useCallback, useEffect, useState } from "react";
import {
  applyPatch,
  EMPTY_TREE,
  type ClientEvent,
  type FacetTransport,
  type FacetTree,
  type ServerMessage,
} from "@facet/core";

// FacetTransport now lives in @facet/core (it's a protocol type); re-exported
// here for back-compat with consumers that imported it from @facet/react.
export type { FacetTransport } from "@facet/core";

/** A root replace can carry arbitrary JSON — only accept something tree-shaped. */
function isTreeShaped(value: unknown): value is FacetTree {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { root?: unknown }).root === "string" &&
    typeof (value as { nodes?: unknown }).nodes === "object" &&
    (value as { nodes?: unknown }).nodes !== null
  );
}

export interface FacetState {
  readonly tree: FacetTree;
  readonly chat: readonly string[];
  send(event: ClientEvent): void;
}

/**
 * Subscribes to a transport and keeps the stage in sync by applying patches
 * client-side with the very same `applyPatch` the server uses, so the two
 * views never diverge.
 */
export function useFacet(transport: FacetTransport): FacetState {
  const [tree, setTree] = useState<FacetTree>(EMPTY_TREE);
  const [chat, setChat] = useState<readonly string[]>([]);

  useEffect(() => {
    return transport.subscribe((message: ServerMessage) => {
      if (message.kind === "patch") {
        setTree((current) => {
          // Fail-safe (invariant #2): a malformed patch must never crash the
          // render — keep the current tree if applyPatch throws, and never let
          // a root replace smuggle a non-tree (null/scalar) into `tree`, which
          // the FacetState type promises is a FacetTree.
          try {
            const next: unknown = applyPatch(current, message.patches);
            return isTreeShaped(next) ? next : current;
          } catch {
            return current;
          }
        });
      } else if (message.kind === "reset") {
        // Transport-synthesized on reconnect: the server is about to replay the
        // session (stage snapshot + full chat history), so clear accumulated
        // chat or every reconnect would duplicate the whole conversation.
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
