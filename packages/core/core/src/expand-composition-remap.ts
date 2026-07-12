import {
  caughtErrorDetail,
  isForbiddenKey,
  nullMap,
  printableKey,
  type IssueSink,
} from "./issues.js";
import type { FacetAction, FacetNode, NodeId } from "./nodes.js";

const MAX_MINT_ATTEMPTS = 4096;

export function mintIds(
  oldIds: readonly NodeId[],
  existingIds: ReadonlySet<NodeId>,
  mintId: (() => string) | undefined,
  issues: IssueSink,
): Record<NodeId, NodeId> | undefined {
  const used = new Set(existingIds);
  // Null-prototype: remapAction indexes this map with author-supplied action
  // targets, so a plain object would resolve Object.prototype members.
  const ids: Record<NodeId, NodeId> = nullMap();
  const mint = mintId ?? defaultMintId;
  let attempts = 0;
  for (const oldId of oldIds) {
    let fresh: string | undefined;
    while (attempts < MAX_MINT_ATTEMPTS) {
      attempts += 1;
      let candidate: unknown;
      try {
        candidate = mint();
      } catch (error) {
        issues.push(`composition expansion mintId failed: ${caughtErrorDetail(error)}`);
        return undefined;
      }
      if (
        typeof candidate === "string" &&
        candidate.length > 0 &&
        !isForbiddenKey(candidate) &&
        !used.has(candidate)
      ) {
        fresh = candidate;
        break;
      }
    }
    if (fresh === undefined) {
      issues.push(
        `composition expansion could not mint a fresh id for "${printableKey(oldId)}" within the ${MAX_MINT_ATTEMPTS}-attempt cap`,
      );
      return undefined;
    }
    ids[oldId] = fresh;
    used.add(fresh);
  }
  return ids;
}

function defaultMintId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `composition-${Math.random().toString(36).slice(2)}`;
}

export function remapNodes(
  nodes: Readonly<Record<NodeId, FacetNode>>,
  ids: Readonly<Record<NodeId, NodeId>>,
): Record<NodeId, FacetNode> {
  const remapped: Record<NodeId, FacetNode> = {};
  for (const [oldId, node] of Object.entries(nodes)) {
    const id = ids[oldId];
    if (id === undefined) continue;
    remapped[id] = remapNode(node, id, ids);
  }
  return remapped;
}

interface MutablePressActions {
  onPress?: FacetAction;
  onHold?: FacetAction;
}

function remapPressActions(
  next: MutablePressActions,
  source: Readonly<MutablePressActions>,
  ids: Readonly<Record<NodeId, NodeId>>,
): void {
  const onPress = source.onPress === undefined ? undefined : remapAction(source.onPress, ids);
  if (onPress !== undefined) next.onPress = onPress;
  else delete next.onPress;
  const onHold = source.onHold === undefined ? undefined : remapAction(source.onHold, ids);
  if (onHold !== undefined) next.onHold = onHold;
  else delete next.onHold;
}

function remapNode(node: FacetNode, id: NodeId, ids: Readonly<Record<NodeId, NodeId>>): FacetNode {
  switch (node.type) {
    case "box": {
      const next: {
        id: NodeId;
        type: "box";
        style?: typeof node.style;
        onPress?: FacetAction;
        onHold?: FacetAction;
        hidden?: boolean;
        children: NodeId[];
      } = {
        ...node,
        id,
        children: node.children
          .map((child) => ids[child])
          .filter((child): child is string => child !== undefined),
      };
      remapPressActions(next, node, ids);
      return next;
    }
    case "text":
      return { ...node, id };
    case "media":
      return { ...node, id };
    case "field":
      return { ...node, id };
    case "button": {
      const next = { ...node, id };
      remapPressActions(next, node, ids);
      return next;
    }
    case "section":
      return {
        ...node,
        id,
        children: node.children
          .map((child) => ids[child])
          .filter((child): child is string => child !== undefined),
      };
    case "card": {
      const next = {
        ...node,
        id,
        children: node.children
          .map((child) => ids[child])
          .filter((child): child is string => child !== undefined),
      };
      remapPressActions(next, node, ids);
      return next;
    }
    case "form": {
      const next = {
        ...node,
        id,
        children: node.children
          .map((child) => ids[child])
          .filter((child): child is string => child !== undefined),
      };
      const onSubmit = node.onSubmit === undefined ? undefined : remapAction(node.onSubmit, ids);
      if (onSubmit !== undefined) next.onSubmit = onSubmit;
      else delete next.onSubmit;
      return next;
    }
    case "search": {
      const next = { ...node, id };
      const onSubmit = node.onSubmit === undefined ? undefined : remapAction(node.onSubmit, ids);
      if (onSubmit !== undefined) next.onSubmit = onSubmit;
      else delete next.onSubmit;
      return next;
    }
    case "filterBar": {
      const next = { ...node, id };
      const onChange = node.onChange === undefined ? undefined : remapAction(node.onChange, ids);
      if (onChange !== undefined) next.onChange = onChange;
      else delete next.onChange;
      return next;
    }
    case "emptyState": {
      const next = { ...node, id };
      const onPress = node.onPress === undefined ? undefined : remapAction(node.onPress, ids);
      if (onPress !== undefined) next.onPress = onPress;
      else delete next.onPress;
      return next;
    }
    default:
      return { ...node, id };
  }
}

function remapAction(
  action: FacetAction,
  ids: Readonly<Record<NodeId, NodeId>>,
): FacetAction | undefined {
  if (action.kind === "toggle") {
    // Own-property guard: an inherited lookup could splice a non-string in.
    const target = Object.prototype.hasOwnProperty.call(ids, action.target)
      ? ids[action.target]
      : undefined;
    return typeof target === "string" ? { ...action, target } : undefined;
  }
  if (action.kind === "navigate") return action;
  if (action.collect !== undefined) {
    const collect = Object.prototype.hasOwnProperty.call(ids, action.collect)
      ? ids[action.collect]
      : undefined;
    if (typeof collect === "string") return { ...action, collect };
    const { collect: droppedCollect, ...rest } = action;
    void droppedCollect;
    return rest;
  }
  return action;
}

export function remapSlots(
  slotSources: ReadonlyMap<string, NodeId>,
  ids: Readonly<Record<NodeId, NodeId>>,
  nodes: Readonly<Record<NodeId, FacetNode>>,
): Record<string, NodeId> {
  const slots: Record<string, NodeId> = {};
  for (const [name, oldId] of slotSources) {
    const id = ids[oldId];
    if (id !== undefined && nodes[id] !== undefined) slots[name] = id;
  }
  return slots;
}
