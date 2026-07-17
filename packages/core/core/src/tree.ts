import {
  isContainer,
  type ChartNode,
  type FacetNode,
  type KeyValueNode,
  type ListNode,
  type NodeId,
  type TextNode,
} from "./nodes.js";
import type { DataWarehouse } from "./data-types.js";
import { resolveNodeData } from "./data-binding.js";
import { BRICK_REGISTRY, type BrickEntry } from "./brick-registry.js";

const TREE_RENDERABLE_NODE_BUDGET = 5_000;
const TREE_RENDERABLE_MAX_DEPTH = 100;
const TREE_RENDERABLE_MAX_TABLE_COLUMNS = 12;
const TREE_RENDERABLE_MAX_CHART_SERIES = 8;
const TREE_RENDERABLE_MAX_CHART_POINTS = 200;
const TREE_RENDERABLE_MAX_LIST_ITEMS = 50;
const TREE_RENDERABLE_MAX_FIELD_OPTIONS = 64;
const TREE_RENDERABLE_MAX_KEY_VALUE_ITEMS = 50;

interface RenderableBudget {
  left: number;
}

/**
 * A stage is the dynamic surface of a Facet page — everything except the
 * persistent chat dock.
 *
 * It is stored as a flat map of nodes keyed by id, with a single node whose id
 * is "root". This "flat list with id references" shape (the same idea as Google
 * A2UI) is what lets an agent stream and patch a UI incrementally — adding one
 * node at a time — instead of re-sending a whole page on every change. The
 * client rebuilds the tree from the map at render time.
 */
export interface FacetTree {
  readonly root: NodeId;
  readonly nodes: Readonly<Record<NodeId, FacetNode>>;
  /**
   * Optional named screens — NAMED ROOTS into the same flat `nodes` map
   * (screen name → the screen's root box id), not nested per-screen trees.
   * This keeps `/nodes/<id>` patch paths working unchanged and lets screens
   * share nodes. A screenless tree is the single-screen form: `screens`
   * absent ⇒ render `root`.
   */
  readonly screens?: Readonly<Record<string, NodeId>>;
  /** Screen shown first (a key of `screens`). Meaningless without `screens`. */
  readonly entry?: string;
  /**
   * Optional per-tree DATA WAREHOUSE — a named section of agent-authored data
   * (`datasetName → rows`) that data-bearing nodes bind to by NAME via `from`.
   * Same trust tier as inline `rows`, just relocated so many nodes can share one
   * source. Sanitized inside `validateTree` (`sanitizeDataWarehouse`) and read at
   * render/content time via `resolveNodeData`; never a URL/resolver.
   */
  readonly data?: DataWarehouse;
}

/**
 * The BASE structural check for a `FacetTree`: `value` is a plain (non-array)
 * object with a string `root` and a non-null, non-array `nodes` map. This is the
 * shared floor that `@facet/react` (useFacet's root-replace guard, StageRenderer),
 * `@facet/runtime` (FileStageStore's persisted-blob guard), and the playground
 * generator all re-derived independently.
 *
 * Deliberately shallow: it does NOT verify that `root` names an existing node,
 * that the root is a box, or that children resolve. Those stricter layers depend
 * on what a given caller will do with the tree (render it, persist it, replay it
 * through the server's offline path) and so belong to the callers, not here.
 */
export function isTreeShaped(value: unknown): value is FacetTree {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const t = value as Record<string, unknown>;
  if (typeof t["root"] !== "string") return false;
  const nodes = t["nodes"];
  return typeof nodes === "object" && nodes !== null && !Array.isArray(nodes);
}

/**
 * Does this tree "show something real"? True iff at least one render root has a
 * visible, renderable descendant. A root that only points at a dangling id, a
 * hidden subtree, or a data brick with no renderable data is NOT content.
 *
 * The single canonical form: the server's offline path (`hasBuiltStage` — should
 * the offline face overwrite this page?) and the runtime's seed gate
 * (`isSeedableTree` — is this initial tree worth seeding?) both delegate here so
 * the "shows something" definition can never silently drift between them.
 */
export function treeHasContent(tree: FacetTree): boolean {
  return treeRenderableNodeIds(tree).size > 0;
}

export function treeRenderableNodeIds(tree: FacetTree): ReadonlySet<NodeId> {
  const ids = new Set<NodeId>();
  try {
    collectRenderableRoot(tree, renderRootId(tree), ids, new Set(), {
      left: TREE_RENDERABLE_NODE_BUDGET,
    });
  } catch {
    ids.clear();
  }
  return ids;
}

function renderRootId(tree: FacetTree): NodeId {
  const entry = liveScreenRoot(tree, (tree as { readonly entry?: unknown }).entry);
  if (entry !== null) return entry;
  const screens = (tree as { readonly screens?: unknown }).screens;
  if (isRecord(screens)) {
    for (const name of Object.keys(screens)) {
      const first = liveScreenRoot(tree, name);
      if (first !== null) return first;
    }
  }
  return tree.root;
}

function liveScreenRoot(tree: FacetTree, name: unknown): NodeId | null {
  const screens = (tree as { readonly screens?: unknown }).screens;
  if (!isRecord(screens) || typeof name !== "string") return null;
  if (!Object.prototype.hasOwnProperty.call(screens, name)) return null;
  const id = screens[name];
  if (typeof id !== "string") return null;
  const node = tree.nodes[id];
  return isRecord(node) && isContainer(node as FacetNode) ? id : null;
}

function collectRenderableRoot(
  tree: FacetTree,
  id: NodeId,
  out: Set<NodeId>,
  seen: Set<NodeId>,
  budget: RenderableBudget,
): boolean {
  const node = tree.nodes[id];
  if (!isRecord(node) || node.hidden === true || !isContainer(node as FacetNode)) return false;
  return collectRenderableNode(tree, id, out, seen, budget, 0);
}

function collectRenderableNode(
  tree: FacetTree,
  id: NodeId,
  out: Set<NodeId>,
  seen: Set<NodeId>,
  budget: RenderableBudget,
  depth: number,
): boolean {
  if (depth > TREE_RENDERABLE_MAX_DEPTH || budget.left <= 0) return false;
  if (seen.has(id)) return false;
  seen.add(id);
  budget.left -= 1;
  const node = tree.nodes[id];
  if (!isRecord(node) || node.hidden === true) return false;
  let renders = nodeRendersItself(node, tree.data);
  if (isContainer(node as FacetNode) && Array.isArray(node.children)) {
    const limit = Math.min(node.children.length, budget.left);
    for (let i = 0; i < limit && budget.left > 0; i += 1) {
      const child = node.children[i];
      if (typeof child !== "string") continue;
      if (collectRenderableNode(tree, child, out, seen, budget, depth + 1)) renders = true;
    }
  }
  if (renders) out.add(id);
  return renders;
}

function nodeRendersItself(
  node: Record<string, unknown>,
  warehouse: DataWarehouse | undefined,
): boolean {
  const type = node.type;
  // Own-property check: a bare `BRICK_REGISTRY[type]` returns an inherited
  // `Object.prototype` member for a junk type like "constructor" (a truthy
  // non-entry), whose `.rendersSelf`/`.resolveFromContent` would throw and, via
  // the `treeRenderableNodeIds` catch, wipe the whole result set. The former
  // `switch` sent such names to `default: return false` — preserve that.
  const entry =
    typeof type === "string" && Object.hasOwn(BRICK_REGISTRY, type)
      ? (BRICK_REGISTRY as Record<string, BrickEntry | undefined>)[type]
      : undefined;
  // A data-bearing node with a `from` binding shows content iff the SHARED
  // `resolveNodeData` (the same precedence + projection the renderer runs, so
  // "shows something" and the render never diverge — RISK-INV-5) yields a
  // non-empty projection. Dangling/absent/empty `from` ⇒ non-content. Nodes
  // without a `from` predicate (e.g. table — decided by inline COLUMNS) fall
  // through to the inline `rendersSelf` predicate below.
  if (typeof node.from === "string" && entry?.resolveFromContent !== undefined) {
    return entry.resolveFromContent(node, warehouse);
  }
  if (entry !== undefined) return entry.rendersSelf(node, warehouse);
  // `image` is a raw media alias that only appears in UNSANITIZED trees; it is
  // not a canonical node type (`media` is), so the registry has no entry for it
  // and it is handled here as a fail-safe with its own predicate.
  if (type === "image") return typeof node.src === "string" && isRenderableMediaSrc(node.src);
  return false;
}

// Per-brick `rendersSelf` predicates — the former `nodeRendersItself` main
// switch cases, verbatim, referenced by the brick registry. Hoisted function
// declarations so the registry can reference them across the import cycle.
export function rendersBox(): boolean {
  return false;
}
export function rendersText(node: Record<string, unknown>): boolean {
  return hasString(node.value);
}
export function rendersMedia(node: Record<string, unknown>): boolean {
  if (node.kind !== undefined && node.kind !== "image" && node.kind !== "video") return false;
  return typeof node.src === "string" && isRenderableMediaSrc(node.src);
}
export function rendersField(node: Record<string, unknown>): boolean {
  return fieldHasRenderableControl(node);
}
export function rendersTable(node: Record<string, unknown>): boolean {
  return hasRenderableArray(
    node.columns,
    TREE_RENDERABLE_MAX_TABLE_COLUMNS,
    isRenderableTableColumn,
  );
}
export function rendersChart(node: Record<string, unknown>): boolean {
  return chartHasRenderableData(node);
}
export function rendersKeyValue(node: Record<string, unknown>): boolean {
  return hasRenderableArray(
    node.items,
    TREE_RENDERABLE_MAX_KEY_VALUE_ITEMS,
    isRenderableKeyValueItem,
  );
}
export function rendersProgress(node: Record<string, unknown>): boolean {
  return typeof node.value === "number" && Number.isFinite(node.value);
}
export function rendersList(node: Record<string, unknown>): boolean {
  return hasRenderableArray(node.items, TREE_RENDERABLE_MAX_LIST_ITEMS, isRenderableListItem);
}
export function rendersAlways(): boolean {
  return true;
}
// Per-brick `resolveFromContent` predicates — the former `from`-binding switch
// cases (chart/list/keyValue/text), verbatim. `table` deliberately has no entry
// (its visibility is inline COLUMNS, not resolved rows).
export function fromChart(
  node: Record<string, unknown>,
  warehouse: DataWarehouse | undefined,
): boolean {
  // Apply the SAME per-kind predicate the renderer uses (donut drops
  // non-positive slices), not a generic "series non-empty" — evaluate it on the
  // RESOLVED series.
  const series = resolveNodeData(node as unknown as ChartNode, warehouse);
  return chartHasRenderableData({ ...(node as unknown as ChartNode), series });
}
export function fromList(
  node: Record<string, unknown>,
  warehouse: DataWarehouse | undefined,
): boolean {
  return resolveNodeData(node as unknown as ListNode, warehouse).length > 0;
}
export function fromKeyValue(
  node: Record<string, unknown>,
  warehouse: DataWarehouse | undefined,
): boolean {
  return resolveNodeData(node as unknown as KeyValueNode, warehouse).length > 0;
}
export function fromText(
  node: Record<string, unknown>,
  warehouse: DataWarehouse | undefined,
): boolean {
  // A store-bound text shows content iff the SHARED scalar projection yields a
  // non-empty cell (the same value the renderer prints), so the empty-inline
  // `value:""` case does not vanish. Dangling/absent/empty cell ⇒ non-content.
  return resolveNodeData(node as unknown as TextNode, warehouse).length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function hasRenderableArray(
  value: unknown,
  cap: number,
  predicate: (item: unknown) => boolean,
): boolean {
  if (!Array.isArray(value)) return false;
  const limit = Math.min(value.length, cap);
  for (let i = 0; i < limit; i += 1) {
    if (predicate(value[i])) return true;
  }
  return false;
}

function isRenderableMediaSrc(src: string): boolean {
  const value = src.trim().toLowerCase();
  return (
    value.startsWith("https://") ||
    value.startsWith("http://") ||
    value.startsWith("//") ||
    value.startsWith("data:image/") ||
    (value.startsWith("/") && !value.startsWith("//"))
  );
}

function isRenderableTableColumn(column: unknown): boolean {
  return isRecord(column) && typeof column.key === "string" && typeof column.label === "string";
}

function isRenderableListItem(item: unknown): boolean {
  if (typeof item === "string") return true;
  return isRecord(item) && typeof item.title === "string";
}

function isRenderableKeyValueItem(item: unknown): boolean {
  return isRecord(item) && typeof item.label === "string" && typeof item.value === "string";
}

function fieldHasRenderableControl(node: Record<string, unknown>): boolean {
  if (typeof node.name !== "string") return false;
  if (node.input !== "radio") return true;
  return (
    hasString(node.label) ||
    hasRenderableArray(node.options, TREE_RENDERABLE_MAX_FIELD_OPTIONS, hasString)
  );
}

function chartHasRenderableData(node: Record<string, unknown>): boolean {
  if (node.kind !== "bar" && node.kind !== "line" && node.kind !== "donut") return false;
  if (!Array.isArray(node.series)) return false;
  const seriesLimit = Math.min(node.series.length, TREE_RENDERABLE_MAX_CHART_SERIES);
  for (let seriesIndex = 0; seriesIndex < seriesLimit; seriesIndex += 1) {
    const series = node.series[seriesIndex];
    if (!isRecord(series) || !Array.isArray(series.values)) continue;
    const valueLimit = Math.min(series.values.length, TREE_RENDERABLE_MAX_CHART_POINTS);
    for (let valueIndex = 0; valueIndex < valueLimit; valueIndex += 1) {
      const value = series.values[valueIndex];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      if (node.kind !== "donut" || Math.abs(value) > 0) return true;
    }
  }
  return false;
}

/** A fresh, empty stage: a single vertical root box with no children. */
export const EMPTY_TREE: FacetTree = {
  root: "root",
  nodes: {
    root: {
      id: "root",
      type: "box",
      style: { direction: "column", gap: "md" },
      children: [],
    },
  },
};
