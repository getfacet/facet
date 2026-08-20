import { DEFAULT_CATALOG } from "@facet/assets";
import { parseMarkup, validateAuthorMarkup } from "@facet/core";
import type { ComponentDocument, FacetCatalog } from "@facet/core";

import {
  QUICKSTART_PREVIEW_ASSET_REGISTRY,
  QUICKSTART_SERVICE_PREVIEW_SOURCES,
  type ComponentPreviewFixture,
  type ComponentPreviewFixtureError,
  type ComponentPreviewFixtureErrorPhase,
  type ComponentPreviewFixtureResult,
} from "./component-preview-fixtures.js";
import type { QuickstartResolvedDesignExample } from "../design-overlay.js";

export interface ScreenPattern {
  readonly id: string;
  readonly source: "default" | "imported";
  readonly label: string;
  readonly description: string;
  readonly roles: readonly string[];
  readonly result: ComponentPreviewFixtureResult;
}

export interface ScreenPatternOptions {
  readonly catalog?: FacetCatalog;
  readonly examples?: readonly QuickstartResolvedDesignExample[];
}

type ServicePreviewSource = (typeof QUICKSTART_SERVICE_PREVIEW_SOURCES)[number];

const SCREEN_PATTERN_SOURCES = QUICKSTART_SERVICE_PREVIEW_SOURCES;

function reject(
  source: ServicePreviewSource,
  phase: ComponentPreviewFixtureErrorPhase,
  code: string,
  detail: string,
): ComponentPreviewFixtureResult {
  const error: ComponentPreviewFixtureError = Object.freeze({ phase, code, detail });
  return Object.freeze({
    ok: false,
    tag: "Screen",
    source: source.source,
    data: source.data,
    error,
  });
}

function fixtureFor(
  source: ServicePreviewSource,
  catalog: FacetCatalog,
): ComponentPreviewFixtureResult {
  const parsed = parseMarkup(source.source);
  if (!parsed.ok) return reject(source, "parse", parsed.error.code, parsed.error.cause);
  const validated = validateAuthorMarkup(
    parsed.ast,
    catalog,
    source.data,
    QUICKSTART_PREVIEW_ASSET_REGISTRY,
  );
  if (!validated.ok) return reject(source, "validate", validated.error.code, validated.error.cause);
  const targetNodeId = screenNodeId(validated.document);
  if (targetNodeId === null)
    return reject(source, "target", "target-screen-missing", "No entry screen exists.");
  const fixture: ComponentPreviewFixture = Object.freeze({
    tag: "Screen",
    source: source.source,
    data: source.data,
    document: validated.document,
    targetNodeId,
  });
  return Object.freeze({ ok: true, tag: "Screen", fixture });
}

function fixtureForExample(
  example: QuickstartResolvedDesignExample,
): ComponentPreviewFixtureResult {
  const targetNodeId = screenNodeId(example.document);
  if (targetNodeId === null) {
    return Object.freeze({
      ok: false,
      tag: "Screen",
      source: example.markup,
      data: example.data,
      error: Object.freeze({
        phase: "target",
        code: "target-screen-missing",
        detail: "No entry screen exists.",
      }),
    });
  }
  return Object.freeze({
    ok: true,
    tag: "Screen",
    fixture: Object.freeze({
      tag: "Screen",
      source: example.markup,
      data: example.data,
      document: example.document,
      targetNodeId,
    }),
  });
}

function screenNodeId(document: ComponentDocument): string | null {
  for (const [nodeId, node] of Object.entries(document.nodes)) {
    if (node.tag === "Screen") return nodeId;
  }
  return null;
}

function rolesForExample(example: QuickstartResolvedDesignExample): readonly string[] {
  const roles = new Set(example.tags);
  for (const node of Object.values(example.document.nodes)) roles.add(node.tag);
  return Object.freeze([...roles]);
}

function screenPatternFromExample(example: QuickstartResolvedDesignExample): ScreenPattern | null {
  if (example.kind !== "screen") return null;
  return Object.freeze({
    id: example.id,
    source: "imported",
    label: example.label,
    description: example.description ?? "Active design screen example.",
    roles: rolesForExample(example),
    result: fixtureForExample(example),
  });
}

function uniquifyActiveScreenPatternIds(
  defaultPatterns: readonly ScreenPattern[],
  activePatterns: readonly ScreenPattern[],
): readonly ScreenPattern[] {
  const occupied = new Set(defaultPatterns.map((pattern) => pattern.id));
  return Object.freeze(
    activePatterns.map((pattern) => {
      if (!occupied.has(pattern.id)) {
        occupied.add(pattern.id);
        return pattern;
      }
      let suffix = 1;
      let id = `active:${pattern.id}`;
      while (occupied.has(id)) {
        suffix += 1;
        id = `active:${pattern.id}:${String(suffix)}`;
      }
      occupied.add(id);
      return Object.freeze({ ...pattern, id });
    }),
  );
}

function isFacetCatalogInput(input: FacetCatalog | ScreenPatternOptions): input is FacetCatalog {
  return Array.isArray((input as { readonly components?: unknown }).components);
}

function screenPatternOptions(input: FacetCatalog | ScreenPatternOptions): {
  readonly catalog: FacetCatalog;
  readonly examples: readonly QuickstartResolvedDesignExample[];
} {
  if (isFacetCatalogInput(input)) return { catalog: input, examples: Object.freeze([]) };
  return {
    catalog: input.catalog ?? DEFAULT_CATALOG,
    examples: input.examples ?? Object.freeze([]),
  };
}

function defaultScreenPatterns(catalog: FacetCatalog): readonly ScreenPattern[] {
  return Object.freeze(
    SCREEN_PATTERN_SOURCES.map((source) =>
      Object.freeze({
        id: source.id,
        source: "default" as const,
        label: source.label,
        description: source.description,
        roles: source.roles,
        result: fixtureFor(source, catalog),
      }),
    ),
  );
}

const DEFAULT_SCREEN_PATTERNS = defaultScreenPatterns(DEFAULT_CATALOG);

export function screenPatterns(catalog?: FacetCatalog): readonly ScreenPattern[];
export function screenPatterns(options: ScreenPatternOptions): readonly ScreenPattern[];
export function screenPatterns(
  input: FacetCatalog | ScreenPatternOptions = DEFAULT_CATALOG,
): readonly ScreenPattern[] {
  const options = screenPatternOptions(input);
  const defaultPatterns =
    options.catalog === DEFAULT_CATALOG
      ? DEFAULT_SCREEN_PATTERNS
      : defaultScreenPatterns(options.catalog);
  const activePatterns = options.examples.flatMap((example) => {
    const pattern = screenPatternFromExample(example);
    return pattern === null ? [] : [pattern];
  });
  const visibleActivePatterns = uniquifyActiveScreenPatternIds(defaultPatterns, activePatterns);
  return Object.freeze(
    visibleActivePatterns.length === 0
      ? defaultPatterns
      : [...defaultPatterns, ...visibleActivePatterns],
  );
}
