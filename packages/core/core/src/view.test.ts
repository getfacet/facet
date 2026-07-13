import { describe, expect, it } from "vitest";
import {
  evaluateViewPredicate,
  MAX_VIEW_SORT_KEYS,
  MAX_VIEW_TOGGLED_KEYS,
  sanitizeView,
  sanitizeViewPredicate,
  SCHEMES,
  SORT_DIRECTIONS,
  VIEWPORTS,
} from "./view.js";
import type { ViewPredicate, ViewSnapshot } from "./view.js";
import { MAX_FIELD_VALUE_CHARS } from "./protocol.js";

describe("sanitizeView", () => {
  it("exports the closed enums and the toggled-entry cap", () => {
    expect(VIEWPORTS).toEqual(["narrow", "medium", "wide"]);
    expect(SCHEMES).toEqual(["light", "dark"]);
    expect(MAX_VIEW_TOGGLED_KEYS).toBe(256);
  });

  it("passes a valid full snapshot through unchanged", () => {
    const snapshot: ViewSnapshot = {
      screen: "pricing",
      toggled: { faq: "shown", promo: "hidden" },
      viewport: "narrow",
      scheme: "dark",
    };
    expect(sanitizeView(snapshot)).toEqual(snapshot);
  });

  it("returns undefined for junk input", () => {
    expect(sanitizeView(null)).toBeUndefined();
    expect(sanitizeView(undefined)).toBeUndefined();
    expect(sanitizeView(42)).toBeUndefined();
    expect(sanitizeView([])).toBeUndefined();
    expect(sanitizeView("x")).toBeUndefined();
    expect(sanitizeView(true)).toBeUndefined();
  });

  it("drops unknown viewport/scheme enum values but keeps the rest", () => {
    expect(sanitizeView({ screen: "home", viewport: "ultrawide", scheme: "sepia" })).toEqual({
      screen: "home",
    });
    expect(sanitizeView({ screen: "home", viewport: 3, scheme: null })).toEqual({
      screen: "home",
    });
  });

  it("drops an over-cap or non-string screen, keeps one exactly at the cap", () => {
    const overCap = "s".repeat(MAX_FIELD_VALUE_CHARS + 1);
    expect(sanitizeView({ screen: overCap, scheme: "light" })).toEqual({ scheme: "light" });
    expect(sanitizeView({ screen: 7, scheme: "light" })).toEqual({ scheme: "light" });
    const atCap = "s".repeat(MAX_FIELD_VALUE_CHARS);
    expect(sanitizeView({ screen: atCap })).toEqual({ screen: atCap });
  });

  it("clamps over-cap toggled to the LAST entries in insertion order (drop-oldest)", () => {
    const toggled: Record<string, unknown> = {};
    for (let i = 0; i < MAX_VIEW_TOGGLED_KEYS + 10; i += 1) {
      toggled[`node-${i}`] = "shown";
    }
    const cleaned = sanitizeView({ toggled });
    const keys = Object.keys(cleaned?.toggled ?? {});
    expect(keys).toHaveLength(MAX_VIEW_TOGGLED_KEYS);
    // the 10 oldest (first-inserted) entries are dropped; the newest survive.
    expect(keys[0]).toBe("node-10");
    expect(keys.at(-1)).toBe(`node-${MAX_VIEW_TOGGLED_KEYS + 9}`);
  });

  it("drops toggled junk values, over-cap keys, and a non-record toggled", () => {
    expect(
      sanitizeView({
        toggled: {
          ok: "shown",
          alsoOk: "hidden",
          num: 1,
          bool: true,
          word: "visible",
          nested: { deep: "shown" },
          ["k".repeat(MAX_FIELD_VALUE_CHARS + 1)]: "shown",
        },
      }),
    ).toEqual({ toggled: { ok: "shown", alsoOk: "hidden" } });
    expect(sanitizeView({ screen: "s", toggled: ["shown"] })).toEqual({ screen: "s" });
    expect(sanitizeView({ screen: "s", toggled: "shown" })).toEqual({ screen: "s" });
  });

  it("never recurses or throws on nested/cyclic input; yields a cleaned flat snapshot", () => {
    const cyclic: Record<string, unknown> = { screen: "home" };
    cyclic["self"] = cyclic;
    cyclic["toggled"] = { good: "shown", bad: cyclic };
    expect(() => sanitizeView(cyclic)).not.toThrow();
    expect(sanitizeView(cyclic)).toEqual({ screen: "home", toggled: { good: "shown" } });
  });

  it("returns undefined when nothing valid remains", () => {
    expect(sanitizeView({})).toBeUndefined();
    expect(sanitizeView({ unrelated: true })).toBeUndefined();
    expect(sanitizeView({ screen: 42, viewport: "huge", scheme: "sepia" })).toBeUndefined();
    expect(sanitizeView({ toggled: {} })).toBeUndefined();
    expect(sanitizeView({ toggled: { a: "nope" } })).toBeUndefined();
  });
});

describe("sanitizeView sort", () => {
  it("exports the closed sort-direction enum and the sort-entry cap", () => {
    expect(SORT_DIRECTIONS).toEqual(["asc", "desc"]);
    expect(MAX_VIEW_SORT_KEYS).toBe(256);
  });

  it("keeps a valid sort map keyed by table node id", () => {
    const snapshot: ViewSnapshot = {
      screen: "orders",
      sort: {
        "table-a": { column: "created", direction: "desc" },
        "table-b": { column: "name", direction: "asc" },
      },
    };
    expect(sanitizeView(snapshot)).toEqual(snapshot);
  });

  it("keeps only entries at exactly the key/column length cap", () => {
    const key = "k".repeat(MAX_FIELD_VALUE_CHARS);
    const column = "c".repeat(MAX_FIELD_VALUE_CHARS);
    expect(sanitizeView({ sort: { [key]: { column, direction: "asc" } } })).toEqual({
      sort: { [key]: { column, direction: "asc" } },
    });
  });

  it("drops entries with an over-cap key, a bad column, or a bad direction", () => {
    const overCapKey = "k".repeat(MAX_FIELD_VALUE_CHARS + 1);
    const overCapColumn = "c".repeat(MAX_FIELD_VALUE_CHARS + 1);
    expect(
      sanitizeView({
        sort: {
          ok: { column: "name", direction: "asc" },
          [overCapKey]: { column: "name", direction: "asc" },
          badColumnType: { column: 7, direction: "asc" },
          overCapColumn: { column: overCapColumn, direction: "asc" },
          badDirection: { column: "name", direction: "sideways" },
          missingDirection: { column: "name" },
          missingColumn: { direction: "asc" },
        },
      }),
    ).toEqual({ sort: { ok: { column: "name", direction: "asc" } } });
  });

  it("drops non-plain-object entry values (null, nested, array, scalar) and a non-record sort", () => {
    expect(
      sanitizeView({
        sort: {
          ok: { column: "name", direction: "desc" },
          nullValue: null,
          scalar: "asc",
          arr: ["name", "asc"],
          nested: { column: { deep: "name" }, direction: "asc" },
        },
      }),
    ).toEqual({ sort: { ok: { column: "name", direction: "desc" } } });
    expect(sanitizeView({ screen: "s", sort: ["asc"] })).toEqual({ screen: "s" });
    expect(sanitizeView({ screen: "s", sort: "asc" })).toEqual({ screen: "s" });
  });

  it("clamps over-cap sort to the LAST entries in insertion order (drop-oldest)", () => {
    const sort: Record<string, unknown> = {};
    for (let i = 0; i < MAX_VIEW_SORT_KEYS + 10; i += 1) {
      sort[`table-${i}`] = { column: "name", direction: "asc" };
    }
    const cleaned = sanitizeView({ sort });
    const keys = Object.keys(cleaned?.sort ?? {});
    expect(keys).toHaveLength(MAX_VIEW_SORT_KEYS);
    expect(keys[0]).toBe("table-10");
    expect(keys.at(-1)).toBe(`table-${MAX_VIEW_SORT_KEYS + 9}`);
  });

  it("never recurses or throws on a hostile/cyclic sort payload", () => {
    const cyclic: Record<string, unknown> = { screen: "home" };
    const entry: Record<string, unknown> = { column: "name", direction: "asc" };
    entry["self"] = entry;
    cyclic["sort"] = { good: entry, bad: cyclic };
    expect(() => sanitizeView(cyclic)).not.toThrow();
    expect(sanitizeView(cyclic)).toEqual({
      screen: "home",
      sort: { good: { column: "name", direction: "asc" } },
    });
  });

  it("omits sort entirely when nothing valid remains", () => {
    expect(sanitizeView({ sort: {} })).toBeUndefined();
    expect(sanitizeView({ sort: { a: { column: "name", direction: "nope" } } })).toBeUndefined();
    expect(sanitizeView({ screen: "s", sort: { a: null } })).toEqual({ screen: "s" });
  });
});

describe("view predicate", () => {
  const emptyOverrides: ReadonlyMap<string, boolean> = new Map();

  describe("sanitizeViewPredicate", () => {
    it("keeps a valid {screen} predicate", () => {
      expect(sanitizeViewPredicate({ screen: "pricing" })).toEqual({ screen: "pricing" });
    });

    it("keeps a valid {toggled} predicate (plain string, not a NodeId type)", () => {
      expect(sanitizeViewPredicate({ toggled: "faq" })).toEqual({ toggled: "faq" });
    });

    it("drops an unknown/malformed shape (returns undefined), never throws", () => {
      expect(sanitizeViewPredicate(undefined)).toBeUndefined();
      expect(sanitizeViewPredicate(null)).toBeUndefined();
      expect(sanitizeViewPredicate(42)).toBeUndefined();
      expect(sanitizeViewPredicate("screen")).toBeUndefined();
      expect(sanitizeViewPredicate([])).toBeUndefined();
      // unknown kind: neither `screen` nor `toggled`
      expect(sanitizeViewPredicate({ mystery: "x" })).toBeUndefined();
      expect(sanitizeViewPredicate({})).toBeUndefined();
      // present but non-string discriminant
      expect(sanitizeViewPredicate({ screen: 5 })).toBeUndefined();
      expect(sanitizeViewPredicate({ toggled: 3 })).toBeUndefined();
      // over-cap string discriminant is dropped
      const overCap = "s".repeat(MAX_FIELD_VALUE_CHARS + 1);
      expect(sanitizeViewPredicate({ screen: overCap })).toBeUndefined();
      expect(sanitizeViewPredicate({ toggled: overCap })).toBeUndefined();
    });

    it("never recurses or throws on a cyclic payload", () => {
      const cyclic: Record<string, unknown> = { screen: "home" };
      cyclic["self"] = cyclic;
      expect(() => sanitizeViewPredicate(cyclic)).not.toThrow();
      expect(sanitizeViewPredicate(cyclic)).toEqual({ screen: "home" });
    });
  });

  describe("evaluateViewPredicate", () => {
    it("{screen} is active only when activeScreen === screen", () => {
      expect(
        evaluateViewPredicate(
          { screen: "home" },
          { activeScreen: "home", visibilityOverrides: emptyOverrides },
        ),
      ).toBe(true);
      expect(
        evaluateViewPredicate(
          { screen: "home" },
          { activeScreen: "pricing", visibilityOverrides: emptyOverrides },
        ),
      ).toBe(false);
    });

    it("{screen} is false when activeScreen is null", () => {
      expect(
        evaluateViewPredicate(
          { screen: "home" },
          { activeScreen: null, visibilityOverrides: emptyOverrides },
        ),
      ).toBe(false);
    });

    it("{toggled} is active only when the RAW override is exactly true", () => {
      expect(
        evaluateViewPredicate(
          { toggled: "faq" },
          { activeScreen: null, visibilityOverrides: new Map([["faq", true]]) },
        ),
      ).toBe(true);
      // toggled=false → not active
      expect(
        evaluateViewPredicate(
          { toggled: "faq" },
          { activeScreen: null, visibilityOverrides: new Map([["faq", false]]) },
        ),
      ).toBe(false);
      // never toggled (undefined override) → not active (raw map, NOT effective visibility)
      expect(
        evaluateViewPredicate(
          { toggled: "faq" },
          { activeScreen: null, visibilityOverrides: emptyOverrides },
        ),
      ).toBe(false);
    });

    it("returns false for an undefined predicate and an unknown kind, never throws", () => {
      expect(
        evaluateViewPredicate(undefined, {
          activeScreen: "home",
          visibilityOverrides: emptyOverrides,
        }),
      ).toBe(false);
      const unknownKind = { mystery: "x" } as unknown as ViewPredicate;
      expect(
        evaluateViewPredicate(unknownKind, {
          activeScreen: "home",
          visibilityOverrides: emptyOverrides,
        }),
      ).toBe(false);
    });
  });
});
