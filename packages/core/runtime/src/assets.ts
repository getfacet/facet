import {
  validateCatalog,
  validateComposition,
  validateTheme,
  validateTree,
  type FacetComposition,
  type FacetCatalog,
  type FacetTheme,
  type FacetTree,
} from "@facet/core";
import { DEFAULT_CATALOG, DEFAULT_COMPOSITIONS, DEFAULT_THEME } from "@facet/assets";
import type { AssetsStore } from "./asset-store.js";
import { isSeedableTree } from "./initial-stage.js";

export { MemoryAssets, type AssetDocuments, type AssetsStore } from "./asset-store.js";
export { isSeedableTree, withInitialStage } from "./initial-stage.js";
const MAX_ASSET_DOCUMENTS = 1024;
const MAX_ASSET_ISSUES = 64;
const MAX_ASSET_ISSUE_CHARS = 200;
const ASSET_ISSUES_SUPPRESSED = "...further asset issues suppressed";

type AssetArrayField = "issues" | "themes" | "compositions";

type AssetField = "issues" | "themes" | "compositions" | "catalog" | "initialTree";
type FieldRead = { readonly ok: true; readonly value: unknown } | { readonly ok: false };

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null;
}

function isAssetArray(value: unknown): value is readonly unknown[] {
  try {
    return Array.isArray(value);
  } catch {
    return false;
  }
}

function readAssetField(
  docs: Record<PropertyKey, unknown>,
  field: AssetField,
  issues: string[],
): FieldRead {
  try {
    return { ok: true, value: docs[field] };
  } catch {
    if (field === "initialTree") {
      pushAssetIssue(issues, "initial tree skipped: document threw during validation");
    } else {
      pushAssetIssue(issues, `assets \`${field}\` threw during validation — ignored`);
    }
    return { ok: false };
  }
}

function isControlChar(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

function sanitizeAssetIssue(raw: string): string {
  let out = "";
  const limit = Math.min(raw.length, MAX_ASSET_ISSUE_CHARS);
  for (let i = 0; i < limit; i += 1) {
    const ch = raw[i]!;
    out += isControlChar(ch.charCodeAt(0)) ? "?" : ch;
  }
  return raw.length > MAX_ASSET_ISSUE_CHARS ? `${out}...` : out;
}

function describeAssetError(err: unknown): string {
  try {
    if (err instanceof Error) {
      return err.message === "" ? "unknown error" : err.message;
    }
  } catch {
    return "unreadable error";
  }
  if (
    err === null ||
    err === undefined ||
    typeof err === "string" ||
    typeof err === "number" ||
    typeof err === "boolean" ||
    typeof err === "bigint" ||
    typeof err === "symbol"
  ) {
    try {
      return String(err);
    } catch {
      return "unreadable error";
    }
  }
  return "non-error rejection";
}

function pushAssetIssue(issues: string[], issue: string): void {
  if (issues.length >= MAX_ASSET_ISSUES) {
    if (issues[issues.length - 1] !== ASSET_ISSUES_SUPPRESSED) {
      issues.push(ASSET_ISSUES_SUPPRESSED);
    }
    return;
  }
  issues.push(sanitizeAssetIssue(issue));
}

function readAssetArrayLength(
  value: readonly unknown[],
  label: AssetArrayField,
  issues: string[],
  maxItems: number,
): number {
  try {
    const length = value.length;
    if (Number.isSafeInteger(length) && length >= 0) {
      if (length > maxItems) {
        pushAssetIssue(
          issues,
          `assets \`${label}\` had ${String(length)} item(s); truncated to ${String(maxItems)}`,
        );
        return maxItems;
      }
      return length;
    }
  } catch {
    // Fall through to the shared issue below.
  }
  pushAssetIssue(issues, `assets \`${label}\` length was unreadable — ignored`);
  return 0;
}

function readAssetArrayItem(
  value: readonly unknown[],
  index: number,
  label: AssetArrayField,
  issues: string[],
): FieldRead {
  try {
    return { ok: true, value: value[index] };
  } catch {
    pushAssetIssue(
      issues,
      `assets \`${label}\` item ${String(index)} threw during validation — ignored`,
    );
    return { ok: false };
  }
}

/** The result of validating an `AssetDocuments` set: only documents that cleared
 * their core validator survive; everything skipped or fixed is named in `issues`.
 * The `themes` and `compositions` lists are frozen — defaults and customs share
 * one immutable validated list each. */
export interface LoadedAssets {
  readonly themes: readonly FacetTheme[];
  readonly compositions: readonly FacetComposition[];
  readonly catalog: FacetCatalog;
  readonly initialTree?: FacetTree;
  readonly issues: readonly string[];
}

/**
 * Runs the core validators once, at boot (Decision Lock: no hot reload).
 *
 * The `@facet/assets` defaults are seeded as the BASE LAYER at the head of both
 * the theme and the composition loop and run through the SAME `validateTheme` /
 * `validateComposition` gate as custom docs (never trusted-in): a bad default is
 * dropped with a recorded issue while the remaining defaults + customs survive.
 * With an empty/absent store the default base layer still resolves (DC-001).
 *
 * Collision rules are SYMMETRIC across both kinds:
 *  - defaults-first, then custom docs;
 *  - a custom doc whose name equals a SEEDED DEFAULT shadows it — the seeded entry
 *    is dropped and the custom appended (defaults-first, custom-last), with a
 *    recorded issue, so the list holds exactly one entry for that name (the
 *    custom). This is a load-time LIST swap, NOT a merge: for themes, render's
 *    `resolveTheme` stays the single merge site that overlays the shadowing custom
 *    onto the imported default value-map floor (DC-007); for compositions the
 *    custom simply replaces the default (DC-003);
 *  - custom-vs-custom (neither a seeded default) stays first-wins + issue.
 *
 * The initial tree passes `validateTree` PLUS `isSeedableTree` — the EMPTY_TREE
 * trap: a tree `validateTree` reduced to empty is refused so it can't silently
 * seed an empty stage and flip the server's offline face. Invalid documents are
 * skipped with a logged issue and boot proceeds — the `FileStageStore`
 * skip-and-log posture. Never throws.
 */
export async function loadAssets(store: AssetsStore, agentId: string): Promise<LoadedAssets> {
  // The primary I/O fetch is guarded too: a pluggable adapter (a DB/proxy store)
  // can reject or return a malformed shape, and the "Never throws" contract must
  // hold for it — not just for the per-document validators below.
  let rawDocs: unknown;
  const issues: string[] = [];
  try {
    rawDocs = await store.load(agentId);
  } catch (err) {
    rawDocs = {
      themes: [],
      compositions: [],
    };
    pushAssetIssue(issues, `assets load failed: ${describeAssetError(err)}`);
  }
  let docs: Record<PropertyKey, unknown>;
  if (isRecord(rawDocs)) {
    docs = rawDocs;
  } else {
    pushAssetIssue(issues, "assets document was not an object — ignored");
    docs = {};
  }
  const rawIssues = readAssetField(docs, "issues", issues);
  if (rawIssues.ok && rawIssues.value !== undefined) {
    if (isAssetArray(rawIssues.value)) {
      const length = readAssetArrayLength(rawIssues.value, "issues", issues, MAX_ASSET_ISSUES);
      for (let i = 0; i < length; i += 1) {
        const issue = readAssetArrayItem(rawIssues.value, i, "issues", issues);
        if (issue.ok && typeof issue.value === "string") pushAssetIssue(issues, issue.value);
      }
    } else {
      pushAssetIssue(issues, "assets `issues` was not an array — ignored");
    }
  }
  // Coerce the trusted array fields so a malformed `{ themes: null }` from a
  // custom adapter can't throw at the spread sites below (skip-and-log, never
  // crash boot). Defaults still seed, so an empty/bad store yields the defaults.
  // Only the canonical fields are read — legacy pre-canonicalization arrays
  // never execute.
  const rawThemes = readAssetField(docs, "themes", issues);
  const themeDocs = rawThemes.ok && isAssetArray(rawThemes.value) ? rawThemes.value : [];
  if (rawThemes.ok && !isAssetArray(rawThemes.value)) {
    pushAssetIssue(issues, "assets `themes` was not an array — ignored");
  }
  const rawCompositions = readAssetField(docs, "compositions", issues);
  const compositionDocs =
    rawCompositions.ok && isAssetArray(rawCompositions.value) ? rawCompositions.value : [];
  if (rawCompositions.ok && !isAssetArray(rawCompositions.value)) {
    pushAssetIssue(issues, "assets `compositions` was not an array — ignored");
  }
  const rawCatalog = readAssetField(docs, "catalog", issues);
  const catalogInput =
    rawCatalog.ok && rawCatalog.value !== undefined ? rawCatalog.value : DEFAULT_CATALOG;

  const themes: FacetTheme[] = [];
  const seenThemeNames = new Set<string>();
  const seededThemeNames = new Set<string>();
  const loadTheme = (raw: unknown, seeded: boolean): void => {
    // Skip-and-log at the seam: a live in-process document (a DB adapter, a
    // proxy) can throw from a property accessor. `validateTheme` already guards
    // its own reads, but the try/catch keeps this loop's "Never throws" contract
    // true for any future validator too.
    let result: ReturnType<typeof validateTheme>;
    try {
      result = validateTheme(raw);
    } catch {
      pushAssetIssue(issues, `${seeded ? "default " : ""}theme document skipped: validation threw`);
      return;
    }
    const { theme, issues: themeIssues } = result;
    if (theme === undefined) {
      const why = themeIssues
        .filter((i) => i.severity === "error")
        .map((i) => i.message)
        .join("; ");
      pushAssetIssue(
        issues,
        `${seeded ? "default " : ""}theme document skipped: ${why || "invalid"}`,
      );
      return;
    }
    if (seenThemeNames.has(theme.name)) {
      if (!seeded && seededThemeNames.has(theme.name)) {
        // Custom shadows a seeded default: drop the seeded entry and append the
        // custom (defaults-first, custom-last) so the list holds exactly one entry
        // for the name — the custom. A load-time LIST swap, never a merge: render's
        // `resolveTheme` stays the single merge site (overlays custom onto floor).
        const at = themes.findIndex((t) => t.name === theme.name);
        if (at !== -1) themes.splice(at, 1);
        seededThemeNames.delete(theme.name);
        pushAssetIssue(issues, `custom theme "${theme.name}" shadows the seeded default`);
        for (const warning of themeIssues) {
          pushAssetIssue(issues, `theme "${theme.name}": ${warning.message}`);
        }
        themes.push(theme);
        return;
      }
      // Custom-vs-custom (or a duplicate default): first wins.
      pushAssetIssue(issues, `duplicate theme name "${theme.name}" ignored (first wins)`);
      return;
    }
    seenThemeNames.add(theme.name);
    if (seeded) seededThemeNames.add(theme.name);
    for (const warning of themeIssues) {
      pushAssetIssue(issues, `theme "${theme.name}": ${warning.message}`);
    }
    themes.push(theme);
  };
  // Defaults first (seeded), then custom docs. Both run the SAME validateTheme
  // gate — a bad default is dropped with an issue, exactly like a bad custom.
  loadTheme(DEFAULT_THEME, true);
  const themeCount = readAssetArrayLength(themeDocs, "themes", issues, MAX_ASSET_DOCUMENTS);
  const compositionCount = readAssetArrayLength(
    compositionDocs,
    "compositions",
    issues,
    MAX_ASSET_DOCUMENTS,
  );
  for (let i = 0; i < themeCount; i += 1) {
    const raw = readAssetArrayItem(themeDocs, i, "themes", issues);
    if (raw.ok) loadTheme(raw.value, false);
  }

  // The ONE composition path: defaults and custom docs run through the same
  // validate/dedupe/shadow loop into the same list (DC-006).
  const compositions: FacetComposition[] = [];
  const seenCompositionNames = new Set<string>();
  const seededCompositionNames = new Set<string>();
  const loadComposition = (raw: unknown, seeded: boolean): void => {
    let result: ReturnType<typeof validateComposition>;
    try {
      result = validateComposition(raw);
    } catch {
      pushAssetIssue(
        issues,
        `${seeded ? "default " : ""}composition document skipped: validation threw`,
      );
      return;
    }
    const { composition, issues: compositionIssues } = result;
    if (composition === undefined) {
      pushAssetIssue(
        issues,
        `${seeded ? "default " : ""}composition document skipped: ${
          compositionIssues.join("; ") || "invalid"
        }`,
      );
      return;
    }
    if (seenCompositionNames.has(composition.name)) {
      if (!seeded && seededCompositionNames.has(composition.name)) {
        // Custom shadows a seeded default: drop the seeded entry, append the custom
        // (symmetric with the theme loop). The name already passed
        // validateComposition's isValidThemeName gate, so it's safe to echo.
        const at = compositions.findIndex((c) => c.name === composition.name);
        if (at !== -1) compositions.splice(at, 1);
        seededCompositionNames.delete(composition.name);
        pushAssetIssue(
          issues,
          `custom composition "${composition.name}" shadows the seeded default`,
        );
        for (const note of compositionIssues) {
          pushAssetIssue(issues, `composition "${composition.name}": ${note}`);
        }
        compositions.push(composition);
        return;
      }
      // Custom-vs-custom (or a duplicate default): first wins. Two same-named
      // compositions would inject contradictory entries into the prompt's
      // COMPOSITIONS section.
      pushAssetIssue(
        issues,
        `duplicate composition name "${composition.name}" ignored (first wins)`,
      );
      return;
    }
    seenCompositionNames.add(composition.name);
    if (seeded) seededCompositionNames.add(composition.name);
    for (const note of compositionIssues) {
      pushAssetIssue(issues, `composition "${composition.name}": ${note}`);
    }
    compositions.push(composition);
  };
  // Defaults first (seeded), then custom docs — the same symmetric layering the
  // theme loop uses, through the same validateComposition gate.
  for (const raw of DEFAULT_COMPOSITIONS) loadComposition(raw, true);
  for (let i = 0; i < compositionCount; i += 1) {
    const raw = readAssetArrayItem(compositionDocs, i, "compositions", issues);
    if (raw.ok) loadComposition(raw.value, false);
  }

  // `validateCatalog(undefined)` returns a FRESH default catalog per call and
  // never throws — the single source of a default clone, so runtime no longer
  // duplicates core's private clone helpers (which had to be edited in lockstep).
  let catalog: FacetCatalog = validateCatalog(undefined).catalog;
  try {
    const result = validateCatalog(catalogInput);
    catalog = result.catalog;
    for (const note of result.issues) {
      pushAssetIssue(issues, `catalog: ${note}`);
    }
    // Keep validateCatalog's output verbatim: it already fills per-section defaults
    // while PRESERVING any provided restriction (a partial doc loads as
    // authored-sections + defaults-for-the-rest). Do NOT wholesale-replace a
    // partial-but-restrictive custom catalog with the permissive bundled default —
    // that would fail open, swapping a stricter custom policy for a looser one.
  } catch {
    pushAssetIssue(issues, "catalog skipped: validation threw; using default catalog");
    catalog = validateCatalog(undefined).catalog;
  }

  let rawInitialTree: unknown;
  let hasInitialTree = false;
  const initialTreeRead = readAssetField(docs, "initialTree", issues);
  if (initialTreeRead.ok) {
    rawInitialTree = initialTreeRead.value;
    hasInitialTree = rawInitialTree !== undefined;
  }
  let initialTree: FacetTree | undefined;
  if (hasInitialTree) {
    try {
      const { tree, issues: treeIssues } = validateTree(rawInitialTree);
      for (const note of treeIssues) {
        pushAssetIssue(issues, `initial tree: ${note}`);
      }
      if (isSeedableTree(tree)) {
        initialTree = tree;
      } else {
        // The trap: `validateTree(garbage)` returns EMPTY_TREE; seeding it would
        // silently flip `hasBuiltStage` and change the offline face. Refuse it so
        // boot falls back to today's model-first paint.
        pushAssetIssue(
          issues,
          "initial tree is empty or invalid — not seedable; using model-first paint",
        );
      }
    } catch {
      pushAssetIssue(issues, "initial tree skipped: validation threw");
    }
  }

  const loaded: { -readonly [K in keyof LoadedAssets]: LoadedAssets[K] } = {
    themes: Object.freeze(themes),
    compositions: Object.freeze(compositions),
    catalog,
    issues,
  };
  if (initialTree !== undefined) loaded.initialTree = initialTree;
  return loaded;
}
