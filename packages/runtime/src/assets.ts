import {
  isContainer,
  validateStamp,
  validateTheme,
  validateTree,
  type FacetSession,
  type FacetStamp,
  type FacetTheme,
  type FacetTree,
} from "@facet/core";
import { DEFAULT_STAMPS, DEFAULT_THEME } from "@facet/assets";
import { sessionKey, type StageStore } from "./stage-store.js";

/** Hygiene cap on `withInitialStage`'s armed-but-unconsumed seed keys — mirrors
 * `FacetRuntime`'s `MAX_PENDING_SEEDS`. A visitor whose first turn never persists
 * (agent throw / save reject) leaves its key armed until it returns; a stream of
 * one-off broken-agent visitors would otherwise leak this in-process Set. */
const MAX_SEEDED = 10_000;

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

/** The result of validating an `AssetDocuments` set: only documents that cleared
 * their core validator survive; everything skipped or fixed is named in `issues`. */
export interface LoadedAssets {
  readonly themes: readonly FacetTheme[];
  readonly stamps: readonly FacetStamp[];
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
  let docs: AssetDocuments;
  try {
    docs = await store.load(agentId);
  } catch (err) {
    docs = {
      themes: [],
      stamps: [],
      issues: [`assets load failed: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
  const issues: string[] = [...(docs.issues ?? [])];
  // Coerce the trusted array fields so a malformed `{ themes: null }` from a
  // custom adapter can't throw at the spread sites below (skip-and-log, never
  // crash boot). Defaults still seed, so an empty/bad store yields the defaults.
  const themeDocs = Array.isArray(docs.themes) ? docs.themes : [];
  if (!Array.isArray(docs.themes)) issues.push("assets `themes` was not an array — ignored");
  const stampDocs = Array.isArray(docs.stamps) ? docs.stamps : [];
  if (!Array.isArray(docs.stamps)) issues.push("assets `stamps` was not an array — ignored");

  const themes: FacetTheme[] = [];
  const seenThemeNames = new Set<string>();
  const seededThemeNames = new Set<string>();
  // Defaults first (seeded), then custom docs. Both run the SAME validateTheme
  // gate — a bad default is dropped with an issue, exactly like a bad custom.
  const themeInputs: readonly { readonly raw: unknown; readonly seeded: boolean }[] = [
    { raw: DEFAULT_THEME, seeded: true },
    ...themeDocs.map((raw) => ({ raw, seeded: false })),
  ];
  for (const { raw, seeded } of themeInputs) {
    // Skip-and-log at the seam: a live in-process document (a DB adapter, a
    // proxy) can throw from a property accessor. `validateTheme` already guards
    // its own reads, but the try/catch keeps this loop's "Never throws" contract
    // true for any future validator too.
    let result: ReturnType<typeof validateTheme>;
    try {
      result = validateTheme(raw);
    } catch {
      issues.push(`${seeded ? "default " : ""}theme document skipped: validation threw`);
      continue;
    }
    const { theme, issues: themeIssues } = result;
    if (theme === undefined) {
      const why = themeIssues
        .filter((i) => i.severity === "error")
        .map((i) => i.message)
        .join("; ");
      issues.push(`${seeded ? "default " : ""}theme document skipped: ${why || "invalid"}`);
      continue;
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
        issues.push(`custom theme "${theme.name}" shadows the seeded default`);
        for (const warning of themeIssues) {
          issues.push(`theme "${theme.name}": ${warning.message}`);
        }
        themes.push(theme);
        continue;
      }
      // Custom-vs-custom (or a duplicate default): first wins.
      issues.push(`duplicate theme name "${theme.name}" ignored (first wins)`);
      continue;
    }
    seenThemeNames.add(theme.name);
    if (seeded) seededThemeNames.add(theme.name);
    for (const warning of themeIssues) {
      issues.push(`theme "${theme.name}": ${warning.message}`);
    }
    themes.push(theme);
  }

  const stamps: FacetStamp[] = [];
  const seenStampNames = new Set<string>();
  const seededStampNames = new Set<string>();
  // Defaults first (seeded), then custom docs — the same symmetric layering the
  // theme loop uses, through the same validateStamp gate.
  const stampInputs: readonly { readonly raw: unknown; readonly seeded: boolean }[] = [
    ...DEFAULT_STAMPS.map((raw) => ({ raw, seeded: true })),
    ...stampDocs.map((raw) => ({ raw, seeded: false })),
  ];
  for (const { raw, seeded } of stampInputs) {
    let result: ReturnType<typeof validateStamp>;
    try {
      result = validateStamp(raw);
    } catch {
      issues.push(`${seeded ? "default " : ""}stamp document skipped: validation threw`);
      continue;
    }
    const { stamp, issues: stampIssues } = result;
    if (stamp === undefined) {
      issues.push(
        `${seeded ? "default " : ""}stamp document skipped: ${stampIssues.join("; ") || "invalid"}`,
      );
      continue;
    }
    if (seenStampNames.has(stamp.name)) {
      if (!seeded && seededStampNames.has(stamp.name)) {
        // Custom shadows a seeded default: drop the seeded entry, append the custom
        // (symmetric with the theme loop). The name already passed validateStamp's
        // isValidThemeName gate, so it's safe to echo.
        const at = stamps.findIndex((s) => s.name === stamp.name);
        if (at !== -1) stamps.splice(at, 1);
        seededStampNames.delete(stamp.name);
        issues.push(`custom stamp "${stamp.name}" shadows the seeded default`);
        for (const note of stampIssues) {
          issues.push(`stamp "${stamp.name}": ${note}`);
        }
        stamps.push(stamp);
        continue;
      }
      // Custom-vs-custom (or a duplicate default): first wins. Two same-named
      // stamps would inject contradictory entries into the prompt's STAMPS section.
      issues.push(`duplicate stamp name "${stamp.name}" ignored (first wins)`);
      continue;
    }
    seenStampNames.add(stamp.name);
    if (seeded) seededStampNames.add(stamp.name);
    for (const note of stampIssues) {
      issues.push(`stamp "${stamp.name}": ${note}`);
    }
    stamps.push(stamp);
  }

  let initialTree: FacetTree | undefined;
  if (docs.initialTree !== undefined) {
    const { tree, issues: treeIssues } = validateTree(docs.initialTree);
    for (const note of treeIssues) {
      issues.push(`initial tree: ${note}`);
    }
    if (isSeedableTree(tree)) {
      initialTree = tree;
    } else {
      // The trap: `validateTree(garbage)` returns EMPTY_TREE; seeding it would
      // silently flip `hasBuiltStage` and change the offline face. Refuse it so
      // boot falls back to today's model-first paint.
      issues.push("initial tree is empty or invalid — not seedable; using model-first paint");
    }
  }

  const loaded: { -readonly [K in keyof LoadedAssets]: LoadedAssets[K] } = {
    themes,
    stamps,
    issues,
  };
  if (initialTree !== undefined) loaded.initialTree = initialTree;
  return loaded;
}

/**
 * A tree worth seeding a fresh session with — it already shows something. Mirrors
 * the server's `hasBuiltStage`: the render root resolves to a box with ≥ 1 child,
 * or `screens` is non-empty. An empty root box (EMPTY_TREE, the shape
 * `validateTree` falls back to on garbage) is NOT seedable — refusing it here is
 * what closes the EMPTY_TREE trap in `loadAssets`.
 */
export function isSeedableTree(tree: FacetTree): boolean {
  if (tree.screens !== undefined && Object.keys(tree.screens).length > 0) return true;
  const root = tree.nodes[tree.root];
  return root !== undefined && isContainer(root) && root.children.length > 0;
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
  // Keys of sessions this decorator just seeded, awaiting a single `takeSeeded`
  // report to the runtime. Consume-once, so a re-open of the same key never
  // re-emits the seed frame.
  const seeded = new Set<string>();
  return {
    get: (agentId, visitorId) => store.get(agentId, visitorId),
    save: (session) => store.save(session),
    async open(agentId, visitor) {
      // Get-then-create, seeding on miss — the `openSession` shape, but with the
      // seed in place of EMPTY_TREE. Safe because the runtime serializes opens
      // per (agent, visitor), so the get→save window can't be raced through it.
      const existing = await store.get(agentId, visitor.visitorId);
      if (existing !== undefined) return existing;
      const session: FacetSession = { agentId, visitor, stage: seed };
      await store.save(session);
      // Bound the armed-key set (FIFO): evict the oldest when full, exactly as
      // the runtime caps its `pendingSeeds`. A lost seed report is benign — it
      // just skips a no-op root-replace prepend.
      if (seeded.size >= MAX_SEEDED) {
        const oldest = seeded.values().next().value;
        if (oldest !== undefined) seeded.delete(oldest);
      }
      seeded.add(sessionKey(agentId, visitor.visitorId));
      return session;
    },
    takeSeeded(agentId, visitorId) {
      return seeded.delete(sessionKey(agentId, visitorId));
    },
  };
}
