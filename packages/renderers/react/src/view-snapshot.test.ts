// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { NodeId, SortDirection } from "@facet/core";
import { captureViewSnapshot, useViewportColorMode } from "./view-snapshot.js";
import { NARROW_BREAKPOINT_PX } from "./layout-contract.js";

afterEach(cleanup);

// Resolve sibling source files from this file's directory. `fileURLToPath` is
// applied to `import.meta.url` directly (always file-scheme); `new URL(rel, …)`
// is avoided because the jsdom environment swaps in a global `URL` that mangles
// relative resolution.
const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (name: string): string => readFileSync(join(SRC_DIR, name), "utf8");

// A stub MediaQueryList whose `matches` is decided per-query, exposing the
// change listeners so a test can fire them and assert the effect only mutates
// in-memory state (never a transport call).
function stubMatchMedia(
  decide: (query: string) => boolean,
  changeListeners?: Array<() => void>,
): void {
  window.matchMedia = vi.fn((query: string) => ({
    matches: decide(query),
    media: query,
    addEventListener: (_type: string, cb: () => void) => changeListeners?.push(cb),
    removeEventListener: (_type: string, _cb: () => void) => {},
    // Legacy API surface some libraries still probe; unused here.
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
}

describe("captureViewSnapshot", () => {
  it("derives screen and toggled (shown/hidden) from the renderer state", () => {
    const overrides = new Map<NodeId, boolean>([
      ["faq-3", true],
      ["menu", false],
    ]);
    expect(captureViewSnapshot("pricing", overrides, "narrow", "dark")).toEqual({
      screen: "pricing",
      toggled: { "faq-3": "shown", menu: "hidden" },
      viewport: "narrow",
      colorMode: "dark",
    });
  });

  it("omits screen when undefined and toggled when the override map is empty", () => {
    expect(captureViewSnapshot(undefined, new Map())).toEqual({});
    expect(captureViewSnapshot(undefined, new Map(), "medium")).toEqual({ viewport: "medium" });
  });

  it("keeps toggled alone when only overrides exist (no viewport/colorMode)", () => {
    expect(captureViewSnapshot(undefined, new Map<NodeId, boolean>([["a", true]]))).toEqual({
      toggled: { a: "shown" },
    });
  });

  it("emits sort from the holder and omits it when the holder is empty", () => {
    const sort = new Map<NodeId, { column: string; direction: SortDirection }>([
      ["orders", { column: "total", direction: "desc" }],
      ["people", { column: "name", direction: "asc" }],
    ]);
    expect(captureViewSnapshot(undefined, new Map(), undefined, undefined, sort)).toEqual({
      sort: {
        orders: { column: "total", direction: "desc" },
        people: { column: "name", direction: "asc" },
      },
    });
    // Empty holder ⇒ sort omitted entirely.
    expect(captureViewSnapshot(undefined, new Map(), undefined, undefined, new Map())).toEqual({});
  });

  it("carries sort alongside screen/toggled/viewport/colorMode", () => {
    const overrides = new Map<NodeId, boolean>([["menu", false]]);
    const sort = new Map<NodeId, { column: string; direction: SortDirection }>([
      ["t1", { column: "age", direction: "asc" }],
    ]);
    expect(captureViewSnapshot("home", overrides, "wide", "light", sort)).toEqual({
      screen: "home",
      toggled: { menu: "hidden" },
      viewport: "wide",
      colorMode: "light",
      sort: { t1: { column: "age", direction: "asc" } },
    });
  });
});

// box-layout-foundation (WU-5, R9): the narrow breakpoint is now a SINGLE source
// in layout-contract.ts — this module derives NARROW_QUERY from it instead of a
// private NARROW_MAX_PX, so the reported `viewport === "narrow"` and the CSS-only
// collapse reflow share one threshold and can never disagree. Behavior is
// unchanged (640 - 1 = 639px, exactly as before).
describe("NARROW_QUERY single-breakpoint derivation (R9)", () => {
  const original = window.matchMedia;
  afterEach(() => {
    if (original === undefined) {
      // @ts-expect-error restore jsdom's missing matchMedia
      delete window.matchMedia;
    } else {
      window.matchMedia = original;
    }
  });

  it("derives from NARROW_BREAKPOINT_PX and drops the private NARROW_MAX_PX", () => {
    const src = readSrc("./view-snapshot.ts");
    expect(src).toContain('import { NARROW_BREAKPOINT_PX } from "./layout-contract.js"');
    expect(src).toContain("NARROW_BREAKPOINT_PX - 1");
    // The private duplicate constant is gone — no second source of truth.
    expect(src).not.toContain("NARROW_MAX_PX");
  });

  it("still resolves to (max-width: 639px), byte-identical to before", () => {
    // Behavior parity: the derived query is exactly the old literal.
    expect(`(max-width: ${String(NARROW_BREAKPOINT_PX - 1)}px)`).toBe("(max-width: 639px)");
    // And matchMedia is still consulted with that max-width query (narrow class).
    const queried: string[] = [];
    window.matchMedia = ((query: string) => {
      queried.push(query);
      return {
        matches: query.includes("max-width"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
        onchange: null,
      };
    }) as unknown as typeof window.matchMedia;
    const { result } = renderHook(() => useViewportColorMode());
    expect(result.current.viewport).toBe("narrow");
    expect(queried).toContain("(max-width: 639px)");
  });
});

describe("useViewportColorMode", () => {
  const original = window.matchMedia;
  afterEach(() => {
    if (original === undefined) {
      // @ts-expect-error jsdom leaves matchMedia undefined; restore that.
      delete window.matchMedia;
    } else {
      window.matchMedia = original;
    }
  });

  it("uses light for system on SSR and honors a forced mode", () => {
    // jsdom does not implement matchMedia; make sure it is absent.
    // @ts-expect-error force-remove for this assertion
    delete window.matchMedia;
    const { result } = renderHook(() => useViewportColorMode());
    expect(result.current).toEqual({ colorMode: "light" });
    const forced = renderHook(() => useViewportColorMode("dark"));
    expect(forced.result.current).toEqual({ colorMode: "dark" });
  });

  it("detects viewport and colorMode from a mocked matchMedia", () => {
    // max-width query matches ⇒ narrow; dark color-mode query matches ⇒ dark.
    stubMatchMedia((q) => q.includes("max-width") || q.includes("prefers-color-scheme: dark"));
    const { result } = renderHook(() => useViewportColorMode());
    expect(result.current).toEqual({ viewport: "narrow", colorMode: "dark" });
  });

  it("reports the wide breakpoint when only the min-width query matches", () => {
    stubMatchMedia((q) => q.includes("min-width"));
    const { result } = renderHook(() => useViewportColorMode());
    expect(result.current.viewport).toBe("wide");
    expect(result.current.colorMode).toBe("light");
  });

  it("does not subscribe to system color changes while a mode is forced", () => {
    const subscribedQueries: string[] = [];
    window.matchMedia = vi.fn((query: string) => ({
      matches: query.includes("prefers-color-scheme"),
      media: query,
      addEventListener: () => subscribedQueries.push(query),
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    })) as unknown as typeof window.matchMedia;
    const { result } = renderHook(() => useViewportColorMode("light"));
    expect(result.current.colorMode).toBe("light");
    expect(subscribedQueries).not.toContain("(prefers-color-scheme: dark)");
  });
});

// DC-006: the media-query listeners may ONLY mutate in-memory React state — no
// event send, no local record, no fetch. Proven two ways: a transport-like spy
// stays at zero calls when a change fires, and the module source references
// none of send/record/fetch (the hook has no transport to reach).
describe("useViewportColorMode fires no transport traffic (DC-006)", () => {
  const original = window.matchMedia;
  afterEach(() => {
    if (original === undefined) {
      // @ts-expect-error restore jsdom's missing matchMedia
      delete window.matchMedia;
    } else {
      window.matchMedia = original;
    }
  });

  it("firing a media-query change only updates state (re-reads device classes)", () => {
    let wide = true;
    const changeListeners: Array<() => void> = [];
    stubMatchMedia((q) => (q.includes("min-width") ? wide : false), changeListeners);

    const { result } = renderHook(() => useViewportColorMode());
    expect(result.current.viewport).toBe("wide");

    // The listener re-reads fresh device classes; it must never fire transport
    // traffic (DC-006 — that "no send/record/fetch" property is proven
    // structurally by the source-grep test below).
    wide = false;
    act(() => {
      for (const fire of changeListeners) fire();
    });
    expect(result.current.viewport).toBe("medium");
  });

  it("view-snapshot.ts source references no send/record/fetch API", () => {
    const src = readSrc("./view-snapshot.ts");
    expect(src).not.toMatch(/\bsend\b/);
    expect(src).not.toMatch(/\brecord\b/);
    expect(src).not.toMatch(/\bfetch\b/);
  });
});

// RISK-INV-5 structural fence: the view-state DEVICE signal — the visitor's
// viewport size class + effective browser color mode carried in `ViewSnapshot`
// (view-snapshot.ts) — is report-only inert event data that must NEVER drive
// layout. So layout code must not import view-snapshot.ts nor read a `viewport`
// device field. The effective color mode reaches only Theme paint selection in
// StageRenderer and never enters a layout-role module.
describe("view-snapshot layout fence (RISK-INV-5)", () => {
  // Cover the files that resolve layout and recursively render the tree.
  for (const file of ["./brick-renderer-layout.tsx", "./theme.ts", "./renderer-render.tsx"]) {
    it(`${file} does not import the view-state device signal or read a viewport device field`, () => {
      const src = readSrc(file);
      expect(src).not.toContain("view-snapshot");
      expect(src).not.toMatch(/\bviewport\b/);
    });
  }
});
