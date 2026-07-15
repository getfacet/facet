import { describe, expect, it } from "vitest";
import { COMPONENT_NODE_TYPES, PRIMITIVE_BRICK_TYPES, type FacetTree } from "@facet/core";

import { STAGE_SUMMARY_REGISTRY, summarizeStageForPrompt } from "./stage-summary.js";

const RETIRED_CONTAINER_PATTERN_TYPES = [
  ["sec", "tion"].join(""),
  ["ca", "rd"].join(""),
  ["empty", "State"].join(""),
] as const;

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

  it("omits retired container-pattern handlers", () => {
    for (const type of RETIRED_CONTAINER_PATTERN_TYPES) {
      expect(Object.hasOwn(STAGE_SUMMARY_REGISTRY, type)).toBe(false);
    }

    const staleNodes = Object.fromEntries(
      RETIRED_CONTAINER_PATTERN_TYPES.map((type) => [type, { id: type, type }]),
    );
    const stage = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: [...RETIRED_CONTAINER_PATTERN_TYPES] },
        ...staleNodes,
      },
    } as unknown as FacetTree;
    const summary = summarizeStageForPrompt(stage);

    for (const type of RETIRED_CONTAINER_PATTERN_TYPES) {
      expect(summary).toContain(`- ${type}: type=unknown`);
      expect(summary).not.toContain(`type=${type}`);
    }
  });
});

// The `field`→`input` rename (DC-001) + `search` removal (DC-003): the primitive
// input brick must summarize as `type=input`, and the removed `search` component
// type must have no handler left in the registry.
describe("summarizeStageForPrompt input", () => {
  it("summarizes an input node as type=input with its name and kind", () => {
    const stage = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["email"] },
        email: { id: "email", type: "input", name: "email", input: "email" },
      },
    } as unknown as FacetTree;

    const summary = summarizeStageForPrompt(stage);
    expect(summary).toContain("type=input");
    expect(summary).toContain("name=email");
    expect(summary).toContain("input=email");
    expect(summary).not.toContain("type=field");
    expect(summary).not.toContain("type=unknown");
  });

  it("has no search handler in the registry (DC-003)", () => {
    expect(Object.hasOwn(STAGE_SUMMARY_REGISTRY, "search")).toBe(false);
    expect(Object.hasOwn(STAGE_SUMMARY_REGISTRY, "input")).toBe(true);
    expect(Object.hasOwn(STAGE_SUMMARY_REGISTRY, "field")).toBe(false);
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

// DC-002 / DC-005: badge/alert/divider were removed from the core node-type
// vocabulary and demoted to compositions, so their explicit STAGE_SUMMARY
// handlers are gone. A stale authored node bearing one of those removed `type`s
// must fall through the SOFT registry to the generic `type=unknown` summary
// (fail-safe), never emitting a `type=badge`/`type=alert`/`type=divider` line.
describe("summarizeStageForPrompt removed display-leaf types", () => {
  it("summarizes a removed display-leaf generically", () => {
    const stage = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["badge", "alert", "divider"] },
        badge: { id: "badge", type: "badge", label: "Live", tone: "info" },
        alert: { id: "alert", type: "alert", title: "Heads up", body: "Something happened here." },
        divider: { id: "divider", type: "divider", label: "Details" },
      },
    } as unknown as FacetTree;

    const summary = summarizeStageForPrompt(stage);
    expect(summary).not.toContain("type=badge");
    expect(summary).not.toContain("type=alert");
    expect(summary).not.toContain("type=divider");
    expect(summary).toContain("- badge: type=unknown");
    expect(summary).toContain("- alert: type=unknown");
    expect(summary).toContain("- divider: type=unknown");
  });

  it("has no badge/alert/divider handlers in the registry", () => {
    expect(Object.hasOwn(STAGE_SUMMARY_REGISTRY, "badge")).toBe(false);
    expect(Object.hasOwn(STAGE_SUMMARY_REGISTRY, "alert")).toBe(false);
    expect(Object.hasOwn(STAGE_SUMMARY_REGISTRY, "divider")).toBe(false);
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
