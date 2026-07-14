import { describe, expect, it } from "vitest";
import { COMPONENT_NODE_TYPES, PRIMITIVE_BRICK_TYPES, type FacetTree } from "@facet/core";

import { STAGE_SUMMARY_REGISTRY, summarizeStageForPrompt } from "./stage-summary.js";

// Guards the whole point of the registry: if a future PR removes a core node
// type but leaves its summary entry (or adds a type and forgets the entry), the
// registry keys drift from the core vocabulary and this test fails. The switch
// this replaced handled every core node type, so the sets must match exactly.
describe("STAGE_SUMMARY_REGISTRY", () => {
  it("covers exactly the core node-type vocabulary", () => {
    const coreNodeTypes = [...PRIMITIVE_BRICK_TYPES, ...COMPONENT_NODE_TYPES];
    expect(Object.keys(STAGE_SUMMARY_REGISTRY).sort()).toEqual([...coreNodeTypes].sort());
  });

  it("maps every core node type to a summary handler", () => {
    for (const type of [...PRIMITIVE_BRICK_TYPES, ...COMPONENT_NODE_TYPES]) {
      expect(typeof STAGE_SUMMARY_REGISTRY[type]).toBe("function");
    }
  });
});

// A richtext node is a flowing LEAF brick holding its own `blocks`/`runs`, not
// child ids. The summarizer must flatten that shape to a text preview so
// compaction reflects the prose, rather than degrading to `type=unknown`.
describe("summarizeStageForPrompt richtext", () => {
  it("summarizes a richtext node as a block count plus a text preview", () => {
    const stage = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["intro"] },
        intro: {
          id: "intro",
          type: "richtext",
          blocks: [
            {
              type: "heading",
              level: 1,
              runs: [{ text: "Welcome " }, { text: "aboard", marks: [{ kind: "bold" }] }],
            },
            { type: "paragraph", runs: [{ text: "Second block copy." }] },
          ],
        },
      },
    } as unknown as FacetTree;

    const summary = summarizeStageForPrompt(stage);
    expect(summary).toContain("type=richtext");
    expect(summary).toContain("blocks=2");
    expect(summary).toContain("Welcome aboard");
    expect(summary).not.toContain("type=unknown");
  });

  it("summarizes a richtext node with no readable runs without throwing", () => {
    const stage = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["empty"] },
        empty: { id: "empty", type: "richtext", blocks: [] },
      },
    } as unknown as FacetTree;

    const summary = summarizeStageForPrompt(stage);
    expect(summary).toContain("type=richtext");
    expect(summary).toContain("blocks=0");
    expect(summary).not.toContain("type=unknown");
  });
});

// The summarizer reads raw, unvalidated node `type`s, so it can meet
// "constructor" and other Object.prototype member names. A bare registry lookup
// returned the inherited `Object` FUNCTION, and `summarize(node)` then produced
// `[object Object]`; the `Object.hasOwn` guard must fall through to the
// `type=unknown` default exactly as the former switch's trailing case did.
describe("summarizeStageForPrompt prototype-chain lookup guard", () => {
  it("summarizes an Object.prototype member type as type=unknown, not [object Object]", () => {
    const stage = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["junk"] },
        junk: { id: "junk", type: "constructor", value: "evil" },
      },
    } as unknown as FacetTree;

    const summary = summarizeStageForPrompt(stage);
    expect(summary).toContain("type=unknown");
    expect(summary).not.toContain("[object Object]");
  });
});
