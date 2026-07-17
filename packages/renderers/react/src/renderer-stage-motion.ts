import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FacetTree, NodeId } from "@facet/core";
import {
  MANY_CHANGE_THRESHOLD,
  MOTION_ENTER_MS,
  MOTION_EXIT_MS,
  STAGE_CROSSFADE_MS,
} from "./motion.js";
import type { ResolvedTheme } from "./theme.js";
import type { StageTransitionHint } from "./useFacet.js";
import {
  captureResolvedThemeSnapshot,
  collectVisibleInfo,
  emptyMotionState,
  isBlankBootSnapshot,
  isMotionStateEmpty,
  normalizeTransitionHint,
  resolveActiveScreen,
  resolveScreenRoot,
  topmostExitingIds,
  visibleSubtreeIds,
  type ExitRecord,
  type MotionState,
  type RenderSnapshot,
  type TimerHandle,
} from "./renderer-motion.js";
import { isContainerValue, isRenderableTree } from "./renderer-safe.js";

function useMotionLayoutEffect(
  effect: Parameters<typeof useEffect>[0],
  deps: readonly unknown[],
): void {
  const useLayout = typeof window === "undefined" ? useEffect : useLayoutEffect;
  useLayout(effect, deps);
}

interface UseStageMotionArgs {
  readonly tree: FacetTree;
  readonly transition: StageTransitionHint | undefined;
  readonly currentScreen: string | null;
  readonly visibilityOverrides: ReadonlyMap<NodeId, boolean>;
  readonly theme: ResolvedTheme;
}

export interface StageMotionResult {
  readonly motionState: MotionState;
  readonly normalizedTransition: ReturnType<typeof normalizeTransitionHint>;
  readonly renderable: boolean;
  readonly currentRootId: NodeId | null;
  readonly activeScreen: string | null;
}

export function useStageMotion({
  tree,
  transition,
  currentScreen,
  visibilityOverrides,
  theme,
}: UseStageMotionArgs): StageMotionResult {
  const [motionState, setMotionState] = useState<MotionState>(() => emptyMotionState());
  const motionStateRef = useRef<MotionState>(motionState);
  motionStateRef.current = motionState;
  const previousSnapshotRef = useRef<RenderSnapshot | null>(null);
  const enterTimersRef = useRef<Map<NodeId, TimerHandle>>(new Map());
  const exitTimersRef = useRef<Map<NodeId, TimerHandle>>(new Map());
  const stageTimerRef = useRef<TimerHandle | null>(null);
  const normalizedTransition = useMemo(() => normalizeTransitionHint(transition), [transition]);
  const capturedTheme = useMemo(() => captureResolvedThemeSnapshot(theme), [theme]);
  const capturedVisibilityOverrides = useMemo<ReadonlyMap<NodeId, boolean>>(
    () => new Map(visibilityOverrides),
    [visibilityOverrides],
  );
  const renderable = isRenderableTree(tree);
  const currentRootId = renderable ? resolveScreenRoot(tree, currentScreen) : null;
  const activeScreen = renderable ? resolveActiveScreen(tree, currentScreen) : null;
  const visibleInfo = useMemo(
    () =>
      currentRootId === null
        ? null
        : collectVisibleInfo(tree, currentRootId, capturedVisibilityOverrides),
    [capturedVisibilityOverrides, currentRootId, tree],
  );
  const currentSnapshot: RenderSnapshot | null =
    currentRootId === null || visibleInfo === null
      ? null
      : {
          tree,
          rootId: currentRootId,
          activeScreen,
          visible: visibleInfo,
          visibilityOverrides: capturedVisibilityOverrides,
          theme: capturedTheme,
          revision: normalizedTransition?.revision ?? null,
          rootReplacedRevision: normalizedTransition?.rootReplacedRevision ?? null,
        };

  const updateMotionState = (updater: (current: MotionState) => MotionState): void => {
    setMotionState((current) => {
      const next = updater(current);
      motionStateRef.current = next;
      return next;
    });
  };

  const clearEnterTimer = (id: NodeId): void => {
    const timer = enterTimersRef.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      enterTimersRef.current.delete(id);
    }
  };
  const clearExitTimer = (id: NodeId): void => {
    const timer = exitTimersRef.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      exitTimersRef.current.delete(id);
    }
  };
  const clearStageTimer = (): void => {
    if (stageTimerRef.current !== null) {
      clearTimeout(stageTimerRef.current);
      stageTimerRef.current = null;
    }
  };
  const clearAllMotionTimers = (): void => {
    for (const timer of enterTimersRef.current.values()) {
      clearTimeout(timer);
    }
    enterTimersRef.current.clear();
    for (const timer of exitTimersRef.current.values()) {
      clearTimeout(timer);
    }
    exitTimersRef.current.clear();
    clearStageTimer();
  };
  const scheduleEnterTimer = (id: NodeId): void => {
    clearEnterTimer(id);
    const timer = setTimeout(() => {
      enterTimersRef.current.delete(id);
      updateMotionState((current) => {
        if (!current.enterIds.has(id)) {
          return current;
        }
        const enterIds = new Set(current.enterIds);
        enterIds.delete(id);
        return { ...current, enterIds };
      });
    }, MOTION_ENTER_MS);
    enterTimersRef.current.set(id, timer);
  };
  const scheduleExitTimer = (id: NodeId): void => {
    clearExitTimer(id);
    const timer = setTimeout(() => {
      exitTimersRef.current.delete(id);
      updateMotionState((current) => {
        if (!current.exitRecords.has(id)) {
          return current;
        }
        const exitRecords = new Map(current.exitRecords);
        exitRecords.delete(id);
        return { ...current, exitRecords };
      });
    }, MOTION_EXIT_MS);
    exitTimersRef.current.set(id, timer);
  };
  const scheduleStageTimer = (): void => {
    clearStageTimer();
    stageTimerRef.current = setTimeout(() => {
      stageTimerRef.current = null;
      updateMotionState((current) =>
        current.stagePrevious === null ? current : { ...current, stagePrevious: null },
      );
    }, STAGE_CROSSFADE_MS);
  };

  useEffect(() => () => clearAllMotionTimers(), []);

  useMotionLayoutEffect(() => {
    if (currentSnapshot === null) {
      previousSnapshotRef.current = null;
      if (!isMotionStateEmpty(motionStateRef.current)) {
        clearAllMotionTimers();
        updateMotionState(() => emptyMotionState());
      }
      return;
    }
    if (normalizedTransition === null) {
      previousSnapshotRef.current = currentSnapshot;
      if (!isMotionStateEmpty(motionStateRef.current)) {
        clearAllMotionTimers();
        updateMotionState(() => emptyMotionState());
      }
      return;
    }

    const previous = previousSnapshotRef.current;
    if (previous === null) {
      previousSnapshotRef.current = currentSnapshot;
      return;
    }
    if (isBlankBootSnapshot(previous)) {
      previousSnapshotRef.current = currentSnapshot;
      return;
    }

    const reappearedExitIds = new Set<NodeId>();
    for (const [id, record] of motionStateRef.current.exitRecords) {
      for (const visibleId of record.visibleIds) {
        if (!currentSnapshot.visible.ids.has(visibleId)) {
          continue;
        }
        reappearedExitIds.add(id);
        break;
      }
    }

    const enteringIds: NodeId[] = [];
    for (const id of currentSnapshot.visible.ids) {
      if (!previous.visible.ids.has(id) && !reappearedExitIds.has(id)) {
        enteringIds.push(id);
      }
    }
    let exitingVisibleCount = 0;
    for (const id of previous.visible.ids) {
      if (!currentSnapshot.visible.ids.has(id)) {
        exitingVisibleCount += 1;
      }
    }
    const exitingIds = topmostExitingIds(previous.visible, currentSnapshot.visible.ids);
    const rootReplaced =
      currentSnapshot.rootReplacedRevision !== null &&
      (previous.rootReplacedRevision === null ||
        currentSnapshot.rootReplacedRevision > previous.rootReplacedRevision);
    const enteringIdSet = new Set<NodeId>(enteringIds);
    let pendingEnterCount = 0;
    for (const id of motionStateRef.current.enterIds) {
      if (currentSnapshot.visible.ids.has(id) && !enteringIdSet.has(id)) {
        pendingEnterCount += 1;
      }
    }
    let pendingExitCount = 0;
    for (const [id, record] of motionStateRef.current.exitRecords) {
      if (!reappearedExitIds.has(id)) {
        pendingExitCount += record.visibleIds.size;
      }
    }
    const stageCrossfade =
      rootReplaced ||
      enteringIds.length + pendingEnterCount + exitingVisibleCount + pendingExitCount >
        MANY_CHANGE_THRESHOLD;

    if (
      reappearedExitIds.size === 0 &&
      enteringIds.length === 0 &&
      exitingIds.length === 0 &&
      !stageCrossfade
    ) {
      previousSnapshotRef.current = currentSnapshot;
      return;
    }

    if (stageCrossfade) {
      clearAllMotionTimers();
      updateMotionState(() => ({
        enterIds: new Set<NodeId>(),
        exitRecords: new Map<NodeId, ExitRecord>(),
        stagePrevious: { snapshot: previous },
      }));
      scheduleStageTimer();
      previousSnapshotRef.current = currentSnapshot;
      return;
    }

    if (motionStateRef.current.stagePrevious !== null) {
      previousSnapshotRef.current = currentSnapshot;
      return;
    }

    clearStageTimer();
    for (const id of reappearedExitIds) {
      clearExitTimer(id);
    }
    for (const id of enteringIds) {
      scheduleEnterTimer(id);
    }
    for (const id of exitingIds) {
      clearEnterTimer(id);
      scheduleExitTimer(id);
    }

    updateMotionState((current) => {
      const enterIds = new Set(current.enterIds);
      for (const id of exitingIds) {
        enterIds.delete(id);
      }
      for (const id of enteringIds) {
        enterIds.add(id);
      }

      const exitRecords = new Map(current.exitRecords);
      for (const id of reappearedExitIds) {
        exitRecords.delete(id);
      }
      for (const id of exitingIds) {
        const info = previous.visible.nodes.get(id);
        if (info !== undefined) {
          exitRecords.set(id, {
            id,
            parentId:
              info.parentId !== null &&
              currentSnapshot.visible.ids.has(info.parentId) &&
              isContainerValue(currentSnapshot.tree.nodes[info.parentId])
                ? info.parentId
                : null,
            index: info.index,
            ancestors: info.ancestors,
            depth: info.depth,
            visibleIds: visibleSubtreeIds(previous.visible, id),
            snapshot: previous,
          });
        }
      }

      return { enterIds, exitRecords, stagePrevious: null };
    });
    previousSnapshotRef.current = currentSnapshot;
  }, [currentSnapshot, normalizedTransition]);
  return { motionState, normalizedTransition, renderable, currentRootId, activeScreen };
}
