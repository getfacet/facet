import type { FacetTree } from "@facet/core";

/** Print a stage tree as an indented outline — shared by the demo and gen CLIs. */
export function printTree(tree: FacetTree): void {
  const walk = (id: string, depth: number): void => {
    const node = tree.nodes[id];
    if (node === undefined) return;
    const pad = "  ".repeat(depth);
    const detail =
      node.type === "text"
        ? `: "${node.value}"`
        : node.type === "image"
          ? `: ${node.src}`
          : node.type === "field"
            ? `: ${node.name}`
            : "";
    const press =
      node.type === "box" && node.onPress !== undefined ? ` [→ ${node.onPress.name}]` : "";
    console.log(`${pad}${node.type}${detail}${press}`);
    if (node.type === "box") {
      for (const child of node.children) walk(child, depth + 1);
    }
  };
  walk(tree.root, 0);
}
