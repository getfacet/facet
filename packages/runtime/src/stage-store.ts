import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EMPTY_TREE, type FacetSession, type VisitorContext } from "@facet/core";

/**
 * Persists the STAGE — the current rendered page per `(agent, visitor)`. This is
 * always Facet's to own (nobody else tracks which bricks a visitor is looking
 * at), so a store is always present. Swap the backend to change durability/scale.
 *
 * Methods are async so a backend can be a database (Postgres, etc.). The
 * conversation is a SEPARATE concern — see `Sink`.
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

  async get(agentId: string, visitorId: string): Promise<FacetSession | undefined> {
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

  async open(agentId: string, visitor: VisitorContext): Promise<FacetSession> {
    const existing = await this.get(agentId, visitor.visitorId);
    if (existing !== undefined) return existing;
    const session: FacetSession = { agentId, visitor, stage: EMPTY_TREE };
    await this.save(session);
    return session;
  }

  async save(session: FacetSession): Promise<void> {
    this.cache.set(sessionKey(session.agentId, session.visitor.visitorId), session);
    writeFileSync(
      this.fileFor(session.agentId, session.visitor.visitorId),
      JSON.stringify(session),
    );
  }
}
