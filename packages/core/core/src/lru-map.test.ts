import { describe, expect, it, vi } from "vitest";

import { createLruMap } from "./lru-map.js";

describe("createLruMap", () => {
  it("stores and returns values", () => {
    const lru = createLruMap<number>(3);
    lru.set("a", 1);
    expect(lru.get("a")).toBe(1);
    expect(lru.get("missing")).toBeUndefined();
    expect(lru.size).toBe(1);
  });

  it("evicts the oldest entry once past the cap", () => {
    const lru = createLruMap<number>(2);
    lru.set("a", 1);
    lru.set("b", 2);
    lru.set("c", 3); // evicts "a"
    expect(lru.get("a")).toBeUndefined();
    expect(lru.get("b")).toBe(2);
    expect(lru.get("c")).toBe(3);
    expect(lru.size).toBe(2);
  });

  it("a get hit refreshes recency so a different key is evicted next", () => {
    const lru = createLruMap<number>(2);
    lru.set("a", 1);
    lru.set("b", 2);
    lru.get("a"); // touch "a" — "b" is now oldest
    lru.set("c", 3); // evicts "b", not "a"
    expect(lru.get("a")).toBe(1);
    expect(lru.get("b")).toBeUndefined();
    expect(lru.get("c")).toBe(3);
  });

  it("set on an existing key refreshes recency", () => {
    const lru = createLruMap<number>(2);
    lru.set("a", 1);
    lru.set("b", 2);
    lru.set("a", 10); // touch + replace — "b" is now oldest
    lru.set("c", 3); // evicts "b"
    expect(lru.get("a")).toBe(10);
    expect(lru.get("b")).toBeUndefined();
    expect(lru.get("c")).toBe(3);
  });

  it("getOrCreate mints once and reuses thereafter", () => {
    const lru = createLruMap<{ n: number }>(3);
    const make = vi.fn(() => ({ n: 7 }));
    const first = lru.getOrCreate("a", make);
    const second = lru.getOrCreate("a", make);
    expect(make).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("getOrCreate touches an existing entry (refreshes recency)", () => {
    const lru = createLruMap<number>(2);
    lru.set("a", 1);
    lru.set("b", 2);
    lru.getOrCreate("a", () => 99); // touch "a" (not created) — "b" oldest
    lru.set("c", 3); // evicts "b"
    expect(lru.get("a")).toBe(1);
    expect(lru.get("b")).toBeUndefined();
  });

  it("getOrCreate evicts the oldest when minting past the cap", () => {
    const lru = createLruMap<number>(2);
    lru.set("a", 1);
    lru.set("b", 2);
    lru.getOrCreate("c", () => 3); // creates "c", evicts "a"
    expect(lru.get("a")).toBeUndefined();
    expect(lru.get("b")).toBe(2);
    expect(lru.get("c")).toBe(3);
  });

  it("delete removes a key and reports prior presence", () => {
    const lru = createLruMap<number>(2);
    lru.set("a", 1);
    expect(lru.delete("a")).toBe(true);
    expect(lru.delete("a")).toBe(false);
    expect(lru.get("a")).toBeUndefined();
    expect(lru.size).toBe(0);
  });

  it("throws on a non-integer or sub-1 cap", () => {
    expect(() => createLruMap(0)).toThrow(RangeError);
    expect(() => createLruMap(-1)).toThrow(RangeError);
    expect(() => createLruMap(1.5)).toThrow(RangeError);
    expect(() => createLruMap(Number.NaN)).toThrow(RangeError);
    expect(() => createLruMap(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => createLruMap(1)).not.toThrow();
  });
});
