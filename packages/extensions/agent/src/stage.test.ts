import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { MAX_PATCH_OPS, type FacetComposition, type FacetTree } from "@facet/core";
import { Stage } from "./stage.js";

const STAGE_SOURCE = readFileSync(fileURLToPath(new URL("./stage.ts", import.meta.url)), "utf8");

// Legacy vocabulary is built at runtime so the removed tokens never appear as
// source literals (same idiom as theme.test.ts).
const legacy = ["st", "amp"].join("");
const legacyTitle = ["St", "amp"].join("");
const legacySurface = new RegExp(
  [
    `use${legacyTitle}`,
    `Facet${legacyTitle}`,
    `${legacyTitle}Params`,
    `Use${legacyTitle}Result`,
    `expand${legacyTitle}`,
  ].join("|"),
);

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

const CARD_COMPOSITION: FacetComposition = {
  name: "card",
  slots: { title: "Default" },
  root: "card",
  nodes: {
    card: { id: "card", type: "box", children: ["title"] },
    title: { id: "title", type: "text", value: "{{title}}" },
  },
};

const LABEL_COMPOSITION: FacetComposition = {
  name: "label",
  root: "label",
  nodes: { label: { id: "label", type: "text", value: "Inside" } },
};

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

  describe("useComposition", () => {
    it(`useComposition is the only expansion surface — no ${legacy} method or types remain`, () => {
      expect(STAGE_SOURCE).toContain("useComposition(");
      expect(STAGE_SOURCE).not.toMatch(legacySurface);
      expect(Object.getOwnPropertyNames(Stage.prototype)).toContain("useComposition");
      expect(Object.getOwnPropertyNames(Stage.prototype)).not.toContain(`use${legacyTitle}`);
    });

    it("expands a composition into one coalesced patch and returns fresh ids", () => {
      const stage = new Stage();
      const result = stage.useComposition(CARD_COMPOSITION, { title: "Hello" }, { parent: "root" });

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

    it("coalesces with pending edits and flushes before say", () => {
      const stage = new Stage();
      stage.set({ id: "panel", type: "box", children: [] });
      const result = stage.useComposition(LABEL_COMPOSITION, {}, { parent: "panel" });
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
      const sectionResult = stage.useComposition(LABEL_COMPOSITION, {}, { parent: "section" });
      stage.set({ id: "card", type: "card", title: "Metrics", children: [] });
      const cardResult = stage.useComposition(LABEL_COMPOSITION, {}, { parent: "card" });

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
      const result = stage.useComposition(LABEL_COMPOSITION, {}, { parent: "section" });

      expect(result.root).toBeDefined();

      const message = stage.flush()[0];
      if (message?.kind !== "patch") throw new Error("expected patch");
      expect(message.patches).toContainEqual({
        op: "add",
        path: "/nodes/section/children/-",
        value: result.root,
      });
    });

    it("is a no-op adding zero ops for malformed compositions or unknown parents", () => {
      const stage = new Stage();

      const badComposition = stage.useComposition(undefined, {}, { parent: "root" });
      const unknownParent = stage.useComposition(LABEL_COMPOSITION, {}, { parent: "ghost" });

      expect(badComposition.root).toBeUndefined();
      expect(badComposition.ids).toEqual({});
      expect(unknownParent.root).toBeUndefined();
      expect(unknownParent.ids).toEqual({});
      expect(stage.flush()).toEqual([]);
    });

    it("rejects non-container parents from the current session", () => {
      const stage = new Stage({
        root: "root",
        nodes: {
          root: { id: "root", type: "box", children: ["title"] },
          title: { id: "title", type: "text", value: "Title" },
        },
      });

      const result = stage.useComposition(LABEL_COMPOSITION, {}, { parent: "title" });

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
      const underRoot = stage.useComposition(LABEL_COMPOSITION, {}, { parent: "root" });
      const underNull = stage.useComposition(LABEL_COMPOSITION, {}, { parent: "x" });

      expect(underRoot.root).toBeDefined();
      expect(underNull.root).toBeUndefined();
    });

    it("refuses an expansion that would exceed one patch batch, adding zero ops", () => {
      const nodes: Record<string, FacetComposition["nodes"][string]> = {
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

      const result = stage.useComposition(
        { name: "huge", root: "root", nodes },
        {},
        { parent: "root" },
      );

      expect(result.root).toBeUndefined();
      expect(stage.flush()).toEqual([]);
    });

    it("counts patch ops already flushed by say in the same turn", () => {
      const largeNodes: Record<string, FacetComposition["nodes"][string]> = {
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

      const first = stage.useComposition(
        { name: "large", root: "root", nodes: largeNodes },
        {},
        { parent: "root" },
      );
      stage.say("between");
      const second = stage.useComposition(LABEL_COMPOSITION, {}, { parent: "root" });

      expect(first.root).toBeDefined();
      expect(second.root).toBeUndefined();
      expect(stage.flush().filter((message) => message.kind === "patch")).toHaveLength(1);
    });

    it("treats a partial mint followed by a hostile thrown message getter as a bounded no-op", () => {
      const failure = new Error("mint boom");
      Object.defineProperty(failure, "message", {
        get(): string {
          throw new Error("SENTINEL_MINT");
        },
      });
      const mint = vi
        .spyOn(globalThis.crypto, "randomUUID")
        .mockImplementationOnce(() => "11111111-1111-4111-8111-111111111111")
        .mockImplementation(() => {
          throw failure;
        });

      const stage = new Stage();
      stage.set({ id: "panel", type: "box", children: [] });
      expect(stage.flush()).toHaveLength(1);

      try {
        const hostile = stage.useComposition(
          CARD_COMPOSITION,
          { title: "Hello" },
          { parent: "panel" },
        );

        expect(hostile.root).toBeUndefined();
        expect(hostile.slots).toEqual({});
        expect(hostile.ids).toEqual({});
        const serialized = JSON.stringify(hostile);
        expect(serialized).not.toContain("SENTINEL_MINT");
        expect(serialized).not.toContain("mint boom");
        expect(serialized).not.toMatch(CONTROL_CHARS);
        expect(stage.flush()).toEqual([]);
      } finally {
        mint.mockRestore();
      }

      const recovered = stage.useComposition(
        CARD_COMPOSITION,
        { title: "Recovered" },
        { parent: "panel" },
      );

      expect(recovered.root).toBeDefined();
      const messages = stage.flush();
      expect(messages).toHaveLength(1);
      const message = messages[0];
      if (message?.kind !== "patch") throw new Error("expected patch");
      expect(message.patches).toHaveLength(3);
      expect(message.patches).toContainEqual({
        op: "add",
        path: "/nodes/panel/children/-",
        value: recovered.root,
      });
    });
  });
});
