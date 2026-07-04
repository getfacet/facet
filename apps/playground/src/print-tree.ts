import type { FacetAction, FacetTree } from "@facet/core";

/** Label a press by its action kind: agent → name, navigate → screen, toggle → target. */
function pressLabel(action: FacetAction): string {
  if (action.kind === "navigate") return `→ screen:${action.to}`;
  if (action.kind === "toggle") return `⇄ ${action.target}`;
  return `→ ${action.name}`;
}

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
      node.type === "box" && node.onPress !== undefined ? ` [${pressLabel(node.onPress)}]` : "";
    const hold =
      node.type === "box" && node.onHold !== undefined ? ` [hold ${pressLabel(node.onHold)}]` : "";
    const hidden = node.type === "box" && node.hidden === true ? " (hidden)" : "";
    console.log(`${pad}${node.type}${detail}${press}${hold}${hidden}`);
    if (node.type === "box") {
      for (const child of node.children) walk(child, depth + 1);
    }
  };
  walk(tree.root, 0);
}
