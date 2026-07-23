import {
  isContainer,
  MAX_DEPTH,
  treeHasContent,
  type FacetTree,
  type NodeId,
  type RichTextNode,
} from "@facet/core";
import { participatesInMotionSnapshot } from "./brick-render-registry.js";
import { MOTION_CLASS_NAMES } from "./motion.js";
import type { ResolvedTheme } from "./theme.js";
import {
  EMPTY_ANCESTORS,
  RENDER_BUDGET,
  childIdsOf,
  isHiddenByDefault,
  isRenderableMedia,
} from "./renderer-safe.js";

export type TimerHandle = ReturnType<typeof setTimeout>;
export type RenderMode = "live" | "inert";

interface VisibleNodeInfo {
  readonly parentId: NodeId | null;
  readonly index: number;
  readonly ancestors: ReadonlySet<NodeId>;
  readonly depth: number;
}

interface VisibleInfo {
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

interface MotionRenderPlan {
  readonly motionClassById: ReadonlyMap<NodeId, string>;
  readonly exitRecordsByParent: ReadonlyMap<NodeId, readonly ExitRecord[]>;
  readonly rootExitRecords: readonly ExitRecord[];
}

interface NormalizedTransitionHint {
  readonly revision: number;
  readonly rootReplacedRevision: number | null;
}

function cloneStyleGraph(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (typeof value !== "object" || value === null) return value;
  const known = seen.get(value);
  if (known !== undefined) return known;
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(cloneStyleGraph(item, seen));
    return copy;
  }
  const copy: Record<string, unknown> = {};
  seen.set(value, copy);
  for (const key of Object.keys(value)) {
    copy[key] = cloneStyleGraph((value as Record<string, unknown>)[key], seen);
  }
  return copy;
}

/**
 * Capture the resolved design-system value used by an inert motion frame.
 * Token maps and Preset/default style graphs are copied so a retired frame is
 * never a live alias to an operator-owned object. Concrete values are already
 * validated strings/numbers; the recursive copy exists only for style bundles.
 */
export function captureResolvedThemeSnapshot(theme: ResolvedTheme): ResolvedTheme {
  return {
    name: theme.name,
    ...(theme.description === undefined ? {} : { description: theme.description }),
    colorMode: theme.colorMode,
    space: { ...theme.space },
    fontSize: { ...theme.fontSize },
    fontFamily: { ...theme.fontFamily },
    fontWeight: { ...theme.fontWeight },
    radius: { ...theme.radius },
    borderWidth: { ...theme.borderWidth },
    aspectRatio: { ...theme.aspectRatio },
    minHeight: { ...theme.minHeight },
    maxWidth: { ...theme.maxWidth },
    layoutWidth: { ...theme.layoutWidth },
    maxHeight: { ...theme.maxHeight },
    letterSpacing: { ...theme.letterSpacing },
    lineHeight: { ...theme.lineHeight },
    controlHeight: { ...theme.controlHeight },
    indicatorSize: { ...theme.indicatorSize },
    progressThickness: { ...theme.progressThickness },
    chartThickness: { ...theme.chartThickness },
    color: { ...theme.color },
    shadow: { ...theme.shadow },
    gradient: { ...theme.gradient },
    scrim: { ...theme.scrim },
    highlight: { ...theme.highlight },
    defaults: cloneStyleGraph(theme.defaults, new WeakMap()) as ResolvedTheme["defaults"],
    ...(theme.presets === undefined
      ? {}
      : {
          presets: cloneStyleGraph(theme.presets, new WeakMap()) as NonNullable<
            ResolvedTheme["presets"]
          >,
        }),
  };
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

/**
 * True when a richtext leaf carries at least one run with visible text.
 * Defensive against raw-path junk (blocks/runs/text may not be the shapes the
 * type promises): iterates only real arrays and treats a non-string or empty
 * `text` as no run, matching the text case's string guard.
 */
function richTextHasVisibleRun(node: RichTextNode): boolean {
  const blocks: unknown = (node as { readonly blocks?: unknown }).blocks;
  if (!Array.isArray(blocks)) {
    return false;
  }
  for (const block of blocks) {
    const runs: unknown = (block as { readonly runs?: unknown } | null)?.runs;
    if (!Array.isArray(runs)) {
      continue;
    }
    for (const run of runs) {
      const text: unknown = (run as { readonly text?: unknown } | null)?.text;
      if (typeof text === "string" && text.length > 0) {
        return true;
      }
    }
  }
  return false;
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
      case "input":
        ids.add(id);
        nodes.set(id, { parentId, index, ancestors, depth });
        return;
      case "richtext":
        // A leaf richtext participates only when it carries at least one run
        // with visible text — mirroring the text case's `typeof value === string`
        // guard so an empty/junk richtext neither appear-animates nor is tracked
        // as a leaf on toggle/navigate re-show.
        if (richTextHasVisibleRun(node)) {
          ids.add(id);
          nodes.set(id, { parentId, index, ancestors, depth });
        }
        return;
      default:
        // The remaining display-brick fallthrough is registry-driven: every
        // registered leaf participates unconditionally in the visibility
        // snapshot. The box container and legacy raw `image` are handled above;
        // an unknown/junk type does not participate.
        if (participatesInMotionSnapshot(node.type)) {
          ids.add(id);
          nodes.set(id, { parentId, index, ancestors, depth });
        }
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

/** A press the renderer has classified from an UNTRUSTED `onPress` value. */
