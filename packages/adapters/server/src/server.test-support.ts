import { deriveMessageId, validateCatalog } from "@facet/core";
import type {
  VisitorEvent,
  ComponentDocument,
  ConversationMessage,
  FacetCatalog,
  FacetStage,
  FacetTheme,
  ServerFrame,
} from "@facet/core";
import { validTestTheme } from "../../../../test-support/theme-fixture.js";
import { createFacetServer, type FacetServer, type FacetServerOptions } from "./server.js";

export const MARKUP = `<Facet entry="home"><Screen name="home"><Text value="Ready" /><Action label="Submit" action="agent:submit" /></Screen></Facet>`;

export function testCatalog(): FacetCatalog {
  const result = validateCatalog({
    components: [
      {
        tag: "Screen",
        whenToUse: "Root screen.",
        props: {
          name: {
            type: "string",
            required: true,
            guidance: "Screen name.",
          },
        },
        content: { mode: "children" },
      },
      {
        tag: "Text",
        whenToUse: "Short text.",
        props: {
          value: { type: "string", guidance: "Text value.", bindable: true },
          arg: { type: "string", guidance: "Event argument." },
        },
        content: { mode: "none" },
      },
      {
        tag: "Action",
        whenToUse: "Send one explicit visitor action.",
        props: {
          label: { type: "string", required: true, guidance: "Visible action label." },
          action: {
            type: "string",
            required: true,
            action: true,
            guidance: "Agent action reference.",
          },
        },
        content: { mode: "none" },
      },
    ],
  });
  if (!result.ok) throw new Error(result.code);
  return result.catalog;
}

export function testTheme(): FacetTheme {
  return validTestTheme({
    semantic: {
      action: { primaryBg: "#2563eb" },
      canvas: { background: "#fff" },
      text: { default: "#111827", muted: "#6b7280" },
      status: {
        successText: "#16a34a",
        warningText: "#ca8a04",
        dangerText: "#dc2626",
      },
    },
  });
}

export function visitorEvent(overrides: Partial<VisitorEvent> = {}): VisitorEvent {
  return {
    eventId: "event1",
    eventName: "submit",
    sourceNodeId: "n3",
    screen: "home",
    stageRevision: 0,
    collect: {},
    ...overrides,
  };
}

export function conversation(
  turnId: string,
  role: ConversationMessage["role"],
  text: string,
): ConversationMessage {
  return {
    kind: "conversation",
    messageId: deriveMessageId(turnId, role),
    turnId,
    role,
    text,
    at: 1,
  };
}

export async function start(
  options: Partial<FacetServerOptions> = {},
): Promise<{ readonly server: FacetServer; readonly base: string }> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const port = 20_000 + Math.floor(Math.random() * 20_000);
    const server = createFacetServer({
      port,
      catalog: testCatalog(),
      theme: testTheme(),
      initialMarkup: MARKUP,
      agent: { run: async () => ({ text: "hello from agent" }) },
      ...options,
    });
    try {
      await server.listen();
      return { server, base: `http://127.0.0.1:${port}` };
    } catch {
      // port collision
    }
  }
  throw new Error("could not bind a test port");
}

export interface SseFrame {
  readonly id?: string;
  readonly data: ServerFrame;
}

function parseBlock(block: string): SseFrame | undefined {
  let id: string | undefined;
  let dataLine: string | undefined;
  for (const line of block.split("\n")) {
    if (line.startsWith("id: ")) id = line.slice(4);
    if (line.startsWith("data: ")) dataLine = line.slice(6);
  }
  if (dataLine === undefined) return undefined;
  return id === undefined
    ? { data: JSON.parse(dataLine) as ServerFrame }
    : { id, data: JSON.parse(dataLine) as ServerFrame };
}

export function drainFrames(buffer: string): {
  readonly blocks: readonly string[];
  readonly rest: string;
} {
  const blocks: string[] = [];
  let rest = buffer;
  let index = rest.indexOf("\n\n");
  while (index >= 0) {
    blocks.push(rest.slice(0, index));
    rest = rest.slice(index + 2);
    index = rest.indexOf("\n\n");
  }
  return { blocks, rest };
}

export function eventReader(response: Response): {
  readonly next: (ms?: number) => Promise<SseFrame | undefined>;
  readonly close: () => Promise<void>;
} {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("no body");
  const decoder = new TextDecoder();
  let buffer = "";
  const next = async (ms = 500): Promise<SseFrame | undefined> => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const drained = drainFrames(buffer);
      buffer = drained.rest;
      for (const [index, block] of drained.blocks.entries()) {
        const parsed = parseBlock(block);
        if (parsed !== undefined) {
          buffer =
            drained.blocks
              .slice(index + 1)
              .map((remaining) => `${remaining}\n\n`)
              .join("") + buffer;
          return parsed;
        }
      }
      const timeout = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), Math.max(0, deadline - Date.now())),
      );
      const chunk = await Promise.race([reader.read(), timeout]);
      if (chunk === null || chunk.done) return undefined;
      buffer += decoder.decode(chunk.value, { stream: true });
    }
    return undefined;
  };
  return { next, close: () => reader.cancel() };
}

export async function readFrames(response: Response, count: number): Promise<readonly SseFrame[]> {
  const reader = eventReader(response);
  const frames: SseFrame[] = [];
  try {
    while (frames.length < count) {
      const frame = await reader.next(1000);
      if (frame === undefined) break;
      frames.push(frame);
    }
    return frames;
  } finally {
    await reader.close();
  }
}

export function postEvent(
  base: string,
  sessionKey: string,
  event: VisitorEvent,
): Promise<Response> {
  return fetch(`${base}/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionKey, event }),
  });
}

export function postMessage(
  base: string,
  sessionKey: string,
  messageId: string,
  text: string,
): Promise<Response> {
  return fetch(`${base}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionKey, messageId, text, screen: "home", stageRevision: 0 }),
  });
}

export function stageFromResync(frame: ServerFrame): FacetStage {
  if (frame.kind !== "patch") throw new Error("not a patch");
  const value = frame.ops[0]?.op === "replace" ? frame.ops[0].value : undefined;
  return value as FacetStage;
}

export function textValues(document: ComponentDocument | null): readonly string[] {
  if (document === null) return [];
  return Object.values(document.nodes)
    .filter((node) => node.tag === "Text")
    .map((node) => node.props["value"])
    .map((prop) => (prop?.kind === "scalar" ? prop.value : ""));
}
