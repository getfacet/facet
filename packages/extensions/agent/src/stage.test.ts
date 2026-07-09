import { describe, expect, it } from "vitest";
import { MAX_PATCH_OPS, type FacetStamp, type FacetTree } from "@facet/core";
import { Stage } from "./stage.js";

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

  it("records a theme selection as a top-level add op", () => {
    const stage = new Stage();
    stage.theme("midnight");
    const messages = stage.flush();
    expect(messages).toHaveLength(1);
    const message = messages[0];
    if (message?.kind !== "patch") throw new Error("expected patch");
    expect(message.patches).toEqual([{ op: "add", path: "/theme", value: "midnight" }]);
  });

  it("theme coalesces with other edits and flushes before say", () => {
    const stage = new Stage();
    stage.set({ id: "root", type: "box", children: [] }).theme("midnight").say("theme set");
    const messages = stage.flush();
    expect(messages.map((m) => m.kind)).toEqual(["patch", "say"]);
    const message = messages[0];
    if (message?.kind !== "patch") throw new Error("expected patch");
    expect(message.patches).toEqual([
      { op: "add", path: "/nodes/root", value: { id: "root", type: "box", children: [] } },
      { op: "add", path: "/theme", value: "midnight" },
    ]);
  });

  it("escapes ids in JSON pointers", () => {
    const stage = new Stage();
    stage.remove("a/b~c");
    const message = stage.flush()[0];
    if (message?.kind !== "patch") throw new Error("expected patch");
    expect(message.patches[0]).toEqual({ op: "remove", path: "/nodes/a~1b~0c" });
  });

  it("useStamp expands a stamp into one coalesced patch and returns fresh ids", () => {
    const stage = new Stage();
    const result = stage.useStamp(
      {
        name: "card",
        slots: { title: "Default" },
        root: "card",
        nodes: {
          card: { id: "card", type: "box", children: ["title"] },
          title: { id: "title", type: "text", value: "{{title}}" },
        },
      },
      { title: "Hello" },
      { parent: "root" },
    );

    expect(result.root).toBeDefined();
    expect(result.slots["title"]).toBeDefined();
    expect(result.ids["card"]).toBe(result.root);
    expect(result.ids["title"]).toBe(result.slots["title"]);

    const messages = stage.flush();
    expect(messages).toHaveLength(1);
    const message = messages[0];
    if (message?.kind !== "patch") throw new Error("expected patch");
    expect(message.patches).toEqual([
      {
        op: "add",
        path: `/nodes/${result.root}`,
        value: { id: result.root, type: "box", style: {}, children: [result.slots["title"]] },
      },
      {
        op: "add",
        path: `/nodes/${result.slots["title"]}`,
        value: { id: result.slots["title"], type: "text", value: "Hello", style: {} },
      },
      { op: "add", path: "/nodes/root/children/-", value: result.root },
    ]);
  });

  it("useStamp coalesces with pending edits and flushes before say", () => {
    const stage = new Stage();
    stage.set({ id: "panel", type: "box", children: [] });
    const result = stage.useStamp(
      {
        name: "label",
        root: "text",
        nodes: { text: { id: "text", type: "text", value: "Inside" } },
      },
      {},
      { parent: "panel" },
    );
    stage.say("done");

    const messages = stage.flush();
    expect(messages.map((message) => message.kind)).toEqual(["patch", "say"]);
    const message = messages[0];
    if (message?.kind !== "patch") throw new Error("expected patch");
    expect(message.patches).toEqual([
      { op: "add", path: "/nodes/panel", value: { id: "panel", type: "box", children: [] } },
      {
        op: "add",
        path: `/nodes/${result.root}`,
        value: { id: result.root, type: "text", value: "Inside", style: {} },
      },
      { op: "add", path: "/nodes/panel/children/-", value: result.root },
    ]);
  });

  it("supports component section and card parents after set", () => {
    const stage = new Stage();
    stage.set({ id: "section", type: "section", title: "Overview", children: [] });
    const sectionResult = stage.useStamp(
      {
        name: "label",
        root: "label",
        nodes: { label: { id: "label", type: "text", value: "Inside section" } },
      },
      {},
      { parent: "section" },
    );
    stage.set({ id: "card", type: "card", title: "Metrics", children: [] });
    const cardResult = stage.useStamp(
      {
        name: "label",
        root: "label",
        nodes: { label: { id: "label", type: "text", value: "Inside card" } },
      },
      {},
      { parent: "card" },
    );

    expect(sectionResult.root).toBeDefined();
    expect(cardResult.root).toBeDefined();

    const message = stage.flush()[0];
    if (message?.kind !== "patch") throw new Error("expected patch");
    expect(message.patches).toContainEqual({
      op: "add",
      path: "/nodes/section/children/-",
      value: sectionResult.root,
    });
    expect(message.patches).toContainEqual({
      op: "add",
      path: "/nodes/card/children/-",
      value: cardResult.root,
    });
  });

  it("tracks component container parents added through append", () => {
    const stage = new Stage();
    stage.append("root", { id: "section", type: "section", title: "Plan", children: [] });
    const result = stage.useStamp(
      {
        name: "label",
        root: "label",
        nodes: { label: { id: "label", type: "text", value: "Nested" } },
      },
      {},
      { parent: "section" },
    );

    expect(result.root).toBeDefined();

    const message = stage.flush()[0];
    if (message?.kind !== "patch") throw new Error("expected patch");
    expect(message.patches).toContainEqual({
      op: "add",
      path: "/nodes/section/children/-",
      value: result.root,
    });
  });

  it("useStamp is a no-op for malformed stamps or unknown parents", () => {
    const stage = new Stage();

    const badStamp = stage.useStamp(undefined, {}, { parent: "root" });
    const unknownParent = stage.useStamp(
      {
        name: "label",
        root: "text",
        nodes: { text: { id: "text", type: "text", value: "Inside" } },
      },
      {},
      { parent: "ghost" },
    );

    expect(badStamp.root).toBeUndefined();
    expect(badStamp.ids).toEqual({});
    expect(unknownParent.root).toBeUndefined();
    expect(unknownParent.ids).toEqual({});
    expect(stage.flush()).toEqual([]);
  });

  it("useStamp rejects non-box parents from the current session", () => {
    const stage = new Stage({
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["title"] },
        title: { id: "title", type: "text", value: "Title" },
      },
    });

    const result = stage.useStamp(
      {
        name: "label",
        root: "label",
        nodes: { label: { id: "label", type: "text", value: "Inside" } },
      },
      {},
      { parent: "title" },
    );

    expect(result.root).toBeUndefined();
    expect(stage.flush()).toEqual([]);
  });

  it("seeds known ids fail-safe from a session stage with null nodes", () => {
    const sessionStage = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["x"] },
        x: null,
      },
    } as unknown as FacetTree;

    expect(() => new Stage(sessionStage)).not.toThrow();
    const stage = new Stage(sessionStage);
    const underRoot = stage.useStamp(
      {
        name: "label",
        root: "label",
        nodes: { label: { id: "label", type: "text", value: "Inside" } },
      },
      {},
      { parent: "root" },
    );
    const underNull = stage.useStamp(
      {
        name: "label",
        root: "label",
        nodes: { label: { id: "label", type: "text", value: "Inside" } },
      },
      {},
      { parent: "x" },
    );

    expect(underRoot.root).toBeDefined();
    expect(underNull.root).toBeUndefined();
  });

  it("useStamp refuses an expansion that would exceed one patch batch", () => {
    const nodes: Record<string, FacetStamp["nodes"][string]> = {
      root: { id: "root", type: "box", children: [] },
    };
    const children: string[] = [];
    for (let i = 0; i < MAX_PATCH_OPS; i += 1) {
      const id = `n${String(i)}`;
      children.push(id);
      nodes[id] = { id, type: "text", value: id };
    }
    nodes["root"] = { id: "root", type: "box", children };
    const stage = new Stage();

    const result = stage.useStamp({ name: "huge", root: "root", nodes }, {}, { parent: "root" });

    expect(result.root).toBeUndefined();
    expect(stage.flush()).toEqual([]);
  });

  it("useStamp counts patch ops already flushed by say in the same turn", () => {
    const largeNodes: Record<string, FacetStamp["nodes"][string]> = {
      root: { id: "root", type: "box", children: [] },
    };
    const children: string[] = [];
    for (let i = 0; i < MAX_PATCH_OPS - 2; i += 1) {
      const id = `n${String(i)}`;
      children.push(id);
      largeNodes[id] = { id, type: "text", value: id };
    }
    largeNodes["root"] = { id: "root", type: "box", children };
    const stage = new Stage();

    const first = stage.useStamp(
      { name: "large", root: "root", nodes: largeNodes },
      {},
      { parent: "root" },
    );
    stage.say("between");
    const second = stage.useStamp(
      {
        name: "label",
        root: "label",
        nodes: { label: { id: "label", type: "text", value: "Too much" } },
      },
      {},
      { parent: "root" },
    );

    expect(first.root).toBeDefined();
    expect(second.root).toBeUndefined();
    expect(stage.flush().filter((message) => message.kind === "patch")).toHaveLength(1);
  });
});
