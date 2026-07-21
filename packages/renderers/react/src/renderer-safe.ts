import {
  isContainer,
  isSafeMediaSrc,
  isTreeShaped,
  MEDIA_ICON_NAMES,
  MAX_RENDER_NODES,
  type FacetNode,
  type FacetTree,
  type MediaIconName,
  type NodeId,
} from "@facet/core";
import { isObjectRecord, safeOwnValue, styleOf } from "./renderer-value-safety.js";

export {
  cappedArray,
  cappedString,
  isObjectRecord,
  safeOwnValue,
} from "./renderer-value-safety.js";

export const EMPTY_ANCESTORS: ReadonlySet<NodeId> = new Set<NodeId>();
export const RENDER_BUDGET = MAX_RENDER_NODES;

export function childIdsOf(node: FacetNode): readonly NodeId[] {
  const children = safeOwnValue(node, "children");
  if (!Array.isArray(children)) return [];
  try {
    return children.slice() as readonly NodeId[];
  } catch {
    return [];
  }
}

export function isContainerValue(value: unknown): value is FacetNode {
  return value != null && isContainer(value as FacetNode);
}

export function safeTreeRoot(tree: FacetTree): NodeId | undefined {
  try {
    return typeof tree.root === "string" ? tree.root : undefined;
  } catch {
    return undefined;
  }
}

export function safeTreeNodes(tree: FacetTree): Readonly<Record<NodeId, FacetNode>> | undefined {
  try {
    const nodes = tree.nodes;
    return typeof nodes === "object" && nodes !== null && !Array.isArray(nodes) ? nodes : undefined;
  } catch {
    return undefined;
  }
}

export function safeTreeScreens(tree: FacetTree): Record<string, unknown> | undefined {
  try {
    const screens = tree.screens;
    return typeof screens === "object" && screens !== null && !Array.isArray(screens)
      ? (screens as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export function safeTreeEntry(tree: FacetTree): unknown {
  try {
    return tree.entry;
  } catch {
    return undefined;
  }
}

export function safeObjectKeys(value: object): readonly string[] {
  try {
    return Object.keys(value);
  } catch {
    return [];
  }
}

/** A tree is renderable only if it's tree-shaped (core floor) AND its root resolves. */
export function isRenderableTree(tree: FacetTree): boolean {
  // != null: a patch can set the root node to JSON null, not just remove it.
  const root = safeTreeRoot(tree);
  const nodes = safeTreeNodes(tree);
  return (
    root !== undefined &&
    nodes !== undefined &&
    isTreeShaped(tree) &&
    safeOwnValue(nodes, root) != null
  );
}

/** Resolve one raw-path node without invoking inherited or throwing accessors. */
export function safeTreeNode(tree: FacetTree, id: NodeId): FacetNode | undefined {
  const nodes = safeTreeNodes(tree);
  const node = safeOwnValue(nodes, id);
  return isObjectRecord(node) ? (node as unknown as FacetNode) : undefined;
}

const MEDIA_ICON_NAME_SET: ReadonlySet<string> = new Set(MEDIA_ICON_NAMES);

function isMediaIconName(value: unknown): value is MediaIconName {
  return typeof value === "string" && MEDIA_ICON_NAME_SET.has(value);
}

interface RenderableSourcedMediaValue {
  readonly kind: "image" | "video";
  readonly src: string;
  readonly alt?: unknown;
  readonly poster?: string;
  readonly controls: boolean;
  readonly style?: object;
}

interface RenderableIconMediaValue {
  readonly kind: "icon";
  readonly icon: MediaIconName;
  readonly alt?: unknown;
  readonly style?: object;
}

export type RenderableMediaValue = RenderableSourcedMediaValue | RenderableIconMediaValue;

/** Safely read and normalize the renderer's raw-path media shape once. */
export function readRenderableMedia(raw: unknown): RenderableMediaValue | undefined {
  const type = safeOwnValue(raw, "type");
  const rawKind = safeOwnValue(raw, "kind");
  const kind = type === "image" ? "image" : rawKind === undefined ? "image" : rawKind;
  if (kind !== "image" && kind !== "video" && kind !== "icon") return undefined;

  const alt = safeOwnValue(raw, "alt");
  const style = styleOf<object>(safeOwnValue(raw, "style"));

  if (kind === "icon") {
    const icon = safeOwnValue(raw, "icon");
    if (!isMediaIconName(icon)) return undefined;
    return {
      kind,
      icon,
      alt,
      ...(style === undefined ? {} : { style }),
    };
  }

  const src = safeOwnValue(raw, "src");
  if (typeof src !== "string" || !isSafeMediaSrc(src)) return undefined;

  const posterValue = safeOwnValue(raw, "poster");
  const poster =
    typeof posterValue === "string" && isSafeMediaSrc(posterValue) ? posterValue : undefined;

  return {
    kind,
    src,
    alt,
    ...(poster === undefined ? {} : { poster }),
    controls: safeOwnValue(raw, "controls") === true,
    ...(style === undefined ? {} : { style }),
  };
}

export function isRenderableMedia(raw: unknown): boolean {
  return readRenderableMedia(raw) !== undefined;
}

export function isHiddenByDefault(node: FacetNode): boolean {
  return safeOwnValue(node, "hidden") === true;
}

/** Pointer coordinates on the raw event path can be missing (synthetic events); degrade to 0. */
