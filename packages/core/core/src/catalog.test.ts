import { describe, expect, it } from "vitest";
import * as catalogExports from "./catalog.js";
import {
  CATALOG_BRICK_TYPES,
  CATALOG_COMPONENT_TYPES,
  DEFAULT_CATALOG,
  validateCatalog,
  type CatalogComponent,
  type FacetCatalog,
} from "./catalog.js";

// Legacy vocabulary is built at runtime so the removed tokens never appear as
// source literals (same idiom as theme.test.ts).
const legacy = ["st", "amp"].join("");
const legacyPolicyField = `${legacy}s`;
const legacyOrderField = ["component", "Order"].join("");
const legacyDefinitionsField = ["component", "Definitions"].join("");

describe("catalog module boundary", () => {
  it("keeps the exact runtime export surface", () => {
    expect(Object.keys(catalogExports).sort()).toEqual([
      "CATALOG_BRICK_TYPES",
      "CATALOG_COMPONENT_TYPES",
      "DEFAULT_CATALOG",
      "validateCatalog",
    ]);
  });
});

describe("validateCatalog", () => {
  it("defaults missing catalog input to a locked safe catalog", () => {
    const { catalog, issues } = validateCatalog(undefined);

    expect(catalog).toEqual(DEFAULT_CATALOG);
    expect(catalog).not.toBe(DEFAULT_CATALOG);
    expect(issues).toHaveLength(0);
    expect(catalog.theme.switchPolicy).toBe("locked");
    expect(catalog.policy.order).toEqual(["component", "primitive"]);
    expect(catalog.components).toEqual(DEFAULT_CATALOG.components);
    expect(catalog.compositions).toEqual(DEFAULT_CATALOG.compositions);
  });

  it("reference exposure is separate from authoring order", () => {
    const { catalog, issues } = validateCatalog({
      name: "canonical",
      compositions: { mode: "allow", names: ["customerSummary"] },
      policy: {
        order: ["component", "primitive"],
        editBeforeAppend: true,
        compactScreens: true,
        maxScreenSections: 4,
      },
    });

    expect(issues).toEqual([]);
    expect(catalog.compositions).toEqual({ mode: "allow", names: ["customerSummary"] });
    expect(catalog.policy.order).toEqual(["component", "primitive"]);
    expect(legacyPolicyField in catalog).toBe(false);
    expect(legacyOrderField in catalog.policy).toBe(false);

    expect(legacyPolicyField in DEFAULT_CATALOG).toBe(false);
    expect(legacyOrderField in DEFAULT_CATALOG.policy).toBe(false);
    expect(DEFAULT_CATALOG.compositions).toEqual({ mode: "all" });
    expect(DEFAULT_CATALOG.policy.order).toEqual(["component", "primitive"]);
  });

  it("returns fresh fallback catalog objects so caller mutation cannot poison defaults", () => {
    const { catalog: first } = validateCatalog(undefined);
    (first.theme.allowed as string[]).push("mutated");
    (first.bricks as { type: FacetCatalog["bricks"][number]["type"] }[]).push({ type: "button" });
    (first.components as CatalogComponent[]).push({ type: "metric" });
    (first.compositions as { mode: "allow"; names: string[] }).names = ["mutated"];
    (first.policy.order as unknown as string[])[0] = "primitive";

    const { catalog: second } = validateCatalog(undefined);
    expect(second).toEqual(DEFAULT_CATALOG);
    expect(second.theme.allowed).toEqual(["default"]);
    expect(second.bricks).toHaveLength(DEFAULT_CATALOG.bricks.length);
    expect(second.components).toEqual(DEFAULT_CATALOG.components);
    expect(second.compositions).toEqual(DEFAULT_CATALOG.compositions);
    expect(second.policy.order).toEqual(["component", "primitive"]);
  });

  it("keeps valid catalog bricks, variants, compositions, and usage policy", () => {
    const { catalog, issues } = validateCatalog({
      name: "acme",
      description: "Acme UI policy",
      theme: {
        active: "acme-default",
        switchPolicy: "allowed",
        allowed: ["acme-default", "acme-dark"],
      },
      bricks: [
        { type: "section", variants: ["dashboard"], guidance: "Use as screen regions." },
        { type: "button", variants: ["primary", "secondary"] },
        { type: "box" },
      ],
      compositions: { mode: "allow", names: ["pricing", "dashboard-summary"] },
      primitiveFallback: "discouraged",
      policy: {
        order: ["component", "primitive"],
        editBeforeAppend: true,
        compactScreens: true,
        maxScreenSections: 6,
      },
    });

    expect(issues).toHaveLength(0);
    expect(catalog.name).toBe("acme");
    expect(catalog.theme).toEqual({
      active: "acme-default",
      switchPolicy: "allowed",
      allowed: ["acme-default", "acme-dark"],
    });
    expect(catalog.bricks).toEqual([
      { type: "section", variants: ["dashboard"], guidance: "Use as screen regions." },
      { type: "button", variants: ["primary", "secondary"] },
      { type: "box" },
    ]);
    expect(catalog.components).toEqual([
      { type: "section", variants: ["dashboard"], guidance: "Use as screen regions." },
      { type: "button", variants: ["primary", "secondary"] },
    ]);
    expect(catalog.compositions).toEqual({
      mode: "allow",
      names: ["pricing", "dashboard-summary"],
    });
    expect(catalog.primitiveFallback).toBe("discouraged");
    expect(catalog.policy.order).toEqual(["component", "primitive"]);
  });

  it("normalizes component-facing catalogs to the canonical shape", () => {
    const { catalog, issues } = validateCatalog({
      name: "component-catalog",
      theme: { active: "default", switchPolicy: "locked", allowed: ["default"] },
      components: [
        { type: "metric", variants: ["default", "success"], guidance: "Prefer metric." },
        { type: "keyValue", variants: ["default"] },
        { type: "stat", variants: ["success"], guidance: "Legacy metric alias." },
      ],
      compositions: { mode: "allow", names: ["customerSummary"] },
      primitiveFallback: "allowed",
      policy: {
        order: ["component", "primitive"],
        editBeforeAppend: true,
        compactScreens: true,
        maxScreenSections: 4,
      },
    });

    expect(issues).toEqual([]);
    expect(catalog.components).toEqual([
      { type: "metric", variants: ["default", "success"], guidance: "Prefer metric." },
      { type: "keyValue", variants: ["default"] },
      { type: "stat", variants: ["success"], guidance: "Legacy metric alias." },
    ]);
    expect(catalog.bricks).toEqual(catalog.components);
    expect(catalog.compositions).toEqual({ mode: "allow", names: ["customerSummary"] });
    expect(catalog.policy.order).toEqual(["component", "primitive"]);
  });

  it(`ignores legacy ${legacy} and order fields when normalizing policy`, () => {
    const { catalog, issues } = validateCatalog({
      name: "legacy-catalog",
      bricks: [
        { type: "stat", variants: ["success"], guidance: "Old KPI component." },
        { type: "box" },
      ],
      [legacyPolicyField]: { mode: "allow", names: ["legacy-card"] },
      compositions: { mode: "allow", names: ["pricing"] },
      primitiveFallback: "discouraged",
      policy: {
        order: [legacy, "brick", "primitive"],
        [legacyOrderField]: ["component", "primitive"],
        editBeforeAppend: false,
        compactScreens: false,
        maxScreenSections: 2,
      },
    });

    expect(catalog.bricks).toEqual([
      { type: "stat", variants: ["success"], guidance: "Old KPI component." },
      { type: "box" },
    ]);
    expect(catalog.compositions).toEqual({ mode: "allow", names: ["pricing"] });
    expect(catalog.policy.order).toEqual(["component", "primitive"]);
    expect(catalog.policy.editBeforeAppend).toBe(false);
    expect(catalog.policy.compactScreens).toBe(false);
    expect(catalog.policy.maxScreenSections).toBe(2);
    expect(legacyPolicyField in catalog).toBe(false);
    expect(legacyOrderField in catalog.policy).toBe(false);
    expect(issues).toContain("catalog policy: invalid order defaulted to component > primitive");
  });

  it(`never lets a legacy ${legacyPolicyField} policy shape the normalized compositions policy`, () => {
    const { catalog } = validateCatalog({
      name: `${legacyPolicyField}-only`,
      [legacyPolicyField]: { mode: "allow", names: ["legacy-card"] },
    });

    expect(catalog.compositions).toEqual({ mode: "all" });
    expect(legacyPolicyField in catalog).toBe(false);
  });

  it("drops malformed entries with bounded issues instead of throwing", () => {
    const { catalog, issues } = validateCatalog({
      name: "bad name",
      theme: {
        active: "has space",
        switchPolicy: "sometimes",
        allowed: ["ok", "has space", 123],
      },
      bricks: [{ type: "script" }, { type: "button", variants: ["primary", "bad variant", 123] }],
      components: [
        { type: "box" },
        { type: "timeline" },
        { type: "metric", variants: ["default"] },
      ],
      [legacyPolicyField]: { mode: "allow", names: ["pricing", "bad name", 123] },
      compositions: { mode: "allow", names: ["summary", "bad name", 123] },
      primitiveFallback: "maybe",
      policy: {
        order: ["primitive", legacy],
        [legacyOrderField]: ["primitive", "component"],
        editBeforeAppend: "yes",
        compactScreens: "no",
        maxScreenSections: 9999,
      },
    });

    expect(catalog.name).toBe(DEFAULT_CATALOG.name);
    expect(catalog.theme.switchPolicy).toBe("locked");
    expect(catalog.theme.active).toBeUndefined();
    expect(catalog.theme.allowed).toEqual(["ok"]);
    expect(catalog.bricks).toEqual([{ type: "button", variants: ["primary"] }]);
    expect(catalog.components).toEqual([{ type: "metric", variants: ["default"] }]);
    expect(catalog.compositions).toEqual({ mode: "allow", names: ["summary"] });
    expect(catalog.primitiveFallback).toBe(DEFAULT_CATALOG.primitiveFallback);
    expect(catalog.policy.order).toEqual(["component", "primitive"]);
    expect(catalog.policy.maxScreenSections).toBe(DEFAULT_CATALOG.policy.maxScreenSections);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join("\n")).not.toContain("bad name".repeat(100));
  });

  it("fails closed to an empty restriction when a provided variant list has no valid entries", () => {
    const { catalog, issues } = validateCatalog({
      name: "acme",
      bricks: [{ type: "button", variants: ["Bad Variant!", 123] }],
    });

    // Not undefined (which downstream reads as unrestricted / allow-anything) —
    // an empty restriction that allows nothing.
    expect(catalog.bricks).toEqual([{ type: "button", variants: [] }]);
    const button = catalog.bricks.find((brick) => brick.type === "button");
    expect(button?.variants).not.toBeUndefined();
    expect(issues.join("\n")).toContain(
      "catalog bricks.button.variants: no valid entries — restriction kept empty",
    );
  });

  it("keeps an explicitly empty variant list empty rather than unrestricted", () => {
    const { catalog, issues } = validateCatalog({
      name: "acme",
      bricks: [{ type: "button", variants: [] }],
    });

    expect(catalog.bricks).toEqual([{ type: "button", variants: [] }]);
    expect(issues.join("\n")).toContain(
      "catalog bricks.button.variants: no valid entries — restriction kept empty",
    );
  });

  it("fails closed to an empty theme allow-list when every entry is invalid", () => {
    const { catalog, issues } = validateCatalog({
      name: "acme",
      theme: { switchPolicy: "allowed", allowed: ["has space", 123] },
    });

    expect(catalog.theme.allowed).toEqual([]);
    expect(catalog.theme.allowed).not.toBeUndefined();
    expect(issues.join("\n")).toContain(
      "catalog theme.allowed: no valid entries — restriction kept empty",
    );
  });

  it("fails closed when a provided components list is explicitly empty", () => {
    const { catalog, issues } = validateCatalog({ name: "acme", components: [] });

    // A provided-but-empty restriction allows nothing — never the permissive
    // default component set.
    expect(catalog.components).toEqual([]);
    expect(catalog.bricks).toEqual([]);
    expect(issues.join("\n")).toContain(
      "catalog components: provided restriction list validated to empty; no catalog components allowed (primitives follow primitiveFallback)",
    );
  });

  it("fails closed when a provided bricks list validates to empty (all invalid)", () => {
    const { catalog, issues } = validateCatalog({
      name: "acme",
      bricks: [{ type: "not-a-real-brick" }],
    });

    expect(catalog.bricks).toEqual([]);
    expect(issues.join("\n")).toContain(
      "catalog bricks: provided restriction list validated to empty; no catalog bricks allowed (primitives follow primitiveFallback)",
    );
  });

  it("falls back to the default vocabulary only when bricks/components are absent", () => {
    const { catalog, issues } = validateCatalog({ name: "acme" });

    expect(catalog.bricks).toEqual(DEFAULT_CATALOG.bricks);
    expect(catalog.components).toEqual(DEFAULT_CATALOG.components);
    expect(issues.join("\n")).not.toContain("provided restriction list validated to empty");
  });

  it("leaves an absent variant/allowed field unrestricted (undefined)", () => {
    const { catalog, issues } = validateCatalog({
      name: "acme",
      theme: { switchPolicy: "allowed" },
      bricks: [{ type: "button" }],
    });

    expect(catalog.theme.allowed).toBeUndefined();
    const button = catalog.bricks.find((brick) => brick.type === "button");
    expect(button?.variants).toBeUndefined();
    expect(issues.join("\n")).not.toContain("no valid entries");
  });

  it("fails closed when a provided compositions policy has an invalid mode", () => {
    const { catalog, issues } = validateCatalog({
      name: "bad-compositions",
      compositions: { mode: "deny", names: ["pricing"] },
    });

    expect(catalog.compositions).toEqual({ mode: "allow", names: [] });
    expect(issues.join("\n")).toContain("catalog compositions: invalid mode");
    expect(issues.join("\n")).toContain("restriction kept empty");
  });

  it("fails closed when a provided bricks restriction is not an array", () => {
    const { catalog, issues } = validateCatalog({
      name: "acme",
      bricks: { section: {} } as unknown as FacetCatalog["bricks"],
    });

    // Provided-but-mistyped must not silently reopen the full default vocabulary.
    expect(catalog.bricks).toEqual([]);
    expect(catalog.components).toEqual([]);
    expect(issues.join("\n")).toContain(
      "catalog bricks: expected an array; restriction kept empty (primitives follow primitiveFallback)",
    );
  });

  it("fails closed when a provided components restriction is not an array", () => {
    const { catalog, issues } = validateCatalog({
      name: "acme",
      components: "metric" as unknown as FacetCatalog["components"],
    });

    expect(catalog.components).toEqual([]);
    expect(catalog.bricks).toEqual([]);
    expect(issues.join("\n")).toContain(
      "catalog components: expected an array; restriction kept empty (primitives follow primitiveFallback)",
    );
  });

  it("fails closed when a provided compositions policy is not an object", () => {
    const { catalog, issues } = validateCatalog({
      name: "acme",
      compositions: ["pricing"] as unknown as FacetCatalog["compositions"],
    });

    expect(catalog.compositions).toEqual({ mode: "allow", names: [] });
    expect(issues.join("\n")).toContain(
      "catalog compositions: expected a policy object; restriction kept empty",
    );
  });

  it("fails closed when a provided theme allow-list is not an array", () => {
    const { catalog, issues } = validateCatalog({
      name: "acme",
      theme: { switchPolicy: "allowed", allowed: "dark" as unknown as readonly string[] },
    });

    expect(catalog.theme.allowed).toEqual([]);
    expect(catalog.theme.allowed).not.toBeUndefined();
    expect(issues.join("\n")).toContain(
      "catalog theme.allowed: expected an array of names; restriction kept empty",
    );
  });

  it("diagnoses an allow-mode compositions policy whose names are missing", () => {
    const { catalog, issues } = validateCatalog({
      name: "acme",
      compositions: { mode: "allow" } as unknown as FacetCatalog["compositions"],
    });

    expect(catalog.compositions).toEqual({ mode: "allow", names: [] });
    expect(issues.join("\n")).toContain(
      "catalog compositions.names: no valid entries — restriction kept empty",
    );
  });

  it("fails closed when an allow-mode compositions names field is not an array", () => {
    const { catalog, issues } = validateCatalog({
      name: "acme",
      compositions: {
        mode: "allow",
        names: "pricing",
      } as unknown as FacetCatalog["compositions"],
    });

    expect(catalog.compositions).toEqual({ mode: "allow", names: [] });
    expect(issues.join("\n")).toContain(
      "catalog compositions.names: expected an array of names; restriction kept empty",
    );
  });

  it("keeps an absent compositions policy at the allow-all default with no issue", () => {
    const { catalog, issues } = validateCatalog({ name: "acme" });

    expect(catalog.compositions).toEqual({ mode: "all" });
    expect(issues.join("\n")).not.toContain("compositions");
  });

  it("never throws on hostile catalog property getters", () => {
    const run = validateCatalog({
      name: "hostile",
      get theme(): unknown {
        throw new Error("boom");
      },
    });

    expect(run.catalog).toEqual(DEFAULT_CATALOG);
    expect(run.catalog).not.toBe(DEFAULT_CATALOG);
    expect(run.issues).toContain("catalog could not be read safely; default catalog used");
  });

  it("advertises the richtext primitive brick with guidance in the default catalog", () => {
    const richtext = DEFAULT_CATALOG.bricks.find((brick) => brick.type === "richtext");
    expect(richtext, "richtext brick advertised in default catalog").toBeDefined();
    expect(typeof richtext?.guidance).toBe("string");
    expect(richtext?.guidance).toBeTruthy();
    // Stays in lockstep with the closed brick-set widened by WU-1.
    expect(CATALOG_BRICK_TYPES).toContain("richtext");
  });

  it("includes every v1 brick type in the default catalog", () => {
    const types = new Set<string>(DEFAULT_CATALOG.bricks.map((brick) => brick.type));
    // "search" is retired from the catalog by the input consolidation (its type
    // leaves CATALOG_BRICK_TYPES in WU-2); the default catalog covers all others.
    for (const type of CATALOG_BRICK_TYPES as readonly string[]) {
      if (type === "search") continue;
      expect(types.has(type), type).toBe(true);
    }
    expect(types.has("search")).toBe(false);
  });

  it("exposes every intrinsic component in the default component catalog", () => {
    const defaultComponents = DEFAULT_CATALOG.components ?? [];
    const types = new Set<string>(defaultComponents.map((component) => component.type));
    // "search" is retired from the catalog (its type leaves CATALOG_COMPONENT_TYPES in WU-2).
    for (const type of CATALOG_COMPONENT_TYPES as readonly string[]) {
      if (type === "search") continue;
      expect(types.has(type), type).toBe(true);
    }
    expect(types.has("search")).toBe(false);
    expect(types.has("stat")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(DEFAULT_CATALOG, legacyDefinitionsField)).toBe(
      false,
    );
  });

  it("does not advertise demoted display leaves", () => {
    // badge/alert/divider are demoted to DEFAULT_COMPOSITIONS (WU-1) and removed
    // from the node vocabulary (WU-2); the default catalog must no longer
    // advertise them as intrinsic components or bricks.
    const demoted = ["badge", "alert", "divider"];
    const componentTypes = new Set((DEFAULT_CATALOG.components ?? []).map((c) => c.type));
    const brickTypes = new Set(DEFAULT_CATALOG.bricks.map((b) => b.type));
    for (const type of demoted) {
      expect(componentTypes.has(type as CatalogComponent["type"]), `component ${type}`).toBe(false);
      expect(brickTypes.has(type as FacetCatalog["bricks"][number]["type"]), `brick ${type}`).toBe(
        false,
      );
    }
    // Roster shrinks by exactly the three demoted leaves (18 -> 15 intrinsic
    // components in DEFAULT_CATALOG.components).
    expect(DEFAULT_CATALOG.components).toHaveLength(15);
  });

  it("keeps the component default catalog compact with recipe-backed variants", () => {
    const variants = Object.fromEntries(
      DEFAULT_CATALOG.bricks.map((brick) => [brick.type, brick.variants ?? []]),
    );

    // The default catalog covers every catalog brick type EXCEPT the retired
    // `search` node (its type leaves CATALOG_BRICK_TYPES in WU-2). Cast so the
    // "search" filter stays legal once the literal is gone from the type.
    expect(DEFAULT_CATALOG.bricks.length).toBe(
      (CATALOG_BRICK_TYPES as readonly string[]).filter((t) => t !== "search").length,
    );
    expect(variants).toEqual({
      box: [],
      text: [],
      media: ["default", "hero"],
      input: ["default"],
      richtext: [],
      button: ["primary", "secondary", "danger"],
      section: ["default", "surface"],
      card: ["default", "interactive"],
      tabs: ["default"],
      nav: ["default"],
      table: ["default"],
      chart: ["default"],
      metric: ["default", "success"],
      keyValue: ["default"],
      stat: ["default", "success"],
      progress: ["default", "success"],
      list: ["default", "compact"],
      form: ["default"],
      filterBar: ["default"],
      emptyState: ["default"],
      loading: ["default"],
    });

    const { catalog, issues } = validateCatalog({ name: "minimal-component-default" });
    expect(issues).toEqual([]);
    expect(catalog.bricks).toEqual(DEFAULT_CATALOG.bricks);
    expect(catalog.policy).toEqual({
      order: ["component", "primitive"],
      editBeforeAppend: true,
      compactScreens: true,
      maxScreenSections: 6,
    });
  });

  it("returns a catalog typed as FacetCatalog", () => {
    const { catalog } = validateCatalog({ name: "typed" });
    const typed: FacetCatalog = catalog;
    expect(typed.name).toBe("typed");
  });
});
