import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FacetTree } from "@facet/core";
import { MemoryStageStore, type StageStore } from "./stage-store.js";
import { FileStageStore } from "./file-stage-store.js";
import { sessionFilePath } from "./session-file.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "facet-stage-"));
}

function contract(name: string, make: () => StageStore): void {
  describe(name, () => {
    it("opens a session with an empty stage", async () => {
      const store = make();
      const session = await store.open("a", { visitorId: "v" });
      expect(session.stage.root).toBe("root");
      expect(await store.get("a", "v")).toBeDefined();
    });

    it("saves an updated stage", async () => {
      const store = make();
      const session = await store.open("a", { visitorId: "v" });
      const stage: FacetTree = {
        root: "root",
        nodes: {
          root: { id: "root", type: "box", children: ["t"] },
          t: { id: "t", type: "text", value: "hi" },
        },
      };
      await store.save({ ...session, stage });
      expect((await store.get("a", "v"))?.stage.nodes["t"]).toMatchObject({ value: "hi" });
    });

    it("isolates by (agent, visitor)", async () => {
      const store = make();
      await store.open("a", { visitorId: "v1" });
      expect(await store.get("a", "v2")).toBeUndefined();
    });
  });
}

contract("MemoryStageStore", () => new MemoryStageStore());
contract("FileStageStore", () => new FileStageStore(tempDir()));

describe("FileStageStore cache bound", () => {
  it("evicts least-recently-used cache entries but still serves them from disk", async () => {
    const store = new FileStageStore(tempDir());
    for (let i = 0; i < 550; i += 1) {
      await store.open("a", { visitorId: `v${i}` });
    }
    const cache = (store as unknown as { cache: Map<string, unknown> }).cache;
    expect(cache.size).toBeLessThanOrEqual(500);
    // v0 was evicted from the cache long ago — the file is still the truth.
    expect(await store.get("a", "v0")).toBeDefined();
  });
});

describe("FileStageStore durability", () => {
  it("restores the stage after a fresh instance (simulated restart)", async () => {
    const dir = tempDir();
    const first = new FileStageStore(dir);
    const session = await first.open("agent", { visitorId: "v" });
    const stage: FacetTree = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["t"] },
        t: { id: "t", type: "text", value: "kept" },
      },
    };
    await first.save({ ...session, stage });

    const restarted = new FileStageStore(dir);
    expect((await restarted.get("agent", "v"))?.stage.nodes["t"]).toMatchObject({ value: "kept" });
  });

  it("leaves no .tmp remnant after save", async () => {
    const dir = tempDir();
    const store = new FileStageStore(dir);
    const session = await store.open("agent", { visitorId: "v" });
    await store.save(session);
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

describe("FileStageStore fail-safe read", () => {
  it("rejects a wrong-shape session file", async () => {
    const dir = tempDir();
    const store = new FileStageStore(dir);
    // Valid JSON, but not a session — must not be handed back as one.
    writeFileSync(sessionFilePath(dir, "a", "v", "json"), JSON.stringify({ foo: 1 }));
    expect(await store.get("a", "v")).toBeUndefined();
  });

  it("rejects a truncated session file", async () => {
    const dir = tempDir();
    const store = new FileStageStore(dir);
    writeFileSync(sessionFilePath(dir, "a", "v", "json"), '{"agentId":"a","visi');
    expect(await store.get("a", "v")).toBeUndefined();
  });

  it("rejects a session whose stage is not a tree", async () => {
    const dir = tempDir();
    const store = new FileStageStore(dir);
    // `{}` and `[]` are non-null objects but have no `.nodes[.root]` — the
    // offline visit path would throw a TypeError on them.
    const base = { agentId: "a", visitor: { visitorId: "v" } };
    writeFileSync(sessionFilePath(dir, "a", "v1", "json"), JSON.stringify({ ...base, stage: {} }));
    writeFileSync(sessionFilePath(dir, "a", "v2", "json"), JSON.stringify({ ...base, stage: [] }));
    expect(await store.get("a", "v1")).toBeUndefined();
    expect(await store.get("a", "v2")).toBeUndefined();
  });

  it("rejects a session whose root node is missing or screens is not an object", async () => {
    const dir = tempDir();
    const store = new FileStageStore(dir);
    const base = { agentId: "a", visitor: { visitorId: "v" } };
    // (a) root/nodes present but `nodes[root]` is null → `"children" in root` throws.
    writeFileSync(
      sessionFilePath(dir, "a", "v1", "json"),
      JSON.stringify({ ...base, stage: { root: "root", nodes: { root: null } } }),
    );
    // (b) `screens: null` passes `!== undefined` → `Object.keys(null)` throws.
    writeFileSync(
      sessionFilePath(dir, "a", "v2", "json"),
      JSON.stringify({ ...base, stage: { root: "r", nodes: { r: {} }, screens: null } }),
    );
    // (c) root node exists but `children: null` → `root.children.length` throws.
    writeFileSync(
      sessionFilePath(dir, "a", "v3", "json"),
      JSON.stringify({ ...base, stage: { root: "r", nodes: { r: { children: null } } } }),
    );
    expect(await store.get("a", "v1")).toBeUndefined();
    expect(await store.get("a", "v2")).toBeUndefined();
    expect(await store.get("a", "v3")).toBeUndefined();
  });

  it("accepts a valid session that has screens", async () => {
    const dir = tempDir();
    const store = new FileStageStore(dir);
    writeFileSync(
      sessionFilePath(dir, "a", "v", "json"),
      JSON.stringify({
        agentId: "a",
        visitor: { visitorId: "v" },
        stage: {
          root: "home",
          nodes: { home: { id: "home", type: "box", children: [] } },
          screens: { home: "home" },
          screen: "home",
        },
      }),
    );
    expect(await store.get("a", "v")).toBeDefined();
  });
});
