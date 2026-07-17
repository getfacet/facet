import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Dataset } from "@facet/core";
import { Stage } from "./stage.js";

const STAGE_SOURCE = readFileSync(fileURLToPath(new URL("./stage.ts", import.meta.url)), "utf8");

describe("Stage — ergonomic CLI over RFC 6902", () => {
  it("append emits an add-node op plus an add-child-ref op", () => {
    const stage = new Stage();
    stage.append("root", { id: "c", type: "text", value: "hi" });
    const messages = stage.flush();
    expect(messages).toHaveLength(1);
    const message = messages[0];
    expect(message?.kind).toBe("patch");
    if (message?.kind !== "patch") throw new Error("expected patch");
    expect(message.patches).toEqual([
      { op: "add", path: "/nodes/c", value: { id: "c", type: "text", value: "hi" } },
      { op: "add", path: "/nodes/root/children/-", value: "c" },
    ]);
  });

  it("render becomes a replace at the root path", () => {
    const stage = new Stage();
    stage.render({ root: "root", nodes: {} });
    const message = stage.flush()[0];
    if (message?.kind !== "patch") throw new Error("expected patch");
    expect(message.patches[0]).toEqual({
      op: "replace",
      path: "",
      value: { root: "root", nodes: {} },
    });
  });

  it("say flushes queued patches first, preserving order", () => {
    const stage = new Stage();
    stage.set({ id: "a", type: "text", value: "x" }).say("done");
    expect(stage.flush().map((m) => m.kind)).toEqual(["patch", "say"]);
  });

  it("flush drains recorded output so repeated flushes return deltas only", () => {
    const stage = new Stage();
    stage.say("one");
    expect(stage.flush()).toEqual([{ kind: "say", text: "one" }]);
    expect(stage.flush()).toEqual([]);

    stage.say("two");
    expect(stage.flush()).toEqual([{ kind: "say", text: "two" }]);
  });

  it("screens records a screens map and entry as patch ops", () => {
    const stage = new Stage();
    stage.screens({ home: "home_root", about: "about_root" }, "home");
    const messages = stage.flush();
    expect(messages).toHaveLength(1);
    const message = messages[0];
    if (message?.kind !== "patch") throw new Error("expected patch");
    expect(message.patches).toEqual([
      { op: "add", path: "/screens", value: { home: "home_root", about: "about_root" } },
      { op: "add", path: "/entry", value: "home" },
    ]);
  });

  it("screens coalesces with other edits and flushes before say", () => {
    const stage = new Stage();
    stage
      .set({ id: "home_root", type: "box", children: [] })
      .screens({ home: "home_root" }, "home")
      .say("screens ready");
    const messages = stage.flush();
    expect(messages.map((m) => m.kind)).toEqual(["patch", "say"]);
    const message = messages[0];
    if (message?.kind !== "patch") throw new Error("expected patch");
    expect(message.patches).toEqual([
      {
        op: "add",
        path: "/nodes/home_root",
        value: { id: "home_root", type: "box", children: [] },
      },
      { op: "add", path: "/screens", value: { home: "home_root" } },
      { op: "add", path: "/entry", value: "home" },
    ]);
  });

  it("has no Theme patch authoring surface", () => {
    expect(Object.getOwnPropertyNames(Stage.prototype)).not.toContain("theme");
    expect(STAGE_SOURCE).not.toContain('path: "/theme"');
  });

  it("escapes ids in JSON pointers", () => {
    const stage = new Stage();
    stage.remove("a/b~c");
    const message = stage.flush()[0];
    if (message?.kind !== "patch") throw new Error("expected patch");
    expect(message.patches[0]).toEqual({ op: "remove", path: "/nodes/a~1b~0c" });
  });

  describe("setData", () => {
    const SALES: Dataset = [
      { region: "US", revenue: 100 },
      { region: "EU", revenue: 80 },
    ];

    it("emits a /data/<name> add plus a one-time /data init on the first write", () => {
      const stage = new Stage();
      stage.setData("sales", SALES);
      const messages = stage.flush();
      expect(messages).toHaveLength(1);
      const message = messages[0];
      if (message?.kind !== "patch") throw new Error("expected patch");
      expect(message.patches).toEqual([
        { op: "add", path: "/data", value: {} },
        { op: "add", path: "/data/sales", value: SALES },
      ]);
    });

    it("skips the /data init when the session stage already carries data", () => {
      const stage = new Stage({ root: "root", nodes: {}, data: { existing: [] } });
      stage.setData("sales", SALES);
      const messages = stage.flush();
      expect(messages).toHaveLength(1);
      const message = messages[0];
      if (message?.kind !== "patch") throw new Error("expected patch");
      expect(message.patches).toEqual([{ op: "add", path: "/data/sales", value: SALES }]);
    });

    it("inits /data only once across several datasets in the same turn", () => {
      const stage = new Stage();
      stage.setData("sales", SALES).setData("costs", []);
      const message = stage.flush()[0];
      if (message?.kind !== "patch") throw new Error("expected patch");
      expect(message.patches).toEqual([
        { op: "add", path: "/data", value: {} },
        { op: "add", path: "/data/sales", value: SALES },
        { op: "add", path: "/data/costs", value: [] },
      ]);
    });

    it("coalesces with other edits and flushes before say", () => {
      const stage = new Stage({ root: "root", nodes: {}, data: {} });
      stage
        .set({ id: "chart", type: "chart", kind: "bar", series: [], from: "sales" })
        .setData("sales", SALES)
        .say("data ready");
      const messages = stage.flush();
      expect(messages.map((m) => m.kind)).toEqual(["patch", "say"]);
      const message = messages[0];
      if (message?.kind !== "patch") throw new Error("expected patch");
      expect(message.patches).toEqual([
        {
          op: "add",
          path: "/nodes/chart",
          value: { id: "chart", type: "chart", kind: "bar", series: [], from: "sales" },
        },
        { op: "add", path: "/data/sales", value: SALES },
      ]);
    });

    it("escapes the dataset name in the JSON pointer", () => {
      const stage = new Stage({ root: "root", nodes: {}, data: {} });
      stage.setData("a/b~c", SALES);
      const message = stage.flush()[0];
      if (message?.kind !== "patch") throw new Error("expected patch");
      expect(message.patches[0]).toEqual({ op: "add", path: "/data/a~1b~0c", value: SALES });
    });
  });

  it("has no composition expansion method", () => {
    const method = ["use", "Composition"].join("");

    expect(Object.getOwnPropertyNames(Stage.prototype)).not.toContain(method);
    expect(STAGE_SOURCE).not.toContain(`${method}(`);
  });
});
