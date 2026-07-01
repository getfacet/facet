import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EMPTY_TREE, type FacetSession, type VisitorContext } from "@facet/core";

/**
 * Persists the STAGE — the current rendered page per `(agent, visitor)`. This is
 * always Facet's to own (nobody else tracks which bricks a visitor is looking
 * at), so a store is always present. Swap the backend to change durability/scale;
 * the interface is intentionally tiny.
 *
 * The conversation is a SEPARATE concern — see `Sink`.
 */
export interface StageStore {
  get(agentId: string, visitorId: string): FacetSession | undefined;
  open(agentId: string, visitor: VisitorContext): FacetSession;
  save(session: FacetSession): void;
}

export function sessionKey(agentId: string, visitorId: string): string {
  return `${agentId}::${visitorId}`;
}

/** In-memory stage store — the zero-config default. Lost on restart. */
export class MemoryStageStore implements StageStore {
  private readonly sessions = new Map<string, FacetSession>();

  get(agentId: string, visitorId: string): FacetSession | undefined {
    return this.sessions.get(sessionKey(agentId, visitorId));
  }

  open(agentId: string, visitor: VisitorContext): FacetSession {
    const existing = this.get(agentId, visitor.visitorId);
    if (existing !== undefined) return existing;
    const session: FacetSession = { agentId, visitor, stage: EMPTY_TREE };
    this.save(session);
    return session;
  }

  save(session: FacetSession): void {
    this.sessions.set(sessionKey(session.agentId, session.visitor.visitorId), session);
  }
}

/**
 * Durable, dependency-free reference: each session's stage is a JSON file on
 * disk, so pages survive a restart. Good for a single instance or a shared
 * volume; swap for a database store to scale past one process.
 */
export class FileStageStore implements StageStore {
  private readonly cache = new Map<string, FacetSession>();

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private fileFor(agentId: string, visitorId: string): string {
    const name = Buffer.from(sessionKey(agentId, visitorId)).toString("base64url");
    return join(this.dir, `${name}.json`);
  }

  get(agentId: string, visitorId: string): FacetSession | undefined {
    const key = sessionKey(agentId, visitorId);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const file = this.fileFor(agentId, visitorId);
    if (!existsSync(file)) return undefined;
    try {
      const session = JSON.parse(readFileSync(file, "utf8")) as FacetSession;
      this.cache.set(key, session);
      return session;
    } catch {
      return undefined;
    }
  }

  open(agentId: string, visitor: VisitorContext): FacetSession {
    const existing = this.get(agentId, visitor.visitorId);
    if (existing !== undefined) return existing;
    const session: FacetSession = { agentId, visitor, stage: EMPTY_TREE };
    this.save(session);
    return session;
  }

  save(session: FacetSession): void {
    this.cache.set(sessionKey(session.agentId, session.visitor.visitorId), session);
    writeFileSync(
      this.fileFor(session.agentId, session.visitor.visitorId),
      JSON.stringify(session),
    );
  }
}
