import { describe, expect, it } from "vitest";
import {
  COMPONENT_NODE_TYPES,
  PRIMITIVE_BRICK_TYPES,
  type DataWarehouse,
  type FacetNode,
} from "@facet/core";

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

// WU-5 (RISK-API-2) — richtext must be registered as a PRIMITIVE executor entry
// so the mapped `ExecutorRegistry` stays exhaustive and the primitive-fallback
// gate (`PRIMITIVE_NODE_TYPES.has(node.type)`) accepts it — never mis-routed as a
// component. asNode is a light shape gate (the deep clamp lives in core's
// validateTree); describe is a one-line inspect summary.
describe("richtext", () => {
  it("is registered as a primitive brick (not a component)", () => {
    expect(EXECUTOR_REGISTRY.richtext.policy.kind).toBe("primitive");
    expect(PRIMITIVE_NODE_TYPES.has("richtext")).toBe(true);
    expect(COMPONENT_NODE_TYPE_SET.has("richtext")).toBe(false);
  });

  it("asNode accepts a valid richtext node", () => {
    const result = EXECUTOR_REGISTRY.richtext.asNode({
      id: "prose",
      type: "richtext",
      blocks: [
        {
          type: "paragraph",
          runs: [{ text: "Hello ", marks: [{ kind: "bold" }] }, { text: "world" }],
        },
      ],
    });
    expect("facetNode" in result).toBe(true);
  });

  it("asNode rejects a non-array blocks field", () => {
    const result = EXECUTOR_REGISTRY.richtext.asNode({
      id: "prose",
      type: "richtext",
      blocks: "nope",
    });
    expect("error" in result).toBe(true);
  });

  it("describe reports the block count", () => {
    const node = {
      id: "prose",
      type: "richtext",
      blocks: [
        { type: "heading", level: 1, runs: [{ text: "Title" }] },
        { type: "paragraph", runs: [{ text: "Body" }] },
      ],
    } as unknown as FacetNode;
    expect(describeNode(node, undefined)).toBe("prose richtext blocks=2");
  });
});

// WU-5 (DC-001/DC-003) — the former `field` primitive brick is renamed to
// `input` and the `search` component is removed. The registry must expose an
// `input` primitive entry (name-gated asNode, one-line describe) and NO `search`
// entry — a still-typed `search` node degrades gracefully via describeNode.
describe("input (field renamed) + search removed", () => {
  it("DC-001: input is registered as a primitive brick, not a component", () => {
    expect(EXECUTOR_REGISTRY.input.policy.kind).toBe("primitive");
    expect(PRIMITIVE_NODE_TYPES.has("input")).toBe(true);
    expect(COMPONENT_NODE_TYPE_SET.has("input")).toBe(false);
  });

  it("DC-001: input asNode requires a string name and describe reports it", () => {
    const ok = EXECUTOR_REGISTRY.input.asNode({ id: "q", type: "input", name: "query" });
    expect("facetNode" in ok).toBe(true);
    const bad = EXECUTOR_REGISTRY.input.asNode({ id: "q", type: "input" });
    expect("error" in bad).toBe(true);
    const node = { id: "q", type: "input", name: "query" } as unknown as FacetNode;
    expect(describeNode(node, undefined)).toBe('q input name="query"');
  });

  it("DC-003: the search node type is gone from the registry and degrades gracefully", () => {
    expect(Object.hasOwn(EXECUTOR_REGISTRY, "search")).toBe(false);
    const searchNode = { id: "s", type: "search", name: "q" } as unknown as FacetNode;
    expect(() => describeNode(searchNode, undefined)).not.toThrow();
    expect(describeNode(searchNode, undefined)).toBe("type=search");
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

// RISK-INV-6 — the brain's local `text` shadow must reflect the SAME resolved
// store cell the renderer prints. A `from`-bound `text` describe must project
// its cell through `resolveNodeData` (metric/stat parity), not read the raw
// inline `value`, or the agent's view drifts from the visitor's.
describe("text from", () => {
  const boundText = {
    id: "kpi",
    type: "text",
    value: "",
    from: "sales",
    column: "revenue",
    row: 1,
  } as unknown as FacetNode;
  const boundMetric = {
    id: "kpiMetric",
    type: "metric",
    label: "Revenue",
    value: "",
    from: "sales",
    column: "revenue",
    row: 1,
  } as unknown as FacetNode;

  it("DC-001: a from-bound text's describe shows the resolved cell, matching the metric shadow", () => {
    const warehouse: DataWarehouse = {
      sales: [
        { month: "Jan", revenue: 10 },
        { month: "Feb", revenue: 20 },
      ],
    };
    // Resolved cell (row 1, column "revenue") = 20 — NOT the empty inline value.
    expect(describeNode(boundText, warehouse)).toBe('kpi text value="20"');
    // Parity: the metric shadow of the same binding resolves the same cell.
    expect(describeNode(boundMetric, warehouse)).toContain('value="20"');
  });

  it("DC-003: the text describe reflects the store after a data change", () => {
    const before: DataWarehouse = { sales: [{ revenue: 10 }, { revenue: 20 }] };
    const after: DataWarehouse = { sales: [{ revenue: 10 }, { revenue: 99 }] };
    expect(describeNode(boundText, before)).toBe('kpi text value="20"');
    expect(describeNode(boundText, after)).toBe('kpi text value="99"');
  });

  it("DC-002 parity: a dangling from resolves to empty, never throws", () => {
    const warehouse: DataWarehouse = { other: [{ revenue: 5 }] };
    expect(() => describeNode(boundText, warehouse)).not.toThrow();
    expect(describeNode(boundText, warehouse)).toBe('kpi text value=""');
  });
});
