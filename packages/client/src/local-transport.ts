import type {
  ClientEvent,
  CollectedEvent,
  FacetTransport,
  ServerMessage,
  VisitorContext,
} from "@facet/core";

/**
 * The two things LocalTransport needs from a runtime: the request/response
 * `handle`, and the optional fire-and-forget `record` (a locally-resolved tap
 * appended to the log without an agent turn). Structural (not `FacetRuntime`)
 * so `@facet/runtime` stays a dev-only dependency — any object with these
 * methods works. `record` is optional: a runtime double without it is a safe
 * no-op.
 */
interface RuntimeLike {
  handle(
    visitor: VisitorContext,
    event: ClientEvent,
  ): Promise<{ readonly messages: readonly ServerMessage[] }>;
  record?(visitor: VisitorContext, event: CollectedEvent): Promise<unknown>;
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

  /**
   * Best-effort record of a locally-resolved tap: forward it to the runtime's
   * `record` (no agent turn). Fire-and-forget — a synchronous throw or an async
   * rejection is swallowed (logged) so a record failure can never unwind the
   * renderer's optimistic view-state.
   */
  record(event: CollectedEvent): void {
    try {
      void this.runtime.record?.(this.visitor, event)?.catch((error: unknown) => {
        console.error("[facet] record failed:", error);
      });
    } catch (error: unknown) {
      console.error("[facet] record failed:", error);
    }
  }

  subscribe(onMessage: (message: ServerMessage) => void): () => void {
    this.listeners.add(onMessage);
    return () => {
      this.listeners.delete(onMessage);
    };
  }
}
