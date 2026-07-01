import { useCallback, useEffect, useState } from "react";
import {
  applyPatch,
  EMPTY_TREE,
  type ClientEvent,
  type FacetTree,
  type ServerMessage,
} from "@facet/core";

/**
 * The wire between a viewer and the runtime. A concrete transport wraps a
 * WebSocket or SSE connection; the demo uses an in-process one. Keeping it an
 * interface lets the same `useFacet` hook drive any of them.
 */
export interface FacetTransport {
  send(event: ClientEvent): void;
  subscribe(onMessage: (message: ServerMessage) => void): () => void;
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
        setTree((current) => applyPatch(current, message.patches));
      } else {
        setChat((current) => [...current, message.text]);
      }
    });
  }, [transport]);

  const send = useCallback(
    (event: ClientEvent) => transport.send(event),
    [transport],
  );

  return { tree, chat, send };
}
