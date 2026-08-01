// @vitest-environment jsdom
/**
 * /live-test Tier 1b (spec Decision 7, reviewer P1) — the REAL prebuilt page
 * bundle is executed, not a fixture: after `pnpm --filter @facet/quickstart
 * build`, `dist/page/app.js` is evaluated inside jsdom with a `#root` element
 * present, and the test asserts (a) no bare `process.env.NODE_ENV` token
 * survived the tsup define, (b) evaluation does not throw, and (c) React mounts
 * the default component renderer plus conversation surface.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_THEME } from "@facet/assets";
import { BOUNDS, NEUTRAL_COPY_DEFAULTS, type ComponentDocument } from "@facet/core";

// NOT `new URL("../dist/page/app.js", import.meta.url)`: Vite statically
// rewrites that exact pattern into a served-asset URL (http://localhost:3000/…
// under the jsdom environment), which fileURLToPath then rejects. Deriving the
// directory first sidesteps the transform.
const BUNDLE_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "page", "app.js");

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
    color: {
      ...DEFAULT_THEME.color,
      background,
      success,
    },
  };
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
} {
  return window as unknown as {
    __FACET_INITIAL_STAGE__?: unknown;
    __FACET_THEME__?: unknown;
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
    installBrowserStubs();
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

  it("paints the boot-shipped ComponentDocument immediately through StageRenderer", async () => {
    const seedText = "Seeded component document";
    const background = "#f5f7ff";
    bootWindow().__FACET_THEME__ = completeTheme(background);
    bootWindow().__FACET_INITIAL_STAGE__ = documentWithText(seedText);

    const root = await evalBundle(bundleText);

    const backgroundProbe = document.createElement("div");
    backgroundProbe.style.background = background;
    expect(root.querySelector("[data-facet-stage]")).not.toBeNull();
    expect(root.querySelector("[data-facet-conversation]")).not.toBeNull();
    expect(root.textContent).toContain(seedText);
    expect(document.body.style.background).toBe(backgroundProbe.style.background);
    expect(bootWindow().__FACET_INITIAL_STAGE__).toEqual(documentWithText(seedText));
  });

  it("junk boot globals fall back to a bare default boot without throwing", async () => {
    bootWindow().__FACET_THEME__ = { color: { background: 1 } };
    bootWindow().__FACET_INITIAL_STAGE__ = { root: "retired-tree", nodes: {} };

    const root = await evalBundle(bundleText);

    const defaultProbe = document.createElement("div");
    defaultProbe.style.background = DEFAULT_THEME.color.background;
    expect(root.querySelector("[data-facet-stage]")).not.toBeNull();
    expect(root.querySelector("[data-facet-conversation]")).not.toBeNull();
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
    const button = root.querySelector("button");
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
