import type { AgentEvent, ConversationMessage, FacetTransport, ServerFrame } from "@facet/core";

const MAX_QUEUE = 100;
const POST_TIMEOUT_MS = 35_000;

function isConversationFrame(frame: ServerFrame): frame is ConversationMessage {
  return frame.kind === "conversation";
}

function streamUrl(baseUrl: string, sessionKey: string, lastEventId: string | undefined): string {
  const params = new URLSearchParams({ sessionKey });
  if (lastEventId !== undefined && lastEventId.length > 0) {
    params.set("lastEventId", lastEventId);
  }
  return `${baseUrl}/stream?${params.toString()}`;
}

/**
 * Browser transport over the reference server: Server-Sent Events for the
 * server→client ServerFrame stream, and ordered `POST /event` for the validated
 * AgentEvent payload the renderer creates.
 */
export class SseTransport implements FacetTransport {
  private ready = false;
  private readonly queue: AgentEvent[] = [];
  private readonly seenMessages = new Set<string>();
  private sendChain: Promise<void> = Promise.resolve();
  private lastEventId: string | undefined;

  constructor(
    private readonly baseUrl: string,
    private readonly sessionKey: string,
  ) {}

  send(event: AgentEvent): void {
    if (!this.ready) {
      if (this.queue.length >= MAX_QUEUE) {
        this.queue.shift();
      }
      this.queue.push(event);
      return;
    }
    this.commit(event);
  }

  private commit(event: AgentEvent): void {
    this.sendChain = this.sendChain
      .then(() =>
        fetch(`${this.baseUrl}/event`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionKey: this.sessionKey, event }),
          signal: AbortSignal.timeout(POST_TIMEOUT_MS),
        }).then(() => undefined),
      )
      .catch((error: unknown) => {
        console.error("[facet] event send failed:", error);
      });
  }

  subscribe(onFrame: (frame: ServerFrame) => void): () => void {
    const source = new EventSource(streamUrl(this.baseUrl, this.sessionKey, this.lastEventId));
    source.onopen = () => {
      this.ready = true;
      const pending = this.queue.splice(0, this.queue.length);
      for (const event of pending) {
        this.commit(event);
      }
    };
    source.onmessage = (message: MessageEvent<string>) => {
      try {
        if (message.lastEventId.length > 0) {
          this.lastEventId = message.lastEventId;
        }
        const frame = JSON.parse(message.data) as ServerFrame;
        if (isConversationFrame(frame)) {
          if (this.seenMessages.has(frame.messageId)) {
            return;
          }
          this.seenMessages.add(frame.messageId);
        }
        onFrame(frame);
      } catch {
        // Malformed frames are inert; the next valid frame can still land.
      }
    };
    return () => {
      source.close();
      this.ready = false;
    };
  }
}
