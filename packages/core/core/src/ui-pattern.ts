import type { FacetCatalog } from "./catalog.js";
import { validateAuthorMarkup } from "./document-validation.js";
import { isFacetIdentifier } from "./identifiers.js";
import { parseMarkup } from "./markup-parser.js";

export const UI_PATTERN_BOUNDS = Object.freeze({
  patterns: 32,
  stringChars: 240,
  listItems: 8,
  regionsPerPattern: 6,
  componentChoicesPerPattern: 8,
  tagsPerChoice: 6,
  variantsPerPattern: 4,
  exampleMarkupChars: 6_000,
  patternChars: 20_000,
  issues: 64,
} as const);

export interface UiPatternRegion {
  readonly id: string;
  readonly purpose: string;
  readonly relationship: string;
}

export interface UiPatternComponentChoice {
  readonly whenToUse: string;
  readonly tags: readonly string[];
  readonly rationale: string;
}

export interface UiPatternVariant {
  readonly id: string;
  readonly whenToUse: string;
  readonly composition: string;
  readonly exampleMarkup: string;
}

export interface UiPattern {
  readonly id: string;
  readonly title: string;
  readonly whenToUse: string;
  readonly avoidWhen: readonly string[];
  readonly informationOrder: readonly string[];
  readonly regions: readonly UiPatternRegion[];
  readonly componentChoices: readonly UiPatternComponentChoice[];
  readonly variants: readonly UiPatternVariant[];
  readonly avoid: readonly string[];
}

export interface UiPatternSet {
  readonly version: string;
  readonly patterns: readonly UiPattern[];
}

export type UiPatternValidationIssueCode =
  | "duplicate-pattern-id"
  | "invalid-example"
  | "invalid-pattern-set"
  | "invalid-value"
  | "unknown-component";

export interface UiPatternValidationIssue {
  readonly code: UiPatternValidationIssueCode;
  readonly path: string;
}

export type UiPatternValidationResult =
  | { readonly ok: true; readonly set: UiPatternSet }
  | { readonly ok: false; readonly issues: readonly UiPatternValidationIssue[] };

const PATTERN_KEYS = Object.freeze([
  "avoid",
  "avoidWhen",
  "componentChoices",
  "id",
  "informationOrder",
  "regions",
  "title",
  "variants",
  "whenToUse",
] as const);
const REGION_KEYS = Object.freeze(["id", "purpose", "relationship"] as const);
const COMPONENT_CHOICE_KEYS = Object.freeze(["rationale", "tags", "whenToUse"] as const);
const VARIANT_KEYS = Object.freeze(["composition", "exampleMarkup", "id", "whenToUse"] as const);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function isBoundedString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= UI_PATTERN_BOUNDS.stringChars
  );
}

function isBoundedIdentifier(value: unknown): value is string {
  return isBoundedString(value) && isFacetIdentifier(value);
}

function isBoundedStringList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= UI_PATTERN_BOUNDS.listItems &&
    value.every(isBoundedString) &&
    new Set(value).size === value.length
  );
}

function pushIssue(
  issues: UiPatternValidationIssue[],
  code: UiPatternValidationIssueCode,
  path: string,
): void {
  if (issues.length < UI_PATTERN_BOUNDS.issues) issues.push(Object.freeze({ code, path }));
}

function validateRegion(value: unknown): value is UiPatternRegion {
  return (
    isRecord(value) &&
    hasExactKeys(value, REGION_KEYS) &&
    isBoundedIdentifier(value["id"]) &&
    isBoundedString(value["purpose"]) &&
    isBoundedString(value["relationship"])
  );
}

function validateComponentChoiceShape(value: unknown): value is UiPatternComponentChoice {
  return (
    isRecord(value) &&
    hasExactKeys(value, COMPONENT_CHOICE_KEYS) &&
    isBoundedString(value["whenToUse"]) &&
    Array.isArray(value["tags"]) &&
    value["tags"].length >= 1 &&
    value["tags"].length <= UI_PATTERN_BOUNDS.tagsPerChoice &&
    value["tags"].every(isBoundedIdentifier) &&
    new Set(value["tags"]).size === value["tags"].length &&
    isBoundedString(value["rationale"])
  );
}

function validateVariantShape(value: unknown): value is UiPatternVariant {
  return (
    isRecord(value) &&
    hasExactKeys(value, VARIANT_KEYS) &&
    isBoundedIdentifier(value["id"]) &&
    isBoundedString(value["whenToUse"]) &&
    isBoundedString(value["composition"]) &&
    typeof value["exampleMarkup"] === "string" &&
    value["exampleMarkup"].length >= 1 &&
    value["exampleMarkup"].length <= UI_PATTERN_BOUNDS.exampleMarkupChars
  );
}

function measureJson(value: unknown): number | null {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? serialized.length : null;
  } catch {
    return null;
  }
}

/**
 * Validates design guidance against the same immutable catalog and declarative
 * authoring boundary as live markup. It never renders or mutates a stage.
 */
export function validateUiPatternSet(
  value: unknown,
  catalog: FacetCatalog,
): UiPatternValidationResult {
  const issues: UiPatternValidationIssue[] = [];
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["patterns", "version"]) ||
    !Array.isArray(value["patterns"])
  ) {
    return { ok: false, issues: Object.freeze([{ code: "invalid-pattern-set", path: "$" }]) };
  }
  if (!isBoundedString(value["version"])) pushIssue(issues, "invalid-value", "version");
  const patterns = value["patterns"];
  if (patterns.length < 1 || patterns.length > UI_PATTERN_BOUNDS.patterns) {
    pushIssue(issues, "invalid-value", "patterns");
    return { ok: false, issues: Object.freeze(issues) };
  }

  const catalogTags = new Set(catalog.components.map(({ tag }) => tag));
  const patternIds = new Set<string>();
  for (const [patternIndex, candidate] of patterns.entries()) {
    const prefix = `patterns[${patternIndex}]`;
    if (!isRecord(candidate) || !hasExactKeys(candidate, PATTERN_KEYS)) {
      pushIssue(issues, "invalid-value", prefix);
      continue;
    }
    const patternChars = measureJson(candidate);
    if (patternChars === null || patternChars > UI_PATTERN_BOUNDS.patternChars) {
      pushIssue(issues, "invalid-value", prefix);
      continue;
    }
    if (!isBoundedIdentifier(candidate["id"])) {
      pushIssue(issues, "invalid-value", `${prefix}.id`);
    } else if (patternIds.has(candidate["id"])) {
      pushIssue(issues, "duplicate-pattern-id", `${prefix}.id`);
    } else {
      patternIds.add(candidate["id"]);
    }
    if (!isBoundedString(candidate["title"])) pushIssue(issues, "invalid-value", `${prefix}.title`);
    if (!isBoundedString(candidate["whenToUse"])) {
      pushIssue(issues, "invalid-value", `${prefix}.whenToUse`);
    }
    for (const key of ["avoidWhen", "informationOrder", "avoid"] as const) {
      if (!isBoundedStringList(candidate[key])) {
        pushIssue(issues, "invalid-value", `${prefix}.${key}`);
      }
    }

    const regions = candidate["regions"];
    if (
      !Array.isArray(regions) ||
      regions.length < 1 ||
      regions.length > UI_PATTERN_BOUNDS.regionsPerPattern
    ) {
      pushIssue(issues, "invalid-value", `${prefix}.regions`);
    } else {
      const regionIds = new Set<string>();
      for (const [regionIndex, region] of regions.entries()) {
        if (!validateRegion(region) || regionIds.has(region.id)) {
          pushIssue(issues, "invalid-value", `${prefix}.regions[${regionIndex}]`);
        } else {
          regionIds.add(region.id);
        }
      }
    }

    const choices = candidate["componentChoices"];
    if (
      !Array.isArray(choices) ||
      choices.length < 1 ||
      choices.length > UI_PATTERN_BOUNDS.componentChoicesPerPattern
    ) {
      pushIssue(issues, "invalid-value", `${prefix}.componentChoices`);
    } else {
      for (const [choiceIndex, choice] of choices.entries()) {
        const choicePath = `${prefix}.componentChoices[${choiceIndex}]`;
        if (!validateComponentChoiceShape(choice)) {
          pushIssue(issues, "invalid-value", choicePath);
          continue;
        }
        for (const [tagIndex, tag] of choice.tags.entries()) {
          if (!catalogTags.has(tag)) {
            pushIssue(issues, "unknown-component", `${choicePath}.tags[${tagIndex}]`);
          }
        }
      }
    }

    const variants = candidate["variants"];
    if (
      !Array.isArray(variants) ||
      variants.length < 1 ||
      variants.length > UI_PATTERN_BOUNDS.variantsPerPattern
    ) {
      pushIssue(issues, "invalid-value", `${prefix}.variants`);
    } else {
      const variantIds = new Set<string>();
      for (const [variantIndex, variant] of variants.entries()) {
        const variantPath = `${prefix}.variants[${variantIndex}]`;
        if (!validateVariantShape(variant) || variantIds.has(variant.id)) {
          pushIssue(issues, "invalid-value", variantPath);
          continue;
        }
        variantIds.add(variant.id);
        const parsed = parseMarkup(variant.exampleMarkup);
        if (!parsed.ok || !validateAuthorMarkup(parsed.ast, catalog, {}).ok) {
          pushIssue(issues, "invalid-example", `${variantPath}.exampleMarkup`);
        }
      }
    }
  }

  if (issues.length > 0) return { ok: false, issues: Object.freeze(issues) };
  return { ok: true, set: value as unknown as UiPatternSet };
}
