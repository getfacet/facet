import { escapeJsonPointerToken, type NodeId } from "@facet/core";

export function nodePath(id: NodeId): string {
  return `/nodes/${escapeJsonPointerToken(id)}`;
}

export function nodeChildrenPath(parent: NodeId): string {
  return `${nodePath(parent)}/children`;
}

export function childrenPath(parent: NodeId): string {
  return `${nodeChildrenPath(parent)}/-`;
}

export function screenPath(name: string): string {
  return `/screens/${escapeJsonPointerToken(name)}`;
}
