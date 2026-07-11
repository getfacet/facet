import { describe, expect, it } from "vitest";
import { MemorySummaryStore, type StoredSummary } from "./summary-store.js";

function summary(coveredThrough: number, generation: number, payload: unknown = {}): StoredSummary {
  return { payload, coveredThrough, generation };
}

describe("MemorySummaryStore", () => {
  it("returns undefined for an absent key", async () => {
    const store = new MemorySummaryStore();
    expect(await store.get("agent", "visitor")).toBeUndefined();
  });

  it("round-trips an opaque payload untouched (deep-equal)", async () => {
    const store = new MemorySummaryStore();
    const payload = { turns: [{ role: "user", text: "hi" }], notes: { nested: [1, 2, 3] } };
    await store.put("agent", "visitor", summary(3, 0, payload));
    const got = await store.get("agent", "visitor");
    expect(got).toEqual({ payload, coveredThrough: 3, generation: 0 });
    // Payload is opaque: the same reference comes back, never re-shaped.
    expect(got?.payload).toBe(payload);
  });

  it("isolates records by (agentId, visitorId)", async () => {
    const store = new MemorySummaryStore();
    await store.put("a1", "v1", summary(1, 0, "a1v1"));
    await store.put("a1", "v2", summary(2, 0, "a1v2"));
    await store.put("a2", "v1", summary(3, 0, "a2v1"));

    expect((await store.get("a1", "v1"))?.payload).toBe("a1v1");
    expect((await store.get("a1", "v2"))?.payload).toBe("a1v2");
    expect((await store.get("a2", "v1"))?.payload).toBe("a2v1");
    expect(await store.get("a2", "v2")).toBeUndefined();
  });

  it("replaces when coveredThrough is strictly higher (put returns true)", async () => {
    const store = new MemorySummaryStore();
    expect(await store.put("agent", "visitor", summary(2, 0, "old"))).toBe(true);
    expect(await store.put("agent", "visitor", summary(5, 1, "new"))).toBe(true);
    expect(await store.get("agent", "visitor")).toEqual({
      payload: "new",
      coveredThrough: 5,
      generation: 1,
    });
  });

  it("ignores a lower coveredThrough (put returns false, previous record kept)", async () => {
    const store = new MemorySummaryStore();
    await store.put("agent", "visitor", summary(5, 1, "kept"));
    expect(await store.put("agent", "visitor", summary(4, 2, "stale"))).toBe(false);
    expect(await store.get("agent", "visitor")).toEqual({
      payload: "kept",
      coveredThrough: 5,
      generation: 1,
    });
  });

  it("ignores an equal coveredThrough (put returns false, previous record kept)", async () => {
    const store = new MemorySummaryStore();
    await store.put("agent", "visitor", summary(5, 1, "kept"));
    expect(await store.put("agent", "visitor", summary(5, 9, "stale"))).toBe(false);
    expect(await store.get("agent", "visitor")).toEqual({
      payload: "kept",
      coveredThrough: 5,
      generation: 1,
    });
  });

  it("accepts the first record at coveredThrough 0", async () => {
    const store = new MemorySummaryStore();
    expect(await store.put("agent", "visitor", summary(0, 0, "first"))).toBe(true);
    expect((await store.get("agent", "visitor"))?.coveredThrough).toBe(0);
  });

  it("ignores invalid coveredThrough values", async () => {
    const store = new MemorySummaryStore();
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(await store.put("agent", "visitor", summary(bad, 0))).toBe(false);
    }
    expect(await store.get("agent", "visitor")).toBeUndefined();
  });

  it("ignores invalid generation values", async () => {
    const store = new MemorySummaryStore();
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(await store.put("agent", "visitor", summary(3, bad))).toBe(false);
    }
    expect(await store.get("agent", "visitor")).toBeUndefined();
  });

  it("delete removes the record and resets the monotonic guard", async () => {
    const store = new MemorySummaryStore();
    await store.put("agent", "visitor", summary(5, 3, "old"));
    await store.delete("agent", "visitor");
    expect(await store.get("agent", "visitor")).toBeUndefined();
    // With the guard reset, a fresh LOWER coveredThrough put now succeeds.
    expect(await store.put("agent", "visitor", summary(1, 1, "rebuilt"))).toBe(true);
    expect(await store.get("agent", "visitor")).toEqual({
      payload: "rebuilt",
      coveredThrough: 1,
      generation: 1,
    });
  });

  it("delete is a no-op for an absent key", async () => {
    const store = new MemorySummaryStore();
    await expect(store.delete("agent", "visitor")).resolves.toBeUndefined();
  });

  it("normalizes an undefined payload to null (guard stays intact)", async () => {
    const store = new MemorySummaryStore();
    expect(
      await store.put("agent", "visitor", { payload: undefined, coveredThrough: 1, generation: 1 }),
    ).toBe(true);
    expect(await store.get("agent", "visitor")).toEqual({
      payload: null,
      coveredThrough: 1,
      generation: 1,
    });
    // Normalization is pure serialization — the monotonic guard is untouched, so
    // an equal coveredThrough is still rejected.
    expect(
      await store.put("agent", "visitor", { payload: undefined, coveredThrough: 1, generation: 2 }),
    ).toBe(false);
  });
});
