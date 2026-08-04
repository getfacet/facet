import type { VisitorEvent, ConversationMessage, FacetTransport, ServerFrame } from "@facet/core";

const MAX_QUEUE = 100;
const POST_TIMEOUT_MS = 35_000;
const STREAM_OPEN_TIMEOUT_MS = 10_000;
const MAX_ABORT_TIMEOUT_MS = 2_147_483_647;

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

export interface SseVisitorMessageInput {
  readonly messageId: string;
  readonly text: string;
  readonly screen: string;
  readonly stageRevision: number;
}

export interface SseTransportOptions {
  readonly postTimeoutMs?: number;
}

type PendingSend =
  | {
      readonly kind: "event";
      readonly event: VisitorEvent;
      readonly resolve: () => void;
      readonly reject: (error: unknown) => void;
    }
  | {
      readonly kind: "message";
      readonly message: SseVisitorMessageInput;
      readonly resolve: () => void;
      readonly reject: (error: unknown) => void;
    };

/**
 * Browser transport over the reference server: Server-Sent Events for the
 * server→client ServerFrame stream, and ordered `POST /event` for the validated
 * VisitorEvent payload the renderer creates.
 */
export class SseTransport implements FacetTransport {
  private ready = false;
  private readonly queue: PendingSend[] = [];
  private readonly seenMessages = new Set<string>();
  private sendChain: Promise<void> = Promise.resolve();
  private lastEventId: string | undefined;
  private subscribed = false;
  private readonly postTimeoutMs: number;

  constructor(
    private readonly baseUrl: string,
    private readonly sessionKey: string,
    options: SseTransportOptions = {},
  ) {
    this.postTimeoutMs = positiveIntegerOption(options.postTimeoutMs, POST_TIMEOUT_MS);
  }

  send(event: VisitorEvent): Promise<void> {
    return this.enqueue({ kind: "event", event });
  }

  sendMessage(message: SseVisitorMessageInput): Promise<void> {
    return this.enqueue({ kind: "message", message });
  }

  private enqueue(
    input:
      | { readonly kind: "event"; readonly event: VisitorEvent }
      | { readonly kind: "message"; readonly message: SseVisitorMessageInput },
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const pending = Object.freeze({ ...input, resolve, reject }) as PendingSend;
      if (!this.subscribed) {
        reject(new Error("transport disconnected"));
        return;
      }
      if (!this.ready) {
        if (this.queue.length >= MAX_QUEUE) {
          this.queue.shift()?.reject(new Error("send queue full"));
        }
        this.queue.push(pending);
        return;
      }
      this.commit(pending);
    });
  }

  private commit(pending: PendingSend): void {
    this.sendChain = this.sendChain
      .then(() => this.post(pending))
      .then(pending.resolve, (error) => {
        pending.reject(error);
        console.error("[facet] send failed:", error);
      });
  }

  private async post(pending: PendingSend): Promise<void> {
    const target =
      pending.kind === "event"
        ? {
            path: "/event",
            body: { sessionKey: this.sessionKey, event: pending.event },
          }
        : {
            path: "/message",
            body: { sessionKey: this.sessionKey, ...pending.message },
          };
    const response = await fetch(`${this.baseUrl}${target.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(target.body),
      signal: AbortSignal.timeout(this.postTimeoutMs),
    });
    if (!response.ok) {
      throw new Error(`POST ${target.path} failed: ${String(response.status)}`);
    }
  }

  private discardQueuedSends(reason: string): void {
    if (!this.ready) {
      const pending = this.queue.splice(0, this.queue.length);
      for (const entry of pending) {
        entry.reject(new Error(reason));
      }
    }
  }

  subscribe(onFrame: (frame: ServerFrame) => void): () => void {
    const source = new EventSource(streamUrl(this.baseUrl, this.sessionKey, this.lastEventId));
    this.subscribed = true;
    const openTimer = setTimeout(() => {
      if (!this.ready) {
        this.subscribed = false;
        source.close();
        this.discardQueuedSends("transport open timed out");
      }
    }, STREAM_OPEN_TIMEOUT_MS);
    unrefTimer(openTimer);
    source.onopen = () => {
      clearTimeout(openTimer);
      this.ready = true;
      const pending = this.queue.splice(0, this.queue.length);
      for (const entry of pending) {
        this.commit(entry);
      }
    };
    source.onerror = () => {
      if (!this.ready) {
        this.discardQueuedSends("transport disconnected");
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
      clearTimeout(openTimer);
      source.close();
      this.subscribed = false;
      this.ready = false;
      this.discardQueuedSends("transport disconnected");
    };
  }
}

function positiveIntegerOption(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.min(Math.floor(value), MAX_ABORT_TIMEOUT_MS);
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (
    typeof timer === "object" &&
    timer !== null &&
    "unref" in timer &&
    typeof timer.unref === "function"
  ) {
    timer.unref();
  }
}
