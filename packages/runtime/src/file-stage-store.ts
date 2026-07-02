import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { FacetSession, VisitorContext } from "@facet/core";
import { openSession, sessionKey, type StageStore } from "./stage-store.js";
import { sessionFilePath } from "./session-file.js";

/** Read-through cache bound: past this many sessions the least-recently-used
 * entry is evicted (the file on disk stays the source of truth). */
const MAX_CACHED_SESSIONS = 500;

/**
 * Durable, dependency-free reference `StageStore`: each session's stage is a JSON
 * file on disk, so pages survive a restart. Good for a single instance or a
 * shared volume; swap for a database store to scale past one process.
 *
 * Node-only (uses `node:fs`) — kept in its own module so browser bundles that
 * import `MemoryStageStore` don't pull in `node:fs`.
 */
export class FileStageStore implements StageStore {
  private readonly cache = new Map<string, FacetSession>();

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  /** LRU insert: Map iteration order is insertion order, so re-inserting on every
   * touch keeps the oldest key first and eviction O(1). */
  private cachePut(key: string, session: FacetSession): void {
    this.cache.delete(key);
    this.cache.set(key, session);
    if (this.cache.size > MAX_CACHED_SESSIONS) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
  }

  private fileFor(agentId: string, visitorId: string): string {
    return sessionFilePath(this.dir, agentId, visitorId, "json");
  }

  async get(agentId: string, visitorId: string): Promise<FacetSession | undefined> {
    const key = sessionKey(agentId, visitorId);
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      this.cachePut(key, cached); // refresh recency
      return cached;
    }
    const file = this.fileFor(agentId, visitorId);
    if (!existsSync(file)) return undefined;
    try {
      const session = JSON.parse(readFileSync(file, "utf8")) as FacetSession;
      this.cachePut(key, session);
      return session;
    } catch {
      return undefined;
    }
  }

  async open(agentId: string, visitor: VisitorContext): Promise<FacetSession> {
    return openSession(this, agentId, visitor);
  }

  async save(session: FacetSession): Promise<void> {
    this.cachePut(sessionKey(session.agentId, session.visitor.visitorId), session);
    mkdirSync(this.dir, { recursive: true }); // resilient if the dir was removed at runtime
    writeFileSync(
      this.fileFor(session.agentId, session.visitor.visitorId),
      JSON.stringify(session),
    );
  }
}
