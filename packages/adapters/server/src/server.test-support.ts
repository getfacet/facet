import { deriveMessageId, validateCatalog, validateTheme } from "@facet/core";
import type {
  AgentEvent,
  ComponentDocument,
  ConversationMessage,
  FacetCatalog,
  FacetStage,
  FacetTheme,
  ServerFrame,
} from "@facet/core";
import { createFacetServer, type FacetServer, type FacetServerOptions } from "./server.js";

export const MARKUP = `<Facet entry="home"><Screen name="home"><Text value="Ready" /></Screen></Facet>`;

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
        acceptsChildren: true,
      },
      {
        tag: "Text",
        whenToUse: "Short text.",
        props: {
          value: { type: "string", guidance: "Text value.", bindable: true },
          arg: { type: "string", guidance: "Event argument." },
        },
        acceptsChildren: false,
      },
    ],
  });
  if (!result.ok) throw new Error(result.code);
  return result.catalog;
}

export function testTheme(): FacetTheme {
  const result = validateTheme({
    color: {
      background: "#fff",
      surface: "#f9fafb",
      border: "#e5e7eb",
      text: "#111827",
      textMuted: "#6b7280",
      accent: "#2563eb",
      onAccent: "#fff",
      success: "#16a34a",
      warning: "#ca8a04",
      danger: "#dc2626",
    },
    space: { xs: "2px", sm: "4px", md: "8px", lg: "16px", xl: "24px" },
    radius: { sm: "4px", md: "8px", lg: "12px", full: "999px" },
    borderWidth: { thin: "1px", thick: "2px" },
    shadow: { sm: "none", md: "0 2px 8px #0002", lg: "0 8px 24px #0003" },
    fontFamily: { sans: "system-ui", mono: "ui-monospace" },
    fontSize: { xs: "12px", sm: "14px", md: "16px", lg: "18px", xl: "22px" },
    fontWeight: { regular: "400", medium: "500", bold: "700" },
    lineHeight: { tight: "1.1", normal: "1.4", relaxed: "1.8" },
  });
  if (!result.ok) throw new Error(result.code);
  return result.theme;
}

export function agentEvent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    eventId: "event1",
    eventName: "submit",
    sourceNodeId: "node1",
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

export function postEvent(base: string, sessionKey: string, event: AgentEvent): Promise<Response> {
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
