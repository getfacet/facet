import { isContainer, MAX_DEPTH, treeHasContent, type FacetTree, type NodeId } from "@facet/core";
import { MOTION_CLASS_NAMES } from "./motion.js";
import type { ResolvedTheme } from "./theme.js";
import {
  EMPTY_ANCESTORS,
  RENDER_BUDGET,
  childIdsOf,
  isHiddenByDefault,
  isRenderableMedia,
  safeObjectKeys,
  safeTreeEntry,
  safeTreeNodes,
  safeTreeRoot,
  safeTreeScreens,
} from "./renderer-safe.js";

export type TimerHandle = ReturnType<typeof setTimeout>;
export type RenderMode = "live" | "inert";

export interface VisibleNodeInfo {
  readonly parentId: NodeId | null;
  readonly index: number;
  readonly ancestors: ReadonlySet<NodeId>;
  readonly depth: number;
}

export interface VisibleInfo {
  readonly ids: ReadonlySet<NodeId>;
  readonly nodes: ReadonlyMap<NodeId, VisibleNodeInfo>;
}

export interface RenderSnapshot {
  readonly tree: FacetTree;
  readonly rootId: NodeId;
  readonly activeScreen: string | null;
  readonly visible: VisibleInfo;
  readonly visibilityOverrides: ReadonlyMap<NodeId, boolean>;
  readonly theme: ResolvedTheme;
  readonly revision: number | null;
  readonly rootReplacedRevision: number | null;
}

export interface ExitRecord {
  readonly id: NodeId;
  readonly parentId: NodeId | null;
  readonly index: number;
  readonly ancestors: ReadonlySet<NodeId>;
  readonly depth: number;
  readonly visibleIds: ReadonlySet<NodeId>;
  readonly snapshot: RenderSnapshot;
}

export interface StagePreviousRecord {
  readonly snapshot: RenderSnapshot;
}

export interface MotionState {
  readonly enterIds: ReadonlySet<NodeId>;
  readonly exitRecords: ReadonlyMap<NodeId, ExitRecord>;
  readonly stagePrevious: StagePreviousRecord | null;
}

export interface MotionRenderPlan {
  readonly motionClassById: ReadonlyMap<NodeId, string>;
  readonly exitRecordsByParent: ReadonlyMap<NodeId, readonly ExitRecord[]>;
  readonly rootExitRecords: readonly ExitRecord[];
}

export interface NormalizedTransitionHint {
  readonly revision: number;
  readonly rootReplacedRevision: number | null;
}

export function emptyMotionState(): MotionState {
  return {
    enterIds: new Set<NodeId>(),
    exitRecords: new Map<NodeId, ExitRecord>(),
    stagePrevious: null,
  };
}

export function isMotionStateEmpty(state: MotionState): boolean {
  return state.enterIds.size === 0 && state.exitRecords.size === 0 && state.stagePrevious === null;
}

export function isBlankBootSnapshot(snapshot: RenderSnapshot): boolean {
  return (
    snapshot.revision === 0 &&
    snapshot.rootReplacedRevision === null &&
    !treeHasContent(snapshot.tree)
  );
}

export function normalizeTransitionHint(transition: unknown): NormalizedTransitionHint | null {
  if (typeof transition !== "object" || transition === null) {
    return null;
  }
  const raw = transition as {
    readonly revision?: unknown;
    readonly rootReplaced?: unknown;
    readonly rootReplacedRevision?: unknown;
  };
  if (typeof raw.revision !== "number" || !Number.isFinite(raw.revision)) {
    return null;
  }
  const rootReplacedRevision =
    typeof raw.rootReplacedRevision === "number" && Number.isFinite(raw.rootReplacedRevision)
      ? raw.rootReplacedRevision
      : raw.rootReplaced === true
        ? raw.revision
        : null;
  return { revision: raw.revision, rootReplacedRevision };
}

export function collectVisibleInfo(
  tree: FacetTree,
  rootId: NodeId,
  visibilityOverrides: ReadonlyMap<NodeId, boolean>,
): VisibleInfo {
  const ids = new Set<NodeId>();
  const nodes = new Map<NodeId, VisibleNodeInfo>();
  const budget = { left: RENDER_BUDGET, refsLeft: RENDER_BUDGET };

  const visit = (
    id: NodeId,
    parentId: NodeId | null,
    index: number,
    ancestors: ReadonlySet<NodeId>,
    depth: number,
  ): void => {
    const node = tree.nodes[id];
    if (node == null || depth > MAX_DEPTH) {
      return;
    }
    if (--budget.left < 0) {
      return;
    }
    const visible = visibilityOverrides.get(id) ?? !isHiddenByDefault(node);
    if (!visible) {
      return;
    }
    if ((node as { readonly type?: unknown }).type === "image") {
      if (isRenderableMedia(node)) {
        ids.add(id);
        nodes.set(id, { parentId, index, ancestors, depth });
      }
      return;
    }

    if (isContainer(node)) {
      ids.add(id);
      nodes.set(id, { parentId, index, ancestors, depth });
      const seen = ancestors;
      const childAncestors = new Set(seen).add(id);
      const emitted = new Set<NodeId>(childAncestors);
      let childIndex = 0;
      for (const childId of childIdsOf(node)) {
        if (--budget.refsLeft < 0) {
          break;
        }
        if (emitted.has(childId)) {
          continue;
        }
        emitted.add(childId);
        visit(childId, id, childIndex, childAncestors, depth + 1);
        childIndex += 1;
      }
      return;
    }

    switch (node.type) {
      case "text":
        if (typeof node.value === "string") {
          ids.add(id);
          nodes.set(id, { parentId, index, ancestors, depth });
        }
        return;
      case "media":
        if (isRenderableMedia(node)) {
          ids.add(id);
          nodes.set(id, { parentId, index, ancestors, depth });
        }
        return;
      case "field":
        ids.add(id);
        nodes.set(id, { parentId, index, ancestors, depth });
        return;
      case "button":
      case "tabs":
      case "nav":
      case "table":
      case "chart":
      case "metric":
      case "stat":
      case "keyValue":
      case "badge":
      case "progress":
      case "alert":
      case "list":
      case "divider":
      case "search":
      case "filterBar":
      case "emptyState":
      case "loading":
        ids.add(id);
        nodes.set(id, { parentId, index, ancestors, depth });
        return;
    }
  };

  visit(rootId, null, 0, EMPTY_ANCESTORS, 0);
  return { ids, nodes };
}

export function topmostExitingIds(
  previous: VisibleInfo,
  currentIds: ReadonlySet<NodeId>,
): NodeId[] {
  const exiting = new Set<NodeId>();
  for (const id of previous.ids) {
    if (!currentIds.has(id)) {
      exiting.add(id);
    }
  }
  const topmost: NodeId[] = [];
  for (const id of exiting) {
    let parentId = previous.nodes.get(id)?.parentId ?? null;
    let hasExitingAncestor = false;
    const seenParents = new Set<NodeId>();
    while (parentId !== null && !seenParents.has(parentId)) {
      seenParents.add(parentId);
      if (exiting.has(parentId)) {
        hasExitingAncestor = true;
        break;
      }
      parentId = previous.nodes.get(parentId)?.parentId ?? null;
    }
    if (!hasExitingAncestor) {
      topmost.push(id);
    }
  }
  return topmost;
}

export function visibleSubtreeIds(visible: VisibleInfo, rootId: NodeId): ReadonlySet<NodeId> {
  const ids = new Set<NodeId>();
  for (const id of visible.ids) {
    if (id === rootId || visible.nodes.get(id)?.ancestors.has(rootId) === true) {
      ids.add(id);
    }
  }
  return ids;
}

export function motionRenderPlan(state: MotionState): MotionRenderPlan {
  const motionClassById = new Map<NodeId, string>();
  for (const id of state.enterIds) {
    motionClassById.set(id, MOTION_CLASS_NAMES.brickEnter);
  }

  const exitRecordsByParent = new Map<NodeId, ExitRecord[]>();
  const rootExitRecords: ExitRecord[] = [];
  for (const record of state.exitRecords.values()) {
    if (record.parentId === null) {
      rootExitRecords.push(record);
      continue;
    }
    const records = exitRecordsByParent.get(record.parentId);
    if (records === undefined) {
      exitRecordsByParent.set(record.parentId, [record]);
    } else {
      records.push(record);
    }
  }
  for (const records of exitRecordsByParent.values()) {
    records.sort((left, right) => left.index - right.index);
  }
  rootExitRecords.sort((left, right) => left.index - right.index);
  return { motionClassById, exitRecordsByParent, rootExitRecords };
}

/**
 * Resolves `name` to a screen's live root node id, or null. Defensive against
 * raw-path junk: `screens` may not be an object, its values may not be strings,
 * and a value may name a node that no longer exists. The target must resolve to
 * a BOX — a screen root is rendered as a root, and `sanitizeScreens` drops a
 * non-box target on the stored tree, so the live fail-safe must match it (else a
 * raw-path patch pointing a screen at a text node would render that text as the
 * whole screen before the corrective frame arrives).
 */
export function liveScreenRoot(tree: FacetTree, name: unknown): NodeId | null {
  const screens = safeTreeScreens(tree);
  if (screens === undefined || typeof name !== "string") {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(screens, name)) {
    return null;
  }
  const rootId: unknown = screens[name];
  if (typeof rootId !== "string") {
    return null;
  }
  const nodes = safeTreeNodes(tree);
  if (nodes === undefined) return null;
  const node = nodes[rootId];
  return node != null && isContainer(node) ? rootId : null;
}

/**
 * Total function from view-state to the node id to render (invariant #6):
 * current screen if live → entry if live → first live screen → plain `root`.
 */
export function resolveScreenRoot(tree: FacetTree, currentScreen: string | null): NodeId {
  const current = liveScreenRoot(tree, currentScreen);
  if (current !== null) {
    return current;
  }
  const entry = liveScreenRoot(tree, safeTreeEntry(tree));
  if (entry !== null) {
    return entry;
  }
  const screens = safeTreeScreens(tree);
  if (screens !== undefined) {
    for (const name of safeObjectKeys(screens)) {
      const first = liveScreenRoot(tree, name);
      if (first !== null) return first;
    }
  }
  return safeTreeRoot(tree) ?? "root";
}

export function resolveActiveScreen(tree: FacetTree, currentScreen: string | null): string | null {
  if (liveScreenRoot(tree, currentScreen) !== null) {
    return currentScreen;
  }
  const entry = safeTreeEntry(tree);
  if (typeof entry === "string" && liveScreenRoot(tree, entry) !== null) {
    return entry;
  }
  const screens = safeTreeScreens(tree);
  if (screens !== undefined) {
    for (const name of safeObjectKeys(screens)) {
      if (liveScreenRoot(tree, name) !== null) return name;
    }
  }
  return null;
}

/** A press the renderer has classified from an UNTRUSTED `onPress` value. */
