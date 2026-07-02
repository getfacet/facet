import { createLruMap, type ServerMessage } from "@facet/core";

/** One logged browser frame: its per-session seq and the already-serialized JSON
 * payload (kept as a string so a replay re-emits byte-identical `data:`). */
export interface LoggedFrame {
  readonly seq: number;
  readonly json: string;
}

/** A session's replay log: a version token (`era`), the next seq to assign, and a
 * bounded ring of recent frames. `era` is re-minted whenever the entry is created
 * (server restart or LRU eviction), so a stale resume token can never replay
 * against a different history — it fails the era check and full-rehydrates. */
export interface FrameLog {
  era: string;
  nextSeq: number;
  frames: LoggedFrame[];
  // Per-visitor event ordering, kept beside the ring so it's bounded by the same
  // LRU. `eventCounter` stamps each /event at arrival (always read as an ATOMIC
  // {index, era} pair via `nextArrival` — an index is only meaningful within the
  // era whose counter minted it); `lastApplied` is the highest index whose apply
  // has completed (-1 = none). A late result whose parked index is below
  // `lastApplied` is stale — a newer turn already mutated the stage, so its
  // patches are dropped (NOT its says). NOTE: this is a separate counter from
  // `nextSeq` on purpose — an interim timeout say bumps `nextSeq` but is not a
  // new event, so `nextSeq` would give false staleness.
  eventCounter: number;
  lastApplied: number;
}

/** A stamped browser frame ready to write: its `id:` line (`<era>:<seq>`) and the
 * serialized `data:` payload. The output of the log-append (seq-assign) half of
 * `deliver`, which server.ts fans out to live connections. */
export interface StampedFrame {
  readonly id: string;
  readonly json: string;
}

/** Ring bound per session: past this many frames the oldest fall off and a
 * reconnect beyond the window full-rehydrates instead of resuming. */
export const FRAME_LOG_LIMIT = 200;
/** LRU cap on the session→log map so a server serving many one-off visitors
 * can't grow it without bound (re-insert-on-touch, oldest evicted first). */
export const MAX_FRAME_SESSIONS = 1000;

let eraCounter = 0;
/** A short version token for a frame log. base36 (no `":"`) so `<era>:<seq>`
 * parses unambiguously; a per-process counter plus randomness keeps eras distinct
 * across re-mints within one run and across restarts. */
function mintEra(): string {
  eraCounter += 1;
  return `${eraCounter.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** The per-visitor replay log store: the era/LRU/ring machinery behind the browser
 * channel's resume + rehydrate flows. Owns nothing about HTTP — server.ts fans the
 * stamped frames out to live connections. */
export interface FrameLogStore {
  /** Get-or-create a session's frame log, minting an era on first touch. Touched
   * as LRU (re-insert moves it to newest); oldest evicted past the cap. */
  logFor(visitorId: string): FrameLog;
  /** Read a session's log without creating one (a hit still counts as an LRU touch).
   * Used by the rehydrate re-check, which compares the captured log by identity. */
  peek(visitorId: string): FrameLog | undefined;
  /** The log-append (seq-assign) half of `deliver`: assign each message `seq =
   * nextSeq++`, append to the ring (trimming past the limit), and return the stamped
   * frames for server.ts to fan out. SYNCHRONOUS, the only seq-assigning path;
   * frames are logged even with zero connections (the late-result-while-disconnected
   * case the resume path replays). Called ONLY from lane tasks. */
  append(visitorId: string, messages: readonly ServerMessage[]): StampedFrame[];
  /** Resume read: for a parsed `<era>:<seq>` token, return the stamped frames past
   * `seq` to replay (touching the log LRU so a successful resume keeps the session
   * hot), or `undefined` if unresumable — unknown session, era mismatch, or the gap
   * has fallen out of the ring — so the caller degrades to a full rehydrate. */
  resume(visitorId: string, era: string, seq: number): StampedFrame[] | undefined;
  /** Stamp the next per-visitor arrival index, returned as an ATOMIC {index, era}
   * pair from one entry read — the pair travels together through parking and
   * staleness checks, so an LRU re-mint between arrival and handling can never pair
   * an old-space index with a new era (which would defeat `isStaleLateResult`). */
  nextArrival(visitorId: string): { readonly index: number; readonly era: string };
  /** Record that a visitor's event `index` has finished applying (running max), so a
   * later late result can tell whether a newer turn already mutated the stage.
   * `era` must be the index's minting era: after a re-mint the old index space is
   * meaningless, so a mismatched record is skipped (degrades toward falsely-stale,
   * never false-fresh). */
  recordApplied(visitorId: string, index: number, era: string): void;
}

export function createFrameLogStore(): FrameLogStore {
  // Per-session replay log (server-local — the Sink is NOT the replay store).
  const logs = createLruMap<FrameLog>(MAX_FRAME_SESSIONS);

  const logFor = (visitorId: string): FrameLog =>
    logs.getOrCreate(visitorId, () => ({
      era: mintEra(),
      nextSeq: 0,
      frames: [],
      eventCounter: 0,
      lastApplied: -1,
    }));

  return {
    logFor,
    peek: (visitorId) => logs.get(visitorId),
    append(visitorId, messages) {
      const log = logFor(visitorId);
      const stamped: StampedFrame[] = [];
      for (const message of messages) {
        const seq = log.nextSeq;
        log.nextSeq += 1;
        const json = JSON.stringify(message);
        log.frames.push({ seq, json });
        if (log.frames.length > FRAME_LOG_LIMIT) log.frames.shift();
        stamped.push({ id: `${log.era}:${seq}`, json });
      }
      return stamped;
    },
    resume(visitorId, era, seq) {
      // A hit touches the LRU (a successful resume keeps the session hot); a miss
      // or a mismatch degrades to the full rehydrate, which touches anyway.
      const log = logs.get(visitorId);
      if (log === undefined || era !== log.era) return undefined;
      const oldest = log.frames[0];
      // seq within range AND the gap still retained in the ring.
      if (!(seq <= log.nextSeq - 1 && (oldest === undefined || oldest.seq <= seq + 1))) {
        return undefined;
      }
      const replay: StampedFrame[] = [];
      for (const frame of log.frames) {
        if (frame.seq > seq) replay.push({ id: `${log.era}:${frame.seq}`, json: frame.json });
      }
      return replay;
    },
    nextArrival(visitorId) {
      const log = logFor(visitorId);
      const index = log.eventCounter;
      log.eventCounter += 1;
      return { index, era: log.era };
    },
    recordApplied(visitorId, index, era) {
      const log = logFor(visitorId);
      if (log.era !== era) return; // re-minted since the index was stamped
      if (index > log.lastApplied) log.lastApplied = index;
    },
  };
}
