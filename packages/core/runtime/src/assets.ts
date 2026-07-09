import {
  validateCatalog,
  validateComponentDefinition,
  treeHasContent,
  validateStamp,
  validateTheme,
  validateTree,
  type FacetComponentDefinition,
  type FacetCatalog,
  type FacetSession,
  type FacetStamp,
  type FacetTheme,
  type FacetTree,
} from "@facet/core";
import { DEFAULT_CATALOG, DEFAULT_STAMPS, DEFAULT_THEME } from "@facet/assets";
import { sessionKey, type StageStore } from "./stage-store.js";

/** Hygiene cap on `withInitialStage`'s armed-but-unconsumed seed keys — mirrors
 * `FacetRuntime`'s `MAX_PENDING_SEEDS`. A visitor whose first turn never persists
 * (agent throw / save reject) leaves its key armed until it returns; a stream of
 * one-off broken-agent visitors would otherwise leak this in-process Set. */
const MAX_SEEDED = 10_000;
const MAX_ASSET_DOCUMENTS = 1024;
const MAX_ASSET_ISSUES = 64;
const MAX_ASSET_ISSUE_CHARS = 200;
const ASSET_ISSUES_SUPPRESSED = "...further asset issues suppressed";

type CatalogComponent = NonNullable<FacetCatalog["components"]>[number];
type CatalogComponentOrder = NonNullable<FacetCatalog["policy"]["componentOrder"]>;
type AssetArrayField = "issues" | "themes" | "stamps" | "componentDefinitions" | "compositions";

function cloneCatalogComponent(component: CatalogComponent): CatalogComponent {
  const cloned: {
    type: CatalogComponent["type"];
    variants?: readonly string[];
    guidance?: string;
  } = { type: component.type };
  if (component.variants !== undefined) cloned.variants = [...component.variants];
  if (component.guidance !== undefined) cloned.guidance = component.guidance;
  return cloned;
}

function cloneCatalog(catalog: FacetCatalog): FacetCatalog {
  const theme: {
    active?: string;
    switchPolicy: "locked" | "allowed";
    allowed?: readonly string[];
  } = {
    switchPolicy: catalog.theme.switchPolicy,
  };
  if (catalog.theme.active !== undefined) theme.active = catalog.theme.active;
  if (catalog.theme.allowed !== undefined) theme.allowed = [...catalog.theme.allowed];
  const bricks = catalog.bricks.map((brick) => {
    const clonedBrick: {
      type: FacetCatalog["bricks"][number]["type"];
      variants?: readonly string[];
      guidance?: string;
    } = { type: brick.type };
    if (brick.variants !== undefined) clonedBrick.variants = [...brick.variants];
    if (brick.guidance !== undefined) clonedBrick.guidance = brick.guidance;
    return clonedBrick;
  });
  const policy: {
    order: FacetCatalog["policy"]["order"];
    componentOrder?: CatalogComponentOrder;
    editBeforeAppend: boolean;
    compactScreens: boolean;
    maxScreenSections?: number;
  } = {
    order: [...catalog.policy.order] as FacetCatalog["policy"]["order"],
    editBeforeAppend: catalog.policy.editBeforeAppend,
    compactScreens: catalog.policy.compactScreens,
  };
  if (catalog.policy.componentOrder !== undefined) {
    policy.componentOrder = [...catalog.policy.componentOrder] as CatalogComponentOrder;
  }
  if (catalog.policy.maxScreenSections !== undefined) {
    policy.maxScreenSections = catalog.policy.maxScreenSections;
  }
  const cloned: {
    name: string;
    description?: string;
    theme: FacetCatalog["theme"];
    bricks: FacetCatalog["bricks"];
    components?: NonNullable<FacetCatalog["components"]>;
    stamps: FacetCatalog["stamps"];
    compositions?: NonNullable<FacetCatalog["compositions"]>;
    primitiveFallback: FacetCatalog["primitiveFallback"];
    policy: FacetCatalog["policy"];
  } = {
    name: catalog.name,
    theme,
    bricks,
    stamps:
      catalog.stamps.mode === "all"
        ? { mode: "all" }
        : { mode: "allow", names: [...catalog.stamps.names] },
    primitiveFallback: catalog.primitiveFallback,
    policy,
  };
  if (catalog.description !== undefined) cloned.description = catalog.description;
  if (catalog.components !== undefined) {
    cloned.components = catalog.components.map(cloneCatalogComponent);
  }
  if (catalog.compositions !== undefined) {
    cloned.compositions =
      catalog.compositions.mode === "all"
        ? { mode: "all" }
        : { mode: "allow", names: [...catalog.compositions.names] };
  }
  return cloned;
}

/**
 * The operator's per-agent asset library — themes, stamps, and an optional
 * initial tree — as RAW documents straight from the backend, BEFORE any
 * `@facet/core` validation. `loadAssets` is the one gate they pass.
 *
 * This is the `StageStore` posture exactly: an interface plus a browser-safe
 * `MemoryAssets` reference here, with the Node/file reference (`FileAssets`)
 * behind `@facet/runtime/node` so a browser bundle never drags in `node:fs`.
 */
export interface AssetDocuments {
  readonly themes: readonly unknown[];
  readonly stamps: readonly unknown[];
  readonly componentDefinitions?: readonly unknown[];
  readonly compositions?: readonly unknown[];
  readonly catalog?: unknown;
  readonly initialTree?: unknown;
  /** Backend-level problems (unreadable file, bad JSON) — surfaced, never thrown. */
  readonly issues?: readonly string[];
}

/** Serves an agent's raw asset documents. `agentId` carries for adapter parity
 * (a DB adapter keys on it); the memory and file references ignore it and serve
 * their one constructed document set / directory. */
export interface AssetsStore {
  load(agentId: string): Promise<AssetDocuments>;
}

/** In-memory asset store — the zero-config reference; serves its constructed docs. */
export class MemoryAssets implements AssetsStore {
  constructor(private readonly docs: AssetDocuments) {}

  async load(_agentId: string): Promise<AssetDocuments> {
    return this.docs;
  }
}

type AssetField =
  | "issues"
  | "themes"
  | "stamps"
  | "componentDefinitions"
  | "compositions"
  | "catalog"
  | "initialTree";
type FieldRead = { readonly ok: true; readonly value: unknown } | { readonly ok: false };

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null;
}

function isObjectRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCompleteCatalogDocument(value: unknown): boolean {
  try {
    if (!isObjectRecord(value)) return false;
    const hasBricksOrComponents = isAssetArray(value.bricks) || isAssetArray(value.components);
    const hasStampsOrCompositions =
      isObjectRecord(value.stamps) || isObjectRecord(value.compositions);
    return (
      isObjectRecord(value.theme) &&
      hasBricksOrComponents &&
      hasStampsOrCompositions &&
      isObjectRecord(value.policy)
    );
  } catch {
    return false;
  }
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
 * their core validator survive; everything skipped or fixed is named in `issues`. */
export interface LoadedAssets {
  readonly themes: readonly FacetTheme[];
  readonly stamps: readonly FacetStamp[];
  readonly componentDefinitions: readonly FacetComponentDefinition[];
  readonly catalog: FacetCatalog;
  readonly initialTree?: FacetTree;
  readonly issues: readonly string[];
}

/**
 * Runs the core validators once, at boot (Decision Lock: no hot reload).
 *
 * The `@facet/assets` defaults are seeded as the BASE LAYER at the head of both
 * the theme and the stamp loop and run through the SAME `validateTheme` /
 * `validateStamp` gate as custom docs (never trusted-in): a bad default is dropped
 * with a recorded issue while the remaining defaults + customs survive. With an
 * empty/absent store the default base layer still resolves (DC-001).
 *
 * Collision rules are SYMMETRIC across both kinds:
 *  - defaults-first, then custom docs;
 *  - a custom doc whose name equals a SEEDED DEFAULT shadows it — the seeded entry
 *    is dropped and the custom appended (defaults-first, custom-last), with a
 *    recorded issue, so the list holds exactly one entry for that name (the
 *    custom). This is a load-time LIST swap, NOT a merge: for themes, render's
 *    `resolveTheme` stays the single merge site that overlays the shadowing custom
 *    onto the imported default value-map floor (DC-007); for stamps the custom
 *    simply replaces the default (DC-003);
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
      stamps: [],
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
  const rawThemes = readAssetField(docs, "themes", issues);
  const themeDocs = rawThemes.ok && isAssetArray(rawThemes.value) ? rawThemes.value : [];
  if (rawThemes.ok && !isAssetArray(rawThemes.value)) {
    pushAssetIssue(issues, "assets `themes` was not an array — ignored");
  }
  const rawStamps = readAssetField(docs, "stamps", issues);
  const stampDocs = rawStamps.ok && isAssetArray(rawStamps.value) ? rawStamps.value : [];
  if (rawStamps.ok && !isAssetArray(rawStamps.value)) {
    pushAssetIssue(issues, "assets `stamps` was not an array — ignored");
  }
  const rawComponentDefinitions = readAssetField(docs, "componentDefinitions", issues);
  const componentDefinitionDocs =
    rawComponentDefinitions.ok &&
    rawComponentDefinitions.value !== undefined &&
    isAssetArray(rawComponentDefinitions.value)
      ? rawComponentDefinitions.value
      : [];
  if (
    rawComponentDefinitions.ok &&
    rawComponentDefinitions.value !== undefined &&
    !isAssetArray(rawComponentDefinitions.value)
  ) {
    pushAssetIssue(issues, "assets `componentDefinitions` was not an array — ignored");
  }
  const rawCompositions = readAssetField(docs, "compositions", issues);
  const compositionDocs =
    rawCompositions.ok && rawCompositions.value !== undefined && isAssetArray(rawCompositions.value)
      ? rawCompositions.value
      : [];
  if (
    rawCompositions.ok &&
    rawCompositions.value !== undefined &&
    !isAssetArray(rawCompositions.value)
  ) {
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
  const stampCount = readAssetArrayLength(stampDocs, "stamps", issues, MAX_ASSET_DOCUMENTS);
  const componentDefinitionCount = readAssetArrayLength(
    componentDefinitionDocs,
    "componentDefinitions",
    issues,
    MAX_ASSET_DOCUMENTS,
  );
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

  const stamps: FacetStamp[] = [];
  const seenStampNames = new Set<string>();
  const seededStampNames = new Set<string>();
  const loadStamp = (raw: unknown, seeded: boolean): void => {
    let result: ReturnType<typeof validateStamp>;
    try {
      result = validateStamp(raw);
    } catch {
      pushAssetIssue(issues, `${seeded ? "default " : ""}stamp document skipped: validation threw`);
      return;
    }
    const { stamp, issues: stampIssues } = result;
    if (stamp === undefined) {
      pushAssetIssue(
        issues,
        `${seeded ? "default " : ""}stamp document skipped: ${stampIssues.join("; ") || "invalid"}`,
      );
      return;
    }
    if (seenStampNames.has(stamp.name)) {
      if (!seeded && seededStampNames.has(stamp.name)) {
        // Custom shadows a seeded default: drop the seeded entry, append the custom
        // (symmetric with the theme loop). The name already passed validateStamp's
        // isValidThemeName gate, so it's safe to echo.
        const at = stamps.findIndex((s) => s.name === stamp.name);
        if (at !== -1) stamps.splice(at, 1);
        seededStampNames.delete(stamp.name);
        pushAssetIssue(issues, `custom stamp "${stamp.name}" shadows the seeded default`);
        for (const note of stampIssues) {
          pushAssetIssue(issues, `stamp "${stamp.name}": ${note}`);
        }
        stamps.push(stamp);
        return;
      }
      // Custom-vs-custom (or a duplicate default): first wins. Two same-named
      // stamps would inject contradictory entries into the prompt's STAMPS section.
      pushAssetIssue(issues, `duplicate stamp name "${stamp.name}" ignored (first wins)`);
      return;
    }
    seenStampNames.add(stamp.name);
    if (seeded) seededStampNames.add(stamp.name);
    for (const note of stampIssues) {
      pushAssetIssue(issues, `stamp "${stamp.name}": ${note}`);
    }
    stamps.push(stamp);
  };
  // Defaults first (seeded), then custom docs — the same symmetric layering the
  // theme loop uses, through the same validateStamp gate.
  for (const raw of DEFAULT_STAMPS) loadStamp(raw, true);
  for (let i = 0; i < stampCount; i += 1) {
    const raw = readAssetArrayItem(stampDocs, i, "stamps", issues);
    if (raw.ok) loadStamp(raw.value, false);
  }

  const componentDefinitions: FacetComponentDefinition[] = [];
  const seenComponentDefinitionNames = new Set<string>();
  const loadComponentDefinition = (raw: unknown): void => {
    let result: ReturnType<typeof validateComponentDefinition>;
    try {
      result = validateComponentDefinition(raw);
    } catch {
      pushAssetIssue(issues, "component definition document skipped: validation threw");
      return;
    }
    const { definition, issues: definitionIssues } = result;
    if (definition === undefined) {
      pushAssetIssue(
        issues,
        `component definition document skipped: ${definitionIssues.join("; ") || "invalid"}`,
      );
      return;
    }
    if (seenComponentDefinitionNames.has(definition.name)) {
      pushAssetIssue(
        issues,
        `duplicate component definition name "${definition.name}" ignored (first wins)`,
      );
      return;
    }
    seenComponentDefinitionNames.add(definition.name);
    for (const note of definitionIssues) {
      pushAssetIssue(issues, `component definition "${definition.name}": ${note}`);
    }
    componentDefinitions.push(definition);
  };
  for (let i = 0; i < componentDefinitionCount; i += 1) {
    const raw = readAssetArrayItem(componentDefinitionDocs, i, "componentDefinitions", issues);
    if (raw.ok) loadComponentDefinition(raw.value);
  }
  for (let i = 0; i < compositionCount; i += 1) {
    const raw = readAssetArrayItem(compositionDocs, i, "compositions", issues);
    if (raw.ok) loadComponentDefinition(raw.value);
  }

  let catalog: FacetCatalog = cloneCatalog(DEFAULT_CATALOG);
  try {
    const result = validateCatalog(catalogInput);
    catalog = result.catalog;
    for (const note of result.issues) {
      pushAssetIssue(issues, `catalog: ${note}`);
    }
    if (catalogInput !== DEFAULT_CATALOG && !isCompleteCatalogDocument(catalogInput)) {
      pushAssetIssue(issues, "catalog: incomplete catalog document; using bundled default catalog");
      catalog = cloneCatalog(DEFAULT_CATALOG);
    } else if (
      catalogInput !== DEFAULT_CATALOG &&
      isRecord(catalogInput) &&
      catalogInput.name !== undefined &&
      catalog.name === DEFAULT_CATALOG.name &&
      catalogInput.name !== DEFAULT_CATALOG.name
    ) {
      catalog = cloneCatalog(DEFAULT_CATALOG);
    }
  } catch {
    pushAssetIssue(issues, "catalog skipped: validation threw; using default catalog");
    catalog = cloneCatalog(DEFAULT_CATALOG);
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
    themes,
    stamps,
    componentDefinitions,
    catalog,
    issues,
  };
  if (initialTree !== undefined) loaded.initialTree = initialTree;
  return loaded;
}

/**
 * A tree worth seeding a fresh session with — it already shows something.
 * Delegates to core's `treeHasContent`, the single canonical "shows something"
 * predicate (the initial render root has a visible, renderable descendant).
 * Empty containers, blank entry screens, and empty table/chart/tabs/list leaves
 * are NOT seedable — refusing them here is what closes the EMPTY_TREE trap in
 * `loadAssets`.
 */
export function isSeedableTree(tree: FacetTree): boolean {
  return treeHasContent(tree);
}

/**
 * Decorates a `StageStore` so a FRESH session opens with `initialStage` instead
 * of `EMPTY_TREE`; an EXISTING session is returned untouched; `get`/`save`
 * delegate. Because every `open()` runs under `FacetRuntime`'s per-(agent,
 * visitor) serial queue and before the first agent turn, the seed is inside the
 * same serialized stage-write path and visible to the agent's first turn (it
 * "refines the seeded stage"). It reaches the browser as the FIRST stamped patch
 * frame of that turn — `FacetRuntime` prepends a root `replace` when `open()`
 * reports a fresh seed via `takeSeeded` (the first connection's rehydrate ran
 * before the session existed, so a bare reset carried no snapshot); a later
 * reconnect gets the seed the normal way, through the rehydrate snapshot.
 *
 * INTENTIONAL interaction (recorded): a valid seeded tree counts as "built"
 * (`hasBuiltStage`), so the offline face will NOT overwrite it — desired, the
 * seeded skeleton IS the page.
 *
 * Pass-through: with no `initialStage`, or one that isn't seedable, the original
 * store is returned unchanged — today's model-first paint, exactly.
 */
export function withInitialStage(store: StageStore, initialStage?: FacetTree): StageStore {
  if (initialStage === undefined || !isSeedableTree(initialStage)) return store;
  const seed = initialStage;
  const seedFingerprint = stableTreeFingerprint(seed);
  // Keys of sessions this decorator just seeded, awaiting a single `takeSeeded`
  // report to the runtime. If a durable save commits the seed but rejects before
  // runtime can call `takeSeeded`, and the pending key is later evicted, the key
  // moves to `recoverable`: only sessions this decorator actually tried to seed
  // can be re-armed, so unrelated pre-existing seed-shaped sessions stay quiet.
  const seeded = new Set<string>();
  const recoverable = new Set<string>();
  const remember = (set: Set<string>, key: string): void => {
    if (set.has(key)) return;
    if (set.size >= MAX_SEEDED) {
      const oldest = set.values().next().value;
      if (oldest !== undefined) set.delete(oldest);
    }
    set.add(key);
  };
  const armSeed = (key: string): void => {
    recoverable.delete(key);
    if (seeded.size >= MAX_SEEDED && !seeded.has(key)) {
      const oldest = seeded.values().next().value;
      if (oldest !== undefined) {
        seeded.delete(oldest);
        remember(recoverable, oldest);
      }
    }
    remember(seeded, key);
  };
  return {
    get: (agentId, visitorId) => store.get(agentId, visitorId),
    save: (session) => store.save(session),
    async open(agentId, visitor) {
      // Get-then-create, seeding on miss — the `openSession` shape, but with the
      // seed in place of EMPTY_TREE. Safe because the runtime serializes opens
      // per (agent, visitor), so the get→save window can't be raced through it.
      const key = sessionKey(agentId, visitor.visitorId);
      const existing = await store.get(agentId, visitor.visitorId);
      if (existing !== undefined) {
        if (
          !seeded.has(key) &&
          recoverable.has(key) &&
          stageMatchesFingerprint(existing.stage, seedFingerprint)
        ) {
          armSeed(key);
        }
        return existing;
      }
      const session: FacetSession = { agentId, visitor, stage: seed };
      // Arm before save. A DB adapter can commit the seed then lose the ack; the
      // next turn must still receive the seed frame so the browser catches up to
      // the already-persisted seeded session.
      armSeed(key);
      await store.save(session);
      return session;
    },
    takeSeeded(agentId, visitorId) {
      const key = sessionKey(agentId, visitorId);
      const wasSeeded = seeded.delete(key);
      if (wasSeeded) recoverable.delete(key);
      return wasSeeded;
    },
  };
}

function stableTreeFingerprint(tree: FacetTree): string | undefined {
  try {
    return JSON.stringify(tree);
  } catch {
    return undefined;
  }
}

function stageMatchesFingerprint(tree: FacetTree, fingerprint: string | undefined): boolean {
  if (fingerprint === undefined) return false;
  try {
    return JSON.stringify(tree) === fingerprint;
  } catch {
    return false;
  }
}
