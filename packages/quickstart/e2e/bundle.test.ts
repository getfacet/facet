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
});
