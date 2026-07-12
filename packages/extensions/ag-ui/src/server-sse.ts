import { Buffer } from "node:buffer";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { AGUIEvent } from "@ag-ui/core";

import { runError } from "./server-output.js";
import {
  AgUiHttpInputError,
  DEFAULT_MAX_BUFFERED_SSE_EVENTS,
  SSE_HEADERS,
} from "./server-types.js";

export function writeAgUiSseEvent(res: ServerResponse, event: AGUIEvent): void {
  res.write(agUiSseFrame(event));
}

function agUiSseFrame(event: AGUIEvent): string {
  try {
    const json = JSON.stringify(event);
    if (json !== undefined) return `data: ${json}\n\n`;
  } catch {
    // Fall through to the safe terminal event below.
  }
  return `data: ${JSON.stringify(runError("Malformed AG-UI SSE event", "BAD_REQUEST"))}\n\n`;
}

export function writeAgUiSseResponse(
  res: ServerResponse,
  statusCode: number,
  events: readonly AGUIEvent[],
): void {
  try {
    if (isResponseClosed(res)) return;
    if (!res.headersSent) res.writeHead(statusCode, SSE_HEADERS);
    for (const event of events) {
      if (isResponseClosed(res)) return;
      writeAgUiSseEvent(res, event);
    }
    endResponse(res);
  } catch {
    closeResponseForWriteFailure(res);
  }
}

export function createSseWriteQueue(
  res: ServerResponse,
  maxBufferedEvents: number | false = DEFAULT_MAX_BUFFERED_SSE_EVENTS,
): {
  readonly enqueue: (event: AGUIEvent) => void;
  readonly flush: () => Promise<void>;
} {
  const maxBuffered = normalizeMaxBufferedSseEvents(maxBufferedEvents);
  let closed = false;
  let pumping = false;
  const queue: AGUIEvent[] = [];
  const flushWaiters: Array<() => void> = [];
  const onClose = (): void => {
    closed = true;
    queue.length = 0;
    resolveFlushWaiters();
  };
  const resolveFlushWaiters = (): void => {
    if (!closed && (pumping || queue.length > 0)) return;
    res.off("close", onClose);
    res.off("error", onClose);
    while (flushWaiters.length > 0) flushWaiters.shift()?.();
  };
  res.once("close", onClose);
  res.once("error", onClose);
  const closeQueueForWriteFailure = (): void => {
    closed = true;
    queue.length = 0;
    closeResponseForWriteFailure(res);
    resolveFlushWaiters();
  };
  const startPump = (): void => {
    void pump().catch(closeQueueForWriteFailure);
  };
  const pump = async (): Promise<void> => {
    if (pumping) return;
    pumping = true;
    try {
      while (!closed && queue.length > 0 && !res.destroyed && !res.writableEnded) {
        const event = queue.shift();
        if (event === undefined) continue;
        try {
          const blocked = writeAgUiSseEventWithBackpressure(res, event);
          if (blocked !== undefined) await blocked;
        } catch {
          closeQueueForWriteFailure();
          break;
        }
      }
    } finally {
      pumping = false;
      resolveFlushWaiters();
      if (!closed && queue.length > 0) startPump();
    }
  };
  return {
    enqueue: (event) => {
      if (closed || res.destroyed || res.writableEnded) return;
      if (pumping && maxBuffered !== false && queue.length >= maxBuffered) {
        closed = true;
        closeResponseForOverflow(res);
        resolveFlushWaiters();
        return;
      }
      queue.push(event);
      startPump();
    },
    flush: () =>
      !closed && (pumping || queue.length > 0)
        ? new Promise((resolve) => {
            flushWaiters.push(resolve);
          })
        : Promise.resolve(),
  };
}

function normalizeMaxBufferedSseEvents(value: number | false): number | false {
  if (value === false) return false;
  if (!Number.isFinite(value)) return DEFAULT_MAX_BUFFERED_SSE_EVENTS;
  return Math.max(1, Math.floor(value));
}

function closeResponseForOverflow(res: ServerResponse): void {
  closeResponseForWriteFailure(res);
}

function closeResponseForWriteFailure(res: ServerResponse): void {
  if (res.destroyed || res.writableEnded) return;
  try {
    res.destroy();
  } catch {
    endResponse(res);
  }
}

function writeAgUiSseEventWithBackpressure(
  res: ServerResponse,
  event: AGUIEvent,
): Promise<void> | undefined {
  if (res.destroyed || res.writableEnded) return undefined;
  if (res.write(agUiSseFrame(event))) return undefined;

  return new Promise((resolve) => {
    const cleanup = (): void => {
      res.off("drain", onDrain);
      res.off("close", onClose);
      res.off("error", onError);
    };
    const settle = (): void => {
      cleanup();
      resolve();
    };
    const onDrain = (): void => settle();
    const onClose = (): void => settle();
    const onError = (): void => settle();
    res.once("drain", onDrain);
    res.once("close", onClose);
    res.once("error", onError);
  });
}

export function endResponse(res: ServerResponse): void {
  if (!res.destroyed && !res.writableEnded) res.end();
}

export function isResponseClosed(res: ServerResponse): boolean {
  return res.destroyed || res.writableEnded;
}

export async function readRequestBody(req: IncomingMessage, maxBodyBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for await (const chunk of req as AsyncIterable<unknown>) {
    const buffer = bodyChunkToBuffer(chunk);
    receivedBytes += buffer.byteLength;
    if (receivedBytes > maxBodyBytes) {
      throw new AgUiHttpInputError(413, "PAYLOAD_TOO_LARGE", "AG-UI request body is too large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function bodyChunkToBuffer(chunk: unknown): Buffer {
  if (typeof chunk === "string") return Buffer.from(chunk);
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  throw new AgUiHttpInputError(400, "BAD_REQUEST", "Unsupported AG-UI request body chunk");
}

export function parseRequestJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new AgUiHttpInputError(400, "BAD_REQUEST", "Malformed JSON body");
  }
}
