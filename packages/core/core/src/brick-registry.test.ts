import { describe, expect, it } from "vitest";

import { BRICK_REGISTRY, CORE_NODE_TYPES } from "./brick-registry.js";
import { PRIMITIVE_BRICK_TYPES } from "./nodes.js";
import { COMPONENT_NODE_TYPES } from "./component-nodes.js";

const EXPECTED_COMPONENT_NODE_TYPES = [
  "button",
  "tabs",
  "nav",
  "table",
  "chart",
  "metric",
  "keyValue",
  "progress",
  "list",
  "form",
  "filterBar",
  "loading",
  "stat",
] as const;

// The point of PR-0: a node type added to the vocabulary but missing a registry
// entry (or vice-versa) must be caught. `Record<CoreNodeType, BrickEntry>` is
// the compile-time guard; this is the runtime backstop that the registry keys
// stay in lock-step with the canonical type-union arrays.
describe("brick registry exhaustiveness", () => {
  it("has exactly one entry per canonical node type", () => {
    expect(COMPONENT_NODE_TYPES).toEqual(EXPECTED_COMPONENT_NODE_TYPES);
    const registryKeys = Object.keys(BRICK_REGISTRY).sort();
    const vocabulary = [...PRIMITIVE_BRICK_TYPES, ...COMPONENT_NODE_TYPES].sort();
    expect(registryKeys).toEqual(vocabulary);
  });

  it("keeps stat and only the surviving component sanitizer roles", () => {
    expect(BRICK_REGISTRY.stat).toMatchObject({ kind: "component", role: "data" });
    const roles = new Set(
      COMPONENT_NODE_TYPES.map((type) => BRICK_REGISTRY[type].role).filter(
        (role): role is NonNullable<typeof role> => role !== undefined,
      ),
    );
    expect([...roles].sort()).toEqual(["control", "data", "feedback"]);
  });

  it("CORE_NODE_TYPES matches the registry keys", () => {
    expect([...CORE_NODE_TYPES].sort()).toEqual(Object.keys(BRICK_REGISTRY).sort());
  });

  it("has no composition fill hooks", () => {
    for (const type of CORE_NODE_TYPES) {
      const entry = BRICK_REGISTRY[type];
      expect("fill" in entry).toBe(false);
      expect("stringLeaves" in entry).toBe(false);
    }
  });

  it("every entry carries the concern handlers its kind requires", () => {
    for (const type of CORE_NODE_TYPES) {
      const entry = BRICK_REGISTRY[type];
      // rendersSelf is required for every brick.
      expect(typeof entry.rendersSelf).toBe("function");
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
