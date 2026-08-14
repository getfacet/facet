// @vitest-environment jsdom
/**
 * /live-test Tier 1b (spec Decision 7, reviewer P1) — the REAL prebuilt page
 * bundle is executed, not a fixture: after `pnpm --filter @facet/quickstart
 * build`, `dist/page/app.js` is evaluated inside jsdom with a `#root` element
 * present, and the test asserts (a) no bare `process.env.NODE_ENV` token
 * survived the tsup define, (b) evaluation does not throw, and (c) React mounts
 * the default component renderer plus the floating chat shell.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEFAULT_THEME } from "@facet/assets";
import { BOUNDS, NEUTRAL_COPY_DEFAULTS, type ComponentDocument } from "@facet/core";

// NOT `new URL("../dist/page/app.js", import.meta.url)`: Vite statically
// rewrites that exact pattern into a served-asset URL (http://localhost:3000/…
// under the jsdom environment), which fileURLToPath then rejects. Deriving the
// directory first sidesteps the transform.
const E2E_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(E2E_DIR, "..");
const BUNDLE_PATH = join(PACKAGE_ROOT, "dist", "page", "app.js");
const PAGE_MAIN_BUNDLE_PATH = join(PACKAGE_ROOT, "dist", "page", "main.js");
const DESIGN_OVERLAY_TYPE_IMPORT = join(PACKAGE_ROOT, "src", "design-overlay.js").replaceAll(
  sep,
  "/",
);
const DESIGN_OVERLAY_NODE_MODULE_URL = pathToFileURL(
  join(PACKAGE_ROOT, "src", "design-overlay-node.ts"),
).href;
const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];

function readBundle(): string {
  try {
    return readFileSync(BUNDLE_PATH, "utf8");
  } catch (error) {
    throw new Error(
      "dist/page/app.js is missing — run `pnpm --filter @facet/quickstart build` " +
        `before the Tier 1b bundle test (it executes the REAL page bundle). [${String(error)}]`,
    );
  }
}

function scalar(value: string): ComponentDocument["nodes"][string]["props"][string] {
  return Object.freeze({ kind: "scalar" as const, value });
}

function documentWithText(text: string): ComponentDocument {
  return Object.freeze({
    entry: "home",
    screens: Object.freeze(["screen"]),
    nodes: Object.freeze({
      screen: Object.freeze({
        tag: "Screen",
        props: Object.freeze({ name: scalar("home") }),
        children: Object.freeze(["copy"]),
      }),
      copy: Object.freeze({
        tag: "Text",
        props: Object.freeze({
          value: scalar(text),
          variant: scalar("heading"),
        }),
        children: Object.freeze([]),
      }),
    }),
  });
}

function completeTheme(background: string, success = "#0f7b4f") {
  return {
    ...DEFAULT_THEME,
    semantic: {
      ...DEFAULT_THEME.semantic,
      canvas: { ...DEFAULT_THEME.semantic.canvas, background },
      status: { ...DEFAULT_THEME.semantic.status, successText: success },
    },
  };
}

async function makeOverlayBundle() {
  const root = await mkdtemp(join(tmpdir(), "facet-quickstart-overlay-bundle-"));
  temporaryRoots.push(root);
  const overlayPath = join(root, "facet-design.tsx");
  const resultPath = join(root, "bundle-result.json");
  const buildScriptPath = join(root, "build-overlay.mjs");
  await writeFile(
    overlayPath,
    [
      `import type { QuickstartDesignOverlay } from "${DESIGN_OVERLAY_TYPE_IMPORT}";`,
      "",
      "function PromoBanner() {",
      '  return <section data-facet-overlay-sentinel="PromoBanner">Bundle overlay promo</section>;',
      "}",
      "",
      "export default {",
      "  theme: {",
      "    foundation: {",
      "      palette: {",
      '        brand500: "#6741d9",',
      "      },",
      "    },",
      "  },",
      "  components: [",
      "    {",
      '      tag: "PromoBanner",',
      '      whenToUse: "Use for an overlay-generated bundle promo.",',
      '      authoring: { role: "display", informationTypes: ["promotion"], visualEmphasis: "primary" },',
      "      props: {},",
      "      acceptsChildren: false,",
      "    },",
      "  ],",
      "  registry: { PromoBanner },",
      "  examples: [",
      "    {",
      '      id: "bundle-promo-screen",',
      '      kind: "screen",',
      '      label: "Bundle promo screen",',
      '      description: "Active overlay screen rendered from the custom bundle.",',
      '      tags: ["Screen", "PromoBanner"],',
      '      markup: `<Facet entry="preview">',
      '  <Screen name="preview">',
      "    <PromoBanner />",
      "  </Screen>",
      "</Facet>`,",
      "    },",
      "  ],",
      "  notes: [",
      "    {",
      '      id: "bundle-overlay",',
      '      title: "Bundle overlay",',
      '      body: "The active Assets tab is using the overlay bundle.",',
      "    },",
      "  ],",
      "} satisfies QuickstartDesignOverlay;",
      "",
    ].join("\n"),
    "utf8",
  );

  await writeFile(
    buildScriptPath,
    [
      `import { writeFile } from "node:fs/promises";`,
      `import { dirname } from "node:path";`,
      `import { loadQuickstartDesignOverlay } from ${JSON.stringify(DESIGN_OVERLAY_NODE_MODULE_URL)};`,
      "",
      "const design = await loadQuickstartDesignOverlay({",
      `  designPath: ${JSON.stringify(overlayPath)},`,
      `  pageMountModulePath: ${JSON.stringify(PAGE_MAIN_BUNDLE_PATH)},`,
      `  temporaryParentDirectory: ${JSON.stringify(join(root, "bundles"))},`,
      "  minify: false,",
      "});",
      "await writeFile(",
      `  ${JSON.stringify(resultPath)},`,
      "  JSON.stringify({",
      "    bundlePath: design.pageBundlePath,",
      "    temporaryDirectory: dirname(design.pageBundlePath),",
      "  }),",
      '  "utf8",',
      ");",
      "",
    ].join("\n"),
    "utf8",
  );
  await execFileAsync("pnpm", ["exec", "tsx", buildScriptPath], {
    cwd: PACKAGE_ROOT,
    timeout: 120_000,
  });
  const result = JSON.parse(readFileSync(resultPath, "utf8")) as {
    readonly bundlePath: string;
    readonly temporaryDirectory: string;
  };

  return Object.freeze({
    bundlePath: result.bundlePath,
    async cleanup(): Promise<void> {
      await rm(result.temporaryDirectory, { force: true, recursive: true });
    },
  });
}

async function waitForSelector(root: ParentNode, selector: string): Promise<Element> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const element = root.querySelector(selector);
    if (element !== null) return element;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const element = root.querySelector(selector);
  expect(element).not.toBeNull();
  return element!;
}

async function clickButton(root: ParentNode, label: string): Promise<void> {
  for (const candidate of root.querySelectorAll("button")) {
    if (candidate instanceof HTMLButtonElement && candidate.textContent?.includes(label) === true) {
      candidate.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      return;
    }
  }
  throw new Error(`Missing button: ${label}`);
}

/** No-op EventSource: enough surface for SseTransport to construct + close. */
class StubEventSource {
  static instances: StubEventSource[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readonly url: string;
  readyState = 0;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  constructor(url: string | URL) {
    this.url = String(url);
    StubEventSource.instances.push(this);
  }
  addEventListener(): void {
    // no-op
  }
  removeEventListener(): void {
    // no-op
  }
  dispatchEvent(): boolean {
    return false;
  }
  emit(message: unknown, lastEventId = ""): void {
    this.onmessage?.({ data: JSON.stringify(message), lastEventId } as MessageEvent<string>);
  }
  close(): void {
    this.readyState = StubEventSource.CLOSED;
  }
}

function installBrowserStubs(): void {
  const globals = globalThis as {
    EventSource?: unknown;
    fetch?: unknown;
  };
  StubEventSource.instances = [];
  globals.EventSource = StubEventSource;
  globals.fetch = (): Promise<Response> =>
    Promise.resolve(new Response("{}", { status: 202, headers: {} }));
}

async function evalBundle(bundleText: string): Promise<HTMLElement> {
  document.body.innerHTML = '<div id="root"></div>';
  document.body.style.background = "";
  const root = document.getElementById("root");
  expect(root).not.toBeNull();

  expect(() => {
    (0, eval)(bundleText);
  }).not.toThrow();

  const deadline = Date.now() + 10_000;
  while (root!.children.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  expect(root!.children.length).toBeGreaterThan(0);
  return root!;
}

function bootWindow(): {
  __FACET_INITIAL_STAGE__?: unknown;
  __FACET_THEME__?: unknown;
  __FACET_POST_TIMEOUT_MS__?: unknown;
  __FACET_QUICKSTART_DISABLE_AUTOMOUNT__?: unknown;
} {
  return window as unknown as {
    __FACET_INITIAL_STAGE__?: unknown;
    __FACET_THEME__?: unknown;
    __FACET_POST_TIMEOUT_MS__?: unknown;
    __FACET_QUICKSTART_DISABLE_AUTOMOUNT__?: unknown;
  };
}

describe("quickstart page bundle (Tier 1b — the real dist/page/app.js)", () => {
  let bundleText: string;

  beforeAll(() => {
    bundleText = readBundle();
  });

  beforeEach(() => {
    delete bootWindow().__FACET_INITIAL_STAGE__;
    delete bootWindow().__FACET_THEME__;
    delete bootWindow().__FACET_POST_TIMEOUT_MS__;
    delete bootWindow().__FACET_QUICKSTART_DISABLE_AUTOMOUNT__;
    installBrowserStubs();
  });

  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  it("contains no bare process.env.NODE_ENV token (tsup define applied)", () => {
    // Without the define, react's CJS entries would branch on `process` and
    // throw `process is not defined` in a real browser.
    expect(bundleText.includes("process.env.NODE_ENV")).toBe(false);
  });

  it("inlines the default React registry path and no retired pattern payload or Node builtin", () => {
    const retiredPatternGlobal = ["__FACET_", "PATTERNS__"].join("");
    expect(bundleText).toContain("data-facet-conversation");
    expect(bundleText).toContain("data-facet-component");
    expect(bundleText).not.toContain(retiredPatternGlobal);
    expect(bundleText).not.toContain("get_pattern"); // component-hard-cut: allowed-negative
    expect(bundleText).not.toContain("provider-only-pattern-provenance");
    expect(bundleText).not.toMatch(
      /\bnode:(?:assert|buffer|child_process|crypto|events|fs|http|https|net|os|path|stream|url|util|worker_threads)\b/,
    );
  });

  it("boots an overlay-generated quickstart bundle", async () => {
    const bundle = await makeOverlayBundle();

    try {
      const root = await evalBundle(readFileSync(bundle.bundlePath, "utf8"));

      expect(root.querySelector("[data-facet-stage]")).not.toBeNull();
      await clickButton(root, "Assets");
      await waitForSelector(root, "[data-facet-asset-explorer]");
      expect(root.querySelector("[data-facet-active-design-mode]")?.textContent).toBe(
        "Custom design",
      );
      expect(root.querySelector("[data-facet-active-design-custom-tags]")?.textContent).toContain(
        "PromoBanner",
      );
      expect(root.querySelector("[data-facet-active-design-note='bundle-overlay']")).not.toBeNull();

      await clickButton(root, "Components");
      await waitForSelector(root, '[data-component-option="PromoBanner"]');

      await clickButton(root, "Screens");
      await waitForSelector(root, '[data-screen-pattern-option="bundle-promo-screen"]');
    } finally {
      await bundle.cleanup();
    }
  });

  it("paints the boot-shipped ComponentDocument immediately through StageRenderer", async () => {
    const seedText = "Seeded component document";
    const background = "#f5f7ff";
    bootWindow().__FACET_THEME__ = completeTheme(background);
    bootWindow().__FACET_INITIAL_STAGE__ = documentWithText(seedText);

    const root = await evalBundle(bundleText);

    const backgroundProbe = document.createElement("div");
    backgroundProbe.style.background = background;
    expect(root.querySelector("[data-facet-stage]")).not.toBeNull();
    expect(root.querySelector("[data-facet-chat-drawer]")).not.toBeNull();
    expect(root.querySelector("[data-facet-chat-conversation]")).toBeNull();
    expect(root.textContent).toContain(seedText);
    expect(document.body.style.background).toBe(backgroundProbe.style.background);
    expect(bootWindow().__FACET_INITIAL_STAGE__).toEqual(documentWithText(seedText));
  });

  it("junk boot globals fall back to a bare default boot without throwing", async () => {
    bootWindow().__FACET_THEME__ = { color: { background: 1 } };
    bootWindow().__FACET_INITIAL_STAGE__ = { root: "retired-tree", nodes: {} };

    const root = await evalBundle(bundleText);

    const defaultProbe = document.createElement("div");
    defaultProbe.style.background = DEFAULT_THEME.semantic.canvas.background;
    expect(root.querySelector("[data-facet-stage]")).not.toBeNull();
    expect(root.querySelector("[data-facet-chat-drawer]")).not.toBeNull();
    expect(root.querySelector("[data-facet-chat-conversation]")).toBeNull();
    expect(root.textContent).not.toContain("retired-tree");
    expect(document.body.style.background).toBe(defaultProbe.style.background);
  });

  it("shows the framework-default over-length validation copy in ConversationSurface", async () => {
    const root = await evalBundle(bundleText);
    const textarea = root.querySelector("textarea");
    const form = root.querySelector("form");
    expect(textarea).not.toBeNull();
    expect(form).not.toBeNull();

    const valueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    valueSetter?.call(textarea, "x".repeat(BOUNDS.conversationMessageChars + 1));
    textarea!.dispatchEvent(new Event("input", { bubbles: true }));
    textarea!.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    const deadline = Date.now() + 10_000;
    while (
      !root.textContent?.includes(NEUTRAL_COPY_DEFAULTS.validation.messageTooLong) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(root.textContent).toContain(NEUTRAL_COPY_DEFAULTS.validation.messageTooLong);
  });

  it("blocks valid message POSTs while the initial visit is still pending", async () => {
    const fetchCalls: string[] = [];
    const unresolved = new Promise<Response>(() => {});
    const globals = globalThis as { fetch: typeof fetch };
    globals.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      fetchCalls.push(url);
      if (url.endsWith("/event")) {
        return unresolved;
      }
      return Promise.resolve(new Response("{}", { status: 202, headers: {} }));
    }) as typeof fetch;

    const root = await evalBundle(bundleText);
    StubEventSource.instances.at(-1)?.onopen?.({});
    const deadline = Date.now() + 10_000;
    while (!fetchCalls.some((url) => url.endsWith("/event")) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    const textarea = root.querySelector("textarea");
    const form = root.querySelector("form");
    const button = form?.querySelector("button[type='submit']");
    expect(textarea).not.toBeNull();
    expect(form).not.toBeNull();
    expect(button).not.toBeNull();
    expect(fetchCalls.filter((url) => url.endsWith("/event"))).toHaveLength(1);
    expect((button as HTMLButtonElement | null)?.disabled).toBe(true);

    const valueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    valueSetter?.call(textarea, "hello while pending");
    textarea!.dispatchEvent(new Event("input", { bubbles: true }));
    textarea!.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fetchCalls.filter((url) => url.endsWith("/message"))).toHaveLength(0);
  });

  it("folds server patch frames from the real SseTransport into StageRenderer", async () => {
    const seedText = "Seed before replacement";
    const replacementText = "Replacement after SSE root write";
    bootWindow().__FACET_INITIAL_STAGE__ = documentWithText(seedText);

    const root = await evalBundle(bundleText);
    const source = StubEventSource.instances[StubEventSource.instances.length - 1];
    expect(source).toBeDefined();
    if (source === undefined) {
      throw new Error("expected the real bundle to subscribe to EventSource");
    }
    expect(root.textContent).toContain(seedText);

    source.emit(
      {
        kind: "patch",
        stageRevision: 1,
        ops: [
          {
            op: "replace",
            path: "",
            value: {
              document: documentWithText(replacementText),
              data: {},
            },
          },
        ],
      },
      "era:1",
    );

    const deadline = Date.now() + 10_000;
    while (!root.textContent?.includes(replacementText) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(root.textContent).not.toContain(seedText);
    expect(root.textContent).toContain(replacementText);
    expect(
      root.querySelector("[data-facet-stage]")?.getAttribute("data-facet-stage-revision"),
    ).toBe("1");
  });
});
