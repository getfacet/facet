import type { ServerResponse } from "node:http";
import { asAgentServerMessage, type FacetTree, type ServerMessage } from "@facet/core";
import type { FacetRuntime, StoredEvent } from "@facet/runtime";
import type { FrameLog, FrameLogStore, LoggedFrame } from "./frame-log.js";
import type { FacetServerObserver } from "./observer.js";
import { writeSse } from "./sse.js";

const MAX_REHYDRATE_REREADS = 4;

/** Write one SSE frame. An optional `id` becomes the `id:` line — browser live
 * frames carry `<era>:<seq>` for resume, while full rehydrate uses an empty id to
 * clear stale resume state; agent-channel frames pass no id. */
function sse(res: ServerResponse, data: unknown, id?: string): void {
  writeSse(res, { data }, id);
}

/** Write a pre-serialized browser frame with its stamped id — the replay path,
 * which re-emits a logged frame's exact JSON. */
export function writeFrame(res: ServerResponse, json: string, id: string): void {
  writeSse(res, { json }, id);
}

const CLEAR_RESUME_ID = "";

// ── browser stream: resume ──────────────────────────────────────────
// A valid Last-Event-ID (`<era>:<seq>`, era matches the live log, seq within
// range, gap still in the ring) joins the fan-out and replays the missed frames
// in ONE synchronous block. Join-first is safe precisely because there is no await
// for a live frame to interleave into; the replayed frames carry their original
// ids, so no seq is re-assigned and no dup is possible. Every invalid token shape
// returns false and degrades to the full rehydrate — /stream never answers 4xx/5xx
// for a resume token (the only 400 is a missing visitorId).
/** Try to resume a reconnecting stream from its `Last-Event-ID`; returns true if it
 * replayed (and joined the fan-out), false if the token is unusable. */
export function resumeStream(
  res: ServerResponse,
  visitorId: string,
  lastEventId: string,
  frameLog: FrameLogStore,
  join: () => void,
): boolean {
  const colon = lastEventId.indexOf(":");
  if (colon <= 0) return false;
  const era = lastEventId.slice(0, colon);
  const seqStr = lastEventId.slice(colon + 1);
  // Strict integer only: `Number("")` is 0 and hex/exponent/whitespace all coerce,
  // so parse the shape explicitly. `-1` IS valid — it's the base a virgin session's
  // snapshot stamps (`era:N0` with N0 = -1); resuming from it replays the whole ring
  // with no reset (else an idle tab that never received a stamped frame would
  // full-rehydrate on every reconnect).
  if (!/^(-1|0|[1-9]\d*)$/.test(seqStr)) return false;
  const replay = frameLog.resume(visitorId, era, Number(seqStr));
  if (replay === undefined) return false;
  join();
  for (const frame of replay) writeFrame(res, frame.json, frame.id);
  return true;
}

function parseLoggedServerMessage(frame: LoggedFrame): ServerMessage | undefined {
  try {
    return asAgentServerMessage(JSON.parse(frame.json));
  } catch {
    return undefined;
  }
}

function retainedSayFrames(
  frames: readonly LoggedFrame[],
  minSeq: number,
  maxSeq: number,
): LoggedFrame[] {
  const says: LoggedFrame[] = [];
  for (const frame of frames) {
    if (frame.seq < minSeq || frame.seq > maxSeq) continue;
    const message = parseLoggedServerMessage(frame);
    if (message?.kind === "say") says.push(frame);
  }
  return says;
}

export interface HandlingTurn {
  readonly index: number;
  readonly era: string;
  readonly streamStartSeq: number;
  streamEndSeq?: number;
}

/** Runs a single visitor's turns serially (different visitors stay concurrent). */
export type Lane = (key: string, task: () => Promise<void>) => Promise<void>;

export function pruneUnrecoverableHandlingTurns(
  handling: Map<string, HandlingTurn[]>,
  visitorId: string,
  log: FrameLog,
): void {
  const turns = handling.get(visitorId);
  if (turns === undefined) return;
  const oldest = log.frames[0];
  const remaining = turns.filter(
    (turn) => turn.era === log.era && (oldest === undefined || turn.streamStartSeq >= oldest.seq),
  );
  if (remaining.length === turns.length) return;
  if (remaining.length === 0) handling.delete(visitorId);
  else handling.set(visitorId, remaining);
}

function pendingSayFramesForRehydrate(
  handling: Map<string, HandlingTurn[]>,
  visitorId: string,
  log: FrameLog,
  history: readonly StoredEvent[],
  maxSeq: number,
): LoggedFrame[] {
  pruneUnrecoverableHandlingTurns(handling, visitorId, log);
  const pendingTurns = handling.get(visitorId)?.filter((turn) => turn.era === log.era) ?? [];
  const visibleForwardedTurns = visibleForwardedRecordCountForCurrentEra(history, log);
  const historySayCounts = sayCountsForHistory(history);
  const pendingSayFrames: LoggedFrame[] = [];
  for (const turn of pendingTurns) {
    if (turn.streamStartSeq > maxSeq) continue;
    const turnMaxSeq = Math.min(turn.streamEndSeq ?? maxSeq, maxSeq);
    const frames = retainedSayFrames(log.frames, turn.streamStartSeq, turnMaxSeq);
    if (visibleForwardedTurns > turn.index && historyContainsSayFrames(historySayCounts, frames)) {
      continue;
    }
    for (const frame of frames) {
      pendingSayFrames.push(frame);
    }
  }
  return pendingSayFrames;
}

function sayCountsForHistory(history: readonly StoredEvent[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of history) {
    for (const message of entry.messages) {
      if (message.kind !== "say") continue;
      counts.set(message.text, (counts.get(message.text) ?? 0) + 1);
    }
  }
  return counts;
}

function historyContainsSayFrames(
  historySayCounts: ReadonlyMap<string, number>,
  frames: readonly LoggedFrame[],
): boolean {
  const needed = new Map<string, number>();
  for (const frame of frames) {
    const message = parseLoggedServerMessage(frame);
    if (message?.kind !== "say") continue;
    needed.set(message.text, (needed.get(message.text) ?? 0) + 1);
  }
  if (needed.size === 0) return false;
  for (const [text, count] of needed) {
    if ((historySayCounts.get(text) ?? 0) < count) return false;
  }
  return true;
}

function isForwardedHistoryRecord(entry: StoredEvent): boolean {
  if (entry.event.kind === "message" || entry.event.kind === "visit") return true;
  return entry.event.kind === "tap" && entry.event.action !== undefined;
}

function visibleForwardedRecordCountForCurrentEra(
  history: readonly StoredEvent[],
  log: FrameLog,
): number {
  const count = history.filter(isForwardedHistoryRecord).length;
  // The frame log's event counter resets when its era is re-minted, while durable
  // Sink history does not. In that case the old history cannot identify a pending
  // turn in the new event-counter space, so keep pending frames rather than risk
  // dropping a live say.
  return count <= log.eventCounter ? count : 0;
}

function pendingTurnsForLog(
  handling: Map<string, HandlingTurn[]>,
  visitorId: string,
  log: FrameLog,
): readonly HandlingTurn[] {
  return handling.get(visitorId)?.filter((turn) => turn.era === log.era) ?? [];
}

function lostPendingTurn(before: readonly HandlingTurn[], after: readonly HandlingTurn[]): boolean {
  return before.some((turn) => !after.includes(turn));
}

async function historyForRehydrate(
  runtime: FacetRuntime,
  visitorId: string,
  handling: Map<string, HandlingTurn[]>,
  log: FrameLog,
  isClosed: () => boolean,
): Promise<readonly StoredEvent[]> {
  let pendingBefore = pendingTurnsForLog(handling, visitorId, log);
  let history = await runtime.historyFor(visitorId);
  for (let rereads = 0; rereads < MAX_REHYDRATE_REREADS; rereads += 1) {
    if (isClosed()) return history;
    const pendingAfter = pendingTurnsForLog(handling, visitorId, log);
    if (!lostPendingTurn(pendingBefore, pendingAfter)) return history;
    pendingBefore = pendingAfter;
    history = await runtime.historyFor(visitorId);
  }
  return history;
}

function writeFullRehydrate(
  res: ServerResponse,
  stage: FacetTree | undefined,
  history: readonly StoredEvent[],
  pendingSayFrames: readonly LoggedFrame[],
): void {
  sse(res, { kind: "reset" }, CLEAR_RESUME_ID);
  if (stage !== undefined) {
    sse(
      res,
      { kind: "patch", patches: [{ op: "replace", path: "", value: stage }] },
      CLEAR_RESUME_ID,
    );
  }
  for (const entry of history) {
    for (const message of entry.messages) {
      if (message.kind === "say") sse(res, message, CLEAR_RESUME_ID);
    }
  }
  for (const frame of pendingSayFrames) {
    writeFrame(res, frame.json, CLEAR_RESUME_ID);
  }
}

async function rehydrateFromLane(
  res: ServerResponse,
  visitorId: string,
  frameLog: FrameLogStore,
  runtime: FacetRuntime,
  handling: Map<string, HandlingTurn[]>,
  isClosed: () => boolean,
  join: () => void,
): Promise<void> {
  const stage = await runtime.stageFor(visitorId);
  if (isClosed()) return;
  const log = frameLog.logFor(visitorId);
  const history = await historyForRehydrate(runtime, visitorId, handling, log, isClosed);
  if (isClosed()) return;
  const pendingSayFrames = pendingSayFramesForRehydrate(
    handling,
    visitorId,
    log,
    history,
    log.nextSeq - 1,
  );
  writeFullRehydrate(res, stage, history, pendingSayFrames);
  join();
}

// ── browser stream: full rehydrate (out of the lane) ────────────────
// A token-less new tab (or an unresumable token) gets a full snapshot. This runs
// OUTSIDE the per-visitor lane so it paints immediately instead of blocking behind
// a mid-flight turn — yet it is still loss-free across its store reads, by
// construction:
//   1. capture the watermark (era, N0 = last assigned seq) synchronously, BEFORE
//      any await;
//   2. read the stage + history (may await);
//   3. one synchronous finalization block that re-checks whether a same-visitor
//      frame landed during the read. If not, it writes reset/snapshot/history with
//      an EMPTY id (clearing any stale Last-Event-ID) and joins. If a frame did
//      land, it falls back to a visitor-lane rehydrate barrier: the lane prevents
//      another same-visitor frame from interleaving with the replacement snapshot,
//      avoiding both double-apply and endless EventSource retry under steady traffic.
// Full-rehydrate frames deliberately clear the resume token instead of minting one
// from non-logged snapshot/history data; if step 2 fails, the response ends so the
// retry performs another full rehydrate.
export async function rehydrate(
  res: ServerResponse,
  visitorId: string,
  frameLog: FrameLogStore,
  runtime: FacetRuntime,
  handling: Map<string, HandlingTurn[]>,
  lane: Lane,
  isClosed: () => boolean,
  join: () => void,
): Promise<void> {
  const log = frameLog.logFor(visitorId);
  const capturedEra = log.era;
  const n0 = log.nextSeq - 1;
  try {
    const stage = await runtime.stageFor(visitorId);
    if (isClosed()) return;
    const history = await historyForRehydrate(runtime, visitorId, handling, log, isClosed);
    if (isClosed()) return;
    const current = frameLog.peek(visitorId);
    if (current !== log || current.era !== capturedEra) {
      // The entry was LRU-evicted and re-minted during the reads. Fall back to
      // the lane, which re-reads from a stable point and joins with the new era.
      await lane(visitorId, async () => {
        if (!isClosed()) {
          await rehydrateFromLane(res, visitorId, frameLog, runtime, handling, isClosed, join);
        }
      });
      return;
    }
    if (current.nextSeq - 1 > n0) {
      // A frame landed while the stage/history reads were in flight. The returned
      // snapshot may or may not include that frame's patch effects; joining now
      // would either miss it or double-apply it. Re-read inside the visitor lane
      // instead of ending and relying on retry quietness.
      await lane(visitorId, async () => {
        if (!isClosed()) {
          await rehydrateFromLane(res, visitorId, frameLog, runtime, handling, isClosed, join);
        }
      });
      return;
    }
    const pendingSayFrames = pendingSayFramesForRehydrate(
      handling,
      visitorId,
      current,
      history,
      n0,
    );
    writeFullRehydrate(res, stage, history, pendingSayFrames);
    join();
  } catch (error: unknown) {
    // Rehydrate failed BEFORE the connection joined the fan-out set — logging alone
    // would strand the visitor on a healthy-looking SSE stream that never gets
    // patches and never reconnects (the server only pings agent streams). End the
    // response so EventSource auto-reconnects and retries the rehydrate.
    console.error("[facet] rehydrate failed:", error);
    res.end();
  }
}

export function addHandlingTurn(
  handling: Map<string, HandlingTurn[]>,
  visitorId: string,
  turn: HandlingTurn,
): void {
  const turns = handling.get(visitorId) ?? [];
  turns.push(turn);
  handling.set(visitorId, turns);
}

export function removeHandlingTurn(
  handling: Map<string, HandlingTurn[]>,
  visitorId: string,
  turn: HandlingTurn,
): void {
  const current = handling.get(visitorId);
  if (current === undefined) return;
  const remaining = current.filter((candidate) => candidate !== turn);
  if (remaining.length === 0) handling.delete(visitorId);
  else handling.set(visitorId, remaining);
}

export function handlingTurnHasFrames(turn: HandlingTurn): boolean {
  return turn.streamEndSeq !== undefined && turn.streamEndSeq >= turn.streamStartSeq;
}

/** The runtime-facing wiring the two POST handlers share: the delivery lane, the
 * runtime, the frame log, and the synchronous fan-out (`deliver`, which stays in
 * server.ts). */
export interface PostHandlerDeps {
  readonly lane: Lane;
  readonly runtime: FacetRuntime;
  readonly frameLog: FrameLogStore;
  readonly deliver: (visitorId: string, messages: readonly ServerMessage[]) => void;
  /** The arrival {index, era} of the turn each visitor's lane is currently
   * handling — server-local so an LRU eviction of the frame log can't detach it
   * mid-turn. One entry per in-flight visitor turn; deleted when the turn ends. */
  readonly handling: Map<string, HandlingTurn[]>;
  /** Optional non-controlling diagnostics assembled by the POST paths. */
  readonly observer: FacetServerObserver | undefined;
}

/** Read the accepted authoritative stage without letting a diagnostic lookup
 * failure alter delivery or persistence. Callers remain on the visitor lane, so
 * a successful result is the exact post-fold stage for that accepted frame. */
export async function stageForObservation(
  runtime: FacetRuntime,
  visitorId: string,
): Promise<FacetTree | undefined> {
  try {
    return await runtime.stageFor(visitorId);
  } catch {
    return undefined;
  }
}
