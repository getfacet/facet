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
  it("exports only the new style asset contract", () => {
    expect(INDEX_AST.statements.every(ts.isExportDeclaration)).toBe(true);
    expect(EXPORT_DECLARATIONS.map(moduleName)).toEqual([
      "./tokens.js",
      "./style-value-contract.js",
      "./nodes.js",
      "./tree.js",
      "./theme.js",
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
    const names = rootExportNames();
    for (const name of [
      "STYLE_VALUE_CONTRACT",
      "TOKEN_STYLE_VALUE_CONTRACT",
      "FIXED_STYLE_VALUE_CONTRACT",
      "BRICK_TYPES",
      "BrickType",
      "BRICK_CONTRACT",
      "BrickContractEntry",
      "FacetNode",
      "ContainerNode",
      "isContainer",
      "BrickStyle",
      "BrickStyleDefinition",
      "FacetTheme",
      "FacetPreset",
      "FacetPresets",
      "validateTheme",
      "AuthorIssue",
      "AuthorValidationResult",
      "validateAuthorNode",
      "validateAuthorTree",
      "FacetPattern",
      "PatternValidationResult",
      "PatternListValidationResult",
      "MAX_PATTERN_NODES",
      "MAX_PATTERNS",
      "validatePattern",
      "validatePatternList",
    ]) {
      expect(names.has(name), `missing root export ${name}`).toBe(true);
    }

    const retiredRootNames = [
      ["Facet", "Catalog"].join(""),
      ["Catalog", "Brick"].join(""),
      ["CATALOG", "BRICK", "TYPES"].join("_"),
      ["DEFAULT", "CATALOG"].join("_"),
      ["validate", "Catalog"].join(""),
      ["Facet", "Composition"].join(""),
      ["Composition", "Metadata"].join(""),
      ["Composition", "Validation", "Result"].join(""),
      ["validate", "Composition"].join(""),
    ];
    for (const name of retiredRootNames) {
      expect(names.has(name), `retired root export ${name}`).toBe(false);
      expect(core).not.toHaveProperty(name);
    }

    for (const retiredText of ["catalog", "composition"]) {
      expect(INDEX_SOURCE.toLowerCase()).not.toContain(retiredText);
      expect(VALIDATE_SOURCE.toLowerCase()).not.toContain(retiredText);
    }

    expectTypeOf<import("./index.js").FacetPattern>().toEqualTypeOf<
      import("./validate.js").FacetPattern
    >();
    expectTypeOf<import("./index.js").PatternValidationResult>().toEqualTypeOf<
      import("./validate.js").PatternValidationResult
    >();
    expectTypeOf<typeof import("./index.js").validatePattern>().toEqualTypeOf<
      typeof import("./validate.js").validatePattern
    >();
  });
});
