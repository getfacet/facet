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
        setTree((current) => applyPatch(current, message.patches));
      } else {
        setChat((current) => [...current, message.text]);
      }
    });
  }, [transport]);

  const send = useCallback((event: ClientEvent) => transport.send(event), [transport]);

  return { tree, chat, send };
}
