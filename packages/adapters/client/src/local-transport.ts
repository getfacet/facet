import type { AgentEvent, ConversationMessage, FacetTransport, ServerFrame } from "@facet/core";

type RuntimeHandleResult =
  | readonly ServerFrame[]
  | {
      readonly frames?: readonly ServerFrame[];
    };

interface RuntimeLike {
  handle(input: {
    readonly sessionKey: string;
    readonly event: AgentEvent;
  }): Promise<RuntimeHandleResult>;
}

function isConversationFrame(frame: ServerFrame): frame is ConversationMessage {
  return frame.kind === "conversation";
}

function isFrameArray(result: RuntimeHandleResult): result is readonly ServerFrame[] {
  return Array.isArray(result);
}

function framesFrom(result: RuntimeHandleResult): readonly ServerFrame[] {
  return isFrameArray(result) ? result : (result.frames ?? []);
}

/**
 * In-process transport over any runtime-like object that can accept an AgentEvent
 * and return ServerFrame values. Structural by design: production code imports
 * only `@facet/core`, never the runtime package.
 */
export class LocalTransport implements FacetTransport {
  private readonly listeners = new Set<(frame: ServerFrame) => void>();
  private readonly seenMessages = new Set<string>();

  constructor(
    private readonly runtime: RuntimeLike,
    private readonly sessionKey: string,
  ) {}

  send(event: AgentEvent): void {
    void this.runtime
      .handle({ sessionKey: this.sessionKey, event })
      .then((result) => {
        for (const frame of framesFrom(result)) {
          this.deliver(frame);
        }
      })
      .catch((error: unknown) => {
        console.error("[facet] local transport failed:", error);
      });
  }

  private deliver(frame: ServerFrame): void {
    if (isConversationFrame(frame)) {
      if (this.seenMessages.has(frame.messageId)) {
        return;
      }
      this.seenMessages.add(frame.messageId);
    }
    for (const listener of this.listeners) {
      listener(frame);
    }
  }

  subscribe(onFrame: (frame: ServerFrame) => void): () => void {
    this.listeners.add(onFrame);
    return () => {
      this.listeners.delete(onFrame);
    };
  }
}
