import {
  validateAuthorTree,
  validatePattern,
  type AuthorIssue,
  type FacetPattern,
  type FacetTree,
} from "@facet/core";

import { createBrickSample } from "./catalog-brick-samples.js";
import {
  PACKAGE_CATALOG_SOURCE,
  createCatalogModel,
  type CatalogBrickItem,
  type CatalogDiagnostic,
  type CatalogPatternItem,
  type CatalogPresetItem,
  type CatalogSource,
} from "./catalog-model.js";

export interface CatalogBrickRenderSample {
  readonly status: "render";
  readonly itemId: string;
  readonly kind: "brick";
  readonly nodeId: string;
  readonly tree: FacetTree;
}

export interface CatalogPresetRenderSample {
  readonly status: "render";
  readonly itemId: string;
  readonly kind: "preset";
  readonly brick: string;
  readonly preset: string;
  readonly nodeId: string;
  readonly tree: FacetTree;
}

export interface CatalogPatternRenderSample {
  readonly status: "render";
  readonly itemId: string;
  readonly kind: "pattern";
  readonly tree: FacetTree;
}

export interface CatalogDiagnosticSample {
  readonly status: "diagnostic";
  readonly itemId: string;
  readonly kind: "brick" | "preset" | "pattern";
  readonly diagnostic: CatalogDiagnostic;
}

export type CatalogSample =
  | CatalogBrickRenderSample
  | CatalogPresetRenderSample
  | CatalogPatternRenderSample
  | CatalogDiagnosticSample;

function treeIssueMessage(issue: AuthorIssue): string {
  return `${issue.path}: ${issue.message}`;
}

function diagnosticSample(
  item: CatalogBrickItem | CatalogPresetItem | CatalogPatternItem,
  diagnostic: CatalogDiagnostic,
): CatalogDiagnosticSample {
  return { status: "diagnostic", itemId: item.id, kind: item.kind, diagnostic };
}

function generatedDiagnostic(
  item: CatalogBrickItem | CatalogPresetItem | CatalogPatternItem,
  message: string,
): CatalogDiagnosticSample {
  return diagnosticSample(item, { itemId: item.id, message, severity: "error" });
}

function patternTree(pattern: FacetPattern): FacetTree {
  return {
    root: pattern.root,
    nodes: pattern.nodes,
    ...(pattern.screens === undefined ? {} : { screens: pattern.screens }),
    ...(pattern.entry === undefined ? {} : { entry: pattern.entry }),
    ...(pattern.data === undefined ? {} : { data: pattern.data }),
  };
}

function firstTreeDiagnostic(
  item: CatalogBrickItem | CatalogPresetItem,
  tree: FacetTree,
  source: CatalogSource,
): CatalogDiagnosticSample | undefined {
  const result = validateAuthorTree(tree, source.theme);
  const issue = result.issues[0];
  if (issue !== undefined) return generatedDiagnostic(item, treeIssueMessage(issue));
  if (result.omittedErrorCount > 0) {
    return generatedDiagnostic(
      item,
      `${String(result.omittedErrorCount)} additional tree errors were omitted.`,
    );
  }
  return undefined;
}

function createBrickRenderSample(item: CatalogBrickItem, source: CatalogSource): CatalogSample {
  const existing = item.diagnostics[0];
  if (existing !== undefined) return diagnosticSample(item, existing);
  const sample = createBrickSample(item.brick);
  if (sample === undefined) {
    return generatedDiagnostic(item, `No catalog sample constructor exists for "${item.brick}".`);
  }
  const invalid = firstTreeDiagnostic(item, sample.tree, source);
  if (invalid !== undefined) return invalid;
  return {
    status: "render",
    itemId: item.id,
    kind: "brick",
    nodeId: sample.nodeId,
    tree: sample.tree,
  };
}

function createPresetRenderSample(item: CatalogPresetItem, source: CatalogSource): CatalogSample {
  const existing = item.diagnostics[0];
  if (existing !== undefined) return diagnosticSample(item, existing);
  const sample = createBrickSample(item.brick, item.name);
  if (sample === undefined) {
    return generatedDiagnostic(
      item,
      `No catalog sample constructor exists for Preset Brick "${item.brick}".`,
    );
  }
  const invalid = firstTreeDiagnostic(item, sample.tree, source);
  if (invalid !== undefined) return invalid;
  return {
    status: "render",
    itemId: item.id,
    kind: "preset",
    brick: item.brick,
    preset: item.name,
    nodeId: sample.nodeId,
    tree: sample.tree,
  };
}

function createPatternRenderSample(item: CatalogPatternItem, source: CatalogSource): CatalogSample {
  const existing = item.diagnostics[0];
  if (existing !== undefined) return diagnosticSample(item, existing);
  const result = validatePattern(item.definition, source.theme);
  if (result.pattern === undefined) {
    return generatedDiagnostic(item, result.issues[0] ?? "Pattern validation failed.");
  }
  return {
    status: "render",
    itemId: item.id,
    kind: "pattern",
    tree: patternTree(result.pattern),
  };
}

export function createCatalogSamples(
  source: CatalogSource = PACKAGE_CATALOG_SOURCE,
): readonly CatalogSample[] {
  const items = createCatalogModel(source).categories.flatMap(({ items: categoryItems }) =>
    categoryItems.filter(
      (item): item is CatalogBrickItem | CatalogPresetItem | CatalogPatternItem =>
        item.kind === "brick" || item.kind === "preset" || item.kind === "pattern",
    ),
  );

  return items.map((item) => {
    switch (item.kind) {
      case "brick":
        return createBrickRenderSample(item, source);
      case "preset":
        return createPresetRenderSample(item, source);
      case "pattern":
        return createPatternRenderSample(item, source);
    }
  });
}
