import {
  ALIGNS,
  COLORS,
  DIRECTIONS,
  FONT_SIZES,
  FONT_WEIGHTS,
  JUSTIFIES,
  RADII,
  RATIOS,
  SIZINGS,
  SPACES,
  TEXT_ALIGNS,
} from "./tokens.js";
import type {
  BoxStyle,
  FacetAction,
  FacetNode,
  FieldInput,
  ImageStyle,
  TextStyle,
} from "./nodes.js";
import { EMPTY_TREE, type FacetTree } from "./tree.js";

/**
 * Turns arbitrary input (e.g. an LLM's JSON, which may be malformed, use unknown
 * node types, or invent style values) into a GUARANTEED-VALID FacetTree.
 *
 * This is the fail-safe boundary for untrusted stage sources: unknown node types
 * are dropped, invalid style tokens are stripped, dangling child references are
 * removed, and if there's no usable root it returns an empty tree. It never
 * throws and always returns a renderable tree, plus a list of issues so a caller
 * (like the CLI generator) can report what the agent got wrong.
 */
export interface ValidationResult {
  readonly tree: FacetTree;
  readonly issues: readonly string[];
}

const FIELD_INPUTS = ["text", "number", "email", "password", "search"] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asBool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asToken<T extends string>(value: unknown, allowed: readonly string[]): T | undefined {
  return typeof value === "string" && allowed.includes(value) ? (value as T) : undefined;
}

function asAction(value: unknown): FacetAction | undefined {
  if (!isObject(value)) return undefined;
  const name = asString(value.name);
  if (name === undefined) return undefined;
  const action: { name: string; payload?: Record<string, string | number | boolean> } = { name };
  if (isObject(value.payload)) {
    const payload: Record<string, string | number | boolean> = {};
    for (const [key, raw] of Object.entries(value.payload)) {
      if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
        payload[key] = raw;
      }
    }
    action.payload = payload;
  }
  return action;
}

/** Only render images from safe URL schemes — never `javascript:`, `data:text/html`, etc. */
function isSafeImageSrc(src: string): boolean {
  const s = src.trim().toLowerCase();
  return (
    s.startsWith("https://") ||
    s.startsWith("http://") ||
    s.startsWith("//") ||
    s.startsWith("data:image/") ||
    (s.startsWith("/") && !s.startsWith("//"))
  );
}

function boxStyle(value: unknown): BoxStyle {
  const style: Record<string, unknown> = {};
  if (isObject(value)) {
    const set = <T extends string>(key: string, allowed: readonly string[]): void => {
      const token = asToken<T>(value[key], allowed);
      if (token !== undefined) style[key] = token;
    };
    set("direction", DIRECTIONS);
    set("gap", SPACES);
    set("pad", SPACES);
    set("align", ALIGNS);
    set("justify", JUSTIFIES);
    set("bg", COLORS);
    set("radius", RADII);
    set("width", SIZINGS);
    const wrap = asBool(value.wrap);
    if (wrap !== undefined) style.wrap = wrap;
    const border = asBool(value.border);
    if (border !== undefined) style.border = border;
    const grow = asBool(value.grow);
    if (grow !== undefined) style.grow = grow;
  }
  return style as BoxStyle;
}

function textStyle(value: unknown): TextStyle {
  const style: Record<string, unknown> = {};
  if (isObject(value)) {
    const size = asToken(value.size, FONT_SIZES);
    if (size !== undefined) style.size = size;
    const weight = asToken(value.weight, FONT_WEIGHTS);
    if (weight !== undefined) style.weight = weight;
    const color = asToken(value.color, COLORS);
    if (color !== undefined) style.color = color;
    const align = asToken(value.align, TEXT_ALIGNS);
    if (align !== undefined) style.align = align;
  }
  return style as TextStyle;
}

function imageStyle(value: unknown): ImageStyle {
  const style: Record<string, unknown> = {};
  if (isObject(value)) {
    const radius = asToken(value.radius, RADII);
    if (radius !== undefined) style.radius = radius;
    const width = asToken(value.width, SIZINGS);
    if (width !== undefined) style.width = width;
    const ratio = asToken(value.ratio, RATIOS);
    if (ratio !== undefined) style.ratio = ratio;
  }
  return style as ImageStyle;
}

function sanitizeNode(id: string, raw: unknown, issues: string[]): FacetNode | undefined {
  const type = isObject(raw) ? asString(raw.type) : undefined;
  if (!isObject(raw) || type === undefined) {
    issues.push(`node "${id}": not an object with a type`);
    return undefined;
  }
  switch (type) {
    case "box": {
      const children = Array.isArray(raw.children)
        ? raw.children.filter((child): child is string => typeof child === "string")
        : [];
      const node: {
        id: string;
        type: "box";
        style: BoxStyle;
        children: string[];
        onPress?: FacetAction;
      } = { id, type: "box", style: boxStyle(raw.style), children };
      const onPress = asAction(raw.onPress);
      if (onPress !== undefined) node.onPress = onPress;
      return node;
    }
    case "text": {
      const value = asString(raw.value);
      if (value === undefined) {
        issues.push(`node "${id}": text has no string value`);
        return undefined;
      }
      return { id, type: "text", value, style: textStyle(raw.style) };
    }
    case "image": {
      const src = asString(raw.src);
      const alt = asString(raw.alt);
      if (src === undefined || alt === undefined) {
        issues.push(`node "${id}": image needs src and alt`);
        return undefined;
      }
      if (!isSafeImageSrc(src)) {
        issues.push(`node "${id}": unsafe image src dropped`);
        return undefined;
      }
      return { id, type: "image", src, alt, style: imageStyle(raw.style) };
    }
    case "field": {
      const name = asString(raw.name);
      if (name === undefined) {
        issues.push(`node "${id}": field has no name`);
        return undefined;
      }
      const node: {
        id: string;
        type: "field";
        name: string;
        input?: FieldInput;
        label?: string;
        placeholder?: string;
      } = { id, type: "field", name };
      const input = asToken<FieldInput>(raw.input, FIELD_INPUTS);
      if (input !== undefined) node.input = input;
      const label = asString(raw.label);
      if (label !== undefined) node.label = label;
      const placeholder = asString(raw.placeholder);
      if (placeholder !== undefined) node.placeholder = placeholder;
      return node;
    }
    default:
      issues.push(`node "${id}": unknown type "${type}"`);
      return undefined;
  }
}

export function validateTree(input: unknown): ValidationResult {
  const issues: string[] = [];
  if (!isObject(input) || !isObject(input.nodes)) {
    issues.push("input is not a tree object with a nodes map");
    return { tree: EMPTY_TREE, issues };
  }

  const nodes: Record<string, FacetNode> = {};
  for (const [id, raw] of Object.entries(input.nodes)) {
    const node = sanitizeNode(id, raw, issues);
    if (node !== undefined) {
      nodes[id] = node;
    }
  }

  // Drop child references that point at nodes we couldn't keep.
  for (const node of Object.values(nodes)) {
    if (node.type === "box") {
      const kept = node.children.filter((child) => nodes[child] !== undefined);
      if (kept.length !== node.children.length) {
        nodes[node.id] = { ...node, children: kept };
        issues.push(`node "${node.id}": removed dangling child references`);
      }
    }
  }

  const rootId =
    typeof input.root === "string" && nodes[input.root] !== undefined
      ? input.root
      : nodes["root"] !== undefined
        ? "root"
        : undefined;

  const rootNode = rootId === undefined ? undefined : nodes[rootId];
  if (rootId === undefined || rootNode === undefined) {
    issues.push("no valid root node");
    return { tree: EMPTY_TREE, issues };
  }
  if (rootNode.type !== "box") {
    issues.push("root node must be a box");
    return { tree: EMPTY_TREE, issues };
  }

  // Break cycles: drop any child ref that points back to an ancestor, which would
  // otherwise recurse forever in the renderer. DFS from root; a node in the
  // current path (gray) reached again is a back-edge.
  const inPath = new Set<string>();
  const settled = new Set<string>();
  const breakCycles = (nodeId: string): void => {
    const node = nodes[nodeId];
    if (node === undefined || node.type !== "box") {
      settled.add(nodeId);
      return;
    }
    inPath.add(nodeId);
    const kept: string[] = [];
    for (const child of node.children) {
      if (inPath.has(child)) {
        issues.push(`node "${nodeId}": removed cyclic child "${child}"`);
        continue;
      }
      kept.push(child);
      if (!settled.has(child)) breakCycles(child);
    }
    if (kept.length !== node.children.length) {
      nodes[nodeId] = { ...node, children: kept };
    }
    inPath.delete(nodeId);
    settled.add(nodeId);
  };
  breakCycles(rootId);

  return { tree: { root: rootId, nodes }, issues };
}
