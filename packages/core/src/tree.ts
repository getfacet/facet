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
