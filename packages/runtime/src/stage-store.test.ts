import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FacetTree } from "@facet/core";
import { FileStageStore, MemoryStageStore, type StageStore } from "./stage-store.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "facet-stage-"));
}

function contract(name: string, make: () => StageStore): void {
  describe(name, () => {
    it("opens a session with an empty stage", () => {
      const store = make();
      const session = store.open("a", { visitorId: "v" });
      expect(session.stage.root).toBe("root");
      expect(store.get("a", "v")).toBeDefined();
    });

    it("saves an updated stage", () => {
      const store = make();
      const session = store.open("a", { visitorId: "v" });
      const stage: FacetTree = {
        root: "root",
        nodes: {
          root: { id: "root", type: "box", children: ["t"] },
          t: { id: "t", type: "text", value: "hi" },
        },
      };
      store.save({ ...session, stage });
      expect(store.get("a", "v")?.stage.nodes["t"]).toMatchObject({ value: "hi" });
    });

    it("isolates by (agent, visitor)", () => {
      const store = make();
      store.open("a", { visitorId: "v1" });
      expect(store.get("a", "v2")).toBeUndefined();
    });
  });
}

contract("MemoryStageStore", () => new MemoryStageStore());
contract("FileStageStore", () => new FileStageStore(tempDir()));

describe("FileStageStore durability", () => {
  it("restores the stage after a fresh instance (simulated restart)", () => {
    const dir = tempDir();
    const first = new FileStageStore(dir);
    const session = first.open("agent", { visitorId: "v" });
    const stage: FacetTree = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["t"] },
        t: { id: "t", type: "text", value: "kept" },
      },
    };
    first.save({ ...session, stage });

    const restarted = new FileStageStore(dir);
    expect(restarted.get("agent", "v")?.stage.nodes["t"]).toMatchObject({ value: "kept" });
  });
});
