import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateComposition } from "@facet/core";
import type { FacetComposition } from "@facet/core";

const moduleUrl = new URL("./compositions.ts", import.meta.url);
const containerModuleUrl = new URL("./composition-containers.ts", import.meta.url);
const controlModuleUrl = new URL("./composition-controls.ts", import.meta.url);

// Legacy vocabulary is built at runtime so the removed tokens never appear as
// source literals (same idiom as theme.test.ts).
const legacyNaming = new RegExp(["st", "amp"].join(""), "i");
const legacyDefinitionsField = ["component", "Definitions"].join("");
const legacyTemplateMarker = new RegExp(
  [["\\{", "\\{"].join(""), "[A-Za-z_][A-Za-z0-9_-]*", ["\\}", "\\}"].join("")].join(""),
);
const legacySlotField = ["slo", "ts"].join("");
const legacyReferenceField = ["u", "se"].join("");

const EXPECTED_SECTION_NODES = {
  "section.root": {
    id: "section.root",
    type: "box",
    style: { gap: "md", pad: "lg", width: "full" },
    children: ["section.title", "section.body"],
  },
  "section.title": {
    id: "section.title",
    type: "text",
    value: "Section title",
    style: { color: "fg", size: "xl", weight: "bold" },
  },
  "section.body": {
    id: "section.body",
    type: "text",
    value: "Add focused content for this part of the page.",
    style: { color: "fg" },
  },
};

const EXPECTED_CARD_NODES = {
  "card.root": {
    id: "card.root",
    type: "box",
    style: {
      bg: "surface",
      border: true,
      gap: "sm",
      pad: "md",
      radius: "md",
      shadow: "sm",
    },
    children: ["card.header"],
  },
  "card.header": {
    id: "card.header",
    type: "box",
    style: { gap: "xs" },
    children: ["card.title", "card.body"],
  },
  "card.title": {
    id: "card.title",
    type: "text",
    value: "Quarterly planning",
    style: { color: "fg", size: "lg", weight: "bold" },
  },
  "card.body": {
    id: "card.body",
    type: "text",
    value: "Review goals, owners, and open decisions for the next release.",
    style: { color: "fg-muted" },
  },
};

const EXPECTED_EMPTY_STATE_NODES = {
  "empty-state.root": {
    id: "empty-state.root",
    type: "box",
    style: {
      bg: "surface",
      border: true,
      gap: "sm",
      pad: "lg",
      radius: "md",
      align: "center",
      width: "full",
    },
    children: ["empty-state.title", "empty-state.body", "empty-state.action"],
  },
  "empty-state.title": {
    id: "empty-state.title",
    type: "text",
    value: "No projects yet",
    style: { color: "fg", align: "center", size: "lg", weight: "bold" },
  },
  "empty-state.body": {
    id: "empty-state.body",
    type: "text",
    value: "Create your first project to start organizing this workspace.",
    style: { color: "fg-muted", align: "center" },
  },
  "empty-state.action": {
    id: "empty-state.action",
    type: "box",
    style: { bg: "accent", pad: "sm", radius: "md", shadow: "sm" },
    children: ["empty-state.action-label"],
    onPress: { kind: "agent", name: "create_item" },
  },
  "empty-state.action-label": {
    id: "empty-state.action-label",
    type: "text",
    value: "Create project",
    style: { color: "accent-fg", align: "center", weight: "semibold" },
  },
};

const collectKeys = (value: unknown): readonly string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectKeys(entry));
  }
  if (value === null || typeof value !== "object") {
    return [];
  }
  return Object.entries(value).flatMap(([key, entry]) => [key, ...collectKeys(entry)]);
};

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
  it("ships native section card and empty-state references", async () => {
    const defaults = await loadDefaults();
    expect(defaults).toHaveLength(27);

    for (const composition of defaults) {
      const { composition: validated, issues } = validateComposition(composition);
      expect(issues, composition.name).toEqual([]);
      expect(validated, composition.name).toEqual(composition);
      expect(["root", "box"], composition.name).toContain(composition.metadata.preferredParent);
    }

    const section = defaults.find((composition) => composition.name === "section");
    expect(section?.nodes).toEqual(EXPECTED_SECTION_NODES);

    const card = defaults.find((composition) => composition.name === "card");
    expect(card?.nodes).toEqual(EXPECTED_CARD_NODES);

    const emptyState = defaults.find((composition) => composition.name === "empty-state");
    expect(emptyState?.nodes).toEqual(EXPECTED_EMPTY_STATE_NODES);
    expect(emptyState?.nodes["empty-state.root"]).not.toHaveProperty("onPress");
    expect(emptyState?.nodes["empty-state.root"]).not.toHaveProperty("onHold");

    const retiredTypes = new Set([
      ["sec", "tion"].join(""),
      ["ca", "rd"].join(""),
      ["empty", "State"].join(""),
    ]);
    for (const composition of defaults) {
      for (const [id, node] of Object.entries(composition.nodes)) {
        expect(retiredTypes.has(node.type), `${composition.name}:${id}`).toBe(false);
      }
    }
  });

  it("ships concrete reference datasets", async () => {
    const defaults = await loadDefaults();
    expect(defaults).toHaveLength(27);
    for (const composition of defaults) {
      const { composition: validated, issues } = validateComposition(composition);
      expect(issues).toEqual([]);
      expect(validated).toEqual(composition);
      expect(validated?.root).toBe(composition.root);
      expect(composition.metadata.description.trim(), composition.name).not.toBe("");
      expect(
        Object.prototype.hasOwnProperty.call(composition, "description"),
        composition.name,
      ).toBe(false);
      expect(
        Object.prototype.hasOwnProperty.call(composition, legacySlotField),
        composition.name,
      ).toBe(false);

      const serialized = JSON.stringify(composition);
      expect(serialized, composition.name).not.toMatch(legacyTemplateMarker);
      for (const [id, node] of Object.entries(composition.nodes)) {
        expect(Object.prototype.hasOwnProperty.call(node, legacyReferenceField), id).toBe(false);
        expect(node.id, id).toBe(id);
      }
    }

    const pricing = defaults.find((composition) => composition.name === "pricing-section");
    const dashboard = defaults.find((composition) => composition.name === "dashboard-summary");
    expect(pricing?.nodes["pricing-section.enterprise-badge"]).toMatchObject({
      id: "pricing-section.enterprise-badge",
      type: "box",
    });
    expect(dashboard?.nodes["dashboard-summary.badge"]).toMatchObject({
      id: "dashboard-summary.badge",
      type: "box",
    });
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
      "section",
      "cta-button",
      "form",
      "fixed-filter",
      "metric",
      "tabs",
      "nav",
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
      expect(composition.metadata.category, composition.name).toBeDefined();
      expect(composition.metadata.useWhen, composition.name).toBeDefined();
      expect(composition.metadata.tags?.length, composition.name).toBeGreaterThan(0);
      expect(JSON.stringify(composition.metadata), composition.name).not.toContain('"nodes"');
    }
  });

  it("ships native control and navigation references", async () => {
    const defaults = await loadDefaults();
    const controls = new Map(
      defaults
        .filter((composition) =>
          ["cta-button", "form", "fixed-filter", "metric", "tabs", "nav"].includes(
            composition.name,
          ),
        )
        .map((composition) => [composition.name, composition] as const),
    );

    expect([...controls.keys()]).toEqual([
      "cta-button",
      "form",
      "fixed-filter",
      "metric",
      "tabs",
      "nav",
    ]);

    for (const [name, composition] of controls) {
      const { composition: validated, issues } = validateComposition(composition);
      expect(issues, name).toEqual([]);
      expect(validated, name).toEqual(composition);

      const keys = new Set(collectKeys(composition));
      for (const denied of [
        "html",
        "rawHtml",
        "innerHTML",
        "script",
        "javascript",
        "js",
        "css",
        "pixels",
        "px",
        "position",
        "absolute",
        "overlay",
        "zIndex",
        "z-index",
        "backend",
        "fetch",
        "fetchUrl",
        "endpoint",
        "url",
        "dataSource",
        "dataBinding",
        "binding",
        "bindings",
        "query",
        "queryExpr",
        "expression",
        "where",
        "predicate",
        "formula",
        "resolver",
        "onChange",
      ]) {
        expect(keys.has(denied), `${name}:${denied}`).toBe(false);
      }
    }

    const form = controls.get("form");
    expect(form?.root).toBe("form.root");
    expect(form?.nodes["form.root"]).toMatchObject({
      id: "form.root",
      type: "box",
      children: ["form.title", "form.email", "form.role", "form.submit"],
    });
    expect(Object.values(form?.nodes ?? {}).filter((node) => node.type === "input")).toHaveLength(
      2,
    );
    expect(form?.nodes["form.submit"]).toMatchObject({
      id: "form.submit",
      type: "box",
      children: ["form.submit-label"],
      onPress: { kind: "agent", name: "submit_form", collect: "form.root" },
    });
    const formActions = Object.values(form?.nodes ?? {}).flatMap((node) =>
      node.type === "box" && node.onPress?.kind === "agent" ? [node.onPress] : [],
    );
    expect(formActions).toEqual([{ kind: "agent", name: "submit_form", collect: "form.root" }]);

    const metric = controls.get("metric");
    expect(metric?.nodes["metric.value"]).toMatchObject({
      id: "metric.value",
      type: "text",
      from: "summary",
      column: "revenue",
      row: 0,
    });

    for (const name of ["fixed-filter", "tabs", "nav"] as const) {
      const composition = controls.get(name);
      expect(composition, name).toBeDefined();
      expect(
        Object.values(composition?.nodes ?? {}).every(
          (node) => node.type === "box" || node.type === "text",
        ),
        name,
      ).toBe(true);

      const pressable = Object.values(composition?.nodes ?? {}).filter(
        (node) => node.type === "box" && node.onPress !== undefined,
      );
      expect(pressable.length, name).toBeGreaterThan(1);
      for (const node of pressable) {
        if (node.type !== "box") continue;
        expect(node.onPress?.kind, `${name}:${node.id}`).toBe("navigate");
        if (node.onPress?.kind !== "navigate") continue;
        expect(node.active, `${name}:${node.id}`).toEqual({ screen: node.onPress.to });
        expect(node.activeVariant, `${name}:${node.id}`).toBe("selected");

        const labelId = node.children[0];
        const label = labelId === undefined ? undefined : composition?.nodes[labelId];
        expect(label, `${name}:${node.id}:label`).toMatchObject({
          type: "text",
          active: { screen: node.onPress.to },
          activeStyle: { color: "accent-fg" },
        });
        expect(label, `${name}:${node.id}:label`).not.toHaveProperty("activeVariant");
      }

      const serialized = JSON.stringify(composition);
      expect(serialized, name).not.toContain('"kind":"agent"');
      expect(serialized, name).not.toContain('"collect"');
      expect(composition?.metadata.followUpEdits?.join(" "), name).toMatch(/screen/i);
    }

    const rewrittenNodes = [
      ["hero", "hero.cta"],
      ["cta-button", "cta-button.root"],
      ["pricing-section", "pricing-section.starter-price"],
      ["pricing-section", "pricing-section.pro-price"],
      ["pricing-section", "pricing-section.cta"],
      ["dashboard-summary", "dashboard-summary.stat"],
      ["settings-panel", "settings-panel.save"],
      ["empty-state", "empty-state.action"],
      ["support-triage", "support-triage.submit"],
    ] as const;
    for (const [compositionName, nodeId] of rewrittenNodes) {
      const composition = defaults.find((candidate) => candidate.name === compositionName);
      expect(composition?.nodes[nodeId], `${compositionName}:${nodeId}`).toMatchObject({
        id: nodeId,
        type: "box",
      });
    }

    const retiredTypes = new Set(["button", "form", "filterBar", "metric", "tabs", "nav", "stat"]);
    for (const composition of defaults) {
      for (const [id, node] of Object.entries(composition.nodes)) {
        expect(retiredTypes.has(node.type), `${composition.name}:${id}`).toBe(false);
      }
    }
  });

  it("uses concrete example content and native-only authoring", async () => {
    const defaults = await loadDefaults();
    const serialized = JSON.stringify(defaults);
    expect(serialized).not.toContain(legacyDefinitionsField);
    expect(serialized).not.toMatch(legacyNaming);

    const source = [
      moduleUrl,
      containerModuleUrl,
      controlModuleUrl,
      new URL("./composition-chart-table.ts", import.meta.url),
    ]
      .map((url) => readFileSync(url, "utf8"))
      .join("\n");
    expect(source).not.toMatch(/\bfrom\s+["@'](?:node:|@facet\/(react|runtime|server|client))\b/);
    expect(source).not.toMatch(new RegExp(`\\b${legacyDefinitionsField}\\b`));
    expect(source).not.toMatch(legacyNaming);
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
      parts: {
        title: { text: { color: "info", weight: "bold" } },
        body: { text: { color: "fg" } },
      },
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
  it.each(badgeCases)(
    "%s bakes the merged badge tokens for its tone",
    async (name, tone, variant) => {
      const composition = await byName(name);
      const expected = badgeExpected(
        tone,
        variant === undefined ? undefined : badgeRecipes[variant],
      );
      expect(style(composition, `${name}.root`)).toEqual(expected.box);
      expect(style(composition, `${name}.label`)).toEqual(expected.label);
    },
  );

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

// DC-007: the two formerly nested badge examples are now ordinary native box +
// text structures, and no demoted display-leaf type survives in any dataset.
describe("no residual demoted display leaves (DC-007)", () => {
  const DEMOTED = new Set(["badge", "alert", "divider"]);

  it("inlines the two shipped badge examples as native structures", async () => {
    const defaults = await loadDefaults();
    const pricing = defaults.find((c) => c.name === "pricing-section");
    const dashboard = defaults.find((c) => c.name === "dashboard-summary");
    expect(pricing?.nodes["pricing-section.enterprise-badge"]).toMatchObject({
      id: "pricing-section.enterprise-badge",
      type: "box",
      children: ["pricing-section.enterprise-badge-label"],
    });
    expect(dashboard?.nodes["dashboard-summary.badge"]).toMatchObject({
      id: "dashboard-summary.badge",
      type: "box",
      children: ["dashboard-summary.badge-label"],
    });
  });

  it("leaves zero demoted node type in every native dataset", async () => {
    const defaults = await loadDefaults();
    for (const composition of defaults) {
      for (const [id, node] of Object.entries(composition.nodes)) {
        const type = (node as { type?: unknown }).type;
        expect(DEMOTED.has(String(type)), `${composition.name}:${id}`).toBe(false);
      }
    }
  });
});
