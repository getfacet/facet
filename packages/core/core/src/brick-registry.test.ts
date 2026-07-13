import { describe, expect, it } from "vitest";

import { BRICK_REGISTRY, CORE_NODE_TYPES } from "./brick-registry.js";
import { PRIMITIVE_BRICK_TYPES } from "./nodes.js";
import { COMPONENT_NODE_TYPES } from "./component-nodes.js";

// The point of PR-0: a node type added to the vocabulary but missing a registry
// entry (or vice-versa) must be caught. `Record<CoreNodeType, BrickEntry>` is
// the compile-time guard; this is the runtime backstop that the registry keys
// stay in lock-step with the canonical type-union arrays.
describe("brick registry exhaustiveness", () => {
  it("has exactly one entry per canonical node type", () => {
    const registryKeys = Object.keys(BRICK_REGISTRY).sort();
    const vocabulary = [...PRIMITIVE_BRICK_TYPES, ...COMPONENT_NODE_TYPES].sort();
    expect(registryKeys).toEqual(vocabulary);
  });

  it("CORE_NODE_TYPES matches the registry keys", () => {
    expect([...CORE_NODE_TYPES].sort()).toEqual(Object.keys(BRICK_REGISTRY).sort());
  });

  it("every entry carries the concern handlers its kind requires", () => {
    for (const type of CORE_NODE_TYPES) {
      const entry = BRICK_REGISTRY[type];
      // rendersSelf / fill / stringLeaves are required for every brick.
      expect(typeof entry.rendersSelf).toBe("function");
      expect(typeof entry.fill).toBe("function");
      expect(typeof entry.stringLeaves).toBe("function");
      if (entry.kind === "primitive") {
        expect(typeof entry.validate).toBe("function");
        expect(entry.role).toBeUndefined();
      } else {
        expect(entry.role).toBeDefined();
        expect(entry.validate).toBeUndefined();
      }
    }
  });
});
