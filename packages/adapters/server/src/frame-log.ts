import type { ServerFrame } from "@facet/core";

/** One retained frame from the runtime outbox. */
export interface LoggedFrame {
  readonly seq: number;
  readonly frame: ServerFrame;
  readonly json: string;
}

export interface FrameLog {
  readonly era: string;
  readonly frames: readonly LoggedFrame[];
}

export interface StampedFrame {
  readonly id: string;
  readonly json: string;
}

export interface FrameLogStore {
  logFor(sessionKey: string): FrameLog;
  append(
    sessionKey: string,
    entry: { readonly seq: number; readonly frame: ServerFrame },
  ): StampedFrame;
  replay(sessionKey: string, era: string, sinceSeq: number): readonly StampedFrame[] | undefined;
  evict(sessionKey: string): void;
}

export const FRAME_LOG_LIMIT = 200;
export const MAX_FRAME_SESSIONS = 1000;

let eraCounter = 0;

function mintEra(): string {
  eraCounter += 1;
  return `${eraCounter.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

interface MutableFrameLog {
  era: string;
  frames: LoggedFrame[];
}

function touch<K, V>(map: Map<K, V>, key: K, value: V): V {
  map.delete(key);
  map.set(key, value);
  return value;
}

export function createFrameLogStore(): FrameLogStore {
  const logs = new Map<string, MutableFrameLog>();

  const logFor = (sessionKey: string): MutableFrameLog => {
    const existing = logs.get(sessionKey);
    if (existing !== undefined) {
      return touch(logs, sessionKey, existing);
    }
    const created = { era: mintEra(), frames: [] };
    logs.set(sessionKey, created);
    while (logs.size > MAX_FRAME_SESSIONS) {
      const oldest = logs.keys().next().value;
      if (oldest === undefined) break;
      logs.delete(oldest);
    }
    return created;
  };

  return {
    logFor(sessionKey) {
      const log = logFor(sessionKey);
      return Object.freeze({ era: log.era, frames: Object.freeze([...log.frames]) });
    },
    append(sessionKey, entry) {
      const log = logFor(sessionKey);
      const logged = Object.freeze({
        seq: entry.seq,
        frame: entry.frame,
        json: JSON.stringify(entry.frame),
      });
      log.frames.push(logged);
      while (log.frames.length > FRAME_LOG_LIMIT) log.frames.shift();
      return Object.freeze({ id: `${log.era}:${entry.seq}`, json: logged.json });
    },
    replay(sessionKey, era, sinceSeq) {
      const log = logs.get(sessionKey);
      if (log === undefined || log.era !== era) return undefined;
      touch(logs, sessionKey, log);
      const oldest = log.frames[0];
      if (oldest !== undefined && sinceSeq + 1 < oldest.seq) return undefined;
      return Object.freeze(
        log.frames
          .filter((frame) => frame.seq > sinceSeq)
          .map((frame) => Object.freeze({ id: `${log.era}:${frame.seq}`, json: frame.json })),
      );
    },
    evict(sessionKey) {
      logs.delete(sessionKey);
    },
  };
}
