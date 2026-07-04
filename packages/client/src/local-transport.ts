import type { ClientEvent, FacetTransport, ServerMessage, VisitorContext } from "@facet/core";

/**
 * The one thing LocalTransport needs from a runtime: the request/response
 * `handle`. Structural (not `FacetRuntime`) so `@facet/runtime` stays a
 * dev-only dependency — any object with this method works.
 */
interface RuntimeLike {
  handle(
    visitor: VisitorContext,
    event: ClientEvent,
  ): Promise<{ readonly messages: readonly ServerMessage[] }>;
}

/**
 * An in-process transport — the client talks to a `FacetRuntime` directly, with
 * no network. Useful for embedding, demos, tests, and SSR: the full loop
 * (renderer + runtime + agent) runs in one process.
 */
export class LocalTransport implements FacetTransport {
  private readonly listeners = new Set<(message: ServerMessage) => void>();

  constructor(
    private readonly runtime: RuntimeLike,
    private readonly visitor: VisitorContext,
  ) {}

  send(event: ClientEvent): void {
    void this.runtime
      .handle(this.visitor, event)
      .then(({ messages }) => {
        for (const message of messages) {
          for (const listener of this.listeners) {
            listener(message);
          }
        }
      })
      .catch((error: unknown) => {
        // An agent throw must not become an unhandled rejection (process crash
        // in Node). Surface it as a chat notice instead.
        console.error("[facet] agent failed:", error);
        const notice: ServerMessage = { kind: "say", text: "(the agent hit an error)" };
        for (const listener of this.listeners) listener(notice);
      });
  }

  subscribe(onMessage: (message: ServerMessage) => void): () => void {
    this.listeners.add(onMessage);
    return () => {
      this.listeners.delete(onMessage);
    };
  }
}
