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
  it("ships exactly 21 defaults that pass validateComposition with zero error issues", async () => {
    const defaults = await loadDefaults();
    expect(defaults).toHaveLength(21);
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
      Object.values(composition.nodes).map((node) => ("type" in node ? node.type : undefined)),
    );
    const legacyStatNodes = defaults.flatMap((composition) =>
      Object.entries(composition.nodes)
        .filter(([, node]) => "type" in node && node.type === "stat")
        .map(([id, node]) => ({ id, composition: composition.name, node })),
    );

    expect(nodeTypes).toContain("metric");
    expect(legacyStatNodes.map(({ id, composition }) => `${composition}:${id}`)).toEqual([
      "dashboard-summary:dashboard-summary.stat",
    ]);
    expect(JSON.stringify(legacyStatNodes[0]?.node)).toContain("{{metric}}");
    expect(serialized).not.toContain(legacyDefinitionsField);
    expect(serialized).not.toMatch(legacyNaming);

    const source = [moduleUrl, new URL("./composition-chart-table.ts", import.meta.url)]
      .map((url) => readFileSync(url, "utf8"))
      .join("\n");
    expect(source).not.toMatch(/\bfrom\s+["@'](?:node:|@facet\/(react|runtime|server|client))\b/);
    expect(source).not.toMatch(new RegExp(`\\b${legacyDefinitionsField}\\b`));
    expect(source).not.toMatch(legacyNaming);
  });

  it("declares slots with whole-value markers and each composition is fillable", async () => {
    const defaults = await loadDefaults();
    for (const composition of defaults) {
      expect(Object.keys(composition.slots ?? {}), composition.name).not.toEqual([]);
      const serialized = JSON.stringify(composition.nodes);
      for (const slot of Object.keys(composition.slots ?? {})) {
        expect(serialized, `${composition.name}:${slot}`).toContain(`{{${slot}}}`);
      }

      const params = Object.fromEntries(
        Object.keys(composition.slots ?? {}).map((slot) => [slot, `filled:${slot}`]),
      );
      let i = 0;
      // The registry resolves the PR-5.0 nested `{ use }` badge embeds (pricing /
      // dashboard) so expansion carries no dropped-reference issue.
      const expanded = expandComposition(
        composition,
        params,
        { parent: "root" },
        {
          existingIds: new Set(["root"]),
          mintId: () => `${composition.name}.fresh.${String(i++)}`,
          compositions: defaults,
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

// DC-001 / RISK-INV-2: the demoted badge/alert display leaves become per-tone
// compositions that must render PIXEL-IDENTICALLY to the removed component for
// their tone. Each composition BAKES the fully-resolved tokens; this oracle
// INDEPENDENTLY reproduces the exact three-layer merge the renderer performed —
// `rendererDefault(tone)` (tone-conditional) → `recipe.box/text` (theme.ts) →
// `recipe.parts` (a part's text wins over the recipe text). A hand-typo in a
// baked token is caught because the expected value is derived by re-merging, not
// copied from the composition.
describe("per-tone parity (DC-001)", () => {
  type Tokens = Record<string, unknown>;
  interface OracleRecipe {
    readonly box?: Tokens;
    readonly text?: Tokens;
    readonly parts?: Readonly<Record<string, { readonly text?: Tokens; readonly box?: Tokens }>>;
  }
  const merge = (...layers: ReadonlyArray<Tokens | undefined>): Tokens =>
    Object.assign({}, ...layers.map((l) => l ?? {}));

  // --- badge: renderer defaults (brick-renderer-data.tsx renderBadge) ---------
  const badgeDefaultBox = (tone: string): Tokens => ({
    direction: "row",
    pad: "xs",
    radius: "full",
    bg: tone === "success" ? "success" : "surface-2",
  });
  const badgeDefaultText = (tone: string): Tokens => ({
    color: tone === "success" ? "accent-fg" : "fg",
    size: "sm",
    weight: "semibold",
  });
  // badge recipes (theme.ts badge recipeVariants). No "info"/base variant → the
  // base badge (which the enterprise embed carried at tone "info") resolves to an
  // EMPTY recipe, so it keeps only the renderer defaults.
  const badgeRecipes: Readonly<Record<string, OracleRecipe>> = {
    neutral: {
      box: { bg: "surface-2", pad: "xs", radius: "full" },
      text: { color: "neutral", size: "xs", weight: "semibold" },
      parts: { label: { text: { color: "neutral", size: "xs", weight: "semibold" } } },
    },
    success: {
      box: { bg: "surface", border: true, pad: "xs", radius: "full" },
      text: { color: "success", size: "xs", weight: "semibold" },
      parts: { label: { text: { color: "success", size: "xs", weight: "semibold" } } },
    },
    warning: {
      box: { bg: "surface", border: true, pad: "xs", radius: "full" },
      text: { color: "warning", size: "xs", weight: "semibold" },
      parts: { label: { text: { color: "warning", size: "xs", weight: "semibold" } } },
    },
    danger: {
      box: { bg: "surface", border: true, pad: "xs", radius: "full" },
      text: { color: "danger", size: "xs", weight: "semibold" },
      parts: { label: { text: { color: "danger", size: "xs", weight: "semibold" } } },
    },
  };
  const badgeExpected = (
    tone: string,
    recipe: OracleRecipe | undefined,
  ): { box: Tokens; label: Tokens } => ({
    box: merge(badgeDefaultBox(tone), recipe?.box),
    label: merge(badgeDefaultText(tone), recipe?.text, recipe?.parts?.label?.text),
  });

  // --- alert: renderer defaults (brick-renderer-data.tsx renderAlert) ---------
  const alertDefaultBox: Tokens = {
    gap: "xs",
    pad: "md",
    bg: "surface",
    border: true,
    radius: "md",
  };
  const alertDefaultTitle: Tokens = { weight: "bold" };
  const alertDefaultBody: Tokens = {};
  // alert recipes (theme.ts alert recipeVariants). No base variant → the base
  // alert resolves to an EMPTY recipe.
  const alertBox = { bg: "surface", border: true, gap: "sm", pad: "md", radius: "md" } as const;
  const alertRecipes: Readonly<Record<string, OracleRecipe>> = {
    info: {
      box: alertBox,
      text: { color: "info" },
      parts: { title: { text: { color: "info", weight: "bold" } }, body: { text: { color: "fg" } } },
    },
    success: {
      box: alertBox,
      text: { color: "success" },
      parts: {
        title: { text: { color: "success", weight: "bold" } },
        body: { text: { color: "fg" } },
      },
    },
    warning: {
      box: alertBox,
      text: { color: "warning" },
      parts: {
        title: { text: { color: "warning", weight: "bold" } },
        body: { text: { color: "fg" } },
      },
    },
    danger: {
      box: alertBox,
      text: { color: "danger" },
      parts: {
        title: { text: { color: "danger", weight: "bold" } },
        body: { text: { color: "fg" } },
      },
    },
  };
  const alertExpected = (
    recipe: OracleRecipe | undefined,
  ): { box: Tokens; title: Tokens; body: Tokens } => ({
    box: merge(alertDefaultBox, recipe?.box),
    title: merge(alertDefaultTitle, recipe?.text, recipe?.parts?.title?.text),
    body: merge(alertDefaultBody, recipe?.text, recipe?.parts?.body?.text),
  });

  const byName = async (name: string): Promise<FacetComposition> => {
    const composition = (await loadDefaults()).find((c) => c.name === name);
    expect(composition, `${name} composition must exist`).toBeDefined();
    return composition as FacetComposition;
  };
  const style = (composition: FacetComposition, id: string): Tokens => {
    const node = composition.nodes[id];
    expect(node, `${composition.name} node ${id}`).toBeDefined();
    return (node as { style?: Tokens }).style ?? {};
  };

  // name → the tone whose renderer output it reproduces (base carries no variant).
  const badgeCases: ReadonlyArray<[name: string, tone: string, variant: string | undefined]> = [
    ["badge", "info", undefined],
    ["badge-neutral", "neutral", "neutral"],
    ["badge-success", "success", "success"],
    ["badge-warning", "warning", "warning"],
    ["badge-danger", "danger", "danger"],
  ];
  it.each(badgeCases)("%s bakes the merged badge tokens for its tone", async (name, tone, variant) => {
    const composition = await byName(name);
    const expected = badgeExpected(tone, variant === undefined ? undefined : badgeRecipes[variant]);
    expect(style(composition, `${name}.root`)).toEqual(expected.box);
    expect(style(composition, `${name}.label`)).toEqual(expected.label);
  });

  const alertCases: ReadonlyArray<[name: string, variant: string | undefined]> = [
    ["alert", undefined],
    ["alert-info", "info"],
    ["alert-success", "success"],
    ["alert-warning", "warning"],
    ["alert-danger", "danger"],
  ];
  it.each(alertCases)("%s bakes the merged alert tokens for its tone", async (name, variant) => {
    const composition = await byName(name);
    const expected = alertExpected(variant === undefined ? undefined : alertRecipes[variant]);
    expect(style(composition, `${name}.root`)).toEqual(expected.box);
    expect(style(composition, `${name}.title`)).toEqual(expected.title);
    expect(style(composition, `${name}.body`)).toEqual(expected.body);
  });

  // The badge-success label color is `success` (via parts), NOT the renderer
  // default `accent-fg` — the explicit RISK-INV-2 precedence drift trap.
  it("resolves the badge-success drift trap: label color is success, not accent-fg", async () => {
    const composition = await byName("badge-success");
    expect(style(composition, "badge-success.label").color).toBe("success");
    expect(style(composition, "badge-success.root").bg).toBe("surface");
  });
});

// DC-004: the two shipped embeds are rewired to PR-5.0 `{ use }` nesting and no
// `type: "badge"` (or alert/divider) primitive survives full expansion of any
// default composition.
describe("no residual demoted display leaves (DC-004)", () => {
  const DEMOTED = new Set(["badge", "alert", "divider"]);

  it("rewires the two shipped embeds to { use } references", async () => {
    const defaults = await loadDefaults();
    const pricing = defaults.find((c) => c.name === "pricing-section");
    const dashboard = defaults.find((c) => c.name === "dashboard-summary");
    expect(pricing?.nodes["pricing-section.enterprise-badge"]).toMatchObject({ use: "badge" });
    expect(dashboard?.nodes["dashboard-summary.badge"]).toMatchObject({ use: "badge-success" });
  });

  it("leaves zero demoted primitive after full expansion of every default", async () => {
    const defaults = await loadDefaults();
    // No demoted type authored anywhere in the raw node maps.
    for (const composition of defaults) {
      for (const [id, node] of Object.entries(composition.nodes)) {
        const type = (node as { type?: unknown }).type;
        expect(DEMOTED.has(String(type)), `${composition.name}:${id}`).toBe(false);
      }
    }
    // And after expansion (resolving nested { use } refs) the produced primitive
    // graph is likewise free of any demoted type.
    for (const composition of defaults) {
      const params = Object.fromEntries(
        Object.keys(composition.slots ?? {}).map((slot) => [slot, `x`]),
      );
      let i = 0;
      const expanded = expandComposition(
        composition,
        params,
        { parent: "root" },
        {
          existingIds: new Set(["root"]),
          mintId: () => `${composition.name}.x.${String(i++)}`,
          compositions: defaults,
        },
      );
      for (const node of Object.values(expanded.nodes)) {
        expect(DEMOTED.has(String((node as { type?: unknown }).type)), composition.name).toBe(false);
      }
    }
  });
});
