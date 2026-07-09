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

function joinedLabel(parts: readonly (string | undefined)[]): string | undefined {
  const labels = parts.filter((part): part is string => part !== undefined && part.length > 0);
  return labels.length > 0 ? labels.join(" / ") : undefined;
}

function labeledCount(label: string | undefined, noun: string, value: number): string {
  const suffix = `(${count(noun, value)})`;
  return label === undefined ? ` ${suffix}` : `: ${quote(label)} ${suffix}`;
}

function detail(node: FacetNode): string {
  switch (node.type) {
    case "text":
      return `: ${quote(node.value)}`;
    case "media":
      return `(${node.kind}): ${node.src}`;
    case "field":
      return `: ${node.name}`;
    case "button":
      return `: ${quote(node.label)}`;
    case "section":
      return labeledCount(
        joinedLabel([node.eyebrow, node.title]) ?? node.body,
        "child",
        node.children.length,
      );
    case "card":
      return labeledCount(node.title ?? node.body, "child", node.children.length);
    case "tabs":
      return `: ${count("tab", node.items.length)}`;
    case "table":
      return `${node.caption === undefined ? "" : `: ${quote(node.caption)} `}(${count("column", node.columns.length)}, ${count("row", node.rows.length)})`;
    case "chart":
      return `(${node.kind})${node.title === undefined ? "" : `: ${quote(node.title)} `}(${count("series", node.series.length)}, ${count("label", node.labels?.length ?? 0)})`;
    case "stat":
      return `: ${node.label} = ${node.value}${node.delta === undefined ? "" : ` (${node.delta})`}`;
    case "badge":
      return `: ${quote(node.label)}`;
    case "progress":
      return `: ${node.label === undefined ? "" : `${node.label} `}${String(node.value)}%`;
    case "alert":
      return node.title === undefined ? `: ${node.body}` : `: ${quote(node.title)} - ${node.body}`;
    case "list":
      return `: ${count("item", node.items.length)}`;
    case "divider":
      return node.label === undefined ? "" : `: ${quote(node.label)}`;
    case "box":
      return "";
  }
}

function nodePress(node: FacetNode): FacetAction | undefined {
  if (node.type === "box" || node.type === "button" || node.type === "card") return node.onPress;
  return undefined;
}

function nodeHold(node: FacetNode): FacetAction | undefined {
  if (node.type === "box" || node.type === "button" || node.type === "card") return node.onHold;
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
