import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EMPTY_TREE, type FacetSession, type VisitorContext } from "@facet/core";
import { sessionKey, type SessionStore, type StoredEvent } from "./session-store.js";

interface Persisted {
  readonly session: FacetSession;
  readonly history: readonly StoredEvent[];
}

/**
 * A durable, dependency-free reference store: each `(agent, visitor)` session is
 * a JSON file on disk, so stages and interaction history survive a restart. It
 * write-throughs a small in-memory cache. Good for a single instance or a shared
 * volume; swap for a database/distributed store when you scale past one process.
 */
export class FileSessionStore implements SessionStore {
  private readonly cache = new Map<string, Persisted>();

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private fileFor(agentId: string, visitorId: string): string {
    const name = Buffer.from(sessionKey(agentId, visitorId)).toString("base64url");
    return join(this.dir, `${name}.json`);
  }

  private load(agentId: string, visitorId: string): Persisted | undefined {
    const key = sessionKey(agentId, visitorId);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const file = this.fileFor(agentId, visitorId);
    if (!existsSync(file)) return undefined;
    try {
      const data = JSON.parse(readFileSync(file, "utf8")) as Persisted;
      this.cache.set(key, data);
      return data;
    } catch {
      return undefined;
    }
  }

  private persist(agentId: string, visitorId: string, data: Persisted): void {
    this.cache.set(sessionKey(agentId, visitorId), data);
    writeFileSync(this.fileFor(agentId, visitorId), JSON.stringify(data));
  }

  get(agentId: string, visitorId: string): FacetSession | undefined {
    return this.load(agentId, visitorId)?.session;
  }

  open(agentId: string, visitor: VisitorContext): FacetSession {
    const existing = this.load(agentId, visitor.visitorId);
    if (existing !== undefined) return existing.session;
    const session: FacetSession = { agentId, visitor, stage: EMPTY_TREE };
    this.persist(agentId, visitor.visitorId, { session, history: [] });
    return session;
  }

  save(session: FacetSession): void {
    const existing = this.load(session.agentId, session.visitor.visitorId);
    this.persist(session.agentId, session.visitor.visitorId, {
      session,
      history: existing?.history ?? [],
    });
  }

  append(agentId: string, visitorId: string, entry: StoredEvent): void {
    const existing = this.load(agentId, visitorId);
    const session: FacetSession = existing?.session ?? {
      agentId,
      visitor: { visitorId },
      stage: EMPTY_TREE,
    };
    const history = existing !== undefined ? [...existing.history, entry] : [entry];
    this.persist(agentId, visitorId, { session, history });
  }

  history(agentId: string, visitorId: string): readonly StoredEvent[] {
    return this.load(agentId, visitorId)?.history ?? [];
  }
}
