import type { FacetTree } from "./tree.js";

function exactTreeFields<const T extends readonly (keyof FacetTree)[]>(
  fields: T & ([Exclude<keyof FacetTree, T[number]>] extends [never] ? unknown : never),
): T {
  return fields;
}

/** Canonical package-private FacetTree field roster. Keep this out of the public barrel. */
export const TREE_FIELDS = exactTreeFields(["root", "nodes", "screens", "entry", "data"] as const);
