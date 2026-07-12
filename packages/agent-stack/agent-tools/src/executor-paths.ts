import type { NodeId } from "@facet/core";

const FORBIDDEN_NODE_IDS = new Set(["__proto__", "prototype", "constructor"]);

export function isForbiddenNodeId(id: string): boolean {
  return FORBIDDEN_NODE_IDS.has(id);
}

function pointerEscape(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

export function nodePath(id: NodeId): string {
  return `/nodes/${pointerEscape(id)}`;
}

export function nodeChildrenPath(parent: NodeId): string {
  return `${nodePath(parent)}/children`;
}

export function childrenPath(parent: NodeId): string {
  return `${nodeChildrenPath(parent)}/-`;
}

export function screenPath(name: string): string {
  return `/screens/${pointerEscape(name)}`;
}
