import { EMPTY_TREE, type FacetSession, type VisitorContext } from "@facet/core";

/**
 * Holds one session per (agent, visitor). The default implementation is
 * in-memory; a production deployment swaps this for a durable/distributed store
 * so a stage survives reconnects and scales past one process. The interface is
 * intentionally tiny so those backends stay easy to write.
 */
export interface SessionStore {
  get(agentId: string, visitorId: string): FacetSession | undefined;
  open(agentId: string, visitor: VisitorContext): FacetSession;
  save(session: FacetSession): void;
}

export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, FacetSession>();

  private key(agentId: string, visitorId: string): string {
    return `${agentId}::${visitorId}`;
  }

  get(agentId: string, visitorId: string): FacetSession | undefined {
    return this.sessions.get(this.key(agentId, visitorId));
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
    this.sessions.set(this.key(session.agentId, session.visitor.visitorId), session);
  }
}
