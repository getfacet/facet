import { describe, expect, it } from "vitest";
import { MAX_VIEW_TOGGLED_KEYS, sanitizeView, SCHEMES, VIEWPORTS } from "./view.js";
import type { ViewSnapshot } from "./view.js";
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
