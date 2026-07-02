import type { ClientEvent, FacetTransport, ServerMessage, VisitorContext } from "@facet/core";

/** Pre-connect sends are held until the stream opens; bound the buffer so a
 * transport that never (re)connects can't accumulate events forever. */
const MAX_QUEUE = 100;

/**
 * Browser transport over the reference server: Server-Sent Events for the
 * server→client channel, `fetch` POST for client→server. Events sent before the
 * stream is open are queued and flushed on connect, so the first `visit` can't
 * race the stream registration.
 *
 * Browser-safe: web-standard `EventSource`/`fetch` only, no Node built-ins.
 */
export class SseTransport implements FacetTransport {
  private ready = false;
  private readonly queue: ClientEvent[] = [];

  constructor(
    private readonly baseUrl: string,
    private readonly visitor: VisitorContext,
  ) {}

  send(event: ClientEvent): void {
    if (!this.ready) {
      if (this.queue.length >= MAX_QUEUE) {
        // Drop the oldest — but spare a leading "visit": it's the event the
        // queue exists to protect (it opens the session on the server).
        this.queue.splice(this.queue[0]?.kind === "visit" ? 1 : 0, 1);
      }
      this.queue.push(event);
      return;
    }
    void fetch(`${this.baseUrl}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitor: this.visitor, event }),
    }).catch((error: unknown) => {
      // A failed POST must not become an unhandled rejection; the event is
      // lost, so at least leave a trace for the operator.
      console.error("[facet] event send failed:", error);
    });
  }

  subscribe(onMessage: (message: ServerMessage) => void): () => void {
    const source = new EventSource(
      `${this.baseUrl}/stream?visitorId=${encodeURIComponent(this.visitor.visitorId)}`,
    );
    let opened = false;
    source.onopen = () => {
      // EventSource auto-reconnects; every (re)open makes the server replay the
      // session (stage snapshot + full chat history). Stage replay is
      // idempotent, chat replay is not — synthesize a reset on RE-opens so the
      // client clears accumulated chat before the duplicate history arrives.
      if (opened) {
        onMessage({ kind: "reset" });
      }
      opened = true;
      this.ready = true;
      const pending = this.queue.splice(0, this.queue.length);
      for (const event of pending) this.send(event);
    };
    source.onmessage = (message: MessageEvent<string>) => {
      try {
        onMessage(JSON.parse(message.data) as ServerMessage);
      } catch {
        // ignore malformed frames
      }
    };
    return () => {
      source.close();
      this.ready = false;
    };
  }
}
