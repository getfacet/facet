import {
  validateAuthorTree,
  validatePatternList,
  validateTheme,
  type FacetPattern,
  type FacetTheme,
  type FacetTree,
} from "@facet/core";
import { DEFAULT_PATTERNS, DEFAULT_THEME } from "@facet/assets";
import { AssetIssues, describeAssetError } from "./asset-issues.js";
import type { AssetsStore } from "./asset-store.js";
import { isSeedableTree } from "./initial-stage.js";

export { MemoryAssets, type AssetDocuments, type AssetsStore } from "./asset-store.js";
export { isSeedableTree, withInitialStage } from "./initial-stage.js";

const RETIRED_FIELDS = ["themes", "compositions", "catalog"] as const;

type FieldRead =
  | { readonly ok: true; readonly present: boolean; readonly value: unknown }
  | { readonly ok: false; readonly present: boolean };

type Presence = true | false | "unreadable";

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  try {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
}

function readField(record: Record<PropertyKey, unknown>, field: PropertyKey): FieldRead {
  const presence = ownPresence(record, field);
  if (presence === "unreadable") return { ok: false, present: false };
  if (!presence) return { ok: true, present: false, value: undefined };
  try {
    return { ok: true, present: true, value: Reflect.get(record, field) };
  } catch {
    return { ok: false, present: true };
  }
}

function ownPresence(record: Record<PropertyKey, unknown>, field: PropertyKey): Presence {
  try {
    return Object.prototype.hasOwnProperty.call(record, field);
  } catch {
    return "unreadable";
  }
}

function readIssueArray(raw: unknown, issues: AssetIssues): void {
  if (raw === undefined) return;
  let array: readonly unknown[];
  try {
    if (!Array.isArray(raw)) {
      issues.push("assets `issues` was not an array — ignored");
      return;
    }
    array = raw;
  } catch {
    issues.push("assets `issues` could not be read safely — ignored");
    return;
  }
  let length: number;
  try {
    length = Math.min(array.length, 64);
  } catch {
    issues.push("assets `issues` length could not be read safely — ignored");
    return;
  }
  for (let index = 0; index < length; index += 1) {
    try {
      const value = array[index];
      if (typeof value === "string") issues.push(value);
    } catch {
      issues.push(`assets \`issues\` item ${String(index)} could not be read safely — ignored`);
    }
  }
}

function effectiveTheme(raw: FieldRead, issues: AssetIssues): FacetTheme {
  if (!raw.ok) {
    issues.push("assets `theme` could not be read safely — using default Theme");
    return requiredDefaultTheme(issues);
  }
  if (!raw.present) return requiredDefaultTheme(issues);
  const result = validateTheme(raw.value);
  if (result.theme !== undefined) return result.theme;
  for (const issue of result.issues) issues.push(`theme: ${issue.message}`);
  issues.push("custom Theme was invalid — using default Theme whole");
  return requiredDefaultTheme(issues);
}

function requiredDefaultTheme(issues: AssetIssues): FacetTheme {
  const result = validateTheme(DEFAULT_THEME);
  if (result.theme !== undefined) return result.theme;
  // Bundled data is tested and release-gated. Keep the public load contract
  // total if that invariant is ever violated, while surfacing the defect.
  issues.push("bundled default Theme failed validation");
  return DEFAULT_THEME;
}

function exactPatterns(
  raw: FieldRead,
  theme: FacetTheme,
  issues: AssetIssues,
): readonly FacetPattern[] {
  if (!raw.ok) {
    issues.push("assets `patterns` could not be read safely — none exposed");
    return [];
  }
  const input = raw.present ? raw.value : DEFAULT_PATTERNS;
  const result = validatePatternList(input, theme);
  for (const issue of result.issues) issues.push(issue);
  return result.patterns;
}

function strictInitialTree(
  raw: FieldRead,
  theme: FacetTheme,
  issues: AssetIssues,
): FacetTree | undefined {
  if (!raw.ok) {
    issues.push("initial tree could not be read safely — ignored");
    return undefined;
  }
  if (!raw.present) return undefined;
  const result = validateAuthorTree(raw.value, theme);
  if (result.value === undefined) {
    for (const issue of result.issues) {
      issues.push(`initial tree${issue.path}: ${issue.message}`);
    }
    if (result.omittedErrorCount > 0) {
      issues.push(`${String(result.omittedErrorCount)} additional initial tree errors omitted`);
    }
    return undefined;
  }
  if (!isSeedableTree(result.value)) {
    issues.push("initial tree is empty — using model-first paint");
    return undefined;
  }
  return result.value;
}

/** Deep-freezes only validator-owned plain data; hostile raw documents never reach here. */
function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

/** One validated, immutable asset snapshot used for a complete agent turn. */
export interface LoadedAssets {
  readonly theme: FacetTheme;
  readonly patterns: readonly FacetPattern[];
  readonly initialTree?: FacetTree;
  readonly issues: readonly string[];
}

/**
 * Resolves the singular Theme, exact compatible Patterns, and strict initial
 * tree once. This boundary is total: hostile operator inputs become bounded
 * issues, never executable or partially trusted data.
 */
export async function loadAssets(store: AssetsStore, agentId: string): Promise<LoadedAssets> {
  const issues = new AssetIssues();
  let rawDocuments: unknown;
  try {
    rawDocuments = await store.load(agentId);
  } catch (error) {
    rawDocuments = {};
    issues.push(`assets load failed: ${describeAssetError(error)}`);
  }

  let documents: Record<PropertyKey, unknown>;
  if (isRecord(rawDocuments)) {
    documents = rawDocuments;
  } else {
    documents = {};
    issues.push("assets document was not an object — using defaults");
  }

  const rawIssues = readField(documents, "issues");
  if (!rawIssues.ok) issues.push("assets `issues` could not be read safely — ignored");
  else if (rawIssues.present) readIssueArray(rawIssues.value, issues);

  for (const field of RETIRED_FIELDS) {
    const presence = ownPresence(documents, field);
    if (presence === "unreadable") {
      issues.push(`retired asset field \`${field}\` could not be inspected safely`);
    } else if (presence) {
      issues.push(`retired asset field \`${field}\` ignored`);
    }
  }

  const theme = effectiveTheme(readField(documents, "theme"), issues);
  const patterns = exactPatterns(readField(documents, "patterns"), theme, issues);
  const initialTree = strictInitialTree(readField(documents, "initialTree"), theme, issues);

  const loaded: {
    theme: FacetTheme;
    patterns: readonly FacetPattern[];
    initialTree?: FacetTree;
    issues: readonly string[];
  } = { theme, patterns, issues: [...issues.list] };
  if (initialTree !== undefined) loaded.initialTree = initialTree;
  return deepFreeze(loaded);
}
