import {
  isContainer,
  isSafeMediaSrc,
  isTreeShaped,
  MAX_RENDER_NODES,
  type FacetNode,
  type FacetTree,
  type NodeId,
} from "@facet/core";

export const EMPTY_ANCESTORS: ReadonlySet<NodeId> = new Set<NodeId>();
export const MAX_INTRINSIC_ITEMS = 32;
export const RENDER_BUDGET = MAX_RENDER_NODES;

export function styleOf<T extends object>(style: T | undefined): T | undefined {
  return typeof style === "object" && style !== null ? style : undefined;
}

export function cappedString(value: unknown, max: number): string | undefined {
  const text = typeof value === "string" ? value : undefined;
  return text === undefined ? undefined : text.slice(0, max);
}

export function childIdsOf(node: FacetNode): readonly NodeId[] {
  return Array.isArray((node as { readonly children?: unknown }).children)
    ? (node as { readonly children: readonly NodeId[] }).children
    : [];
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function safeOwnValue(record: unknown, key: string): unknown {
  if (!isObjectRecord(record)) return undefined;
  try {
    if (!Object.prototype.hasOwnProperty.call(record, key)) return undefined;
    return record[key];
  } catch {
    return undefined;
  }
}

export function cappedArray(value: unknown, max: number): readonly unknown[] {
  if (!Array.isArray(value)) return [];
  try {
    return value.slice(0, max);
  } catch {
    return [];
  }
}

export function virtualFieldId(nodeId: NodeId, name: string): string {
  return `${String(nodeId.length)}:${nodeId}${name}`;
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
  return root !== undefined && nodes !== undefined && isTreeShaped(tree) && nodes[root] != null;
}

export function isRenderableMedia(raw: unknown): boolean {
  const rawMedia = raw as {
    readonly type?: unknown;
    readonly kind?: unknown;
    readonly src?: unknown;
  };
  if (typeof rawMedia.src !== "string" || !isSafeMediaSrc(rawMedia.src)) {
    return false;
  }
  const kind =
    rawMedia.type === "image" ? "image" : rawMedia.kind === undefined ? "image" : rawMedia.kind;
  return kind === "image" || kind === "video";
}

export function isHiddenByDefault(node: FacetNode): boolean {
  return (node as { readonly hidden?: unknown }).hidden === true;
}

/** Pointer coordinates on the raw event path can be missing (synthetic events); degrade to 0. */
