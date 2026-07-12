import { Fragment, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type {
  CollectedEvent,
  FacetAction,
  FacetTheme,
  FacetTree,
  FieldValues,
  NodeId,
} from "@facet/core";
import { APPEAR_CSS } from "./appear.js";
import {
  MOTION_CSS,
  stageCurrentClassName,
  stageFrameClassName,
  stagePreviousClassName,
} from "./motion.js";
import { resolveTheme } from "./theme.js";
import type { StageTransitionHint } from "./useFacet.js";
import {
  isMotionStateEmpty,
  liveScreenRoot,
  motionRenderPlan,
  type ExitRecord,
} from "./renderer-motion.js";
import { collectFieldValues, type ClassifiedPress } from "./renderer-press.js";
import { RENDER_BUDGET, isHiddenByDefault } from "./renderer-safe.js";
import { renderExitRecord, renderNode } from "./renderer-render.js";
import { useStageMotion } from "./renderer-stage-motion.js";

const EMPTY_MOTION_CLASSES: ReadonlyMap<NodeId, string> = new Map<NodeId, string>();
const EMPTY_EXIT_RECORDS_BY_PARENT: ReadonlyMap<NodeId, readonly ExitRecord[]> = new Map<
  NodeId,
  readonly ExitRecord[]
>();
const DISPLAY_CONTENTS_STYLE: CSSProperties = { display: "contents" };

export interface StageRendererProps {
  readonly tree: FacetTree;
  readonly transition?: StageTransitionHint;
  /**
   * Invoked when an interactive brick fires (a pressed box, a submitted field).
   * When the pressed action declares `collect`, `fields` carries the press-time
   * snapshot of the mounted field values in that box's subtree (possibly `{}`);
   * without `collect` it is `undefined` — narrower `(action) => void` handlers
   * remain assignable, so existing consumers compile unchanged.
   */
  readonly onAction?: (action: FacetAction, fields?: FieldValues) => void;
  /**
   * Optional record-only channel for locally-resolved taps (navigate/toggle).
   * Fired AFTER the optimistic view-state mutation with a `CollectedEvent` tap
   * carrying the resolved effect (`{navigate}`/`{toggle}`, captured here and
   * NEVER re-derived) and the pressed box's node id as `target`. Distinct from
   * `onAction`: this tap is LOGGED for replay, never forwarded to the agent.
   * Fire-and-forget — the renderer swallows any throw so a record failure can
   * never unwind `currentScreen`/`visibilityOverrides` (DC-003). Omitted ⇒
   * navigate/toggle behave exactly as today and the output is byte-identical.
   */
  readonly onRecord?: (tap: CollectedEvent) => void;
  /**
   * The operator-authored theme registry. The tree's `theme` NAME is resolved
   * against it into concrete CSS; an absent prop (or unknown name) renders the
   * default look. Documents must be `validateTheme`-clean — the host owns that
   * boundary; `resolveTheme` floor-guards the lookup regardless.
   */
  readonly themes?: readonly FacetTheme[];
}

/**
 * Renders a stage tree into React elements from the four low-level bricks.
 *
 * This is the security boundary and the fail-safe boundary: only known brick
 * types are rendered, there is no node that carries raw HTML/JS, and any id that
 * can't be resolved (e.g. a removed node still referenced by a parent) is simply
 * skipped — so a partial or imperfect stage renders as "plain", never broken.
 *
 * It also owns the browser's VIEW-STATE (invariant #6): `currentScreen` and
 * `visibilityOverrides` live here as React state. A navigate/toggle press
 * mutates only this state — that optimistic effect runs FIRST and
 * unconditionally and NEVER reaches `onAction` (the agent-routed channel). It
 * then fires the OPTIONAL, fire-and-forget `onRecord` channel with the resolved
 * effect + the pressed box's id, so the tap is LOGGED (not forwarded) for
 * replay; a record failure can never unwind the view-state. Content stays
 * server-owned via the patch flow.
 */
export function StageRenderer({
  tree,
  transition,
  onAction,
  onRecord,
  themes,
}: StageRendererProps): ReactNode {
  const [currentScreen, setCurrentScreen] = useState<string | null>(null);
  // A Map, not a plain object: node ids like "toString"/"valueOf" pass
  // validateTree (only __proto__/prototype/constructor are forbidden), and a
  // plain-object lookup would resolve those through Object.prototype — a
  // hidden:true node keyed "toString" would read the inherited function as its
  // override and render visible. A Map never resolves through the prototype.
  const [visibilityOverrides, setVisibilityOverrides] = useState<ReadonlyMap<NodeId, boolean>>(
    () => new Map(),
  );
  // Scope handle for collectFieldValues — reads stay inside THIS renderer
  // instance so two stages on one page never cross-read each other's inputs.
  const stageRootRef = useRef<HTMLDivElement>(null);
  // Resolve the tree's theme NAME (unknown on the raw patch path) against the
  // registry ONCE per name/registry change. A live theme flip is just a new
  // `tree.theme`, so this re-resolves and the stage restyles without a reload.
  // Guard the read: hooks must run before the renderable check below, but a
  // null/primitive tree (the unvalidated CLI path) has no `.theme` to dereference.
  const themeName: unknown =
    typeof tree === "object" && tree !== null
      ? (tree as { readonly theme?: unknown }).theme
      : undefined;
  const theme = useMemo(() => resolveTheme(themeName, themes), [themeName, themes]);
  const { motionState, normalizedTransition, renderable, currentRootId, activeScreen } =
    useStageMotion({
      tree,
      transition,
      currentScreen,
      visibilityOverrides,
      theme,
    });

  // Fail-safe boundary (invariant #2): a malformed tree — e.g. `render 'null'` on
  // the unvalidated CLI path — renders as nothing, never a crash.
  if (!renderable || currentRootId === null) {
    return null;
  }

  // Fire-and-forget record of a locally-resolved tap: the optimistic setState
  // has ALREADY run when this is called, so a throw here is swallowed and can
  // never unwind currentScreen/visibilityOverrides (DC-003). No-op when the
  // host wires no record channel — navigate/toggle then stay exactly as today.
  const recordLocalTap = (tap: CollectedEvent): void => {
    if (onRecord === undefined) {
      return;
    }
    try {
      onRecord(tap);
    } catch {
      // Best-effort: a record-channel failure must not unwind the optimistic
      // view-state or throw out of the press handler (DC-003).
    }
  };

  const handlePress = (press: ClassifiedPress, sourceId: NodeId): void => {
    switch (press.kind) {
      case "navigate":
        // Only a live screen is navigable; unknown targets no-op (DC-004).
        if (liveScreenRoot(tree, press.to) !== null) {
          setCurrentScreen(press.to);
          // Record AFTER the optimistic mutation, carrying the resolved effect
          // (captured here, never re-derived) + the pressed box's id.
          recordLocalTap({ kind: "tap", target: sourceId, effect: { navigate: press.to } });
        }
        return;
      case "toggle": {
        // hasOwnProperty guard: on the raw live path `tree.nodes` is ordinary
        // JSON, so a target named "constructor"/"toString" would otherwise
        // resolve an inherited Object.prototype member and treat a nonexistent
        // node as existing (DC-004: an unknown target must no-op).
        const target = Object.prototype.hasOwnProperty.call(tree.nodes, press.target)
          ? tree.nodes[press.target]
          : undefined;
        if (target == null) {
          return; // unknown target no-ops (DC-004)
        }
        setVisibilityOverrides((prev) => {
          const effective = prev.get(press.target) ?? !isHiddenByDefault(target);
          const next = new Map(prev);
          next.set(press.target, !effective);
          return next;
        });
        // Record AFTER the optimistic mutation with the resolved toggle effect.
        recordLocalTap({ kind: "tap", target: sourceId, effect: { toggle: press.target } });
        return;
      }
      case "agent":
        if (press.collect === undefined) {
          onAction?.(press.action); // no collect ⇒ today's exact emission (fields undefined)
          return;
        }
        // Always a fields object when collect is declared — {} on any degrade,
        // including an unexpectedly null stage root (no document-wide fallback).
        onAction?.(
          press.action,
          stageRootRef.current === null
            ? {}
            : collectFieldValues(tree, press.collect, stageRootRef.current),
        );
    }
  };

  // Appear detection (Decision 4, folded into the render walk in review r7):
  // `renderNode` flips `appearSeen.used` when a REACHABLE box renders with an
  // appear class, so the one-per-stage <style> is gated on the SAME
  // budget-bounded traversal that renders the tree — never a separate O(N) scan
  // of the whole `tree.nodes` map, which the raw live path can grow to
  // arbitrary size with unreachable/dangling entries (a per-render soft-DoS the
  // budget exists to prevent). Reachable-only is also strictly more correct:
  // an appear token on an unrendered node no longer forces a useless stylesheet.
  const appearSeen = { used: false };
  const motionPlan = motionRenderPlan(motionState);
  const hasActiveMotion = !isMotionStateEmpty(motionState);

  // One mutable budget per render pass, LOCAL to this StageRenderer render and
  // threaded down the plain `renderNode` recursion. `renderNode` is a plain
  // function, not a React component, so the counter is never shared across
  // separate component invocations — under StrictMode React double-invokes
  // StageRenderer (each making its own fresh budget) rather than double-decrementing
  // one shared object per node, so a valid tree renders in full at either cap.
  const budget: { left: number; refsLeft: number; warned?: boolean } = {
    left: RENDER_BUDGET,
    refsLeft: RENDER_BUDGET,
  };
  const stage = renderNode({
    tree,
    id: currentRootId,
    onPress: handlePress,
    visibilityOverrides,
    theme,
    budget,
    appearSeen,
    depth: 0,
    renderMode: "live",
    motionClassById: motionPlan.motionClassById,
    exitRecordsByParent: motionPlan.exitRecordsByParent,
    activeScreen,
  });
  const rootExitNodes = motionPlan.rootExitRecords.map((record) => (
    <Fragment key={`exit:${record.id}`}>
      {renderExitRecord({ record, onPress: handlePress, appearSeen })}
    </Fragment>
  ));
  const stageContent = (
    <Fragment>
      {stage}
      {rootExitNodes}
    </Fragment>
  );
  const stageBody =
    normalizedTransition === null ? (
      stageContent
    ) : (
      <div
        className={stageFrameClassName(motionState.stagePrevious !== null)}
        style={motionState.stagePrevious === null ? DISPLAY_CONTENTS_STYLE : undefined}
      >
        <div
          className={stageCurrentClassName()}
          style={motionState.stagePrevious === null ? DISPLAY_CONTENTS_STYLE : undefined}
        >
          {stageContent}
        </div>
        {motionState.stagePrevious === null ? null : (
          <div
            className={stagePreviousClassName()}
            aria-hidden={true}
            style={{ pointerEvents: "none" }}
          >
            {renderNode({
              tree: motionState.stagePrevious.snapshot.tree,
              id: motionState.stagePrevious.snapshot.rootId,
              onPress: handlePress,
              visibilityOverrides: motionState.stagePrevious.snapshot.visibilityOverrides,
              theme: motionState.stagePrevious.snapshot.theme,
              budget: { left: RENDER_BUDGET, refsLeft: RENDER_BUDGET },
              appearSeen,
              depth: 0,
              renderMode: "inert",
              motionClassById: EMPTY_MOTION_CLASSES,
              exitRecordsByParent: EMPTY_EXIT_RECORDS_BY_PARENT,
              activeScreen: motionState.stagePrevious.snapshot.activeScreen,
            })}
          </div>
        )}
      </div>
    );
  // The appear stylesheet rides ONCE per stage, and only when the tree uses
  // appear — appear-free trees stay byte-identical to today (Fragment and null
  // emit no markup). Two stages on one page each emit the identical namespaced
  // constant (idempotent). The Fragment wrapper is UNCONDITIONAL on purpose:
  // `usesAppear ? <Fragment>…</Fragment> : stage` would change the root child's
  // element TYPE when a patch adds the first (or removes the last) appear token,
  // and React would remount the entire stage subtree — wiping visitor-typed
  // field text and scroll offsets (review r3). With the stable Fragment, `stage`
  // keeps its child position and only the <style> slot toggles. Replay
  // semantics are pinned as replay-on-MOUNT (Decision 2): the animation is pure
  // CSS on the class, so it runs whenever the element mounts — first paint,
  // node re-add, toggle re-show, screen navigation (hidden/off-screen nodes are
  // unmounted) — with no JS played-state bookkeeping; a remounted node
  // deliberately replays its animation.
  const staged = (
    <Fragment>
      {appearSeen.used ? <style>{APPEAR_CSS}</style> : null}
      {hasActiveMotion ? <style>{MOTION_CSS}</style> : null}
      {stageBody}
    </Fragment>
  );
  if (onAction === undefined) {
    // No handler ⇒ no press can emit, so field collection is unreachable and
    // the scope wrapper is unnecessary — handler-less output stays byte-
    // identical to the pre-collect renderer (pinned by the static suite).
    return staged;
  }
  // display: contents adds no layout box, so flow layout is unchanged
  // (invariant #5); the div exists only to scope the press-time field read.
  return (
    <div style={{ display: "contents" }} ref={stageRootRef}>
      {staged}
    </div>
  );
}
