import type { ClientEvent, FacetTransport, ServerMessage, VisitorContext } from "@facet/core";
import type { FacetRuntime } from "@facet/runtime";

/**
 * An in-process transport — the client talks to a `FacetRuntime` directly, with
 * no network. Useful for embedding, demos, tests, and SSR: the full loop
 * (renderer + runtime + agent) runs in one process.
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
