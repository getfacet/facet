import { sessionKey } from "./stage-store.js";

/**
 * One persisted rolling summary record for a `(agent, visitor)` conversation.
 *
 * `payload` is OPAQUE to the runtime — the consumer (e.g. an agent brain) owns
 * its schema and validation; the runtime never reads, reshapes, or interprets
 * it. The one exception is pure serialization normalization: a stored
 * `undefined` payload round-trips back as `null` (JSON has no `undefined`), so
 * every backend agrees. `coveredThrough` counts how many `Sink` history entries the summary folds
 * in, and is the monotonic guard the store advances on: a newer record must
 * cover strictly more. `generation` is the consumer's own bookkeeping (e.g. how
 * many times it has recompacted) and never gates storage on its own.
 */
export interface StoredSummary {
  readonly payload: unknown;
  readonly coveredThrough: number;
  readonly generation: number;
}

/**
 * A rolling-summary sink — where a conversation's compacted memory lives per
 * `(agent, visitor)`. This is a SEPARATE concern from the STAGE (`StageStore`)
 * and the raw conversation (`Sink`): it holds the brain's opaque digest of
 * history so a long conversation need not replay in full.
 *
 * Methods are async so a backend can be a database. This module is browser-safe
 * (no Node built-ins); file/DB backends live in their own modules.
 */
export interface SummaryStore {
  get(agentId: string, visitorId: string): Promise<StoredSummary | undefined>;
  /**
   * Stores only when strictly newer: `coveredThrough` must be a finite integer
   * `>= 0` and greater than the stored record's (an equal or lower value is a
   * stale write). `generation` must also be a finite non-negative integer.
   * Returns true when stored, false when ignored.
   */
  put(agentId: string, visitorId: string, summary: StoredSummary): Promise<boolean>;
  /**
   * Removes the stored record for this pair, if any. Used to rebuild after a
   * covered-through/sink mismatch: a fresh `put` then starts over at generation
   * 1 with the monotonic guard reset. A no-op when no record exists.
   */
  delete(agentId: string, visitorId: string): Promise<void>;
}

/** Shared validity guard for `coveredThrough`/`generation`: a non-negative SAFE
 * integer (backends like Postgres bigint columns reject unsafe magnitudes, so
 * every store enforces the same bound). */
export function isSummaryIndex(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

const isIndex = isSummaryIndex;

/** Keeps rolling summaries in memory — the zero-config default. Lost on restart. */
export class MemorySummaryStore implements SummaryStore {
  private readonly records = new Map<string, StoredSummary>();

  async get(agentId: string, visitorId: string): Promise<StoredSummary | undefined> {
    return this.records.get(sessionKey(agentId, visitorId));
  }

  async put(agentId: string, visitorId: string, summary: StoredSummary): Promise<boolean> {
    if (!isIndex(summary.coveredThrough) || !isIndex(summary.generation)) return false;
    const key = sessionKey(agentId, visitorId);
    const existing = this.records.get(key);
    if (existing !== undefined && summary.coveredThrough <= existing.coveredThrough) return false;
    // Normalize `undefined` → `null` for cross-store parity (see interface doc):
    // pure serialization, never an interpretation of the opaque payload.
    this.records.set(key, { ...summary, payload: summary.payload ?? null });
    return true;
  }

  async delete(agentId: string, visitorId: string): Promise<void> {
    this.records.delete(sessionKey(agentId, visitorId));
  }
}
