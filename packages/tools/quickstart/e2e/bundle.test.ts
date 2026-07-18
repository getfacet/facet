// @vitest-environment jsdom
/**
 * /live-test Tier 1b (spec Decision 7, reviewer P1) — the REAL prebuilt page
 * bundle is executed, not a fixture: after `pnpm --filter @facet/quickstart
 * build`, `dist/page/app.js` is evaluated inside jsdom with a `#root` element
 * present, and the test asserts (a) no bare `process.env.NODE_ENV` token
 * survived the tsup define (the browser has no `process`), (b) evaluation does
 * not throw, and (c) React mounts — `#root` gains children.
 *
 * jsdom ships no `EventSource`, and `SseTransport` constructs one on mount —
 * a minimal no-op stub is installed BEFORE evaluation. `fetch` is stubbed with
 * a resolved dummy response for the same reason: the page fires a visit POST
 * on mount, and with no server behind it the real fetch would reject noisily
 * and nondeterministically.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_THEME } from "@facet/assets";

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

function completeTheme(
  name: string,
  lightBackground: string,
  darkBackground: string,
  lightSuccess = "#15803d",
  darkSuccess = "#4ade80",
) {
  return {
    ...DEFAULT_THEME,
    name,
    tokens: {
      ...DEFAULT_THEME.tokens,
      paint: {
        light: {
          ...DEFAULT_THEME.tokens.paint.light,
          color: {
            ...DEFAULT_THEME.tokens.paint.light.color,
            background: lightBackground,
            success: lightSuccess,
          },
        },
        dark: {
          ...DEFAULT_THEME.tokens.paint.dark,
          color: {
            ...DEFAULT_THEME.tokens.paint.dark.color,
            background: darkBackground,
            success: darkSuccess,
          },
        },
      },
    },
  };
}

function matchMediaFor(dark: boolean): typeof window.matchMedia {
  return ((query: string) => ({
    matches: query.includes("prefers-color-scheme") ? dark : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
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
  onmessage: ((event: unknown) => void) | null = null;
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
  emit(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  close(): void {
    this.readyState = StubEventSource.CLOSED;
  }
}

describe("quickstart page bundle (Tier 1b — the real dist/page/app.js)", () => {
  let bundleText: string;

  beforeAll(() => {
    bundleText = readBundle();
  });

  it("contains no bare process.env.NODE_ENV token (tsup define applied)", () => {
    // Without the define, react's CJS entries would branch on `process` and
    // throw `process is not defined` in a real browser (reviewer P1).
    expect(bundleText.includes("process.env.NODE_ENV")).toBe(false);
  });

  it("contains only the Theme browser asset seam and no Pattern payload or Node builtin", () => {
    const retiredPatternGlobal = ["__FACET_", "PATTERNS__"].join("");
    expect(bundleText).toContain("__FACET_THEME__");
    expect(bundleText).not.toContain(retiredPatternGlobal);
    expect(bundleText).not.toContain("get_pattern");
    expect(bundleText).not.toContain("provider-only-pattern-provenance");
    expect(bundleText).not.toMatch(
      /\bnode:(?:assert|buffer|child_process|crypto|events|fs|http|https|net|os|path|stream|url|util|worker_threads)\b/,
    );
  });

  it("paints the boot-shipped seed immediately and themes the canvas (no agent turn)", async () => {
    const globals = globalThis as {
      EventSource?: unknown;
      fetch?: unknown;
    };
    globals.EventSource = StubEventSource;
    globals.fetch = (): Promise<Response> =>
      Promise.resolve(new Response("{}", { status: 202, headers: {} }));

    // The two boot seams the quickstart server inlines into the shell: one
    // complete Theme and one seed stage. Setting them BEFORE eval mirrors the
    // shell running the inline <script> ahead of /app.js.
    const bootWindow = window as unknown as {
      __FACET_INITIAL_STAGE__?: unknown;
      __FACET_THEME__?: unknown;
      __FACET_PATTERNS__?: unknown;
    };
    const seedText = "Seeded skeleton pre-model";
    const lightBackground = "#f5f7ff";
    const darkBackground = "#0b1020";
    bootWindow.__FACET_THEME__ = completeTheme("midnight", lightBackground, darkBackground);
    window.matchMedia = matchMediaFor(true);
    bootWindow.__FACET_INITIAL_STAGE__ = {
      root: "seed-root",
      nodes: {
        "seed-root": {
          id: "seed-root",
          type: "box",
          style: { preset: "panel", direction: "column", gap: "md", padding: "lg" },
          children: ["seed-hero"],
        },
        "seed-hero": {
          id: "seed-hero",
          type: "text",
          value: seedText,
          style: { preset: "heading", color: "success" },
        },
      },
    };

    try {
      document.body.innerHTML = '<div id="root"></div>';
      const root = document.getElementById("root");
      expect(root).not.toBeNull();

      expect(() => {
        (0, eval)(bundleText);
      }).not.toThrow();

      // The FIRST paint is the seed itself: poll only for React's async mount,
      // NOT for any server frame — none can arrive (EventSource is a no-op stub
      // and fetch is a dummy). The seed text in the DOM proves the page no longer
      // waits on the first model turn to paint (Fix A).
      const deadline = Date.now() + 10_000;
      while (root!.children.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(root!.textContent).toContain(seedText);

      // The canvas follows the dark branch of the one host-owned Theme. The
      // document selects no Theme, while its Preset + token style remains visible.
      const darkBackgroundProbe = document.createElement("div");
      darkBackgroundProbe.style.background = darkBackground;
      const canvasDeadline = Date.now() + 10_000;
      while (
        document.body.style.background !== darkBackgroundProbe.style.background &&
        Date.now() < canvasDeadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(document.body.style.background).toBe(darkBackgroundProbe.style.background);
      const heading = Array.from(root!.querySelectorAll("p")).find(
        (element) => element.textContent === seedText,
      ) as HTMLElement | undefined;
      expect(heading).toBeDefined();
      expect(heading?.style.fontSize).not.toBe("");
      const darkSuccessProbe = document.createElement("div");
      darkSuccessProbe.style.color = "#4ade80";
      expect(heading?.style.color).toBe(darkSuccessProbe.style.color);
      expect(bootWindow.__FACET_PATTERNS__).toBeUndefined();
    } finally {
      delete bootWindow.__FACET_INITIAL_STAGE__;
      delete bootWindow.__FACET_THEME__;
      delete bootWindow.__FACET_PATTERNS__;
    }
  });

  it("evaluates in jsdom without throwing and mounts into #root", async () => {
    const globals = globalThis as {
      EventSource?: unknown;
      fetch?: unknown;
    };
    globals.EventSource = StubEventSource;
    // The page fires a visit POST on mount; answer it with a quiet dummy so
    // the run is deterministic with no server behind the page.
    globals.fetch = (): Promise<Response> =>
      Promise.resolve(new Response("{}", { status: 202, headers: {} }));

    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById("root");
    expect(root).not.toBeNull();

    // Indirect eval → global scope, where jsdom's window/document live.
    expect(() => {
      (0, eval)(bundleText);
    }).not.toThrow();

    // React 19's createRoot render is not synchronous — poll briefly.
    const deadline = Date.now() + 10_000;
    while (root!.children.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(root!.children.length).toBeGreaterThan(0);
    const page = root!.firstElementChild as HTMLElement | null;
    expect(page).not.toBeNull();
    expect(page!.style.fontFamily).toBe("Nunito, sans-serif");
  });

  it("junk boot globals fall back to a bare boot: mounts on EMPTY_TREE + default canvas, no throw", async () => {
    const globals = globalThis as {
      EventSource?: unknown;
      fetch?: unknown;
    };
    globals.EventSource = StubEventSource;
    globals.fetch = (): Promise<Response> =>
      Promise.resolve(new Response("{}", { status: 202, headers: {} }));

    const bootWindow = window as unknown as {
      __FACET_INITIAL_STAGE__?: unknown;
      __FACET_THEME__?: unknown;
    };
    window.matchMedia = matchMediaFor(false);

    // Evaluate the real bundle against the current globals and wait for React to
    // mount. Returns the freshly-created #root so callers can assert on the DOM.
    const runBoot = async (expectedBackground: string): Promise<HTMLElement> => {
      document.body.innerHTML = '<div id="root"></div>';
      document.body.style.background = "";
      const root = document.getElementById("root");
      expect(root).not.toBeNull();
      const sourceCount = StubEventSource.instances.length;
      expect(() => {
        (0, eval)(bundleText);
      }).not.toThrow();
      const deadline = Date.now() + 10_000;
      while (
        (root!.children.length === 0 ||
          document.body.style.background !== expectedBackground ||
          StubEventSource.instances.length <= sourceCount) &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return root!;
    };

    // Both junk cases must land on the asset package's default light canvas.
    // Compute via a probe so the assertion follows the canonical Theme and
    // doesn't hardcode jsdom's hex→rgb normalization.
    const defaultProbe = document.createElement("div");
    defaultProbe.style.background = DEFAULT_THEME.tokens.paint.light.color.background;

    try {
      // Case 1: a non-object Theme global and a non-tree seed both fail their
      // shape floors, so the page mounts on EMPTY_TREE + default Theme.
      bootWindow.__FACET_THEME__ = "junk";
      bootWindow.__FACET_INITIAL_STAGE__ = { root: 5 };
      let root = await runBoot(defaultProbe.style.background);
      expect(root.children.length).toBeGreaterThan(0); // mounted, not a blank page
      expect(root.textContent).not.toContain("Seeded"); // no node from the junk seed
      expect(document.body.style.background).toBe(defaultProbe.style.background);

      // Case 2: a name-only Theme passes the cheap page floor but fails complete
      // Theme validation in the renderer, so fallback remains whole/default.
      bootWindow.__FACET_THEME__ = { name: "incomplete" };
      bootWindow.__FACET_INITIAL_STAGE__ = { root: 5 };
      root = await runBoot(defaultProbe.style.background);
      expect(root.children.length).toBeGreaterThan(0);
      expect(document.body.style.background).toBe(defaultProbe.style.background);

      // Case 3: one complete Theme is observable with a valid styled seed. The
      // document contains no Theme selector; the host-owned asset alone controls paint.
      const okBg = "#123456";
      bootWindow.__FACET_THEME__ = completeTheme("ok", okBg, "#010203");
      bootWindow.__FACET_INITIAL_STAGE__ = {
        root: "seed-root",
        nodes: {
          "seed-root": {
            id: "seed-root",
            type: "box",
            style: { preset: "panel", direction: "column", gap: "md" },
            children: ["seed-hero"],
          },
          "seed-hero": {
            id: "seed-hero",
            type: "text",
            value: "ok-seed",
            style: { preset: "heading" },
          },
        },
      };
      const okProbe = document.createElement("div");
      okProbe.style.background = okBg;
      root = await runBoot(okProbe.style.background);
      expect(root.textContent).toContain("ok-seed");
      expect(document.body.style.background).toBe(okProbe.style.background);
    } finally {
      delete bootWindow.__FACET_INITIAL_STAGE__;
      delete bootWindow.__FACET_THEME__;
    }
  });

  it("wires transition metadata into the real page bundle", async () => {
    const globals = globalThis as {
      EventSource?: unknown;
      fetch?: unknown;
    };
    StubEventSource.instances = [];
    globals.EventSource = StubEventSource;
    globals.fetch = (): Promise<Response> =>
      Promise.resolve(new Response("{}", { status: 202, headers: {} }));

    const seedText = "Seed before replacement";
    const replacementText = "Replacement after SSE root write";
    const bootWindow = window as unknown as {
      __FACET_INITIAL_STAGE__?: unknown;
      __FACET_THEME__?: unknown;
    };

    bootWindow.__FACET_INITIAL_STAGE__ = {
      root: "seed-root",
      nodes: {
        "seed-root": {
          id: "seed-root",
          type: "box",
          style: { direction: "column", gap: "md" },
          children: ["seed-copy"],
        },
        "seed-copy": { id: "seed-copy", type: "text", value: seedText },
      },
    };

    try {
      document.body.innerHTML = '<div id="root"></div>';
      const root = document.getElementById("root");
      expect(root).not.toBeNull();

      expect(() => {
        (0, eval)(bundleText);
      }).not.toThrow();

      const seedDeadline = Date.now() + 10_000;
      while (
        (!root!.textContent?.includes(seedText) || StubEventSource.instances.length === 0) &&
        Date.now() < seedDeadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(root!.textContent).toContain(seedText);
      const source = StubEventSource.instances[StubEventSource.instances.length - 1];
      expect(source).toBeDefined();
      if (source === undefined) {
        throw new Error("expected the real bundle to subscribe to EventSource");
      }

      source.emit({
        kind: "patch",
        patches: [
          {
            op: "replace",
            path: "",
            value: {
              root: "replacement-root",
              nodes: {
                "replacement-root": {
                  id: "replacement-root",
                  type: "box",
                  style: { direction: "column", gap: "md" },
                  children: ["replacement-copy"],
                },
                "replacement-copy": {
                  id: "replacement-copy",
                  type: "text",
                  value: replacementText,
                },
              },
            },
          },
        ],
      });

      const transitionDeadline = Date.now() + 10_000;
      let frame: Element | null = null;
      while (Date.now() < transitionDeadline) {
        frame = root!.querySelector(".facet-motion-stage-frame.facet-motion-stage-crossfade");
        if (frame !== null && root!.textContent?.includes(replacementText)) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      expect(root!.textContent).toContain(replacementText);
      expect(frame).not.toBeNull();
      expect(frame!.querySelector(".facet-motion-stage-current")?.textContent).toContain(
        replacementText,
      );
      expect(frame!.querySelector(".facet-motion-stage-previous")?.textContent).toContain(seedText);
    } finally {
      delete bootWindow.__FACET_INITIAL_STAGE__;
      delete bootWindow.__FACET_THEME__;
    }
  });
});
