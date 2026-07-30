import type { FrameLogStore, StampedFrame } from "./frame-log.js";

export interface ResumeToken {
  readonly era: string;
  readonly seq: number;
}

export function parseResumeToken(value: string): ResumeToken | undefined {
  const separator = value.indexOf(":");
  if (separator <= 0) return undefined;
  const seq = value.slice(separator + 1);
  if (!/^(0|[1-9]\d*)$/u.test(seq)) return undefined;
  return Object.freeze({ era: value.slice(0, separator), seq: Number(seq) });
}

export function replaySince(
  frameLog: FrameLogStore,
  sessionKey: string,
  lastEventId: string,
): readonly StampedFrame[] | undefined {
  const token = parseResumeToken(lastEventId);
  if (token === undefined) return undefined;
  return frameLog.replay(sessionKey, token.era, token.seq);
}
