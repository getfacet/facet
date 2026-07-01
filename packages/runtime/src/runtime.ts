import {
  applyPatch,
  type ClientEvent,
  type FacetAgent,
  type FacetSession,
  type FacetTree,
  type ServerMessage,
  type VisitorContext,
} from "@facet/core";
import { MemoryStageStore, type StageStore } from "./stage-store.js";
import { MemorySink, type Sink, type StoredEvent } from "./sink.js";

export interface FacetRuntimeOptions {
  readonly agentId: string;
  readonly agent: FacetAgent;
  /** Where the current page lives. Defaults to in-memory. */
  readonly stageStore?: StageStore;
  /** Where the conversation goes. Defaults to an in-memory (replayable) sink. */
  readonly sink?: Sink;
}

/**
 * Wires a transport's inbound events to the agent and keeps each session's stage
 * up to date. A transport (SSE server, or the in-process demo) calls `handle` for
 * every event from a viewer and ships the returned messages back.
 *
 * Two persistence concerns are kept separate: the STAGE (always Facet's, via
 * `stageStore`) and the CONVERSATION (optional, via `sink` — store, forward, or drop).
 */
export class FacetRuntime {
  private readonly agentId: string;
  private readonly agent: FacetAgent;
  private readonly stageStore: StageStore;
  private readonly sink: Sink;

  constructor(options: FacetRuntimeOptions) {
    this.agentId = options.agentId;
    this.agent = options.agent;
    this.stageStore = options.stageStore ?? new MemoryStageStore();
    this.sink = options.sink ?? new MemorySink();
  }

  /**
   * The current stage for a viewer, if a session exists. A transport uses this to
   * send a snapshot when a viewer (re)connects, so a fresh connection or a second
   * tab immediately shows the live page.
   */
  stageFor(visitorId: string): FacetTree | undefined {
    return this.stageStore.get(this.agentId, visitorId)?.stage;
  }

  /** The recorded conversation for a viewer (events + agent replies), if the sink retains it. */
  historyFor(visitorId: string): readonly StoredEvent[] {
    return this.sink.history(this.agentId, visitorId);
  }

  /**
   * Processes one inbound event for one viewer and returns the messages to send
   * back. Stage patches are applied to the stored session (server is the source of
   * truth), then the interaction is handed to the sink.
   */
  async handle(visitor: VisitorContext, event: ClientEvent): Promise<readonly ServerMessage[]> {
    const session = this.stageStore.open(this.agentId, visitor);
    const messages = await this.agent(event, session);
    this.stageStore.save(this.applyToSession(session, messages));
    const recorded = this.sink.record(this.agentId, visitor.visitorId, {
      at: Date.now(),
      event,
      messages,
    });
    if (recorded !== undefined) {
      void recorded.catch((error: unknown) => console.error("[facet] sink failed:", error));
    }
    return messages;
  }

  private applyToSession(session: FacetSession, messages: readonly ServerMessage[]): FacetSession {
    let stage = session.stage;
    for (const message of messages) {
      if (message.kind === "patch") {
        stage = applyPatch(stage, message.patches);
      }
    }
    return { ...session, stage };
  }
}
