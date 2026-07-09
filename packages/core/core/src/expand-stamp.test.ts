import { describe, expect, it } from "vitest";
import { MAX_FIELD_VALUE_CHARS } from "./protocol.js";
import { expandStamp } from "./expand-stamp.js";
import { expandStamp as barrelExpandStamp } from "./index.js";
import { SLOT_MARKER_RE } from "./validate.js";

function mintFrom(ids: readonly string[]): () => string {
  let index = 0;
  return () => {
    const id = ids[index];
    index += 1;
    if (id === undefined) throw new Error("mint exhausted");
    return id;
  };
}

describe("expandStamp", () => {
  it("fills params and defaults, remaps every node id, and returns slot ids", () => {
    const result = expandStamp(
      {
        name: "card",
        slots: { title: "Default title", body: "Default body" },
        root: "card",
        nodes: {
          card: { id: "card", type: "box", children: ["title", "body"] },
          title: { id: "title", type: "text", value: "{{title}}" },
          body: { id: "body", type: "text", value: "{{body}}" },
        },
      },
      { title: "Custom title" },
      { parent: "root" },
      {
        existingIds: new Set(["root"]),
        mintId: mintFrom(["fresh-card", "fresh-title", "fresh-body"]),
      },
    );

    expect(result.issues).toHaveLength(0);
    expect(result.root).toBe("fresh-card");
    expect(result.ids).toEqual({
      card: "fresh-card",
      title: "fresh-title",
      body: "fresh-body",
    });
    expect(result.slots).toEqual({ title: "fresh-title", body: "fresh-body" });
    expect(result.nodes["fresh-card"]).toMatchObject({
      id: "fresh-card",
      type: "box",
      children: ["fresh-title", "fresh-body"],
    });
    expect(result.nodes["fresh-title"]).toMatchObject({ value: "Custom title" });
    expect(result.nodes["fresh-body"]).toMatchObject({ value: "Default body" });
  });

  it("keeps repeated expansions disjoint from existing ids and from each other", () => {
    const known = new Set(["root", "fresh-card"]);
    const stamp = {
      name: "hero",
      root: "hero",
      nodes: {
        hero: { id: "hero", type: "box", children: ["title"] },
        title: { id: "title", type: "text", value: "Hello" },
      },
    };

    const first = expandStamp(
      stamp,
      {},
      { parent: "root" },
      {
        existingIds: known,
        mintId: mintFrom(["root", "fresh-card", "hero-1", "title-1"]),
      },
    );
    for (const id of Object.values(first.ids)) known.add(id);
    const second = expandStamp(
      stamp,
      {},
      { parent: "root" },
      {
        existingIds: known,
        mintId: mintFrom(["hero-1", "title-1", "hero-2", "title-2"]),
      },
    );

    expect(Object.values(first.ids)).toEqual(["hero-1", "title-1"]);
    expect(Object.values(second.ids)).toEqual(["hero-2", "title-2"]);
    expect(new Set([...Object.values(first.ids), ...Object.values(second.ids)]).size).toBe(4);
  });

  it("sanitizes bad params, validates filled output, and never emits invalid bricks", () => {
    const result = expandStamp(
      {
        name: "media_card",
        slots: {
          image: "https://example.com/default.png",
          alt: "fallback",
          title: "Fallback",
        },
        root: "card",
        nodes: {
          card: { id: "card", type: "box", children: ["image", "title", "bad"] },
          image: { id: "image", type: "media", src: "{{image}}", alt: "{{alt}}" },
          title: { id: "title", type: "text", value: "{{title}}" },
          bad: { id: "bad", type: "marquee", value: "{{title}}" },
        },
      },
      {
        image: "javascript:alert(1)",
        alt: 42,
        title: "t".repeat(MAX_FIELD_VALUE_CHARS + 5),
      },
      { parent: "root" },
      { existingIds: new Set(["root"]), mintId: mintFrom(["card-1", "title-1"]) },
    );

    expect(result.root).toBe("card-1");
    expect(
      Object.values(result.nodes).every((node) =>
        ["box", "text", "media", "field"].includes(node.type),
      ),
    ).toBe(true);
    expect(Object.values(result.nodes).some((node) => node.type === "media")).toBe(false);
    expect(result.nodes["title-1"]).toMatchObject({
      type: "text",
      value: "t".repeat(MAX_FIELD_VALUE_CHARS),
    });
    expect(
      result.issues.some((issue) => issue.includes("param") && issue.includes("not a string")),
    ).toBe(true);
    expect(result.issues.some((issue) => issue.includes("truncated"))).toBe(true);
    expect(result.issues.some((issue) => issue.includes("unsafe media src"))).toBe(true);
  });

  it("fills media poster slots after validating the marker", () => {
    const result = expandStamp(
      {
        name: "video",
        slots: { poster: "https://example.com/default.jpg" },
        root: "video",
        nodes: {
          video: {
            id: "video",
            type: "media",
            kind: "video",
            src: "https://example.com/movie.mp4",
            poster: "{{poster}}",
          },
        },
      },
      { poster: "https://example.com/custom.jpg" },
      { parent: "root" },
      { existingIds: new Set(["root"]), mintId: mintFrom(["fresh-video"]) },
    );

    expect(result.root).toBe("fresh-video");
    expect(result.slots).toEqual({ poster: "fresh-video" });
    expect(result.nodes["fresh-video"]).toMatchObject({
      type: "media",
      poster: "https://example.com/custom.jpg",
    });
  });

  it("drops unreachable stamp nodes before remapping or emitting", () => {
    const result = expandStamp(
      {
        name: "clean",
        root: "root",
        nodes: {
          root: { id: "root", type: "box", children: ["visible"] },
          visible: { id: "visible", type: "text", value: "Visible" },
          orphan: { id: "orphan", type: "box", children: ["orphan-child"] },
          "orphan-child": { id: "orphan-child", type: "text", value: "Hidden" },
        },
      },
      {},
      { parent: "page" },
      { existingIds: new Set(["page"]), mintId: mintFrom(["fresh-root", "fresh-visible"]) },
    );

    expect(result.root).toBe("fresh-root");
    expect(Object.keys(result.nodes).sort()).toEqual(["fresh-root", "fresh-visible"]);
    expect(result.ids).toEqual({ root: "fresh-root", visible: "fresh-visible" });
    expect(result.issues.some((issue) => issue.includes("unreachable"))).toBe(true);
  });

  it("remaps high-level section and card child refs while preserving metadata", () => {
    const result = expandStamp(
      {
        name: "dashboard-summary",
        description: "Dashboard summary",
        metadata: {
          category: "dashboard",
          variants: ["compact"],
          preferredParent: "section",
        },
        slots: { title: "Revenue" },
        root: "section",
        nodes: {
          section: {
            id: "section",
            type: "section",
            title: "{{title}}",
            children: ["card", "badge"],
          },
          card: {
            id: "card",
            type: "card",
            title: "MRR",
            children: ["stat"],
            onPress: { kind: "toggle", target: "badge" },
          },
          stat: { id: "stat", type: "stat", label: "MRR", value: "$42k" },
          badge: { id: "badge", type: "badge", label: "Healthy", tone: "success" },
        },
      },
      { title: "Revenue now" },
      { parent: "root" },
      {
        existingIds: new Set(["root"]),
        mintId: mintFrom(["fresh-section", "fresh-card", "fresh-stat", "fresh-badge"]),
      },
    );

    expect(result.issues).toHaveLength(0);
    expect(result.root).toBe("fresh-section");
    expect(result.slots).toEqual({ title: "fresh-section" });
    expect(result.nodes["fresh-section"]).toMatchObject({
      id: "fresh-section",
      type: "section",
      title: "Revenue now",
      children: ["fresh-card", "fresh-badge"],
    });
    expect(result.nodes["fresh-card"]).toMatchObject({
      id: "fresh-card",
      type: "card",
      children: ["fresh-stat"],
      onPress: { kind: "toggle", target: "fresh-badge" },
    });
  });

  it("bounds untrusted node ids echoed in expansion issues", () => {
    const longId = "x".repeat(80);
    const unreachable = expandStamp(
      {
        name: "clean",
        root: "root",
        nodes: {
          root: { id: "root", type: "box", children: [] },
          [longId]: { id: longId, type: "text", value: "Hidden" },
        },
      },
      {},
      { parent: "page" },
      { existingIds: new Set(["page"]), mintId: mintFrom(["fresh-root"]) },
    );
    const mintFailed = expandStamp(
      {
        name: "clean",
        root: longId,
        nodes: {
          [longId]: { id: longId, type: "text", value: "Visible" },
        },
      },
      {},
      { parent: "page" },
      { existingIds: new Set(["page"]), mintId: () => "page" },
    );

    expect(unreachable.issues.join("\n")).toContain("<key too long>");
    expect(unreachable.issues.join("\n")).not.toContain(longId);
    expect(mintFailed.issues.join("\n")).toContain("<key too long>");
    expect(mintFailed.issues.join("\n")).not.toContain(longId);
  });

  it("uses validateStamp's exported slot marker rule", () => {
    expect(SLOT_MARKER_RE.exec("{{title}}")?.[1]).toBe("title");
    expect(SLOT_MARKER_RE.test("{{bad space}}")).toBe(false);
  });

  it("drops actions that target nodes outside the stamped subtree", () => {
    const result = expandStamp(
      {
        name: "button",
        root: "button",
        nodes: {
          button: {
            id: "button",
            type: "box",
            children: [],
            onPress: { kind: "toggle", target: "root" },
            onHold: { kind: "agent", name: "submit", collect: "root" },
          },
        },
      },
      {},
      { parent: "root" },
      { existingIds: new Set(["root"]), mintId: mintFrom(["fresh-button"]) },
    );

    expect(result.root).toBe("fresh-button");
    expect(result.nodes["fresh-button"]).toEqual({
      id: "fresh-button",
      type: "box",
      style: {},
      children: [],
      onHold: { kind: "agent", name: "submit" },
    });
  });

  it("returns a no-op result for malformed input or an unknown parent", () => {
    const malformed = expandStamp(
      { name: "bad", root: "missing", nodes: { x: { id: "x", type: "text", value: "x" } } },
      {},
      { parent: "root" },
      { existingIds: new Set(["root"]), mintId: mintFrom(["x"]) },
    );
    const unknownParent = expandStamp(
      {
        name: "ok",
        root: "t",
        nodes: { t: { id: "t", type: "text", value: "x" } },
      },
      {},
      { parent: "ghost" },
      { existingIds: new Set(["root"]), mintId: mintFrom(["t-1"]) },
    );

    expect(malformed.root).toBeUndefined();
    expect(malformed.nodes).toEqual({});
    expect(malformed.issues.length).toBeGreaterThan(0);
    expect(unknownParent.root).toBeUndefined();
    expect(unknownParent.nodes).toEqual({});
    expect(unknownParent.issues.some((issue) => issue.includes("parent"))).toBe(true);
  });

  it("is exported through the core barrel", () => {
    expect(barrelExpandStamp).toBe(expandStamp);
  });
});
