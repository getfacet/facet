import { validateAuthorTree, type AuthorIssue } from "./author-validation.js";
import { BoundedIssues, isControlChar, isForbiddenKey, isPlainObject, nullMap } from "./issues.js";
import { SLOT_NAME_RE } from "./slot-marker.js";
import type { FacetTheme } from "./theme-types.js";
import { MAX_DESCRIPTION_LENGTH } from "./theme-types.js";
import type { FacetTree } from "./tree.js";
import { TREE_FIELDS } from "./tree-fields.js";

/** Maximum exact Pattern list exposed in one agent asset snapshot. */
export const MAX_PATTERNS = 64;
/** Maximum raw nodes in one exact Pattern, preserving the former reference-data bound. */
export const MAX_PATTERN_NODES = 1023;

const PATTERN_FIELDS = new Set(["name", "description", "useWhen", "avoidWhen", ...TREE_FIELDS]);

/**
 * Read-only reference data an agent inspects and re-authors. A Pattern is an
 * ordinary Facet tree plus bounded discovery metadata; it adds no runtime
 * node, parameter, reference, or provenance syntax.
 */
export interface FacetPattern extends FacetTree {
  readonly name: string;
  readonly description: string;
  readonly useWhen: string;
  readonly avoidWhen?: string;
}

export interface PatternValidationResult {
  /** Present only when the complete Pattern is valid against the effective Theme. */
  readonly pattern?: FacetPattern;
  readonly issues: readonly string[];
}

export interface PatternListValidationResult {
  /** Every entry is a complete compatible Pattern; invalid entries are never partial. */
  readonly patterns: readonly FacetPattern[];
  readonly issues: readonly string[];
}

type SafeRead =
  | { readonly ok: true; readonly present: boolean; readonly value: unknown }
  | { readonly ok: false; readonly present: false };

function readOwn(input: Record<string, unknown>, key: string): SafeRead {
  try {
    const present = Object.prototype.hasOwnProperty.call(input, key);
    return { ok: true, present, value: present ? Reflect.get(input, key) : undefined };
  } catch {
    return { ok: false, present: false };
  }
}

function readProse(
  input: Record<string, unknown>,
  key: "description" | "useWhen" | "avoidWhen",
  required: boolean,
  issues: BoundedIssues,
): string | undefined {
  const read = readOwn(input, key);
  if (!read.ok) {
    issues.push(`pattern ${key} could not be read safely; refused`);
    return undefined;
  }
  if (!read.present && !required) return undefined;
  const value = read.value;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_DESCRIPTION_LENGTH ||
    value.trim() !== value
  ) {
    issues.push(
      `pattern ${key} must be non-empty bounded prose without surrounding whitespace; refused`,
    );
    return undefined;
  }
  for (let index = 0; index < value.length; index += 1) {
    if (isControlChar(value.charCodeAt(index))) {
      issues.push(`pattern ${key} contains a control character; refused`);
      return undefined;
    }
  }
  return value;
}

function authorIssueMessage(issue: AuthorIssue): string {
  return `pattern tree${issue.path}: ${issue.message}`;
}

function readTreeInput(
  input: Record<string, unknown>,
  issues: BoundedIssues,
): Record<string, unknown> {
  const treeInput: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const field of TREE_FIELDS) {
    const read = readOwn(input, field);
    if (!read.ok) {
      issues.push(`pattern ${field} could not be read safely; refused`);
    } else if (read.present) {
      treeInput[field] = read.value;
    }
  }
  return treeInput;
}

/**
 * Capture one bounded raw-node view before strict validation. Over-cap maps are
 * refused before any value read; accepted keys/values move to a null-prototype
 * map so a hostile Proxy cannot change `ownKeys` during later traversal.
 */
function snapshotBoundedPatternNodes(
  treeInput: Record<string, unknown>,
  issues: BoundedIssues,
): boolean {
  const rawNodes = treeInput.nodes;
  if (!isPlainObject(rawNodes)) return true;
  let nodeKeys: readonly string[];
  try {
    nodeKeys = Object.keys(rawNodes);
  } catch {
    issues.push("pattern node keys could not be read safely; refused");
    return false;
  }
  if (nodeKeys.length > MAX_PATTERN_NODES) {
    issues.push(`pattern nodes exceeded the ${MAX_PATTERN_NODES}-node cap; refused`);
    return false;
  }
  const nodes = nullMap<unknown>();
  for (const nodeId of nodeKeys) {
    try {
      nodes[nodeId] = Reflect.get(rawNodes, nodeId);
    } catch {
      issues.push("pattern node value could not be read safely; refused");
      return false;
    }
  }
  treeInput.nodes = nodes;
  return true;
}

function assemblePattern(
  name: string,
  description: string,
  useWhen: string,
  avoidWhen: string | undefined,
  tree: FacetTree,
): FacetPattern {
  const pattern: {
    name: string;
    description: string;
    useWhen: string;
    avoidWhen?: string;
    root: FacetTree["root"];
    nodes: FacetTree["nodes"];
    screens?: NonNullable<FacetTree["screens"]>;
    entry?: NonNullable<FacetTree["entry"]>;
    data?: NonNullable<FacetTree["data"]>;
  } = { name, description, useWhen, root: tree.root, nodes: tree.nodes };
  if (avoidWhen !== undefined) pattern.avoidWhen = avoidWhen;
  if (tree.screens !== undefined) pattern.screens = tree.screens;
  if (tree.entry !== undefined) pattern.entry = tree.entry;
  if (tree.data !== undefined) pattern.data = tree.data;
  return pattern;
}

function validatePatternUnsafe(
  input: unknown,
  effectiveTheme: FacetTheme,
  issues: BoundedIssues,
): PatternValidationResult {
  if (!isPlainObject(input)) {
    issues.push("pattern is not an object; refused");
    return { issues: issues.list };
  }

  let keys: readonly string[];
  try {
    keys = Object.keys(input);
  } catch {
    issues.push("pattern keys could not be read safely; refused");
    return { issues: issues.list };
  }
  for (const key of keys) {
    if (isForbiddenKey(key) || !PATTERN_FIELDS.has(key)) {
      issues.push("pattern has unknown or forbidden top-level syntax; refused");
    }
  }

  const treeInput = readTreeInput(input, issues);
  if (!snapshotBoundedPatternNodes(treeInput, issues)) {
    return { issues: issues.list };
  }

  const nameRead = readOwn(input, "name");
  const name = nameRead.ok && nameRead.present ? nameRead.value : undefined;
  if (typeof name !== "string" || !SLOT_NAME_RE.test(name)) {
    issues.push("pattern name is missing or malformed (letters/digits/_/-, max 64); refused");
  }
  const description = readProse(input, "description", true, issues);
  const useWhen = readProse(input, "useWhen", true, issues);
  const avoidWhen = readProse(input, "avoidWhen", false, issues);

  const treeResult = validateAuthorTree(treeInput, effectiveTheme);
  for (const issue of treeResult.issues) issues.push(authorIssueMessage(issue));
  if (treeResult.omittedErrorCount > 0) {
    issues.push(`${String(treeResult.omittedErrorCount)} additional pattern tree errors omitted`);
  }

  if (
    issues.list.length > 0 ||
    typeof name !== "string" ||
    description === undefined ||
    useWhen === undefined ||
    treeResult.value === undefined
  ) {
    return { issues: issues.list };
  }

  return {
    pattern: assemblePattern(name, description, useWhen, avoidWhen, treeResult.value),
    issues: issues.list,
  };
}

/**
 * Strict Theme-aware validation for one untrusted Pattern. Unlike the renderer
 * sanitizer, this boundary never repairs or exposes a partial Pattern.
 */
export function validatePattern(
  input: unknown,
  effectiveTheme: FacetTheme,
): PatternValidationResult {
  const issues = new BoundedIssues();
  try {
    return validatePatternUnsafe(input, effectiveTheme, issues);
  } catch {
    issues.push("pattern could not be read safely; refused");
    return { issues: issues.list };
  }
}

/**
 * Validates one exact untrusted list. Over-limit input is rejected as a whole,
 * while each malformed/incompatible entry is hidden as one whole Pattern.
 */
export function validatePatternList(
  input: unknown,
  effectiveTheme: FacetTheme,
): PatternListValidationResult {
  const issues = new BoundedIssues();
  try {
    if (!Array.isArray(input)) {
      issues.push("patterns is not an array; none exposed");
      return { patterns: [], issues: issues.list };
    }
    if (input.length > MAX_PATTERNS) {
      issues.push(`patterns exceeded the ${MAX_PATTERNS}-Pattern cap; none exposed`);
      return { patterns: [], issues: issues.list };
    }
    const patterns: FacetPattern[] = [];
    for (let index = 0; index < input.length; index += 1) {
      const result = validatePattern(input[index], effectiveTheme);
      if (result.pattern !== undefined) {
        patterns.push(result.pattern);
      } else {
        for (const issue of result.issues) {
          issues.push(`pattern[${String(index)}]: ${issue}`);
        }
      }
    }
    return { patterns, issues: issues.list };
  } catch {
    issues.push("patterns could not be read safely; none exposed");
    return { patterns: [], issues: issues.list };
  }
}
