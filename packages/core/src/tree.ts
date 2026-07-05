import { isContainer, type FacetNode, type NodeId } from "./nodes.js";

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
   * Optional theme NAME — a select-by-name handle into an operator-authored
   * theme registry, never a CSS value. The agent sets it to a name it was given
   * (or leaves it absent); an unknown/absent name simply resolves to the default
   * look at render time. Kept only when a string: `validateTree` drops a
   * non-string `theme` with an issue so the two invariants hold — the tree
   * carries a name, styles stay tokens.
   */
  readonly theme?: string;
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
 * Does this tree "show something real"? True iff it has a non-empty `screens`
 * map, or its render root resolves to a container box with ≥ 1 child. An empty
 * root box (EMPTY_TREE, the shape `validateTree` falls back to on garbage) is
 * NOT content.
 *
 * The single canonical form: the server's offline path (`hasBuiltStage` — should
 * the offline face overwrite this page?) and the runtime's seed gate
 * (`isSeedableTree` — is this initial tree worth seeding?) both delegate here so
 * the "shows something" definition can never silently drift between them.
 */
export function treeHasContent(tree: FacetTree): boolean {
  if (tree.screens !== undefined && Object.keys(tree.screens).length > 0) return true;
  const root = tree.nodes[tree.root];
  // A persisted/foreign FileStageStore tree can carry a `{type:"box"}` root with
  // NO children array (isTreeShaped admits it — it only rejects a *present*
  // non-array children). Guard the array so a childless container root fails safe
  // (offline face) instead of throwing on `.length` on a live offline-visit path.
  return (
    root !== undefined &&
    isContainer(root) &&
    Array.isArray((root as { children?: unknown }).children) &&
    root.children.length > 0
  );
}

/** A fresh, empty stage: a single vertical root box with no children. */
export const EMPTY_TREE: FacetTree = {
  root: "root",
  nodes: {
    root: {
      id: "root",
      type: "box",
      style: { direction: "col", gap: "md" },
      children: [],
    },
  },
};
