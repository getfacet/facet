import { createHash } from "node:crypto";

import { DEFAULT_PATTERNS, DEFAULT_THEME } from "@facet/assets";
import { validatePatternList, validateTheme } from "@facet/core";
import type { FacetPattern, FacetTheme } from "@facet/core";
import { MAX_ASSET_BUNDLE_BYTES, MIN_RUN_EVIDENCE_RESERVE_BYTES } from "../shared/run-contract.js";

export const ASSET_SNAPSHOT_SCHEMA_VERSION = 1 as const;
export { MAX_ASSET_BUNDLE_BYTES, MIN_RUN_EVIDENCE_RESERVE_BYTES };
export const MAX_ASSET_DOCUMENT_BYTES = 1024 * 1024;
export const MAX_ASSET_INPUT_DEPTH = 32;
export const MAX_ASSET_INPUT_NODES = 250_000;

export type AssetSnapshotSource = "default" | "custom";

export interface AssetSnapshot {
  readonly schemaVersion: typeof ASSET_SNAPSHOT_SCHEMA_VERSION;
  readonly source: AssetSnapshotSource;
  readonly digest: `sha256:${string}`;
  readonly theme: FacetTheme;
  readonly patterns: readonly FacetPattern[];
}

export type AssetImportIssueCode =
  | "invalid-bundle"
  | "unsupported-version"
  | "unknown-field"
  | "too-deep"
  | "too-many-nodes"
  | "cyclic-input"
  | "non-json-input"
  | "bundle-too-large"
  | "document-too-large"
  | "invalid-theme"
  | "invalid-pattern";

export interface AssetImportIssue {
  readonly code: AssetImportIssueCode;
  readonly message: string;
}

export type AssetImportResult =
  | {
      readonly accepted: true;
      readonly snapshot: AssetSnapshot;
      readonly issues: readonly AssetImportIssue[];
    }
  | {
      readonly accepted: false;
      readonly snapshot: AssetSnapshot;
      readonly issues: readonly AssetImportIssue[];
    };

type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
interface JsonObject {
  [key: string]: JsonValue;
}

type JsonCopyResult =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly issue: AssetImportIssue };

interface JsonCopyBudget {
  nodes: number;
  readonly ancestors: WeakSet<object>;
}

function issue(code: AssetImportIssueCode, message: string): AssetImportIssue {
  return Object.freeze({ code, message });
}

function copyJsonValue(input: unknown, depth: number, budget: JsonCopyBudget): JsonCopyResult {
  if (depth > MAX_ASSET_INPUT_DEPTH) {
    return { ok: false, issue: issue("too-deep", "Asset input exceeded the depth limit") };
  }

  budget.nodes += 1;
  if (budget.nodes > MAX_ASSET_INPUT_NODES) {
    return {
      ok: false,
      issue: issue("too-many-nodes", "Asset input exceeded the node limit"),
    };
  }

  if (input === null || typeof input === "string" || typeof input === "boolean") {
    return { ok: true, value: input };
  }
  if (typeof input === "number") {
    return Number.isFinite(input)
      ? { ok: true, value: input }
      : { ok: false, issue: issue("non-json-input", "Asset input must contain finite numbers") };
  }
  if (typeof input !== "object") {
    return {
      ok: false,
      issue: issue("non-json-input", "Asset input must contain only JSON values"),
    };
  }

  if (budget.ancestors.has(input)) {
    return { ok: false, issue: issue("cyclic-input", "Asset input must not contain cycles") };
  }

  budget.ancestors.add(input);
  try {
    const prototype = Object.getPrototypeOf(input);
    if (!Array.isArray(input) && prototype !== Object.prototype && prototype !== null) {
      return {
        ok: false,
        issue: issue("non-json-input", "Asset input must contain only plain JSON objects"),
      };
    }
    if (Object.getOwnPropertySymbols(input).length > 0) {
      return {
        ok: false,
        issue: issue("non-json-input", "Asset input must not contain symbol properties"),
      };
    }

    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (Array.isArray(input)) {
      const output: JsonValue[] = [];
      for (let index = 0; index < input.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
          return {
            ok: false,
            issue: issue("non-json-input", "Asset arrays must be dense JSON arrays"),
          };
        }
        const child = copyJsonValue(descriptor.value, depth + 1, budget);
        if (!child.ok) return child;
        output.push(child.value);
      }
      const extraKeys = Object.keys(descriptors).filter(
        (key) => key !== "length" && !/^(?:0|[1-9][0-9]*)$/u.test(key),
      );
      if (extraKeys.length > 0) {
        return {
          ok: false,
          issue: issue("non-json-input", "Asset arrays must not contain named properties"),
        };
      }
      return { ok: true, value: output };
    }

    const output: JsonObject = Object.create(null) as JsonObject;
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!("value" in descriptor) || !descriptor.enumerable) {
        return {
          ok: false,
          issue: issue("non-json-input", "Asset objects must contain enumerable data properties"),
        };
      }
      const child = copyJsonValue(descriptor.value, depth + 1, budget);
      if (!child.ok) return child;
      output[key] = child.value;
    }
    return { ok: true, value: output };
  } catch {
    return {
      ok: false,
      issue: issue("non-json-input", "Asset input could not be read safely"),
    };
  } finally {
    budget.ancestors.delete(input);
  }
}

function copyJson(input: unknown): JsonCopyResult {
  return copyJsonValue(input, 0, { nodes: 0, ancestors: new WeakSet<object>() });
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonBytes(value: JsonValue): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function stableJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key]!)}`)
    .join(",")}}`;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function cloneAsJson<T>(value: T): T {
  return structuredClone(value);
}

/** Canonical identity shared by active snapshots and imported evidence validation. */
export function computeAssetDigest(
  theme: FacetTheme,
  patterns: readonly FacetPattern[],
): `sha256:${string}` | undefined {
  const digestInput = copyJson({ theme, patterns });
  if (!digestInput.ok) return undefined;
  return `sha256:${createHash("sha256").update(stableJson(digestInput.value)).digest("hex")}`;
}

function createSnapshot(
  source: AssetSnapshotSource,
  theme: FacetTheme,
  patterns: readonly FacetPattern[],
): AssetSnapshot {
  const themeCopy = deepFreeze(cloneAsJson(theme));
  const patternCopy = deepFreeze(cloneAsJson(patterns));
  const digest = computeAssetDigest(themeCopy, patternCopy);
  if (digest === undefined) throw new Error("Validated Facet assets were not JSON-compatible");
  return deepFreeze({
    schemaVersion: ASSET_SNAPSHOT_SCHEMA_VERSION,
    source,
    digest,
    theme: themeCopy,
    patterns: patternCopy,
  });
}

function rejected(snapshot: AssetSnapshot, firstIssue: AssetImportIssue): AssetImportResult {
  return Object.freeze({ accepted: false, snapshot, issues: Object.freeze([firstIssue]) });
}

/** Builds the known-good bundled selection through the same public Core validators. */
export function createDefaultAssetSnapshot(): AssetSnapshot {
  const themeResult = validateTheme(DEFAULT_THEME);
  if (themeResult.theme === undefined) {
    throw new Error("Bundled Facet Lab Theme failed Core validation");
  }
  const patternResult = validatePatternList(DEFAULT_PATTERNS, themeResult.theme);
  if (patternResult.issues.length > 0) {
    throw new Error("Bundled Facet Lab Patterns failed Core validation");
  }
  return createSnapshot("default", themeResult.theme, patternResult.patterns);
}

/**
 * Strict all-or-nothing import. Any envelope, budget, Theme, or Pattern issue
 * returns the exact prior selection and cannot mutate the selected assets.
 */
export function importAssetBundle(prior: AssetSnapshot, candidate: unknown): AssetImportResult {
  const copied = copyJson(candidate);
  if (!copied.ok) return rejected(prior, copied.issue);
  if (!isJsonObject(copied.value)) {
    return rejected(prior, issue("invalid-bundle", "Asset bundle must be a JSON object"));
  }
  if (jsonBytes(copied.value) > MAX_ASSET_BUNDLE_BYTES) {
    return rejected(
      prior,
      issue("bundle-too-large", "Asset bundle left too little space for terminal run evidence"),
    );
  }

  const allowedFields = new Set(["schemaVersion", "theme", "patterns"]);
  if (Object.keys(copied.value).some((key) => !allowedFields.has(key))) {
    return rejected(prior, issue("unknown-field", "Asset bundle contained an unknown field"));
  }
  if (copied.value.schemaVersion !== ASSET_SNAPSHOT_SCHEMA_VERSION) {
    return rejected(
      prior,
      issue("unsupported-version", "Asset bundle schema version is missing or unsupported"),
    );
  }
  if (!("theme" in copied.value) || !("patterns" in copied.value)) {
    return rejected(prior, issue("invalid-bundle", "Asset bundle is missing a required field"));
  }
  if (jsonBytes(copied.value.theme) > MAX_ASSET_DOCUMENT_BYTES) {
    return rejected(prior, issue("document-too-large", "Theme document exceeded the byte limit"));
  }
  if (Array.isArray(copied.value.patterns)) {
    for (const pattern of copied.value.patterns) {
      if (jsonBytes(pattern) > MAX_ASSET_DOCUMENT_BYTES) {
        return rejected(
          prior,
          issue("document-too-large", "Pattern document exceeded the byte limit"),
        );
      }
    }
  }

  const themeResult = validateTheme(copied.value.theme);
  if (themeResult.theme === undefined) {
    return rejected(prior, issue("invalid-theme", "Theme failed strict Core validation"));
  }
  const patternResult = validatePatternList(copied.value.patterns, themeResult.theme);
  if (patternResult.issues.length > 0) {
    return rejected(
      prior,
      issue("invalid-pattern", "One or more Patterns failed strict Core validation"),
    );
  }

  return Object.freeze({
    accepted: true,
    snapshot: createSnapshot("custom", themeResult.theme, patternResult.patterns),
    issues: Object.freeze([]),
  });
}

/** Captures a detached, deeply frozen, content-digested asset view for one run. */
export function createRunAssetSnapshot(selection: AssetSnapshot): AssetSnapshot {
  return createSnapshot(selection.source, selection.theme, selection.patterns);
}
