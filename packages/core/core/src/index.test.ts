import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, expectTypeOf, it } from "vitest";

const INDEX_SOURCE = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
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

function namedExports(declaration: ts.ExportDeclaration): readonly ts.ExportSpecifier[] {
  const clause = declaration.exportClause;
  if (clause === undefined || !ts.isNamedExports(clause)) {
    throw new Error("composition expansion exports must be explicit named exports");
  }
  return clause.elements;
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
      "./view.js",
      "./agent-result.js",
      "./validate.js",
      "./data-binding.js",
      "./expand-composition.js",
      "./expand-composition.js",
      "./stage-fold.js",
      "./serial-queue.js",
      "./semaphore.js",
      "./lru-map.js",
      "./spec.js",
    ]);
  });

  it("exports the canonical composition expansion API explicitly", () => {
    const declarations = EXPORT_DECLARATIONS.filter(
      (declaration) => moduleName(declaration) === "./expand-composition.js",
    );
    expect(declarations).toHaveLength(2);

    const valueDeclaration = declarations.find((declaration) => !declaration.isTypeOnly);
    const typeDeclaration = declarations.find((declaration) => declaration.isTypeOnly);
    expect(valueDeclaration).toBeDefined();
    expect(typeDeclaration).toBeDefined();

    const values = namedExports(valueDeclaration!);
    expect(
      values.map(({ isTypeOnly, name, propertyName }) => ({
        isTypeOnly,
        name: name.text,
        sourceName: propertyName?.text,
      })),
    ).toEqual([{ isTypeOnly: false, name: "expandComposition", sourceName: undefined }]);

    const types = namedExports(typeDeclaration!);
    expect(
      types.map(({ isTypeOnly, name, propertyName }) => ({
        isTypeOnly,
        name: name.text,
        sourceName: propertyName?.text,
      })),
    ).toEqual([
      { isTypeOnly: false, name: "CompositionParams", sourceName: undefined },
      { isTypeOnly: false, name: "ExpandAt", sourceName: undefined },
      { isTypeOnly: false, name: "UseCompositionResult", sourceName: undefined },
      { isTypeOnly: false, name: "ExpandCompositionResult", sourceName: undefined },
      { isTypeOnly: false, name: "ExpandCompositionOptions", sourceName: undefined },
    ]);
  });

  it("keeps canonical composition validation and expansion types reachable", () => {
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
    expectTypeOf<import("./index.js").CompositionParams>().toEqualTypeOf<
      import("./expand-composition.js").CompositionParams
    >();
    expectTypeOf<import("./index.js").ExpandAt>().toEqualTypeOf<
      import("./expand-composition.js").ExpandAt
    >();
    expectTypeOf<import("./index.js").UseCompositionResult>().toEqualTypeOf<
      import("./expand-composition.js").UseCompositionResult
    >();
    expectTypeOf<import("./index.js").ExpandCompositionResult>().toEqualTypeOf<
      import("./expand-composition.js").ExpandCompositionResult
    >();
    expectTypeOf<import("./index.js").ExpandCompositionOptions>().toEqualTypeOf<
      import("./expand-composition.js").ExpandCompositionOptions
    >();
    expectTypeOf<typeof import("./index.js").expandComposition>().toEqualTypeOf<
      typeof import("./expand-composition.js").expandComposition
    >();
  });
});
