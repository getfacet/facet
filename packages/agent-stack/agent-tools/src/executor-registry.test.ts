import { describe, expect, it } from "vitest";
import { COMPONENT_NODE_TYPES, PRIMITIVE_BRICK_TYPES, type FacetNode } from "@facet/core";

import {
  COMPONENT_NODE_TYPE_SET,
  EXECUTOR_REGISTRY,
  PRIMITIVE_NODE_TYPES,
  describeNode,
} from "./executor-registry.js";

// The point of PR-0: a core node type added to the vocabulary but missing an
// executor entry (or vice-versa) must be caught. `Record<FacetNode["type"], …>`
// is the compile-time guard (it also preserves the former `describeNode` `never`
// exhaustiveness check); this is the runtime backstop that the registry keys
// stay in lock-step with the canonical core node-type list.
describe("executor registry exhaustiveness", () => {
  it("has exactly one entry per core node type", () => {
    const registryKeys = Object.keys(EXECUTOR_REGISTRY).sort();
    const vocabulary = [...PRIMITIVE_BRICK_TYPES, ...COMPONENT_NODE_TYPES].sort();
    expect(registryKeys).toEqual(vocabulary);
  });

  it("every entry carries asNode/describe/policy handlers", () => {
    for (const entry of Object.values(EXECUTOR_REGISTRY)) {
      expect(typeof entry.asNode).toBe("function");
      expect(typeof entry.describe).toBe("function");
      expect(entry.policy.kind === "primitive" || entry.policy.kind === "component").toBe(true);
    }
  });

  it("policy split matches the core primitive/component partition", () => {
    expect([...PRIMITIVE_NODE_TYPES].sort()).toEqual([...PRIMITIVE_BRICK_TYPES].sort());
    expect([...COMPONENT_NODE_TYPE_SET].sort()).toEqual([...COMPONENT_NODE_TYPES].sort());
  });
});

// `describeNode` reads a shadow node whose `type` `isTreeShaped` never validated,
// so it can be an Object.prototype member name. A bare `EXECUTOR_REGISTRY[type]`
// returned the inherited `Object` FUNCTION and `.describe(...)` on it threw; the
// `Object.hasOwn` guard must degrade to a bounded `type=<junk>` string instead.
describe("describeNode prototype-chain lookup guard", () => {
  it("does not throw and returns a graceful description for an Object.prototype member type", () => {
    const junk = { id: "x", type: "constructor" } as unknown as FacetNode;
    expect(() => describeNode(junk, undefined)).not.toThrow();
    expect(describeNode(junk, undefined)).toBe("type=constructor");
  });
});
