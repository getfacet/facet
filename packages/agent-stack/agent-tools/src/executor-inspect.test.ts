import { describe, expect, it } from "vitest";
import type { FacetTree } from "@facet/core";
import { executeInspectNode, executeInspectStage } from "./executor-inspect.js";

/**
 * WU-5 / RISK-API-4 — `describeNode` must report the RESOLVED row/series/item
 * counts for a from-bound node (what the visitor sees), not the inline `0`s.
 */
describe("describeNode resolves from-bound counts (RISK-API-4)", () => {
  const tree: FacetTree = {
    root: "root",
    nodes: {
      root: { id: "root", type: "box", children: ["boundTable", "boundChart", "inlineTable"] },
      boundTable: {
        id: "boundTable",
        type: "table",
        columns: [
          { key: "month", label: "Month" },
          { key: "revenue", label: "Revenue" },
        ],
        rows: [],
        from: "sales",
      },
      boundChart: {
        id: "boundChart",
        type: "chart",
        kind: "bar",
        series: [],
        from: "sales",
      },
      inlineTable: {
        id: "inlineTable",
        type: "table",
        columns: [{ key: "name", label: "Name" }],
        rows: [{ name: "Ada" }, { name: "Grace" }],
      },
    },
    data: {
      sales: [
        { month: "Jan", revenue: 10 },
        { month: "Feb", revenue: 20 },
        { month: "Mar", revenue: 30 },
      ],
    },
  };

  it("DC-001: inspect_stage reports resolved counts for from-bound table/chart; inline unchanged", () => {
    const result = executeInspectStage({ maxNodes: 40 }, tree);
    expect(result.status).toBe("ok");
    // Bound table: 3 rows resolved from data.sales (not inline 0).
    expect(result.observation.text).toContain("boundTable table columns=2 rows=3");
    // Bound chart: one numeric-column series (revenue) resolved from data.sales.
    expect(result.observation.text).toContain("boundChart chart kind=bar series=1");
    // Inline node unchanged.
    expect(result.observation.text).toContain("inlineTable table columns=1 rows=2");
  });

  it("DC-001: inspect_node reports resolved counts for a from-bound node", () => {
    const result = executeInspectNode({ nodeId: "boundTable", depth: 0 }, tree);
    expect(result.status).toBe("ok");
    expect(result.observation.text).toContain("boundTable table columns=2 rows=3");
  });

  it("DC-003: a dangling from (no matching dataset) resolves to 0 rows, never throws", () => {
    const dangling: FacetTree = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["t"] },
        t: { id: "t", type: "table", columns: [{ key: "a", label: "A" }], rows: [], from: "missing" },
      },
    };
    const result = executeInspectStage({ maxNodes: 40 }, dangling);
    expect(result.status).toBe("ok");
    expect(result.observation.text).toContain("t table columns=1 rows=0");
  });
});
