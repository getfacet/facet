import { describe, expect, it } from "vitest";
import * as catalogExports from "./catalog.js";
import {
  CATALOG_BRICK_TYPES,
  DEFAULT_CATALOG,
  validateCatalog,
  type FacetCatalog,
} from "./catalog.js";

const FINAL_BRICKS = [
  "box",
  "text",
  "media",
  "input",
  "richtext",
  "table",
  "chart",
  "list",
  "keyValue",
  "progress",
  "loading",
] as const;

const RETIRED_BRICKS = ["button", "form", "filterBar", "metric", "tabs", "nav", "stat"];

describe("catalog module boundary", () => {
  it("keeps the exact runtime export surface", () => {
    expect(Object.keys(catalogExports).sort()).toEqual([
      "CATALOG_BRICK_TYPES",
      "DEFAULT_CATALOG",
      "validateCatalog",
    ]);
  });
});

describe("validateCatalog", () => {
  it("normalizes the brick-only catalog", () => {
    expect(CATALOG_BRICK_TYPES).toEqual(FINAL_BRICKS);
    expect(DEFAULT_CATALOG.bricks.map((brick) => brick.type)).toEqual(FINAL_BRICKS);
    expect(Object.keys(DEFAULT_CATALOG).sort()).toEqual([
      "bricks",
      "compositions",
      "description",
      "name",
      "policy",
      "theme",
    ]);
    expect(DEFAULT_CATALOG.policy).toEqual({
      editBeforeAppend: true,
      compactScreens: true,
      maxScreenSections: 6,
    });

    const absent = validateCatalog({ name: "absent-bricks" });
    expect(absent.issues).toEqual([]);
    expect(absent.catalog.bricks.map((brick) => brick.type)).toEqual(FINAL_BRICKS);

    for (const input of [
      { name: "empty-bricks", bricks: [] },
      { name: "invalid-bricks", bricks: "box" },
      { name: "retired-bricks", bricks: RETIRED_BRICKS.map((type) => ({ type })) },
    ]) {
      const { catalog, issues } = validateCatalog(input);
      expect(catalog.bricks, input.name).toEqual([]);
      expect(issues.length, input.name).toBeGreaterThan(0);
    }

    const stale = validateCatalog({
      name: "stale-components",
      components: [{ type: "table" }], // composition-hard-cut: allowed-negative
      primitiveFallback: "allowed", // composition-hard-cut: allowed-negative
      policy: {
        order: ["component", "primitive"], // composition-hard-cut: allowed-negative
        editBeforeAppend: false,
        compactScreens: false,
        maxScreenSections: 2,
      },
    });
    expect(stale.catalog.bricks.map((brick) => brick.type)).toEqual(FINAL_BRICKS);
    expect(stale.catalog.policy).toEqual({
      editBeforeAppend: false,
      compactScreens: false,
      maxScreenSections: 2,
    });
    expect(stale.catalog).not.toHaveProperty("components");
    expect(stale.catalog).not.toHaveProperty("primitiveFallback");
    expect(stale.catalog.policy).not.toHaveProperty("order");
    expect(stale.issues).toEqual([]);
  });

  it("defaults missing catalog input to a fresh locked safe catalog", () => {
    const first = validateCatalog(undefined);

    expect(first.catalog).toEqual(DEFAULT_CATALOG);
    expect(first.catalog).not.toBe(DEFAULT_CATALOG);
    expect(first.issues).toEqual([]);
    expect(first.catalog.theme.switchPolicy).toBe("locked");
    expect(first.catalog.compositions).toEqual({ mode: "all" });

    (first.catalog.theme.allowed as string[]).push("mutated");
    (first.catalog.bricks as { type: FacetCatalog["bricks"][number]["type"] }[]).pop();
    (first.catalog.compositions as { mode: "allow"; names: string[] }).names = ["mutated"];
    (first.catalog.policy as { editBeforeAppend: boolean }).editBeforeAppend = false;

    const second = validateCatalog(undefined);
    expect(second.catalog).toEqual(DEFAULT_CATALOG);
    expect(second.catalog.theme.allowed).toEqual(["default"]);
    expect(second.catalog.bricks).toHaveLength(11);
    expect(second.catalog.compositions).toEqual({ mode: "all" });
    expect(second.catalog.policy.editBeforeAppend).toBe(true);
  });

  it("keeps valid bricks, variants, compositions, theme, and edit policy", () => {
    const { catalog, issues } = validateCatalog({
      name: "acme",
      description: "Acme UI policy",
      theme: {
        active: "acme-default",
        switchPolicy: "allowed",
        allowed: ["acme-default", "acme-dark"],
      },
      bricks: [
        { type: "table", variants: ["dashboard"], guidance: "Show account rows." },
        { type: "box", variants: ["selected"] },
      ],
      compositions: { mode: "allow", names: ["pricing", "dashboard-summary"] },
      policy: {
        editBeforeAppend: false,
        compactScreens: false,
        maxScreenSections: 4,
      },
    });

    expect(issues).toEqual([]);
    expect(catalog).toEqual({
      name: "acme",
      description: "Acme UI policy",
      theme: {
        active: "acme-default",
        switchPolicy: "allowed",
        allowed: ["acme-default", "acme-dark"],
      },
      bricks: [
        { type: "table", variants: ["dashboard"], guidance: "Show account rows." },
        { type: "box", variants: ["selected"] },
      ],
      compositions: { mode: "allow", names: ["pricing", "dashboard-summary"] },
      policy: {
        editBeforeAppend: false,
        compactScreens: false,
        maxScreenSections: 4,
      },
    });
  });

  it("drops malformed entries with bounded issues instead of throwing", () => {
    const { catalog, issues } = validateCatalog({
      name: "bad name",
      theme: {
        active: "has space",
        switchPolicy: "sometimes",
        allowed: ["ok", "has space", 123],
      },
      bricks: [{ type: "script" }, { type: "table", variants: ["primary", "bad variant", 123] }],
      compositions: { mode: "allow", names: ["summary", "bad name", 123] },
      policy: {
        editBeforeAppend: "yes",
        compactScreens: "no",
        maxScreenSections: 9999,
      },
    });

    expect(catalog.name).toBe(DEFAULT_CATALOG.name);
    expect(catalog.theme).toEqual({ switchPolicy: "locked", allowed: ["ok"] });
    expect(catalog.bricks).toEqual([{ type: "table", variants: ["primary"] }]);
    expect(catalog.compositions).toEqual({ mode: "allow", names: ["summary"] });
    expect(catalog.policy).toEqual(DEFAULT_CATALOG.policy);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join("\n")).not.toContain("bad name".repeat(100));
  });

  it("keeps provided empty restrictions fail closed", () => {
    const variants = validateCatalog({
      name: "variants",
      bricks: [{ type: "table", variants: ["Bad Variant!", 123] }],
    });
    expect(variants.catalog.bricks).toEqual([{ type: "table", variants: [] }]);
    expect(variants.issues.join("\n")).toContain(
      "catalog bricks.table.variants: no valid entries — restriction kept empty",
    );

    const emptyVariants = validateCatalog({
      name: "empty-variants",
      bricks: [{ type: "table", variants: [] }],
    });
    expect(emptyVariants.catalog.bricks).toEqual([{ type: "table", variants: [] }]);

    const themes = validateCatalog({
      name: "themes",
      theme: { switchPolicy: "allowed", allowed: ["has space", 123] },
    });
    expect(themes.catalog.theme.allowed).toEqual([]);
    expect(themes.catalog.theme.allowed).not.toBeUndefined();

    const compositions = validateCatalog({
      name: "compositions",
      compositions: { mode: "deny", names: ["pricing"] },
    });
    expect(compositions.catalog.compositions).toEqual({ mode: "allow", names: [] });
    expect(compositions.issues.join("\n")).toContain("restriction kept empty");
  });

  it("distinguishes absent fields from mistyped provided restrictions", () => {
    const absent = validateCatalog({
      name: "absent",
      theme: { switchPolicy: "allowed" },
      bricks: [{ type: "table" }],
    });
    expect(absent.catalog.theme.allowed).toBeUndefined();
    expect(absent.catalog.bricks[0]?.variants).toBeUndefined();
    expect(absent.issues.join("\n")).not.toContain("no valid entries");

    const mistypedBricks = validateCatalog({
      name: "mistyped-bricks",
      bricks: { table: {} } as unknown as FacetCatalog["bricks"],
    });
    expect(mistypedBricks.catalog.bricks).toEqual([]);
    expect(mistypedBricks.issues.join("\n")).toContain(
      "catalog bricks: expected an array; restriction kept empty",
    );

    const mistypedTheme = validateCatalog({
      name: "mistyped-theme",
      theme: { switchPolicy: "allowed", allowed: "dark" as unknown as readonly string[] },
    });
    expect(mistypedTheme.catalog.theme.allowed).toEqual([]);

    const mistypedCompositions = validateCatalog({
      name: "mistyped-compositions",
      compositions: ["pricing"] as unknown as FacetCatalog["compositions"],
    });
    expect(mistypedCompositions.catalog.compositions).toEqual({ mode: "allow", names: [] });
  });

  it("diagnoses an allow-mode composition policy without valid names", () => {
    const missing = validateCatalog({
      name: "missing-names",
      compositions: { mode: "allow" } as unknown as FacetCatalog["compositions"],
    });
    expect(missing.catalog.compositions).toEqual({ mode: "allow", names: [] });
    expect(missing.issues.join("\n")).toContain(
      "catalog compositions.names: no valid entries — restriction kept empty",
    );

    const mistyped = validateCatalog({
      name: "mistyped-names",
      compositions: {
        mode: "allow",
        names: "pricing",
      } as unknown as FacetCatalog["compositions"],
    });
    expect(mistyped.catalog.compositions).toEqual({ mode: "allow", names: [] });
    expect(mistyped.issues.join("\n")).toContain(
      "catalog compositions.names: expected an array of names; restriction kept empty",
    );
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

  it("ships compact defaults with one entry per final brick", () => {
    const variants = Object.fromEntries(
      DEFAULT_CATALOG.bricks.map((brick) => [brick.type, brick.variants ?? []]),
    );

    expect(DEFAULT_CATALOG.bricks).toHaveLength(11);
    expect(variants).toEqual({
      box: [],
      text: [],
      media: ["default", "hero"],
      input: ["default"],
      richtext: [],
      table: ["default"],
      chart: ["default"],
      list: ["default", "compact"],
      keyValue: ["default"],
      progress: ["default", "success"],
      loading: ["default"],
    });
  });

  it("returns a catalog typed as FacetCatalog", () => {
    const typed: FacetCatalog = validateCatalog({ name: "typed" }).catalog;
    expect(typed.name).toBe("typed");
  });
});
