import { isContainer } from "@facet/core";
import type { FacetAction, FacetNode, FacetTree } from "@facet/core";

/** Label a press by its action kind: agent → name, navigate → screen, toggle → target. */
function pressLabel(action: FacetAction): string {
  if (action.kind === "navigate") return `→ screen:${action.to}`;
  if (action.kind === "toggle") return `⇄ ${action.target}`;
  return `→ ${action.name}`;
}

function count(noun: string, value: number): string {
  const plural = noun === "child" ? "children" : noun === "series" ? "series" : `${noun}s`;
  return `${String(value)} ${value === 1 ? noun : plural}`;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function detail(node: FacetNode): string {
  switch (node.type) {
    case "text":
      return `: ${quote(node.value)}`;
    case "media":
      return `(${node.kind}): ${node.src}`;
    case "input":
      return `: ${node.name}`;
    case "table":
      return `${node.caption === undefined ? "" : `: ${quote(node.caption)} `}(${count("column", node.columns.length)}, ${count("row", node.rows.length)})`;
    case "chart":
      return `(${node.kind})${node.title === undefined ? "" : `: ${quote(node.title)} `}(${count("series", node.series.length)}, ${count("label", node.labels?.length ?? 0)})`;
    case "keyValue":
      return `: ${count("item", node.items.length)}`;
    case "progress":
      return `: ${node.label === undefined ? "" : `${node.label} `}${String(node.value)}%`;
    case "list":
      return `: ${count("item", node.items.length)}`;
    case "loading":
      return node.label === undefined ? "" : `: ${quote(node.label)}`;
    case "richtext":
      return `: ${count("block", node.blocks.length)}`;
    case "box":
      return "";
  }
  return "";
}

function nodePress(node: FacetNode): FacetAction | undefined {
  if (node.type === "box") return node.onPress;
  return undefined;
}

function nodeHold(node: FacetNode): FacetAction | undefined {
  if (node.type === "box") return node.onHold;
  return undefined;
}

/** Print a stage tree as an indented outline — shared by the demo and gen CLIs. */
export function printTree(tree: FacetTree): void {
  const walk = (id: string, depth: number): void => {
    const node = tree.nodes[id];
    if (node === undefined) return;
    const pad = "  ".repeat(depth);
    const onPress = nodePress(node);
    const onHold = nodeHold(node);
    const press = onPress === undefined ? "" : ` [${pressLabel(onPress)}]`;
    const hold = onHold === undefined ? "" : ` [hold ${pressLabel(onHold)}]`;
    const hidden = node.type === "box" && node.hidden === true ? " (hidden)" : "";
    console.log(`${pad}${node.type}${detail(node)}${press}${hold}${hidden}`);
    if (isContainer(node)) {
      for (const child of node.children) walk(child, depth + 1);
    }
  };
  walk(tree.root, 0);
}
