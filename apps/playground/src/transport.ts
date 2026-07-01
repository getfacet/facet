import type { ClientEvent, ServerMessage, VisitorContext } from "@facet/core";
import type { FacetRuntime } from "@facet/runtime";
import type { FacetTransport } from "@facet/react";

/**
 * An in-process transport — the browser talks to the runtime directly, with no
 * network. It stands in for the future WebSocket/SSE transport (step 3) so the
 * playground can exercise the full loop (renderer + runtime + agent) today.
 */
export class LocalTransport implements FacetTransport {
  private readonly listeners = new Set<(message: ServerMessage) => void>();

  constructor(
    private readonly runtime: FacetRuntime,
    private readonly visitor: VisitorContext,
  ) {}

  send(event: ClientEvent): void {
    void this.runtime.handle(this.visitor, event).then((messages) => {
      for (const message of messages) {
        for (const listener of this.listeners) {
          listener(message);
        }
      }
    });
  }

  subscribe(onMessage: (message: ServerMessage) => void): () => void {
    this.listeners.add(onMessage);
    return () => {
      this.listeners.delete(onMessage);
    };
  }
}
