import { describe, expect, it } from "vitest";
import {
  CATALOG_BRICK_TYPES,
  DEFAULT_CATALOG,
  validateCatalog,
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
  });

  it("returns fresh fallback catalog objects so caller mutation cannot poison defaults", () => {
    const { catalog: first } = validateCatalog(undefined);
    (first.theme.allowed as string[]).push("mutated");
    (first.bricks as { type: FacetCatalog["bricks"][number]["type"] }[]).push({ type: "button" });
    (first.policy.order as unknown as string[])[0] = "primitive";

    const { catalog: second } = validateCatalog(undefined);
    expect(second).toEqual(DEFAULT_CATALOG);
    expect(second.theme.allowed).toEqual(["default"]);
    expect(second.bricks).toHaveLength(DEFAULT_CATALOG.bricks.length);
    expect(second.policy.order).toEqual(["stamp", "brick", "primitive"]);
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
    expect(catalog.stamps).toEqual({ mode: "allow", names: ["pricing", "dashboard-summary"] });
    expect(catalog.primitiveFallback).toBe("discouraged");
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
      stamps: { mode: "allow", names: ["pricing", "bad name", 123] },
      primitiveFallback: "maybe",
      policy: {
        order: ["primitive", "stamp"],
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
    expect(catalog.stamps).toEqual({ mode: "allow", names: ["pricing"] });
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

  it("keeps the polished default catalog compact with recipe-backed variants", () => {
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
      table: ["default"],
      chart: ["default"],
      stat: ["default", "success"],
      badge: ["neutral", "success", "warning", "danger"],
      progress: ["default", "success"],
      alert: ["info", "success", "warning", "danger"],
      list: ["default", "compact"],
      divider: ["default"],
    });

    const { catalog, issues } = validateCatalog({ name: "minimal-polished-default" });
    expect(issues).toEqual([]);
    expect(catalog.bricks).toEqual(DEFAULT_CATALOG.bricks);
    expect(catalog.policy).toEqual({
      order: ["stamp", "brick", "primitive"],
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
