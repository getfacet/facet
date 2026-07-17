import type { FacetAgent } from "@facet/core";
import { createFacetServer, type FacetServer } from "./server.js";

export const sayAgent: FacetAgent = () => [{ kind: "say", text: "hello from agent" }];

/** Bind to a random high port, retrying on collisions. */
export async function start(
  options: Omit<Parameters<typeof createFacetServer>[0], "port">,
): Promise<{ server: FacetServer; base: string }> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const port = 20_000 + Math.floor(Math.random() * 20_000);
    const server = createFacetServer({ ...options, port });
    try {
      await server.listen();
      return { server, base: `http://127.0.0.1:${port}` };
    } catch {
      // EADDRINUSE — try another port.
    }
  }
  throw new Error("could not bind a test port");
}

/** One parsed SSE frame: its optional `id:` line and decoded `data:` payload. */
export interface SseFrame {
  readonly id?: string;
  readonly data: unknown;
}

function parseBlock(block: string): SseFrame | undefined {
  let id: string | undefined;
  let dataLine: string | undefined;
  for (const line of block.split("\n")) {
    if (line.startsWith("id: ")) id = line.slice(4);
    else if (line.startsWith("data: ")) dataLine = line.slice(6);
  }
  if (dataLine === undefined) return undefined;
  return id === undefined ? { data: JSON.parse(dataLine) } : { id, data: JSON.parse(dataLine) };
}

export function drainFrames(buffer: string): { blocks: string[]; rest: string } {
  const blocks: string[] = [];
  let index = buffer.indexOf("\n\n");
  while (index !== -1) {
    blocks.push(buffer.slice(0, index));
    buffer = buffer.slice(index + 2);
    index = buffer.indexOf("\n\n");
  }
  return { blocks, rest: buffer };
}

/** Read SSE frames from a /stream response until `count` data frames arrived. */
export async function readEvents(response: Response, count: number): Promise<SseFrame[]> {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("no body");
  const decoder = new TextDecoder();
  const frames: SseFrame[] = [];
  let buffer = "";
  while (frames.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { blocks, rest } = drainFrames(buffer);
    buffer = rest;
    for (const block of blocks) {
      const frame = parseBlock(block);
      if (frame !== undefined) frames.push(frame);
    }
  }
  await reader.cancel();
  return frames;
}

export async function readFrames(response: Response, count: number): Promise<unknown[]> {
  return (await readEvents(response, count)).map((frame) => frame.data);
}

/** Collect every SSE frame that arrives during a bounded window. */
export async function collectEvents(response: Response, ms: number): Promise<SseFrame[]> {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("no body");
  const decoder = new TextDecoder();
  const frames: SseFrame[] = [];
  let buffer = "";
  const deadline = Date.now() + ms;
  try {
    while (Date.now() < deadline) {
      const timeout = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), deadline - Date.now()),
      );
      const chunk = await Promise.race([reader.read(), timeout]);
      if (chunk === null || chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const { blocks, rest } = drainFrames(buffer);
      buffer = rest;
      for (const block of blocks) {
        const frame = parseBlock(block);
        if (frame !== undefined) frames.push(frame);
      }
    }
  } finally {
    await reader.cancel();
  }
  return frames;
}

export function eventReader(response: Response): {
  next(ms: number): Promise<SseFrame | undefined>;
  close(): Promise<void>;
} {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("no body");
  const decoder = new TextDecoder();
  let buffer = "";
  const next = async (ms: number): Promise<SseFrame | undefined> => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const drained = drainFrames(buffer);
      buffer = drained.rest;
      for (const [index, block] of drained.blocks.entries()) {
        const frame = parseBlock(block);
        if (frame !== undefined) {
          buffer =
            drained.blocks
              .slice(index + 1)
              .map((remaining) => `${remaining}\n\n`)
              .join("") + buffer;
          return frame;
        }
      }
      const timeoutMs = Math.max(0, deadline - Date.now());
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
      const chunk = await Promise.race([reader.read(), timeout]);
      if (chunk === null || chunk.done) return undefined;
      buffer += decoder.decode(chunk.value, { stream: true });
    }
    return undefined;
  };
  return { next, close: () => reader.cancel() };
}

/** Poll `predicate` until it succeeds or the window elapses. */
export async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("waitFor timed out");
}

export type ClientEventLike =
  | { kind: "message"; text: string }
  | { kind: "visit"; visitor: { visitorId: string } }
  | { kind: "tap"; action: { name: string; payload?: unknown }; fields?: unknown };

export function postEvent(
  base: string,
  visitorId: string,
  event: ClientEventLike,
): Promise<Response> {
  return fetch(`${base}/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visitor: { visitorId }, event }),
  });
}

export function postRecord(base: string, visitorId: string, event: unknown): Promise<Response> {
  return fetch(`${base}/record`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visitor: { visitorId }, event }),
  });
}

export const sayText = (frames: readonly SseFrame[]): string[] =>
  frames
    .map((frame) => frame.data)
    .filter(
      (data): data is { kind: "say"; text: string } => (data as { kind?: string }).kind === "say",
    )
    .map((data) => data.text);
