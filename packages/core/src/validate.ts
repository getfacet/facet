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
import {
  FIELD_INPUTS,
  isContainer,
  type BoxStyle,
  type FacetAction,
  type FacetNode,
  type FieldInput,
  type FieldStyle,
  type ImageStyle,
  type TextStyle,
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

/**
 * Max stage nesting depth — beyond this, children are dropped (fail-safe, no
 * stack overflow). Single source of truth: the @facet/react renderer imports
 * this (barrel-reachable via `export * from "./validate.js"`) to cap its own
 * recursion at the same bound, so validation and render never disagree.
 */
export const MAX_DEPTH = 100;

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

/**
 * Normalizes an `onPress` value to the FacetAction union. A bare legacy
 * `{name}` (kind absent) or explicit `kind: "agent"` gets the canonical
 * `kind: "agent"` stamp SILENTLY (no issue — it is the same action, not a
 * mistake). Malformed or unknown-kind actions are stripped with an issue, so
 * the box degrades to a plain non-pressable box.
 */
function asAction(value: unknown, nodeId: string, issues: string[]): FacetAction | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) {
    issues.push(`node "${nodeId}": onPress is not an action object`);
    return undefined;
  }
  const kind = value.kind;
  if (kind === undefined || kind === "agent") {
    const name = asString(value.name);
    if (name === undefined) {
      issues.push(`node "${nodeId}": agent action has no string name`);
      return undefined;
    }
    const action: {
      kind: "agent";
      name: string;
      payload?: Record<string, string | number | boolean>;
    } = { kind: "agent", name };
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
  if (kind === "navigate") {
    const to = asString(value.to);
    if (to === undefined) {
      issues.push(`node "${nodeId}": navigate action needs a string "to"`);
      return undefined;
    }
    return { kind: "navigate", to };
  }
  if (kind === "toggle") {
    const target = asString(value.target);
    if (target === undefined) {
      issues.push(`node "${nodeId}": toggle action needs a string "target"`);
      return undefined;
    }
    return { kind: "toggle", target };
  }
  issues.push(`node "${nodeId}": unknown onPress kind ${JSON.stringify(kind)} dropped`);
  return undefined;
}

/** Only render images from safe URL schemes — never `javascript:`, `data:text/html`, etc. */
export function isSafeImageSrc(src: string): boolean {
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

function fieldStyle(value: unknown): FieldStyle | undefined {
  if (!isObject(value)) return undefined;
  const width = asToken<(typeof SIZINGS)[number]>(value.width, SIZINGS);
  return width !== undefined ? { width } : undefined;
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
        hidden?: boolean;
      } = { id, type: "box", style: boxStyle(raw.style), children };
      const onPress = asAction(raw.onPress, id, issues);
      if (onPress !== undefined) node.onPress = onPress;
      // Only a literal boolean is a visibility default; anything else is stripped
      // (silent, like invalid style tokens — the box just stays visible).
      const hidden = asBool(raw.hidden);
      if (hidden !== undefined) node.hidden = hidden;
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
        style?: FieldStyle;
      } = { id, type: "field", name };
      const input = asToken<FieldInput>(raw.input, FIELD_INPUTS);
      if (input !== undefined) node.input = input;
      const label = asString(raw.label);
      if (label !== undefined) node.label = label;
      const placeholder = asString(raw.placeholder);
      if (placeholder !== undefined) node.placeholder = placeholder;
      // Field style was silently stripped before — kit emits it and the
      // renderer consumes it, so sanitize it through like every other style.
      const style = fieldStyle(raw.style);
      if (style !== undefined) node.style = style;
      return node;
    }
    default:
      issues.push(`node "${id}": unknown type "${type}"`);
      return undefined;
  }
}

/**
 * Sanitizes screens: keep only entries whose value is a string naming an
 * existing BOX node (a screen root must be renderable as a root). Zero
 * survivors ⇒ both fields come back undefined and the tree stays the plain
 * single-screen form. entry must name a kept screen, else fall back to the
 * first kept key so a kept screens map always ships a valid entry.
 */
function sanitizeScreens(
  rawScreens: unknown,
  rawEntry: unknown,
  nodes: Readonly<Record<string, FacetNode>>,
  issues: string[],
): { screens?: Record<string, string>; entry?: string } {
  if (rawScreens === undefined) return {};
  if (!isObject(rawScreens)) {
    issues.push("screens is not an object map; dropped");
    return {};
  }
  const kept: Record<string, string> = {};
  for (const [name, target] of Object.entries(rawScreens)) {
    if (typeof target !== "string") {
      issues.push(`screen "${name}": target is not a node id string; dropped`);
      continue;
    }
    const node = nodes[target];
    if (node === undefined) {
      issues.push(`screen "${name}": target "${target}" does not exist; dropped`);
      continue;
    }
    if (node.type !== "box") {
      issues.push(`screen "${name}": target "${target}" is not a box; dropped`);
      continue;
    }
    kept[name] = target;
  }
  const firstKey = Object.keys(kept)[0];
  if (firstKey === undefined) return {};
  const entry = asString(rawEntry);
  if (entry !== undefined && kept[entry] !== undefined) {
    return { screens: kept, entry };
  }
  issues.push(`entry does not name a kept screen; falling back to "${firstKey}"`);
  return { screens: kept, entry: firstKey };
}

export function validateTree(input: unknown): ValidationResult {
  const issues: string[] = [];
  if (!isObject(input) || !isObject(input.nodes)) {
    issues.push("input is not a tree object with a nodes map");
    return { tree: EMPTY_TREE, issues };
  }

  // Null-prototype accumulator: with a plain object literal, a node keyed
  // "__proto__" would ASSIGN the map's [[Prototype]] instead of storing a node
  // (silently losing it and making dangling-child lookups resolve through the
  // prototype chain). Also drop such ids outright — patch pointers to them are
  // forbidden anyway, so they'd be unreachable.
  const nodes: Record<string, FacetNode> = Object.create(null) as Record<string, FacetNode>;
  for (const [id, raw] of Object.entries(input.nodes)) {
    if (id === "__proto__" || id === "prototype" || id === "constructor") {
      issues.push(`node "${id}": forbidden node id dropped`);
      continue;
    }
    const node = sanitizeNode(id, raw, issues);
    if (node !== undefined) {
      nodes[id] = node;
    }
  }

  // Drop child references that point at nodes we couldn't keep, and dedupe
  // duplicate siblings (a child id may appear at most once under one parent —
  // keep the first occurrence). A dup would otherwise render the same subtree
  // twice and make patch pointers to it ambiguous.
  for (const node of Object.values(nodes)) {
    if (isContainer(node)) {
      const seen = new Set<string>();
      const kept: string[] = [];
      let dangling = false;
      for (const child of node.children) {
        if (nodes[child] === undefined) {
          dangling = true;
          continue;
        }
        if (seen.has(child)) {
          issues.push(`node "${node.id}": removed duplicate sibling child "${child}"`);
          continue;
        }
        seen.add(child);
        kept.push(child);
      }
      if (dangling) {
        issues.push(`node "${node.id}": removed dangling child references`);
      }
      if (kept.length !== node.children.length) {
        nodes[node.id] = { ...node, children: kept };
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

  const { screens, entry } = sanitizeScreens(input.screens, input.entry, nodes, issues);

  // Break cycles: drop any child ref that points back to an ancestor, which would
  // otherwise recurse forever in the renderer. DFS from root AND from every kept
  // screen root (screens may reach subgraphs the root doesn't); the shared
  // settled set skips already-verified acyclic subgraphs.
  const inPath = new Set<string>();
  const settled = new Set<string>();
  const breakCycles = (nodeId: string, depth: number): void => {
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
      if (depth >= MAX_DEPTH) {
        // Fail-safe: cap depth so pathologically deep input can't blow the stack.
        issues.push(`node "${nodeId}": dropped child "${child}" beyond max depth`);
        continue;
      }
      kept.push(child);
      if (!settled.has(child)) breakCycles(child, depth + 1);
    }
    if (kept.length !== node.children.length) {
      nodes[nodeId] = { ...node, children: kept };
    }
    inPath.delete(nodeId);
    settled.add(nodeId);
  };
  breakCycles(rootId, 0);
  if (screens !== undefined) {
    for (const screenRoot of Object.values(screens)) {
      if (!settled.has(screenRoot)) breakCycles(screenRoot, 0);
    }
  }

  const tree: {
    root: string;
    nodes: Record<string, FacetNode>;
    screens?: Record<string, string>;
    entry?: string;
  } = { root: rootId, nodes };
  if (screens !== undefined && entry !== undefined) {
    tree.screens = screens;
    tree.entry = entry;
  }
  return { tree, issues };
}
