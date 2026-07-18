import { validateTree, type FacetTree } from "@facet/core";

import { createBrickSample } from "../catalog/catalog-brick-samples.js";
import { cloneBoundedJson } from "../shared/redaction.js";
import {
  MAX_ASSET_DOCUMENT_BYTES,
  MAX_EVIDENCE_DEPTH,
  MAX_EVIDENCE_NODES,
  type JsonValue,
} from "../shared/run-contract.js";

export const CATALOG_CATEGORY_ORDER = [
  "bricks",
  "presets",
  "patterns",
  "token-values",
  "fixed-choices",
] as const;
export type PresentedCatalogCategoryId = (typeof CATALOG_CATEGORY_ORDER)[number];
export type PresentedCatalogItemKind = "brick" | "preset" | "pattern" | "token" | "fixed";

export interface PresentedCatalogDiagnostic {
  readonly itemId: string;
  readonly severity: "error" | "warning";
  readonly message: string;
}

export type PresentedCatalogOutcome =
  | {
      readonly status: "render";
      readonly definition: JsonValue;
      readonly previewTree: FacetTree | null;
    }
  | {
      readonly status: "diagnostic";
      readonly diagnostics: readonly PresentedCatalogDiagnostic[];
    };

export interface PresentedCatalogItem {
  readonly id: string;
  readonly categoryId: PresentedCatalogCategoryId;
  readonly kind: PresentedCatalogItemKind;
  readonly name: string;
  readonly description: string | null;
  readonly useWhen: string | null;
  readonly avoidWhen: string | null;
  readonly qualifier: string | null;
  readonly outcome: PresentedCatalogOutcome;
}

export interface PresentedCatalogCategory {
  readonly id: PresentedCatalogCategoryId;
  readonly label: string;
  readonly total: number;
  readonly visible: number;
  readonly items: readonly PresentedCatalogItem[];
}

export type CatalogPresentationState = "loading" | "ready" | "empty" | "error";

export interface CatalogPresentation {
  readonly state: CatalogPresentationState;
  readonly statusMessage: string;
  readonly sourceName: string | null;
  readonly assetDigest: string | null;
  readonly categories: readonly PresentedCatalogCategory[];
  readonly items: readonly PresentedCatalogItem[];
  readonly selectedCategoryId: PresentedCatalogCategoryId;
  readonly selectedItem: PresentedCatalogItem | null;
  readonly totalItems: number;
  readonly visibleItems: number;
  readonly renderItems: number;
  readonly diagnosticItems: number;
  readonly accountedItems: number;
  readonly unaccountedItemIds: readonly string[];
  readonly diagnostics: readonly PresentedCatalogDiagnostic[];
}

export interface CatalogPresenterInput {
  readonly status: "loading" | "ready" | "error";
  readonly catalog?: unknown;
  readonly errorMessage?: string;
  readonly query?: string;
  readonly categoryId?: string;
  readonly selectedItemId?: string;
}

const CATEGORY_LABELS: Readonly<Record<PresentedCatalogCategoryId, string>> = {
  bricks: "Bricks",
  presets: "Presets",
  patterns: "Patterns",
  "token-values": "Token values",
  "fixed-choices": "Fixed choices",
};

const CATEGORY_KINDS: Readonly<Record<PresentedCatalogCategoryId, PresentedCatalogItemKind>> = {
  bricks: "brick",
  presets: "preset",
  patterns: "pattern",
  "token-values": "token",
  "fixed-choices": "fixed",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maximum = 20_000): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function optionalText(value: unknown): string | null {
  return boundedString(value) ? value : null;
}

function diagnostic(
  itemId: string,
  message: string,
  severity: PresentedCatalogDiagnostic["severity"] = "error",
): PresentedCatalogDiagnostic {
  return Object.freeze({ itemId, message, severity });
}

function parseDiagnostics(value: unknown, itemId: string): readonly PresentedCatalogDiagnostic[] {
  if (!Array.isArray(value)) return [diagnostic(itemId, "Item diagnostics were malformed.")];
  const diagnostics: PresentedCatalogDiagnostic[] = [];
  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      candidate.itemId !== itemId ||
      (candidate.severity !== "error" && candidate.severity !== "warning") ||
      !boundedString(candidate.message)
    ) {
      diagnostics.push(diagnostic(itemId, "An item diagnostic was malformed."));
      continue;
    }
    diagnostics.push(diagnostic(itemId, candidate.message, candidate.severity));
  }
  return Object.freeze(diagnostics);
}

function safeDefinition(value: unknown): JsonValue | undefined {
  const projected = cloneBoundedJson(value, {
    maxBytes: MAX_ASSET_DOCUMENT_BYTES,
    maxDepth: MAX_EVIDENCE_DEPTH,
    maxNodes: MAX_EVIDENCE_NODES,
  });
  return projected.ok ? projected.value : undefined;
}

function patternPreview(definition: JsonValue): FacetTree | undefined {
  if (!isRecord(definition) || typeof definition.root !== "string" || !isRecord(definition.nodes)) {
    return undefined;
  }
  const candidate = {
    root: definition.root,
    nodes: definition.nodes,
    ...(isRecord(definition.screens) ? { screens: definition.screens } : {}),
    ...(typeof definition.entry === "string" ? { entry: definition.entry } : {}),
    ...(isRecord(definition.data) ? { data: definition.data } : {}),
  };
  const validated = validateTree(candidate);
  return validated.issues.length === 0 ? validated.tree : undefined;
}

function previewTree(
  item: Record<string, unknown>,
  kind: PresentedCatalogItemKind,
  definition: JsonValue,
): FacetTree | null | undefined {
  if (kind === "brick") {
    if (typeof item.brick !== "string") return undefined;
    return createBrickSample(item.brick)?.tree;
  }
  if (kind === "preset") {
    if (typeof item.brick !== "string" || typeof item.name !== "string") return undefined;
    return createBrickSample(item.brick, item.name)?.tree;
  }
  if (kind === "pattern") return patternPreview(definition);
  return null;
}

function qualifier(item: Record<string, unknown>): string | null {
  if (typeof item.domain === "string" && item.domain.length > 0) return item.domain;
  if (typeof item.brick === "string" && item.brick.length > 0) return item.brick;
  return null;
}

function parseItem(
  value: unknown,
  categoryId: PresentedCatalogCategoryId,
  index: number,
): PresentedCatalogItem {
  const fallbackId = `invalid:${categoryId}:${String(index)}`;
  if (!isRecord(value)) {
    const outcome: PresentedCatalogOutcome = {
      status: "diagnostic",
      diagnostics: Object.freeze([diagnostic(fallbackId, "Catalog item was not an object.")]),
    };
    return Object.freeze({
      id: fallbackId,
      categoryId,
      kind: CATEGORY_KINDS[categoryId],
      name: "Invalid catalog item",
      description: null,
      useWhen: null,
      avoidWhen: null,
      qualifier: null,
      outcome,
    });
  }

  const id = boundedString(value.id, 500) ? value.id : fallbackId;
  const kind: PresentedCatalogItemKind = CATEGORY_KINDS[categoryId];
  const name = boundedString(value.name, 500) ? value.name : "Invalid catalog item";
  const diagnostics = [...parseDiagnostics(value.diagnostics, id)];
  if (value.kind !== CATEGORY_KINDS[categoryId]) {
    diagnostics.push(diagnostic(id, "Item kind did not match its catalog category."));
  }
  if (id === fallbackId) diagnostics.push(diagnostic(id, "Item id was missing or invalid."));
  if (name === "Invalid catalog item") {
    diagnostics.push(diagnostic(id, "Item name was missing or invalid."));
  }

  let definition: JsonValue | undefined;
  let preview: FacetTree | null | undefined;
  if (diagnostics.length === 0) {
    definition = safeDefinition(value.definition);
    if (definition === undefined) {
      diagnostics.push(diagnostic(id, "Item definition was not safe JSON."));
    } else {
      preview = previewTree(value, kind, definition);
      if (preview === undefined) {
        diagnostics.push(diagnostic(id, "No valid safe preview could be built for this item."));
      }
    }
  }
  const outcome: PresentedCatalogOutcome =
    diagnostics.length > 0 || definition === undefined || preview === undefined
      ? { status: "diagnostic", diagnostics: Object.freeze(diagnostics) }
      : { status: "render", definition, previewTree: preview };
  const description =
    optionalText(value.description) ??
    (isRecord(definition) ? optionalText(definition.description) : null);

  return Object.freeze({
    id,
    categoryId,
    kind,
    name,
    description,
    useWhen: optionalText(value.useWhen),
    avoidWhen: optionalText(value.avoidWhen),
    qualifier: qualifier(value),
    outcome,
  });
}

function matches(item: PresentedCatalogItem, query: string): boolean {
  if (query.length === 0) return true;
  return [
    item.id,
    item.kind,
    item.name,
    item.description,
    item.useWhen,
    item.avoidWhen,
    item.qualifier,
  ]
    .filter((value): value is string => value !== null)
    .some((value) => value.toLocaleLowerCase().includes(query));
}

function emptyCategories(): readonly PresentedCatalogCategory[] {
  return CATALOG_CATEGORY_ORDER.map((id) => ({
    id,
    label: CATEGORY_LABELS[id],
    total: 0,
    visible: 0,
    items: Object.freeze([]),
  }));
}

function basePresentation(state: "loading" | "error", statusMessage: string): CatalogPresentation {
  return Object.freeze({
    state,
    statusMessage,
    sourceName: null,
    assetDigest: null,
    categories: emptyCategories(),
    items: Object.freeze([]),
    selectedCategoryId: "bricks",
    selectedItem: null,
    totalItems: 0,
    visibleItems: 0,
    renderItems: 0,
    diagnosticItems: 0,
    accountedItems: 0,
    unaccountedItemIds: Object.freeze([]),
    diagnostics: Object.freeze([]),
  });
}

/** Pure, exhaustive projection: each source item becomes exactly one render or diagnostic row. */
export function presentCatalog(input: CatalogPresenterInput): CatalogPresentation {
  if (input.status === "loading") return basePresentation("loading", "Loading catalog…");
  if (input.status === "error") {
    return basePresentation("error", input.errorMessage?.trim() || "Catalog could not be loaded.");
  }
  if (!isRecord(input.catalog) || !Array.isArray(input.catalog.categories)) {
    return basePresentation("error", "Catalog response was invalid.");
  }

  const query = input.query?.trim().toLocaleLowerCase() ?? "";
  const globalDiagnostics: PresentedCatalogDiagnostic[] = [];
  if (Array.isArray(input.catalog.diagnostics)) {
    for (const candidate of input.catalog.diagnostics) {
      if (
        isRecord(candidate) &&
        boundedString(candidate.itemId, 500) &&
        boundedString(candidate.message) &&
        (candidate.severity === "error" || candidate.severity === "warning")
      ) {
        globalDiagnostics.push(diagnostic(candidate.itemId, candidate.message, candidate.severity));
      }
    }
  }
  const rawByCategory = new Map<string, Record<string, unknown>>();
  for (const category of input.catalog.categories) {
    if (!isRecord(category) || typeof category.id !== "string") continue;
    if (rawByCategory.has(category.id)) {
      globalDiagnostics.push(
        diagnostic(`category:${category.id}`, "Catalog category was duplicated."),
      );
      continue;
    }
    rawByCategory.set(category.id, category);
  }

  const allItems: PresentedCatalogItem[] = [];
  const categories = CATALOG_CATEGORY_ORDER.map((id): PresentedCatalogCategory => {
    const rawCategory = rawByCategory.get(id);
    if (rawCategory === undefined) {
      globalDiagnostics.push(diagnostic(`category:${id}`, "Catalog category was missing."));
    }
    const rawItems = Array.isArray(rawCategory?.items) ? rawCategory.items : [];
    const parsed = rawItems.map((item, index) => parseItem(item, id, index));
    allItems.push(...parsed);
    const visible = parsed.filter((item) => matches(item, query));
    return Object.freeze({
      id,
      label: optionalText(rawCategory?.label) ?? CATEGORY_LABELS[id],
      total: parsed.length,
      visible: visible.length,
      items: Object.freeze(visible),
    });
  });

  const selectedCategoryId = CATALOG_CATEGORY_ORDER.includes(
    input.categoryId as PresentedCatalogCategoryId,
  )
    ? (input.categoryId as PresentedCatalogCategoryId)
    : "bricks";
  const visibleItems = categories.flatMap(({ items }) => items);
  const selectedCategory = categories.find(({ id }) => id === selectedCategoryId);
  const selectedItem =
    selectedCategory?.items.find(({ id }) => id === input.selectedItemId) ??
    selectedCategory?.items[0] ??
    null;
  const renderItems = allItems.filter(({ outcome }) => outcome.status === "render").length;
  const diagnosticItems = allItems.length - renderItems;
  const state = allItems.length === 0 ? "empty" : "ready";
  const statusMessage =
    state === "empty"
      ? "The catalog contains no items."
      : visibleItems.length === 0
        ? "No catalog items match this search."
        : `${String(visibleItems.length)} of ${String(allItems.length)} catalog items shown.`;

  return Object.freeze({
    state,
    statusMessage,
    sourceName: optionalText(input.catalog.sourceName),
    assetDigest: optionalText(input.catalog.assetDigest),
    categories: Object.freeze(categories),
    items: Object.freeze(visibleItems),
    selectedCategoryId,
    selectedItem,
    totalItems: allItems.length,
    visibleItems: visibleItems.length,
    renderItems,
    diagnosticItems,
    accountedItems: renderItems + diagnosticItems,
    unaccountedItemIds: Object.freeze([]),
    diagnostics: Object.freeze(globalDiagnostics),
  });
}
