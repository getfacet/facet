import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, expectTypeOf, it } from "vitest";
import * as core from "./index.js";

const INDEX_URL = new URL("./index.ts", import.meta.url);
const INDEX_PATH = fileURLToPath(INDEX_URL);
const INDEX_SOURCE = readFileSync(INDEX_URL, "utf8");
const VALIDATE_SOURCE = readFileSync(new URL("./validate.ts", import.meta.url), "utf8");
const INDEX_AST = ts.createSourceFile(
  "index.ts",
  INDEX_SOURCE,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

const EXPORT_DECLARATIONS = INDEX_AST.statements.filter(ts.isExportDeclaration);

function rootExportNames(): ReadonlySet<string> {
  const program = ts.createProgram({
    rootNames: [INDEX_PATH],
    options: {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      noEmit: true,
      skipLibCheck: true,
      strict: true,
      target: ts.ScriptTarget.ESNext,
    },
  });
  const source = program.getSourceFile(INDEX_PATH);
  const symbol =
    source === undefined ? undefined : program.getTypeChecker().getSymbolAtLocation(source);
  if (symbol === undefined) throw new Error("core barrel must have a module symbol");
  return new Set(
    program
      .getTypeChecker()
      .getExportsOfModule(symbol)
      .map((entry) => entry.name),
  );
}

function moduleName(declaration: ts.ExportDeclaration): string {
  const specifier = declaration.moduleSpecifier;
  if (specifier === undefined || !ts.isStringLiteral(specifier)) {
    throw new Error("core barrel exports must use string module specifiers");
  }
  return specifier.text;
}

describe("core barrel", () => {
  it("exports only the canonical module surface", () => {
    expect(INDEX_AST.statements.every(ts.isExportDeclaration)).toBe(true);
    expect(EXPORT_DECLARATIONS.map(moduleName)).toEqual([
      "./tokens.js",
      "./nodes.js",
      "./tree.js",
      "./theme.js",
      "./catalog.js",
      "./patch.js",
      "./protocol.js",
      "./event-validation.js",
      "./view.js",
      "./agent-result.js",
      "./validate.js",
      "./data-binding.js",
      "./stage-fold.js",
      "./serial-queue.js",
      "./semaphore.js",
      "./lru-map.js",
      "./spec.js",
    ]);
  });

  it("reference dataset hard cutover keeps only native composition validation public", () => {
    const retiredPublicNames = [
      ["Composition", "Ref"].join(""),
      ["validate", "Composition", "Graph"].join(""),
      ["expand", "Composition"].join(""),
      ["Expand", "Composition"].join(""),
      ["Use", "Composition", "Result"].join(""),
      ["Expand", "Composition", "Result"].join(""),
      ["Expand", "Composition", "Options"].join(""),
      ["Composition", "Params"].join(""),
      ["Expand", "At"].join(""),
      ["Validate", "Composition", "Graph", "Result"].join(""),
      ["MAX", "COMPOSITION", "GRAPH", "NEST", "DEPTH"].join("_"),
      ["MAX", "COMPOSITION", "GRAPH", "NODES"].join("_"),
      ["SLOT", "MARKER", "RE"].join("_"),
    ];
    const retiredModulePaths = [
      ["./composition", "graph.js"].join("-"),
      ["./expand", "composition.js"].join("-"),
    ];

    for (const retired of [...retiredPublicNames, ...retiredModulePaths]) {
      expect(INDEX_SOURCE).not.toContain(retired);
      expect(VALIDATE_SOURCE).not.toContain(retired);
    }

    expectTypeOf<import("./index.js").FacetComposition>().toEqualTypeOf<
      import("./validate.js").FacetComposition
    >();
    expectTypeOf<import("./index.js").CompositionMetadata>().toEqualTypeOf<
      import("./validate.js").CompositionMetadata
    >();
    expectTypeOf<import("./index.js").CompositionValidationResult>().toEqualTypeOf<
      import("./validate.js").CompositionValidationResult
    >();
    expectTypeOf<typeof import("./index.js").validateComposition>().toEqualTypeOf<
      typeof import("./validate.js").validateComposition
    >();
  });

  it("exports the final Brick APIs and no retired tier aliases", () => {
    const names = rootExportNames();
    for (const name of [
      "BRICK_TYPES",
      "BrickType",
      "FacetNode",
      "ContainerNode",
      "isContainer",
      "BrickRecipePart",
      "BrickRecipeParts",
      "BrickRecipe",
      "BrickRecipes",
      "RECIPE_BRICKS",
      "RecipeBrickName",
      "CATALOG_BRICK_TYPES",
      "CatalogBrick",
    ]) {
      expect(names.has(name), `missing root export ${name}`).toBe(true);
    }

    const retiredRootNames = [
      ["INTRINSIC", "COMPONENT", "TYPES"].join("_"),
      ["Intrinsic", "Component", "Type"].join(""),
      ["LEGACY", "COMPONENT", "TYPES"].join("_"),
      ["Legacy", "Component", "Type"].join(""),
      ["COMPONENT", "NODE", "TYPES"].join("_"),
      ["Component", "Node", "Type"].join(""),
      ["Intrinsic", "Component", "Node"].join(""),
      ["Legacy", "Component", "Node"].join(""),
      ["Component", "Node"].join(""),
      ["PRIMITIVE", "BRICK", "TYPES"].join("_"),
      ["Primitive", "Brick", "Type"].join(""),
      ["Primitive", "Brick", "Node"].join(""),
      ["Button", "Node"].join(""),
      ["Tabs", "Node"].join(""),
      ["Nav", "Node"].join(""),
      ["Form", "Node"].join(""),
      ["Filter", "Bar", "Node"].join(""),
      ["Metric", "Node"].join(""),
      ["Stat", "Node"].join(""),
      ["CATALOG", "COMPONENT", "TYPES"].join("_"),
      ["Catalog", "Component"].join(""),
      ["Catalog", "Usage", "Order"].join(""),
      ["Component", "Recipe", "Part"].join(""),
      ["Component", "Recipe", "Parts"].join(""),
      ["Component", "Recipe"].join(""),
      ["Component", "Recipes"].join(""),
      ["RECIPE", "COMPONENTS"].join("_"),
      ["Recipe", "Component", "Name"].join(""),
      ["MAX", "TABS", "ITEMS"].join("_"),
    ];
    for (const name of retiredRootNames) {
      expect(names.has(name), `retired root export ${name}`).toBe(false);
      expect(core).not.toHaveProperty(name);
    }

    expect(core.RECIPE_BRICKS).toEqual(core.BRICK_TYPES);
    expect(core.CATALOG_BRICK_TYPES).toEqual(core.BRICK_TYPES);
    expectTypeOf<import("./index.js").BrickRecipe>().toEqualTypeOf<
      import("./theme-types.js").BrickRecipe
    >();
    expectTypeOf<import("./index.js").BrickRecipes>().toEqualTypeOf<
      import("./theme-types.js").BrickRecipes
    >();
    expectTypeOf<import("./index.js").CatalogBrick>().toEqualTypeOf<
      import("./catalog-types.js").CatalogBrick
    >();
  });
});
