import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EMPTY_TREE, type FacetSession, type VisitorContext } from "@facet/core";
import { sessionKey, type StageStore } from "./stage-store.js";

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
    mkdirSync(this.dir, { recursive: true }); // resilient if the dir was removed at runtime
    writeFileSync(
      this.fileFor(session.agentId, session.visitor.visitorId),
      JSON.stringify(session),
    );
  }
}
