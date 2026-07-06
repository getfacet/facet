import type {
  ClientEvent,
  CollectedEvent,
  FacetTransport,
  ServerMessage,
  VisitorContext,
} from "@facet/core";

/** Pre-connect sends are held until the stream opens; bound the buffer so a
 * transport that never (re)connects can't accumulate events forever. */
const MAX_QUEUE = 100;

/** The reference server's client→server endpoints. `/event` forwards to the
 * agent; `/record` only appends to the log (a locally-resolved tap). Both ride
 * the SAME serialized chain so append order == send order across the two. */
type Endpoint = "/event" | "/record";

/** A pre-connect send held until the stream opens, tagged with the endpoint it
 * must POST to so a queued `/record` doesn't lose its lane on flush. */
interface QueuedSend {
  readonly endpoint: Endpoint;
  readonly event: CollectedEvent;
}

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
  private readonly queue: QueuedSend[] = [];
  /** Serializes client→server POSTs: each starts only after the previous one
   * settles, so events arrive in the order they were sent (the queue flush
   * routes through `commit`, so ordering holds from pre-connect through live). */
  private sendChain: Promise<void> = Promise.resolve();
  /** Per-session monotonic counter, stamped onto every event at the single
   * serialization point (`commit`). A dropped event leaves a detectable gap. */
  private seq = 0;

  constructor(
    private readonly baseUrl: string,
    private readonly visitor: VisitorContext,
  ) {}

  send(event: ClientEvent): void {
    this.enqueueOrCommit("/event", event);
  }

  /**
   * Best-effort record of a locally-resolved tap over `POST /record` — it rides
   * the SAME pre-connect queue + `sendChain` as `send`, so its append order
   * relative to `/event`s is preserved. A failed `/record` POST is dropped (log,
   * no throw, no retry, no renderer callback) so it can never wedge the chain.
   */
  record(event: CollectedEvent): void {
    this.enqueueOrCommit("/record", event);
  }

  private enqueueOrCommit(endpoint: Endpoint, event: CollectedEvent): void {
    if (!this.ready) {
      if (this.queue.length >= MAX_QUEUE) {
        // Drop the oldest — but spare a leading "visit": it's the event the
        // queue exists to protect (it opens the session on the server).
        this.queue.splice(this.queue[0]?.event.kind === "visit" ? 1 : 0, 1);
      }
      this.queue.push({ endpoint, event });
      return;
    }
    this.commit(endpoint, event);
  }

  /** The single serialization point: stamp the send-order `seq` and append the
   * POST to `sendChain`. `seq` is assigned HERE (never in userland), so a
   * queued-then-flushed event gets its seq in flush order, monotonic across both
   * endpoints and every caller. */
  private commit(endpoint: Endpoint, event: CollectedEvent): void {
    this.seq += 1;
    const stamped: CollectedEvent = { ...event, seq: this.seq };
    this.sendChain = this.sendChain
      .then(() =>
        fetch(`${this.baseUrl}${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visitor: this.visitor, event: stamped }),
          signal: AbortSignal.timeout(POST_TIMEOUT_MS),
        }).then(() => undefined),
      )
      .catch((error: unknown) => {
        // A failed POST must not become an unhandled rejection or wedge the
        // chain; the event is lost, so at least leave a trace for the operator.
        // `/record` is best-effort by design — same log+drop, no throw, no retry.
        const label = endpoint === "/record" ? "record" : "event";
        console.error(`[facet] ${label} send failed:`, error);
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
      for (const { endpoint, event } of pending) this.commit(endpoint, event);
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
