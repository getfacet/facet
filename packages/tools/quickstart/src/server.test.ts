import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { serializeDocument, type ComponentDocument, type ComponentSpec } from "@facet/core";
import { createStubAgent } from "@facet/reference-agent";
import { resolveQuickstartDesignOverlay } from "./design-overlay.js";
import { QUICKSTART_INITIAL_MARKUP, QUICKSTART_INITIAL_STAGE } from "./guide.js";
import { startQuickstart, type QuickstartServerOptions, type RunningQuickstart } from "./server.js";

interface ShellGlobals {
  readonly __FACET_INITIAL_STAGE__?: unknown;
  readonly __FACET_THEME__?: unknown;
  readonly __FACET_POST_TIMEOUT_MS__?: unknown;
}

interface SseFrame {
  readonly data: unknown;
}

const PROMO_BANNER_SPEC: ComponentSpec = Object.freeze({
  tag: "PromoBanner",
  whenToUse: "Use for a promotional banner fixture.",
  props: Object.freeze({
    title: Object.freeze({
      type: "string",
      guidance: "Concise promotional title.",
      required: true,
    }),
  }),
  acceptsChildren: false,
});

const PROMO_MARKUP = `<Facet entry="home">
  <Screen name="home" title="Seeded">
    <PromoBanner title="Active catalog seed" />
  </Screen>
</Facet>`;

const PromoBanner = () => null;
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

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

function activeDesign() {
  const result = resolveQuickstartDesignOverlay({
    theme: {
      semantic: {
        action: {
          primaryBg: "#123456",
        },
      },
    },
    components: [PROMO_BANNER_SPEC],
    registry: { PromoBanner },
  });
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.detail}`);
  }
  return result.design;
}

function documentTags(document: ComponentDocument): readonly string[] {
  return Object.values(document.nodes).map((node) => node.tag);
}

async function writePageBundle(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "facet-quickstart-server-bundle-"));
  temporaryRoots.push(root);
  const bundlePath = join(root, "app.js");
  await writeFile(bundlePath, "console.log('quickstart server test bundle');\n", "utf8");
  return bundlePath;
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

  it("validates initial markup against the active catalog before listen", async () => {
    const design = activeDesign();
    let running: RunningQuickstart | undefined;
    try {
      running = await startQuickstart({
        port: await freePort(),
        agentId: "quickstart",
        agent: createStubAgent(),
        catalog: design.catalog,
        theme: design.theme,
        themeExtensions: design.themeExtensions,
        pageBundlePath: await writePageBundle(),
        initialMarkup: PROMO_MARKUP,
      });

      const shell = await (await fetch(`${running.url}/`)).text();
      const globals = readShellGlobals(shell);
      const inlineStage = globals.__FACET_INITIAL_STAGE__ as ComponentDocument;
      expect(documentTags(inlineStage)).toContain("PromoBanner");
      expect(globals.__FACET_THEME__).toMatchObject({
        semantic: { action: { primaryBg: "#123456" } },
      });

      const [frame] = await readFrames(await fetch(`${running.url}/stream?sessionKey=custom`), 1);
      const operation = (frame?.data as { readonly ops?: readonly unknown[] }).ops?.[0];
      const document = (operation as { readonly value?: { readonly document?: unknown } }).value
        ?.document as ComponentDocument;
      expect(documentTags(document)).toContain("PromoBanner");
    } finally {
      await running?.close();
    }
  });

  it("rejects a custom catalog without a matching page bundle before listen", async () => {
    const design = activeDesign();
    const port = await freePort();

    await expect(
      startQuickstart({
        port,
        agentId: "quickstart",
        agent: createStubAgent(),
        catalog: design.catalog,
        theme: design.theme,
        initialMarkup: PROMO_MARKUP,
      } as QuickstartServerOptions),
    ).rejects.toThrow(/custom quickstart catalog requires a matching page bundle path/u);

    await expect(
      fetch(`http://localhost:${String(port)}/`, { signal: AbortSignal.timeout(200) }),
    ).rejects.toThrow();
  });

  it("rejects custom initial markup without the active catalog before listen", async () => {
    const port = await freePort();

    await expect(
      startQuickstart({
        port,
        agentId: "quickstart",
        agent: createStubAgent(),
        initialMarkup: PROMO_MARKUP,
      }),
    ).rejects.toThrow(/unknown|registered|component|tag/u);

    await expect(
      fetch(`http://localhost:${String(port)}/`, { signal: AbortSignal.timeout(200) }),
    ).rejects.toThrow();
  });
});
