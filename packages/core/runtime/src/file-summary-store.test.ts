import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileSummaryStore } from "./file-summary-store.js";
import { FileStageStore } from "./file-stage-store.js";
import { sessionFilePath } from "./session-file.js";
import type { StoredSummary } from "./summary-store.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "facet-summary-"));
}

function summary(coveredThrough: number, generation: number, payload: unknown = {}): StoredSummary {
  return { payload, coveredThrough, generation };
}

describe("FileSummaryStore", () => {
  it("returns undefined for an absent key", async () => {
    const store = new FileSummaryStore(tempDir());
    expect(await store.get("agent", "visitor")).toBeUndefined();
  });

  it("round-trips an opaque payload untouched (deep-equal)", async () => {
    const store = new FileSummaryStore(tempDir());
    const payload = { turns: [{ role: "user", text: "hi" }], notes: { nested: [1, 2, 3] } };
    expect(await store.put("agent", "visitor", summary(3, 0, payload))).toBe(true);
    const got = await store.get("agent", "visitor");
    expect(got).toEqual({ payload, coveredThrough: 3, generation: 0 });
  });

  it("isolates records by (agentId, visitorId)", async () => {
    const store = new FileSummaryStore(tempDir());
    await store.put("a1", "v1", summary(1, 0, "a1v1"));
    await store.put("a1", "v2", summary(2, 0, "a1v2"));
    await store.put("a2", "v1", summary(3, 0, "a2v1"));

    expect((await store.get("a1", "v1"))?.payload).toBe("a1v1");
    expect((await store.get("a1", "v2"))?.payload).toBe("a1v2");
    expect((await store.get("a2", "v1"))?.payload).toBe("a2v1");
    expect(await store.get("a2", "v2")).toBeUndefined();
  });

  it("replaces when coveredThrough is strictly higher (put returns true)", async () => {
    const store = new FileSummaryStore(tempDir());
    expect(await store.put("agent", "visitor", summary(2, 0, "old"))).toBe(true);
    expect(await store.put("agent", "visitor", summary(5, 1, "new"))).toBe(true);
    expect(await store.get("agent", "visitor")).toEqual({
      payload: "new",
      coveredThrough: 5,
      generation: 1,
    });
  });

  it("ignores a lower coveredThrough (put returns false, previous record kept)", async () => {
    const store = new FileSummaryStore(tempDir());
    await store.put("agent", "visitor", summary(5, 1, "kept"));
    expect(await store.put("agent", "visitor", summary(4, 2, "stale"))).toBe(false);
    expect(await store.get("agent", "visitor")).toEqual({
      payload: "kept",
      coveredThrough: 5,
      generation: 1,
    });
  });

  it("ignores an equal coveredThrough (put returns false, previous record kept)", async () => {
    const store = new FileSummaryStore(tempDir());
    await store.put("agent", "visitor", summary(5, 1, "kept"));
    expect(await store.put("agent", "visitor", summary(5, 9, "stale"))).toBe(false);
    expect(await store.get("agent", "visitor")).toEqual({
      payload: "kept",
      coveredThrough: 5,
      generation: 1,
    });
  });

  it("accepts the first record at coveredThrough 0", async () => {
    const store = new FileSummaryStore(tempDir());
    expect(await store.put("agent", "visitor", summary(0, 0, "first"))).toBe(true);
    expect((await store.get("agent", "visitor"))?.coveredThrough).toBe(0);
  });

  it("ignores invalid coveredThrough values", async () => {
    const store = new FileSummaryStore(tempDir());
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(await store.put("agent", "visitor", summary(bad, 0))).toBe(false);
    }
    expect(await store.get("agent", "visitor")).toBeUndefined();
  });

  it("ignores invalid generation values", async () => {
    const store = new FileSummaryStore(tempDir());
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(await store.put("agent", "visitor", summary(3, bad))).toBe(false);
    }
    expect(await store.get("agent", "visitor")).toBeUndefined();
  });

  it("delete removes the record and resets the monotonic guard", async () => {
    const store = new FileSummaryStore(tempDir());
    await store.put("agent", "visitor", summary(5, 3, "old"));
    await store.delete("agent", "visitor");
    expect(await store.get("agent", "visitor")).toBeUndefined();
    // With the on-disk record gone, a fresh LOWER coveredThrough put succeeds.
    expect(await store.put("agent", "visitor", summary(1, 1, "rebuilt"))).toBe(true);
    expect(await store.get("agent", "visitor")).toEqual({
      payload: "rebuilt",
      coveredThrough: 1,
      generation: 1,
    });
  });

  it("delete never throws for an absent record", async () => {
    const store = new FileSummaryStore(tempDir());
    await expect(store.delete("agent", "visitor")).resolves.toBeUndefined();
  });

  it("normalizes an undefined payload to null so the record round-trips (guard intact)", async () => {
    const store = new FileSummaryStore(tempDir());
    expect(
      await store.put("agent", "visitor", { payload: undefined, coveredThrough: 1, generation: 1 }),
    ).toBe(true);
    // Without normalization JSON.stringify would drop the payload key and the
    // read shape-guard would reject the file as absent.
    expect(await store.get("agent", "visitor")).toEqual({
      payload: null,
      coveredThrough: 1,
      generation: 1,
    });
    expect(
      await store.put("agent", "visitor", { payload: undefined, coveredThrough: 1, generation: 2 }),
    ).toBe(false);
  });
});

describe("FileSummaryStore durability", () => {
  it("a second instance over the same dir sees the first instance's record", async () => {
    const dir = tempDir();
    const payload = { deep: { list: [1, { two: 2 }] } };
    expect(await new FileSummaryStore(dir).put("agent", "v", summary(4, 2, payload))).toBe(true);
    expect(await new FileSummaryStore(dir).get("agent", "v")).toEqual({
      payload,
      coveredThrough: 4,
      generation: 2,
    });
  });

  it("enforces monotonicity against a record persisted by a prior instance", async () => {
    const dir = tempDir();
    await new FileSummaryStore(dir).put("agent", "v", summary(5, 1, "kept"));
    // A fresh instance must read the on-disk record before deciding.
    expect(await new FileSummaryStore(dir).put("agent", "v", summary(5, 9, "stale"))).toBe(false);
    expect(await new FileSummaryStore(dir).put("agent", "v", summary(6, 2, "newer"))).toBe(true);
    expect((await new FileSummaryStore(dir).get("agent", "v"))?.payload).toBe("newer");
  });
});

describe("FileSummaryStore resilient read", () => {
  it("treats an unparseable file as absent (get returns undefined, never throws)", async () => {
    const dir = tempDir();
    writeFileSync(sessionFilePath(dir, "a", "v", "summary.json"), "{ not json");
    const store = new FileSummaryStore(dir);
    expect(await store.get("a", "v")).toBeUndefined();
  });

  it("treats a wrong-shape file as absent", async () => {
    const dir = tempDir();
    // Valid JSON, but missing the fields the guard requires.
    writeFileSync(
      sessionFilePath(dir, "a", "v", "summary.json"),
      JSON.stringify({ hello: "world" }),
    );
    const store = new FileSummaryStore(dir);
    expect(await store.get("a", "v")).toBeUndefined();
  });

  it("treats a file with non-integer coveredThrough/generation as absent", async () => {
    const dir = tempDir();
    writeFileSync(
      sessionFilePath(dir, "a", "v", "summary.json"),
      JSON.stringify({ payload: "x", coveredThrough: 1.5, generation: 0 }),
    );
    expect(await new FileSummaryStore(dir).get("a", "v")).toBeUndefined();
  });

  it("a corrupt on-disk record does not block a fresh put (treated as absent)", async () => {
    const dir = tempDir();
    writeFileSync(sessionFilePath(dir, "a", "v", "summary.json"), "not json at all");
    const store = new FileSummaryStore(dir);
    expect(await store.put("a", "v", summary(0, 0, "fresh"))).toBe(true);
    expect((await store.get("a", "v"))?.payload).toBe("fresh");
  });
});

describe("FileSummaryStore shared state directory", () => {
  it("coexists with FileStageStore in the same directory without clobbering", async () => {
    const dir = tempDir();
    const stages = new FileStageStore(dir);
    const summaries = new FileSummaryStore(dir);
    const session = {
      agentId: "a",
      visitor: { visitorId: "v" },
      stage: { root: "root", nodes: { root: { id: "root", type: "box" as const, children: [] } } },
    };
    await stages.save(session);
    expect(await summaries.put("a", "v", summary(3, 1, { note: "mem" }))).toBe(true);

    // Neither record shadowed or corrupted the other.
    expect((await stages.get("a", "v"))?.stage.root).toBe("root");
    expect((await summaries.get("a", "v"))?.coveredThrough).toBe(3);

    // A fresh summary write does not touch the persisted stage either.
    expect(await summaries.put("a", "v", summary(4, 2, { note: "mem2" }))).toBe(true);
    expect((await new FileStageStore(dir).get("a", "v"))?.stage.root).toBe("root");
  });
});
