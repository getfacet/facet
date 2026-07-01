import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FacetTree } from "@facet/core";
import { MemorySessionStore, type SessionStore } from "./session-store.js";
import { FileSessionStore } from "./file-session-store.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "facet-store-"));
}

function contract(name: string, make: () => SessionStore): void {
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

    it("appends history in order", () => {
      const store = make();
      store.open("a", { visitorId: "v" });
      store.append("a", "v", {
        at: 1,
        event: { kind: "message", text: "hi" },
        messages: [{ kind: "say", text: "yo" }],
      });
      store.append("a", "v", { at: 2, event: { kind: "message", text: "bye" }, messages: [] });
      const history = store.history("a", "v");
      expect(history.map((e) => e.at)).toEqual([1, 2]);
      expect(history[0]?.event).toMatchObject({ text: "hi" });
    });

    it("isolates history by (agent, visitor)", () => {
      const store = make();
      store.append("a", "v1", {
        at: 1,
        event: { kind: "visit", visitor: { visitorId: "v1" } },
        messages: [],
      });
      expect(store.history("a", "v1")).toHaveLength(1);
      expect(store.history("a", "v2")).toHaveLength(0);
    });
  });
}

contract("MemorySessionStore", () => new MemorySessionStore());
contract("FileSessionStore", () => new FileSessionStore(tempDir()));

describe("FileSessionStore durability", () => {
  it("restores stage + history after a fresh instance (simulated restart)", () => {
    const dir = tempDir();
    const first = new FileSessionStore(dir);
    first.open("agent", { visitorId: "v" });
    first.append("agent", "v", {
      at: 1,
      event: { kind: "message", text: "remember me" },
      messages: [{ kind: "say", text: "ok" }],
    });

    const restarted = new FileSessionStore(dir);
    expect(restarted.get("agent", "v")).toBeDefined();
    expect(restarted.history("agent", "v")[0]?.event).toMatchObject({ text: "remember me" });
  });
});
