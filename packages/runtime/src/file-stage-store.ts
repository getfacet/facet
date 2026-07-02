import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { FacetSession, VisitorContext } from "@facet/core";
import { openSession, sessionKey, type StageStore } from "./stage-store.js";
import { sessionFilePath } from "./session-file.js";

/** A persisted blob is only a session if it has the shape the runtime relies on.
 * Anything else (hand-edited file, partial write, unrelated JSON) is treated as
 * absent so a fresh session opens rather than crashing the render loop. */
function isSession(value: unknown): value is FacetSession {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  const visitor = s["visitor"];
  const stage = s["stage"];
  return (
    typeof s["agentId"] === "string" &&
    typeof visitor === "object" &&
    visitor !== null &&
    typeof (visitor as Record<string, unknown>)["visitorId"] === "string" &&
    isTreeShaped(stage)
  );
}

/** The stage must be a real tree that survives the server's offline visit path
 * (`server.ts` `hasBuiltStage`), which does `nodes[root]` then `"children" in
 * root`, and `Object.keys(screens)` when `screens !== undefined`. So beyond
 * root/nodes being present we require the root node itself to exist as a
 * non-null object, and any `screens` to be a non-null non-array object —
 * otherwise those reads throw a TypeError instead of failing safe to a fresh
 * session. (Stricter than the client renderer's `isTreeShaped`, which only
 * checks root/nodes; a persisted blob has to clear the server path too.) */
function isTreeShaped(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const t = value as Record<string, unknown>;
  const root = t["root"];
  const nodes = t["nodes"];
  const screens = t["screens"];
  if (typeof root !== "string") return false;
  if (typeof nodes !== "object" || nodes === null || Array.isArray(nodes)) return false;
  // The root node must actually exist as a node object — `"children" in root`
  // throws on a null/primitive entry.
  const rootNode = (nodes as Record<string, unknown>)[root];
  if (typeof rootNode !== "object" || rootNode === null) return false;
  // ...and a `children` property, when present, must be an array — the offline
  // path reads `root.children.length` after the `in` check.
  const children = (rootNode as Record<string, unknown>)["children"];
  if (children !== undefined && !Array.isArray(children)) return false;
  // `screens` is optional, but if present must be an object `Object.keys` can read.
  if (
    screens !== undefined &&
    (typeof screens !== "object" || screens === null || Array.isArray(screens))
  )
    return false;
  return true;
}

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
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, "utf8"));
    } catch (err) {
      console.error(`[FileStageStore] unreadable session file ${file}:`, err);
      return undefined;
    }
    if (!isSession(parsed)) {
      console.error(`[FileStageStore] ignoring wrong-shape session file ${file}`);
      return undefined;
    }
    this.cachePut(key, parsed);
    return parsed;
  }

  async open(agentId: string, visitor: VisitorContext): Promise<FacetSession> {
    return openSession(this, agentId, visitor);
  }

  async save(session: FacetSession): Promise<void> {
    this.cachePut(sessionKey(session.agentId, session.visitor.visitorId), session);
    mkdirSync(this.dir, { recursive: true }); // resilient if the dir was removed at runtime
    // Write-then-rename: a crash or ENOSPC leaves the old file intact rather than
    // a half-written one, since rename is atomic on the same filesystem.
    const file = this.fileFor(session.agentId, session.visitor.visitorId);
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(session));
    renameSync(tmp, file);
  }
}
