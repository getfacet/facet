import {
  applyPatch,
  type ClientEvent,
  type FacetAgent,
  type FacetSession,
  type ServerMessage,
  type VisitorContext,
} from "@facet/core";
import { MemorySessionStore, type SessionStore } from "./session-store.js";

export interface FacetRuntimeOptions {
  readonly agentId: string;
  readonly agent: FacetAgent;
  /** Defaults to an in-memory store. */
  readonly store?: SessionStore;
}

/**
 * Wires a transport's inbound events to the agent and keeps each session's stage
 * up to date. A transport (WebSocket/SSE server, or the in-process demo) calls
 * `handle` for every event from a given viewer and ships the returned messages
 * back over that viewer's connection.
 */
export class FacetRuntime {
  private readonly agentId: string;
  private readonly agent: FacetAgent;
  private readonly store: SessionStore;

  constructor(options: FacetRuntimeOptions) {
    this.agentId = options.agentId;
    this.agent = options.agent;
    this.store = options.store ?? new MemorySessionStore();
  }

  /**
   * Processes one inbound event for one viewer and returns the messages to send
   * back to that viewer. Stage patches are applied to the session before return
   * so server state stays the source of truth.
   */
  async handle(
    visitor: VisitorContext,
    event: ClientEvent,
  ): Promise<readonly ServerMessage[]> {
    const session = this.store.open(this.agentId, visitor);
    const messages = await this.agent(event, session);
    const next = this.applyToSession(session, messages);
    this.store.save(next);
    return messages;
  }

  private applyToSession(
    session: FacetSession,
    messages: readonly ServerMessage[],
  ): FacetSession {
    let stage = session.stage;
    for (const message of messages) {
      if (message.kind === "patch") {
        stage = applyPatch(stage, message.patches);
      }
    }
    return { ...session, stage };
  }
}
