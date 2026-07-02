import type { FacetNode, NodeId } from "./nodes.js";

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
