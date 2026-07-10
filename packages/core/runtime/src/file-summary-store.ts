import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { sessionFilePath } from "./session-file.js";
import type { StoredSummary, SummaryStore } from "./summary-store.js";
import { isSummaryIndex as isIndex } from "./summary-store.js";

/** A persisted blob is only a `StoredSummary` if it carries the fields the store
 * reads back: a `payload` key and finite non-negative integer `coveredThrough`
 * and `generation`. Anything else (hand-edited file, partial write, unrelated
 * JSON) is treated as absent so a corrupt record fails safe rather than throwing
 * or blocking a fresh write. The opaque `payload` is never inspected further. */
function isStoredSummary(value: unknown): value is StoredSummary {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    "payload" in s &&
    typeof s["coveredThrough"] === "number" &&
    isIndex(s["coveredThrough"]) &&
    typeof s["generation"] === "number" &&
    isIndex(s["generation"])
  );
}

/**
 * Durable, dependency-free reference `SummaryStore`: each `(agent, visitor)`
 * rolling summary is a JSON file on disk, so compacted memory survives a restart.
 * Same semantics as `MemorySummaryStore` (monotonic `coveredThrough`, invalid
 * values rejected, opaque `payload` round-tripped verbatim).
 *
 * Node-only (uses `node:fs`) — kept in its own module, exported from the node
 * entry, so browser bundles that import `MemorySummaryStore` don't pull in
 * `node:fs`.
 *
 * Pair a durable summary store with an equally durable Sink: with a volatile
 * sink, a restart orphans the summary (the agent detects the mismatch via the
 * conversation anchor and rebuilds from scratch, discarding the saved memory).
 */
export class FileSummaryStore implements SummaryStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private fileFor(agentId: string, visitorId: string): string {
    // Distinct extension so a state directory can be shared with
    // FileStageStore (".json") and FileSink (".jsonl") without clobbering.
    return sessionFilePath(this.dir, agentId, visitorId, "summary.json");
  }

  async get(agentId: string, visitorId: string): Promise<StoredSummary | undefined> {
    const file = this.fileFor(agentId, visitorId);
    if (!existsSync(file)) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, "utf8"));
    } catch (err) {
      console.error(`[FileSummaryStore] unreadable summary file ${file}:`, err);
      return undefined;
    }
    if (!isStoredSummary(parsed)) {
      console.error(`[FileSummaryStore] ignoring wrong-shape summary file ${file}`);
      return undefined;
    }
    return parsed;
  }

  async put(agentId: string, visitorId: string, summary: StoredSummary): Promise<boolean> {
    if (!isIndex(summary.coveredThrough) || !isIndex(summary.generation)) return false;
    // A corrupt/foreign on-disk record reads back as undefined, so a fresh write
    // is not blocked by it (fail-safe, matching the resilient read path).
    const existing = await this.get(agentId, visitorId);
    if (existing !== undefined && summary.coveredThrough <= existing.coveredThrough) return false;
    mkdirSync(this.dir, { recursive: true }); // resilient if the dir was removed at runtime
    // Write-then-rename: a crash or ENOSPC leaves the old record intact rather
    // than a half-written one, since rename is atomic on the same filesystem.
    const file = this.fileFor(agentId, visitorId);
    const tmp = `${file}.tmp`;
    // Normalize `undefined` → `null` before serializing: `JSON.stringify` drops
    // an `undefined` value, which would strip the `payload` key and make the
    // written record fail the read shape-guard. Pure serialization, never an
    // interpretation of the opaque payload (see SummaryStore interface doc).
    writeFileSync(tmp, JSON.stringify({ ...summary, payload: summary.payload ?? null }));
    renameSync(tmp, file);
    return true;
  }

  async delete(agentId: string, visitorId: string): Promise<void> {
    // Remove the record file if present; a missing file or any fs error is
    // swallowed so delete is always a safe no-op (matches the resilient read).
    try {
      rmSync(this.fileFor(agentId, visitorId), { force: true });
    } catch {
      // best-effort: nothing to remove, or the fs rejected it — either way the
      // pair is effectively absent, which is the caller's intent.
    }
  }
}
