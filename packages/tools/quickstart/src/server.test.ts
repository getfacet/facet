import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { serializeDocument } from "@facet/core";
import { createStubAgent } from "@facet/reference-agent";
import { QUICKSTART_INITIAL_MARKUP, QUICKSTART_INITIAL_STAGE } from "./guide.js";
import { startQuickstart, type RunningQuickstart } from "./server.js";

interface ShellGlobals {
  readonly __FACET_INITIAL_STAGE__?: unknown;
  readonly __FACET_THEME__?: unknown;
  readonly __FACET_POST_TIMEOUT_MS__?: unknown;
}

interface SseFrame {
  readonly data: unknown;
}

async function freePort(): Promise<number> {
  const probe = createServer();
  return await new Promise<number>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (typeof address !== "object" || address === null) {
        reject(new Error("missing probe address"));
        return;
      }
      const port = address.port;
      probe.close((error) => (error === undefined ? resolve(port) : reject(error)));
    });
  });
}

function readShellGlobals(body: string): ShellGlobals {
  const bootTag =
    (body.match(/<script>[\s\S]*?<\/script>/g) ?? []).find((tag) => tag.includes("__FACET_")) ?? "";
  expect(bootTag).not.toBe("");
  const scriptBody = bootTag.slice("<script>".length, -"</script>".length);
  const fakeWindow: ShellGlobals = {};
  new Function("window", scriptBody)(fakeWindow);
  return fakeWindow;
}

function parseBlock(block: string): SseFrame | undefined {
  const dataLine = block
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice("data: ".length);
  return dataLine === undefined ? undefined : { data: JSON.parse(dataLine) };
}

async function readFrames(response: Response, count: number): Promise<SseFrame[]> {
  expect(response.status).toBe(200);
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("no body");
  const decoder = new TextDecoder();
  const frames: SseFrame[] = [];
  let buffer = "";
  while (frames.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index = buffer.indexOf("\n\n");
    while (index !== -1) {
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const frame = parseBlock(block);
      if (frame !== undefined) frames.push(frame);
      index = buffer.indexOf("\n\n");
    }
  }
  await reader.cancel();
  return frames;
}

describe("startQuickstart initial markup bootstrap", () => {
  it("derives the same inline and runtime document from the exact author markup", async () => {
    let running: RunningQuickstart | undefined;
    try {
      running = await startQuickstart({
        port: await freePort(),
        agentId: "quickstart",
        agent: createStubAgent(),
        initialMarkup: QUICKSTART_INITIAL_MARKUP,
      });

      const shell = await (await fetch(`${running.url}/`)).text();
      const globals = readShellGlobals(shell);
      expect(globals.__FACET_INITIAL_STAGE__).toEqual(QUICKSTART_INITIAL_STAGE);
      expect(globals.__FACET_POST_TIMEOUT_MS__).toBe(130_250);

      const [frame] = await readFrames(await fetch(`${running.url}/stream?sessionKey=seed`), 1);
      expect(frame?.data).toMatchObject({
        kind: "patch",
        stageRevision: 0,
        ops: [{ op: "replace", path: "" }],
      });
      const operation = (frame?.data as { readonly ops?: readonly unknown[] }).ops?.[0];
      const document = (operation as { readonly value?: { readonly document?: unknown } }).value
        ?.document;
      expect(document).toEqual(QUICKSTART_INITIAL_STAGE);
    } finally {
      await running?.close();
    }
  });

  it("inlines a browser POST timeout derived from a custom turn window", async () => {
    let running: RunningQuickstart | undefined;
    try {
      running = await startQuickstart({
        port: await freePort(),
        agentId: "quickstart",
        agent: createStubAgent(),
        turnTimeoutMs: 60_000,
      });

      const shell = await (await fetch(`${running.url}/`)).text();
      expect(readShellGlobals(shell).__FACET_POST_TIMEOUT_MS__).toBe(65_000);
    } finally {
      await running?.close();
    }
  });

  it("rejects serialized read-back markup with reserved ids before listen", async () => {
    const port = await freePort();
    const readBackMarkup = serializeDocument(QUICKSTART_INITIAL_STAGE).text;

    await expect(
      startQuickstart({
        port,
        agentId: "quickstart",
        agent: createStubAgent(),
        initialMarkup: readBackMarkup,
      }),
    ).rejects.toThrow(/reserved.*id|id.*reserved/u);

    await expect(
      fetch(`http://localhost:${String(port)}/`, { signal: AbortSignal.timeout(200) }),
    ).rejects.toThrow();
  });
});
