import {
  EMPTY_TREE,
  type ClientEvent,
  type FacetSession,
  type ServerMessage,
  type VisitorContext,
} from "@facet/core";

/**
 * One recorded interaction: a visitor event and the messages the agent answered
 * with. Appended in order so the full conversation/interaction history for a
 * `(agent, visitor)` pair can be replayed (e.g. re-hydrating a chat on reconnect).
 */
export interface StoredEvent {
  /** Epoch milliseconds when it was recorded. */
  readonly at: number;
  readonly event: ClientEvent;
  readonly messages: readonly ServerMessage[];
}

/**
 * Holds, per `(agent, visitor)`, the current stage AND the append-only history of
 * events + agent replies. The default implementation is in-memory; a durable one
 * (see `FileSessionStore`) survives restarts, and a production deployment can
 * swap in a distributed backend. The interface is intentionally small so those
 * backends stay easy to write.
 */
export interface SessionStore {
  get(agentId: string, visitorId: string): FacetSession | undefined;
  open(agentId: string, visitor: VisitorContext): FacetSession;
  save(session: FacetSession): void;
  /** Record one interaction (event + the agent's response) in order. */
  append(agentId: string, visitorId: string, entry: StoredEvent): void;
  /** The recorded interactions for a viewer, oldest first. */
  history(agentId: string, visitorId: string): readonly StoredEvent[];
}

export function sessionKey(agentId: string, visitorId: string): string {
  return `${agentId}::${visitorId}`;
}

export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, FacetSession>();
  private readonly histories = new Map<string, StoredEvent[]>();

  get(agentId: string, visitorId: string): FacetSession | undefined {
    return this.sessions.get(sessionKey(agentId, visitorId));
  }

  open(agentId: string, visitor: VisitorContext): FacetSession {
    const existing = this.get(agentId, visitor.visitorId);
    if (existing !== undefined) {
      return existing;
    }
    const session: FacetSession = { agentId, visitor, stage: EMPTY_TREE };
    this.save(session);
    return session;
  }

  save(session: FacetSession): void {
    this.sessions.set(sessionKey(session.agentId, session.visitor.visitorId), session);
  }

  append(agentId: string, visitorId: string, entry: StoredEvent): void {
    const key = sessionKey(agentId, visitorId);
    const history = this.histories.get(key);
    if (history === undefined) {
      this.histories.set(key, [entry]);
    } else {
      history.push(entry);
    }
  }

  history(agentId: string, visitorId: string): readonly StoredEvent[] {
    return this.histories.get(sessionKey(agentId, visitorId)) ?? [];
  }
}
