import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, expectTypeOf, it } from "vitest";

const INDEX_SOURCE = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const VALIDATE_SOURCE = readFileSync(new URL("./validate.ts", import.meta.url), "utf8");
const INDEX_AST = ts.createSourceFile(
  "index.ts",
  INDEX_SOURCE,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

const EXPORT_DECLARATIONS = INDEX_AST.statements.filter(ts.isExportDeclaration);

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
});
