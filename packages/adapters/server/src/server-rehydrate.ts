import type { ServerResponse } from "node:http";
import type { ConversationMessage, FacetStage, PatchFrame, ServerFrame } from "@facet/core";
import type { Sink, StageStore } from "@facet/runtime";
import { loadSession } from "@facet/runtime";
import type { FrameLogStore } from "./frame-log.js";
import { replaySince } from "./late.js";
import { writeSse } from "./sse.js";

export function writeFrame(res: ServerResponse, json: string, id: string): void {
  writeSse(res, { json }, id);
}

export function writeServerFrame(res: ServerResponse, frame: ServerFrame, id?: string): void {
  writeSse(res, { data: frame }, id);
}

export function resumeStream(
  res: ServerResponse,
  sessionKey: string,
  lastEventId: string,
  frameLog: FrameLogStore,
  join: () => void,
): boolean {
  const replay = replaySince(frameLog, sessionKey, lastEventId);
  if (replay === undefined) return false;
  join();
  for (const frame of replay) writeFrame(res, frame.json, frame.id);
  return true;
}

function stageOf(session: Awaited<ReturnType<typeof loadSession>>["session"]): FacetStage {
  return Object.freeze({ document: session.document, data: session.data });
}

export async function rehydrate(
  res: ServerResponse,
  sessionKey: string,
  frameLog: FrameLogStore,
  store: StageStore,
  sink: Sink,
  ensureSession: (sessionKey: string) => Promise<void>,
  isClosed: () => boolean,
  join: () => void,
): Promise<void> {
  try {
    await ensureSession(sessionKey);
    if (isClosed()) return;
    join();
    const loaded = await loadSession(store, sessionKey);
    if (isClosed()) return;
    const log = frameLog.logFor(sessionKey);
    const stage = stageOf(loaded.session);
    const resync: PatchFrame = Object.freeze({
      kind: "patch" as const,
      stageRevision: loaded.session.stageRevision,
      ops: Object.freeze([{ op: "replace" as const, path: "", value: stage }]),
    });
    writeServerFrame(res, resync, `${log.era}:0`);
    const history: readonly ConversationMessage[] = await sink.history(sessionKey, 100);
    const collapsed = new Map<string, ConversationMessage>();
    for (const message of history) {
      collapsed.set(message.messageId, message);
    }
    for (const message of collapsed.values()) {
      writeServerFrame(res, message, `${log.era}:0`);
    }
  } catch {
    res.end();
  }
}
