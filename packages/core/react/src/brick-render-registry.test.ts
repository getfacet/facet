import { describe, expect, it } from "vitest";
import { COMPONENT_NODE_TYPES, PRIMITIVE_BRICK_TYPES } from "@facet/core";
import { BRICK_RENDERERS, brickRendererEntry } from "./brick-render-registry.js";

// The exhaustiveness guard for the react brick-renderer registry (the point of
// PR-0): a core node type that the renderer DRAWS but forgets a registry entry
// must be caught. The `Record<BrickRendererType, …>` typing already makes a
// missing component key a COMPILE error; this pins the runtime relationship to
// the core vocabulary so an added core type can't silently slip the registry.
describe("BRICK_RENDERERS", () => {
  it("has exactly one entry per drawable-via-renderBrick core node type", () => {
    // renderBrickNode dispatches every component type plus the `field`
    // primitive; box/text/media/richtext are drawn by bespoke inline paths.
    const expected = [...COMPONENT_NODE_TYPES, "field"].sort();
    expect(Object.keys(BRICK_RENDERERS).sort()).toEqual(expected);
  });

  it("plus the bespoke primitives accounts for every core node type once", () => {
    const bespoke = ["box", "text", "media", "richtext"];
    const allCoreTypes = [...PRIMITIVE_BRICK_TYPES, ...COMPONENT_NODE_TYPES].sort();
    expect([...Object.keys(BRICK_RENDERERS), ...bespoke].sort()).toEqual(allCoreTypes);
  });

  it("marks only the layout containers as children-bearing", () => {
    const containers = Object.entries(BRICK_RENDERERS)
      .filter(([, entry]) => entry.container)
      .map(([type]) => type)
      .sort();
    expect(containers).toEqual(["card", "form", "section"]);
  });

  it("marks every component leaf as a motion-snapshot participant", () => {
    for (const [type, entry] of Object.entries(BRICK_RENDERERS)) {
      const isLeafComponent = !entry.container && type !== "field";
      expect(entry.motionSnapshot).toBe(isLeafComponent);
    }
  });
});

// A raw/untrusted node type flows into `brickRendererEntry` off the live patch
// path. `Object.prototype` member names ("constructor"/"toString"/…) index a
// plain object to an inherited FUNCTION — a bare `BRICK_RENDERERS[type]` would
// return it and the caller would then dereference `.render` and throw. The
// `Object.hasOwn` guard must reject every such name as a non-entry (undefined).
describe("brickRendererEntry prototype-chain lookup guard", () => {
  it("returns undefined for Object.prototype member names (pre-fix: an inherited function)", () => {
    for (const junk of ["constructor", "toString", "valueOf", "hasOwnProperty"]) {
      expect(brickRendererEntry(junk)).toBeUndefined();
    }
  });
});
