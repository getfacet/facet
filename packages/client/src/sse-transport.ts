import type { ClientEvent, FacetTransport, ServerMessage, VisitorContext } from "@facet/core";

/** Pre-connect sends are held until the stream opens; bound the buffer so a
 * transport that never (re)connects can't accumulate events forever. */
const MAX_QUEUE = 100;

/** Pure network headroom — the POST is answered 202 before the turn runs, so a
 * healthy request settles fast. The abort exists only so a black-holed POST
 * (no response ever) can't wedge the ordered send chain. */
const POST_TIMEOUT_MS = 10_000;

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
  /** Serializes client→server POSTs: each starts only after the previous one
   * settles, so events arrive in the order they were sent (the queue flush
   * routes through `send`, so ordering holds from pre-connect through live). */
  private sendChain: Promise<void> = Promise.resolve();

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
    this.sendChain = this.sendChain
      .then(() =>
        fetch(`${this.baseUrl}/event`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visitor: this.visitor, event }),
          signal: AbortSignal.timeout(POST_TIMEOUT_MS),
        }).then(() => undefined),
      )
      .catch((error: unknown) => {
        // A failed POST must not become an unhandled rejection or wedge the
        // chain; the event is lost, so at least leave a trace for the operator.
        console.error("[facet] event send failed:", error);
      });
  }

  subscribe(onMessage: (message: ServerMessage) => void): () => void {
    const source = new EventSource(
      `${this.baseUrl}/stream?visitorId=${encodeURIComponent(this.visitor.visitorId)}`,
    );
    source.onopen = () => {
      // EventSource auto-reconnects and re-sends Last-Event-ID, so the server
      // decides whether a reopen gets a RESUME replay (no reset) or a FULL
      // rehydrate (preceded by an explicit `reset` frame). The client can't tell
      // the two apart, so it never synthesizes a reset — it just relays frames.
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
