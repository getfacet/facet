import { describe, expect, it } from "vitest";
import {
  CATALOG_BRICK_TYPES,
  CATALOG_COMPONENT_TYPES,
  DEFAULT_CATALOG,
  validateCatalog,
  type CatalogComponent,
  type FacetCatalog,
} from "./catalog.js";

describe("validateCatalog", () => {
  it("defaults missing catalog input to a locked safe catalog", () => {
    const { catalog, issues } = validateCatalog(undefined);

    expect(catalog).toEqual(DEFAULT_CATALOG);
    expect(catalog).not.toBe(DEFAULT_CATALOG);
    expect(issues).toHaveLength(0);
    expect(catalog.theme.switchPolicy).toBe("locked");
    expect(catalog.policy.order).toEqual(["stamp", "brick", "primitive"]);
    expect(catalog.policy.componentOrder).toEqual(["composition", "component", "primitive"]);
    expect(catalog.components).toEqual(DEFAULT_CATALOG.components);
    expect(catalog.compositions).toEqual(DEFAULT_CATALOG.compositions);
  });

  it("returns fresh fallback catalog objects so caller mutation cannot poison defaults", () => {
    const { catalog: first } = validateCatalog(undefined);
    (first.theme.allowed as string[]).push("mutated");
    (first.bricks as { type: FacetCatalog["bricks"][number]["type"] }[]).push({ type: "button" });
    (first.components as CatalogComponent[]).push({ type: "metric" });
    (first.compositions as { mode: "allow"; names: string[] }).names = ["mutated"];
    (first.policy.order as unknown as string[])[0] = "primitive";
    (first.policy.componentOrder as unknown as string[])[0] = "primitive";

    const { catalog: second } = validateCatalog(undefined);
    expect(second).toEqual(DEFAULT_CATALOG);
    expect(second.theme.allowed).toEqual(["default"]);
    expect(second.bricks).toHaveLength(DEFAULT_CATALOG.bricks.length);
    expect(second.components).toEqual(DEFAULT_CATALOG.components);
    expect(second.compositions).toEqual(DEFAULT_CATALOG.compositions);
    expect(second.policy.order).toEqual(["stamp", "brick", "primitive"]);
    expect(second.policy.componentOrder).toEqual(["composition", "component", "primitive"]);
  });

  it("keeps valid catalog bricks, variants, stamps, and usage policy", () => {
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
      stamps: { mode: "allow", names: ["pricing", "dashboard-summary"] },
      primitiveFallback: "discouraged",
      policy: {
        order: ["stamp", "brick", "primitive"],
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
    expect(catalog.stamps).toEqual({ mode: "allow", names: ["pricing", "dashboard-summary"] });
    expect(catalog.compositions).toEqual({
      mode: "allow",
      names: ["pricing", "dashboard-summary"],
    });
    expect(catalog.primitiveFallback).toBe("discouraged");
    expect(catalog.policy.componentOrder).toEqual(["composition", "component", "primitive"]);
  });

  it("normalizes component-facing aliases while preserving legacy catalog fields", () => {
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
        order: ["composition", "component", "primitive"],
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
    expect(catalog.stamps).toEqual({ mode: "allow", names: ["customerSummary"] });
    expect(catalog.policy.order).toEqual(["stamp", "brick", "primitive"]);
    expect(catalog.policy.componentOrder).toEqual(["composition", "component", "primitive"]);
  });

  it("keeps old brick, stamp, and policy order catalogs valid public API", () => {
    const { catalog, issues } = validateCatalog({
      name: "legacy-catalog",
      bricks: [
        { type: "stat", variants: ["success"], guidance: "Old KPI component." },
        { type: "box" },
      ],
      stamps: { mode: "allow", names: ["legacy-card"] },
      primitiveFallback: "discouraged",
      policy: {
        order: ["stamp", "brick", "primitive"],
        editBeforeAppend: false,
        compactScreens: false,
        maxScreenSections: 2,
      },
    });

    expect(issues).toEqual([]);
    expect(catalog.bricks).toEqual([
      { type: "stat", variants: ["success"], guidance: "Old KPI component." },
      { type: "box" },
    ]);
    expect(catalog.components).toEqual([
      { type: "stat", variants: ["success"], guidance: "Old KPI component." },
    ]);
    expect(catalog.stamps).toEqual({ mode: "allow", names: ["legacy-card"] });
    expect(catalog.compositions).toEqual({ mode: "allow", names: ["legacy-card"] });
    expect(catalog.policy.order).toEqual(["stamp", "brick", "primitive"]);
    expect(catalog.policy.componentOrder).toEqual(["composition", "component", "primitive"]);
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
      stamps: { mode: "allow", names: ["pricing", "bad name", 123] },
      compositions: { mode: "allow", names: ["summary", "bad name", 123] },
      primitiveFallback: "maybe",
      policy: {
        order: ["primitive", "stamp"],
        componentOrder: ["primitive", "component"],
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
    expect(catalog.stamps).toEqual({ mode: "allow", names: ["pricing"] });
    expect(catalog.compositions).toEqual({ mode: "allow", names: ["summary"] });
    expect(catalog.primitiveFallback).toBe(DEFAULT_CATALOG.primitiveFallback);
    expect(catalog.policy.maxScreenSections).toBe(DEFAULT_CATALOG.policy.maxScreenSections);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join("\n")).not.toContain("bad name".repeat(100));
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

  it("includes every v1 brick type in the default catalog", () => {
    const types = new Set(DEFAULT_CATALOG.bricks.map((brick) => brick.type));
    for (const type of CATALOG_BRICK_TYPES) {
      expect(types.has(type), type).toBe(true);
    }
  });

  it("exposes every intrinsic component in the default component catalog", () => {
    const defaultComponents = DEFAULT_CATALOG.components ?? [];
    const types = new Set(defaultComponents.map((component) => component.type));
    for (const type of CATALOG_COMPONENT_TYPES) {
      expect(types.has(type), type).toBe(true);
    }
    expect(types.has("stat")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(DEFAULT_CATALOG, "componentDefinitions")).toBe(
      false,
    );
  });

  it("keeps the component default catalog compact with recipe-backed variants", () => {
    const variants = Object.fromEntries(
      DEFAULT_CATALOG.bricks.map((brick) => [brick.type, brick.variants ?? []]),
    );

    expect(DEFAULT_CATALOG.bricks).toHaveLength(CATALOG_BRICK_TYPES.length);
    expect(variants).toEqual({
      box: [],
      text: [],
      media: ["default", "hero"],
      field: ["default"],
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
      badge: ["neutral", "success", "warning", "danger"],
      progress: ["default", "success"],
      alert: ["info", "success", "warning", "danger"],
      list: ["default", "compact"],
      divider: ["default"],
      form: ["default"],
      search: ["default"],
      filterBar: ["default"],
      emptyState: ["default"],
      loading: ["default"],
    });

    const { catalog, issues } = validateCatalog({ name: "minimal-component-default" });
    expect(issues).toEqual([]);
    expect(catalog.bricks).toEqual(DEFAULT_CATALOG.bricks);
    expect(catalog.policy).toEqual({
      order: ["stamp", "brick", "primitive"],
      componentOrder: ["composition", "component", "primitive"],
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
