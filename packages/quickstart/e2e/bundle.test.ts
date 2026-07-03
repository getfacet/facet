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

/** No-op EventSource: enough surface for SseTransport to construct + close. */
class StubEventSource {
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
  });

  it("paints the boot-shipped seed immediately and themes the canvas (no agent turn)", async () => {
    const globals = globalThis as {
      EventSource?: unknown;
      fetch?: unknown;
    };
    globals.EventSource = StubEventSource;
    globals.fetch = (): Promise<Response> =>
      Promise.resolve(new Response("{}", { status: 202, headers: {} }));

    // The two boot seams the quickstart server inlines into the shell: a seed
    // stage (with the theme pre-selected) and the theme registry that names it.
    // Setting them BEFORE eval mirrors the shell running the inline <script>
    // ahead of /app.js.
    const bootWindow = window as unknown as {
      __FACET_INITIAL_STAGE__?: unknown;
      __FACET_THEMES__?: unknown;
    };
    const seedText = "Seeded skeleton pre-model";
    bootWindow.__FACET_INITIAL_STAGE__ = {
      root: "seed-root",
      theme: "midnight",
      nodes: {
        "seed-root": {
          id: "seed-root",
          type: "box",
          style: { direction: "col", gap: "md" },
          children: ["seed-hero"],
        },
        "seed-hero": { id: "seed-hero", type: "text", value: seedText },
      },
    };
    bootWindow.__FACET_THEMES__ = [{ name: "midnight", color: { bg: "#0b1020", fg: "#e5e7eb" } }];

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

      // Fix B: the canvas (document.body, outside the tree) follows the resolved
      // theme's bg. The seed pre-selects theme "midnight", so the body background
      // is midnight's bg, not the default white. Compute the expected normalized
      // color via a detached element so the assertion doesn't hardcode jsdom's
      // hex→rgb conversion.
      const probe = document.createElement("div");
      probe.style.background = "#0b1020";
      const whiteProbe = document.createElement("div");
      whiteProbe.style.background = "#ffffff";
      expect(document.body.style.background).toBe(probe.style.background);
      expect(document.body.style.background).not.toBe(whiteProbe.style.background);
    } finally {
      delete bootWindow.__FACET_INITIAL_STAGE__;
      delete bootWindow.__FACET_THEMES__;
    }
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
      __FACET_THEMES__?: unknown;
    };

    // Evaluate the real bundle against the current globals and wait for React to
    // mount. Returns the freshly-created #root so callers can assert on the DOM.
    const runBoot = async (): Promise<HTMLElement> => {
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
      return root!;
    };

    // Default canvas is white (theme.ts default bg #ffffff) — the fallback both
    // junk cases must land on. Compute via a probe so the assertion doesn't
    // hardcode jsdom's hex→rgb normalization.
    const whiteProbe = document.createElement("div");
    whiteProbe.style.background = "#ffffff";

    try {
      // Case 1: a non-array themes global and a non-tree seed. readThemes returns
      // undefined (not an array) and readInitialStage returns undefined
      // (isTreeShaped rejects `{ root: 5 }`), so the page mounts on EMPTY_TREE
      // with the default theme — a blank canvas, never a thrown error.
      bootWindow.__FACET_THEMES__ = "junk";
      bootWindow.__FACET_INITIAL_STAGE__ = { root: 5 };
      let root = await runBoot();
      expect(root.children.length).toBeGreaterThan(0); // mounted, not a blank page
      expect(root.textContent).not.toContain("Seeded"); // no node from the junk seed
      expect(document.body.style.background).toBe(whiteProbe.style.background);

      // Case 2: a partially-junk themes array (`null` and `{ name: 7 }` are not
      // valid theme shapes) with the same non-tree seed — still mounts on
      // EMPTY_TREE + default canvas: the junk entries never reach StageRenderer.
      bootWindow.__FACET_THEMES__ = [null, { name: 7 }, { name: "ok" }];
      bootWindow.__FACET_INITIAL_STAGE__ = { root: 5 };
      root = await runBoot();
      expect(root.children.length).toBeGreaterThan(0);
      expect(document.body.style.background).toBe(whiteProbe.style.background);

      // Case 3: the partial-filter survivor is observable — a VALID seed that
      // pre-selects theme "ok" alongside the same mixed array. Only if readThemes
      // kept `{ name: "ok" }` (dropping `null` and `{ name: 7 }`) does the canvas
      // take ok's bg; a filter that threw, dropped ok, or let junk through would
      // fail here.
      const okBg = "#123456";
      bootWindow.__FACET_THEMES__ = [
        null,
        { name: 7 },
        { name: "ok", color: { bg: okBg, fg: "#ffffff" } },
      ];
      bootWindow.__FACET_INITIAL_STAGE__ = {
        root: "seed-root",
        theme: "ok",
        nodes: {
          "seed-root": {
            id: "seed-root",
            type: "box",
            style: { direction: "col", gap: "md" },
            children: ["seed-hero"],
          },
          "seed-hero": { id: "seed-hero", type: "text", value: "ok-seed" },
        },
      };
      root = await runBoot();
      expect(root.textContent).toContain("ok-seed");
      const okProbe = document.createElement("div");
      okProbe.style.background = okBg;
      expect(document.body.style.background).toBe(okProbe.style.background);
    } finally {
      delete bootWindow.__FACET_INITIAL_STAGE__;
      delete bootWindow.__FACET_THEMES__;
    }
  });
});
