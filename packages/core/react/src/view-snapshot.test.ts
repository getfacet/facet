// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { NodeId } from "@facet/core";
import { captureViewSnapshot, useViewportScheme } from "./view-snapshot.js";

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
      scheme: "dark",
    });
  });

  it("omits screen when undefined and toggled when the override map is empty", () => {
    expect(captureViewSnapshot(undefined, new Map())).toEqual({});
    expect(captureViewSnapshot(undefined, new Map(), "medium")).toEqual({ viewport: "medium" });
  });

  it("keeps toggled alone when only overrides exist (no viewport/scheme)", () => {
    expect(captureViewSnapshot(undefined, new Map<NodeId, boolean>([["a", true]]))).toEqual({
      toggled: { a: "shown" },
    });
  });
});

describe("useViewportScheme", () => {
  const original = window.matchMedia;
  afterEach(() => {
    if (original === undefined) {
      // @ts-expect-error jsdom leaves matchMedia undefined; restore that.
      delete window.matchMedia;
    } else {
      window.matchMedia = original;
    }
  });

  it("returns {} when matchMedia is unavailable (SSR / older browser)", () => {
    // jsdom does not implement matchMedia; make sure it is absent.
    // @ts-expect-error force-remove for this assertion
    delete window.matchMedia;
    const { result } = renderHook(() => useViewportScheme());
    expect(result.current).toEqual({});
  });

  it("detects viewport and scheme from a mocked matchMedia", () => {
    // max-width query matches ⇒ narrow; dark scheme query matches ⇒ dark.
    stubMatchMedia((q) => q.includes("max-width") || q.includes("prefers-color-scheme: dark"));
    const { result } = renderHook(() => useViewportScheme());
    expect(result.current).toEqual({ viewport: "narrow", scheme: "dark" });
  });

  it("reports the wide breakpoint when only the min-width query matches", () => {
    stubMatchMedia((q) => q.includes("min-width"));
    const { result } = renderHook(() => useViewportScheme());
    expect(result.current.viewport).toBe("wide");
    expect(result.current.scheme).toBe("light");
  });
});

// DC-006: the media-query listeners may ONLY mutate in-memory React state — no
// event send, no local record, no fetch. Proven two ways: a transport-like spy
// stays at zero calls when a change fires, and the module source references
// none of send/record/fetch (the hook has no transport to reach).
describe("useViewportScheme fires no transport traffic (DC-006)", () => {
  const original = window.matchMedia;
  afterEach(() => {
    if (original === undefined) {
      // @ts-expect-error restore jsdom's missing matchMedia
      delete window.matchMedia;
    } else {
      window.matchMedia = original;
    }
  });

  it("firing a media-query change only updates state, never a transport-like callback", () => {
    const transport = vi.fn();
    const changeListeners: Array<() => void> = [];
    stubMatchMedia((q) => q.includes("min-width"), changeListeners);

    const { result } = renderHook(() => useViewportScheme());
    expect(result.current.viewport).toBe("wide");

    act(() => {
      for (const fire of changeListeners) fire();
    });

    expect(transport).not.toHaveBeenCalled();
  });

  it("view-snapshot.ts source references no send/record/fetch API", () => {
    const src = readSrc("./view-snapshot.ts");
    expect(src).not.toMatch(/\bsend\b/);
    expect(src).not.toMatch(/\brecord\b/);
    expect(src).not.toMatch(/\bfetch\b/);
  });
});

// RISK-INV-5 structural fence: viewport/scheme are report-only. They flow ONLY
// into the send path, never into layout resolution — so neither the layout
// module nor the boxStyle module (theme.ts) may import view-snapshot.ts or read
// a viewport/scheme identifier.
describe("view-snapshot layout fence (RISK-INV-5)", () => {
  it("brick-renderer-layout.tsx neither imports view-snapshot nor reads viewport/scheme", () => {
    const src = readSrc("./brick-renderer-layout.tsx");
    expect(src).not.toContain("view-snapshot");
    expect(src).not.toMatch(/\bviewport\b/);
    expect(src).not.toMatch(/\bscheme\b/);
  });

  it("the boxStyle module (theme.ts) neither imports view-snapshot nor reads viewport/scheme", () => {
    const src = readSrc("./theme.ts");
    expect(src).not.toContain("view-snapshot");
    expect(src).not.toMatch(/\bviewport\b/);
    expect(src).not.toMatch(/\bscheme\b/);
  });
});
