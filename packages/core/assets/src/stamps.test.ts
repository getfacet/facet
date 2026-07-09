import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { expandStamp, validateStamp } from "@facet/core";
import { DEFAULT_STAMPS } from "./stamps.js";

describe("DEFAULT_STAMPS", () => {
  it("every entry passes validateStamp with zero error issues", () => {
    for (const stamp of DEFAULT_STAMPS) {
      const { stamp: validated, issues } = validateStamp(stamp);
      expect(issues).toEqual([]);
      expect(validated).toBeDefined();
      expect(validated?.root).toBe(stamp.root);
    }
  });

  it("carries every node id under the stamp's own name prefix", () => {
    for (const stamp of DEFAULT_STAMPS) {
      const ids = Object.keys(stamp.nodes);
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.every((id) => id.startsWith(stamp.name))).toBe(true);
      expect(ids).not.toContain("root");
      expect(stamp.root).not.toBe("root");
      expect(stamp.root.startsWith(stamp.name)).toBe(true);
    }
  });

  it("has unique stamp names", () => {
    const names = DEFAULT_STAMPS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("metadata covers practical catalog-guided stamp patterns", () => {
    const names = new Set(DEFAULT_STAMPS.map((stamp) => stamp.name));
    for (const expected of [
      "hero",
      "cta-button",
      "pricing-section",
      "faq-section",
      "dashboard-summary",
      "settings-panel",
      "feature-grid",
      "empty-state",
      "support-triage",
      "chart-table-view",
    ]) {
      expect(names.has(expected), expected).toBe(true);
    }

    for (const stamp of DEFAULT_STAMPS) {
      expect(stamp.metadata?.category, stamp.name).toBeDefined();
      expect(stamp.metadata?.useWhen, stamp.name).toBeDefined();
      expect(stamp.metadata?.tags?.length, stamp.name).toBeGreaterThan(0);
      expect(JSON.stringify(stamp.metadata), stamp.name).not.toContain('"nodes"');
    }
  });

  it("prefers metric where stamp expansion compatibility allows it", () => {
    const serialized = JSON.stringify(DEFAULT_STAMPS);
    const nodeTypes = DEFAULT_STAMPS.flatMap((stamp) =>
      Object.values(stamp.nodes).map((node) => node.type),
    );
    const legacyStatNodes = DEFAULT_STAMPS.flatMap((stamp) =>
      Object.entries(stamp.nodes)
        .filter(([, node]) => node.type === "stat")
        .map(([id, node]) => ({ id, stamp: stamp.name, node })),
    );

    expect(nodeTypes).toContain("metric");
    expect(legacyStatNodes.map(({ id, stamp }) => `${stamp}:${id}`)).toEqual([
      "dashboard-summary:dashboard-summary.stat",
    ]);
    expect(JSON.stringify(legacyStatNodes[0]?.node)).toContain("{{metric}}");
    expect(serialized).not.toContain("componentDefinitions");
    expect(serialized).not.toContain("compositions");

    const source = readFileSync(new URL("./stamps.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\bfrom\s+["@'](?:node:|@facet\/(react|runtime|server|client))\b/);
    expect(source).not.toMatch(/\bcomponentDefinitions\b|\bcompositions\b/);
  });

  it("declares slots with whole-value markers and each stamp is fillable", () => {
    for (const stamp of DEFAULT_STAMPS) {
      expect(Object.keys(stamp.slots ?? {}), stamp.name).not.toEqual([]);
      const serialized = JSON.stringify(stamp.nodes);
      for (const slot of Object.keys(stamp.slots ?? {})) {
        expect(serialized, `${stamp.name}:${slot}`).toContain(`{{${slot}}}`);
      }

      const params = Object.fromEntries(
        Object.keys(stamp.slots ?? {}).map((slot) => [slot, `filled:${slot}`]),
      );
      let i = 0;
      const expanded = expandStamp(
        stamp,
        params,
        { parent: "root" },
        {
          existingIds: new Set(["root"]),
          mintId: () => `${stamp.name}.fresh.${String(i++)}`,
        },
      );

      expect(expanded.root, stamp.name).toBeDefined();
      expect(expanded.issues, stamp.name).toEqual([]);
      const filled = JSON.stringify(expanded.nodes);
      for (const slot of Object.keys(stamp.slots ?? {})) {
        expect(filled, `${stamp.name}:${slot}`).toContain(`filled:${slot}`);
        expect(filled, `${stamp.name}:${slot}`).not.toContain(`{{${slot}}}`);
      }
    }
  });
});
