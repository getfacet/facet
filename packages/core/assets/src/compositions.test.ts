import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expandComposition, validateComposition } from "@facet/core";
import type { FacetComposition } from "@facet/core";

const moduleUrl = new URL("./compositions.ts", import.meta.url);

// Legacy vocabulary is built at runtime so the removed tokens never appear as
// source literals (same idiom as theme.test.ts).
const legacyNaming = new RegExp(["st", "amp"].join(""), "i");
const legacyDefinitionsField = ["component", "Definitions"].join("");

/**
 * Asserts the canonical module exists BEFORE any dynamic loading so a missing
 * source is an assertion failure, never a module-loader error.
 */
async function loadDefaults(): Promise<readonly FacetComposition[]> {
  expect(existsSync(fileURLToPath(moduleUrl)), "compositions.ts must exist").toBe(true);
  const { DEFAULT_COMPOSITIONS } = await import("./compositions.js");
  return DEFAULT_COMPOSITIONS;
}

describe("DEFAULT_COMPOSITIONS", () => {
  it("ships exactly 11 defaults that pass validateComposition with zero error issues", async () => {
    const defaults = await loadDefaults();
    expect(defaults).toHaveLength(11);
    for (const composition of defaults) {
      const { composition: validated, issues } = validateComposition(composition);
      expect(issues).toEqual([]);
      expect(validated).toBeDefined();
      expect(validated?.root).toBe(composition.root);
    }
  });

  it("carries every node id under the composition's own name prefix", async () => {
    for (const composition of await loadDefaults()) {
      const ids = Object.keys(composition.nodes);
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.every((id) => id.startsWith(composition.name))).toBe(true);
      expect(ids).not.toContain("root");
      expect(composition.root).not.toBe("root");
      expect(composition.root.startsWith(composition.name)).toBe(true);
    }
  });

  it("has unique composition names", async () => {
    const defaults = await loadDefaults();
    const names = defaults.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("metadata covers practical catalog-guided composition patterns", async () => {
    const defaults = await loadDefaults();
    const names = new Set(defaults.map((composition) => composition.name));
    for (const expected of [
      "hero",
      "card",
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

    for (const composition of defaults) {
      expect(composition.metadata?.category, composition.name).toBeDefined();
      expect(composition.metadata?.useWhen, composition.name).toBeDefined();
      expect(composition.metadata?.tags?.length, composition.name).toBeGreaterThan(0);
      expect(JSON.stringify(composition.metadata), composition.name).not.toContain('"nodes"');
    }
  });

  it("prefers metric where composition expansion compatibility allows it", async () => {
    const defaults = await loadDefaults();
    const serialized = JSON.stringify(defaults);
    const nodeTypes = defaults.flatMap((composition) =>
      Object.values(composition.nodes).map((node) => node.type),
    );
    const legacyStatNodes = defaults.flatMap((composition) =>
      Object.entries(composition.nodes)
        .filter(([, node]) => node.type === "stat")
        .map(([id, node]) => ({ id, composition: composition.name, node })),
    );

    expect(nodeTypes).toContain("metric");
    expect(legacyStatNodes.map(({ id, composition }) => `${composition}:${id}`)).toEqual([
      "dashboard-summary:dashboard-summary.stat",
    ]);
    expect(JSON.stringify(legacyStatNodes[0]?.node)).toContain("{{metric}}");
    expect(serialized).not.toContain(legacyDefinitionsField);
    expect(serialized).not.toMatch(legacyNaming);

    const source = readFileSync(moduleUrl, "utf8");
    expect(source).not.toMatch(/\bfrom\s+["@'](?:node:|@facet\/(react|runtime|server|client))\b/);
    expect(source).not.toMatch(new RegExp(`\\b${legacyDefinitionsField}\\b`));
    expect(source).not.toMatch(legacyNaming);
  });

  it("declares slots with whole-value markers and each composition is fillable", async () => {
    for (const composition of await loadDefaults()) {
      expect(Object.keys(composition.slots ?? {}), composition.name).not.toEqual([]);
      const serialized = JSON.stringify(composition.nodes);
      for (const slot of Object.keys(composition.slots ?? {})) {
        expect(serialized, `${composition.name}:${slot}`).toContain(`{{${slot}}}`);
      }

      const params = Object.fromEntries(
        Object.keys(composition.slots ?? {}).map((slot) => [slot, `filled:${slot}`]),
      );
      let i = 0;
      const expanded = expandComposition(
        composition,
        params,
        { parent: "root" },
        {
          existingIds: new Set(["root"]),
          mintId: () => `${composition.name}.fresh.${String(i++)}`,
        },
      );

      expect(expanded.root, composition.name).toBeDefined();
      expect(expanded.issues, composition.name).toEqual([]);
      const filled = JSON.stringify(expanded.nodes);
      for (const slot of Object.keys(composition.slots ?? {})) {
        expect(filled, `${composition.name}:${slot}`).toContain(`filled:${slot}`);
        expect(filled, `${composition.name}:${slot}`).not.toContain(`{{${slot}}}`);
      }
    }
  });
});
