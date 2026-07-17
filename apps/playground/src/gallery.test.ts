import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BoxNode, InputNode, MediaNode } from "@facet/core";
import { validateTree } from "@facet/core";
import { appearHoldScroll, brickVocabV1Demo } from "./gallery.js";

describe("gallery", () => {
  it("uses only current authored style syntax", () => {
    const source = readFileSync(new URL("./gallery.tsx", import.meta.url), "utf8");
    const authoredTrees = source.slice(0, source.indexOf("const PAGES"));

    expect(authoredTrees).not.toMatch(
      /\b(?:size|weight|align|justify|bg|pad|radius|border|appear|ratio)\s*:/,
    );
    expect(authoredTrees).not.toMatch(/"(?:col|bg|fg|fg-muted|accent-fg|surface-2)"/);
    expect(authoredTrees).not.toMatch(/\bscroll\s*:\s*(?:true|"x")/);

    expect(validateTree(appearHoldScroll()).issues).toEqual([]);
    expect(validateTree(brickVocabV1Demo()).issues).toEqual([]);
  });

  it("appear hold scroll demo tree uses scroll appear and a press-hold pair", () => {
    const tree = appearHoldScroll();
    const boxes = Object.values(tree.nodes).filter((n): n is BoxNode => n.type === "box");

    // A bounded, internally-scrollable region.
    expect(boxes.some((b) => b.style?.scroll === "vertical")).toBe(true);

    // Both appear tokens are exercised: fade (hero) and slide (cards).
    expect(boxes.some((b) => b.style?.enterAnimation === "fade")).toBe(true);
    expect(boxes.some((b) => b.style?.enterAnimation === "slide")).toBe(true);

    // At least one box carries BOTH gestures — the press/hold pair.
    expect(boxes.some((b) => b.onPress !== undefined && b.onHold !== undefined)).toBe(true);

    // The hold targets a pre-drawn, initially-hidden peek panel.
    const holder = boxes.find((b) => b.onPress !== undefined && b.onHold !== undefined);
    expect(holder?.onHold).toMatchObject({ kind: "toggle" });
    const target =
      holder?.onHold !== undefined && "target" in holder.onHold ? holder.onHold.target : undefined;
    expect(target).toBeDefined();
    expect(tree.nodes[target as string]).toMatchObject({ type: "box", hidden: true });

    // The whole tree is valid — zero issues.
    expect(validateTree(tree).issues).toEqual([]);
  });

  it("brick-vocab v1 demo covers media, form options, columns, and horizontal scroll", () => {
    const tree = brickVocabV1Demo();
    const nodes = Object.values(tree.nodes);
    const boxes = nodes.filter((n): n is BoxNode => n.type === "box");
    const fields = nodes.filter((n): n is InputNode => n.type === "input");
    const media = nodes.filter((n): n is MediaNode => n.type === "media");

    expect(media.some((node) => node.kind === "video" && node.controls === true)).toBe(true);
    expect(
      fields.some((node) => node.input === "select" && node.options?.includes("Pro") === true),
    ).toBe(true);
    expect(boxes.some((node) => node.style?.columns === 3)).toBe(true);
    expect(boxes.some((node) => node.style?.scroll === "horizontal")).toBe(true);
    expect(validateTree(tree).issues).toEqual([]);
  });
});
