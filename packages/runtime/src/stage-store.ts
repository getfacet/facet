import { EMPTY_TREE, type FacetSession, type VisitorContext } from "@facet/core";

/**
 * Persists the STAGE — the current rendered page per `(agent, visitor)`. This is
 * always Facet's to own (nobody else tracks which bricks a visitor is looking
 * at), so a store is always present. Swap the backend to change durability/scale.
 *
 * Methods are async so a backend can be a database (Postgres, etc.). The
 * conversation is a SEPARATE concern — see `Sink`.
 *
 * This module is browser-safe (no Node built-ins). File/DB backends live in
 * their own modules so importing `MemoryStageStore` never drags in `node:fs`.
 */
export interface StageStore {
  get(agentId: string, visitorId: string): Promise<FacetSession | undefined>;
  open(agentId: string, visitor: VisitorContext): Promise<FacetSession>;
  save(session: FacetSession): Promise<void>;
}

export function sessionKey(agentId: string, visitorId: string): string {
  return `${agentId}::${visitorId}`;
}

/** In-memory stage store — the zero-config default. Lost on restart. */
export class MemoryStageStore implements StageStore {
  private readonly sessions = new Map<string, FacetSession>();

  async get(agentId: string, visitorId: string): Promise<FacetSession | undefined> {
    return this.sessions.get(sessionKey(agentId, visitorId));
  }

  async open(agentId: string, visitor: VisitorContext): Promise<FacetSession> {
    const existing = this.sessions.get(sessionKey(agentId, visitor.visitorId));
    if (existing !== undefined) return existing;
    const session: FacetSession = { agentId, visitor, stage: EMPTY_TREE };
    await this.save(session);
    return session;
  }

  async save(session: FacetSession): Promise<void> {
    this.sessions.set(sessionKey(session.agentId, session.visitor.visitorId), session);
  }
}
