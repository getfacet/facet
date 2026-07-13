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
