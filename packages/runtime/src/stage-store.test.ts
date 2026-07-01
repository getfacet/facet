import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FacetTree } from "@facet/core";
import { MemoryStageStore, type StageStore } from "./stage-store.js";
import { FileStageStore } from "./file-stage-store.js";

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
});
