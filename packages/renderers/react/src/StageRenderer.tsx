import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  resolveTreeScreen,
  type CollectedEvent,
  type ColorModePreference,
  type FacetAction,
  type FacetTheme,
  type FacetTree,
  type FieldValues,
  type NodeId,
  type SortDirection,
  type ViewSnapshot,
} from "@facet/core";
import { captureViewSnapshot, useViewportColorMode } from "./view-snapshot.js";
import { APPEAR_CSS } from "./appear.js";
import { INPUT_TARGET_CSS } from "./brick-style-input.js";
import { INTERACTION_CSS } from "./interaction-style.js";
import {
  MOTION_CSS,
  stageCurrentClassName,
  stageFrameClassName,
  stagePreviousClassName,
} from "./motion.js";
import { resolveTheme } from "./theme.js";
import type { StageTransitionHint } from "./useFacet.js";
import { isMotionStateEmpty, motionRenderPlan, type ExitRecord } from "./renderer-motion.js";
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
const BRICK_STATE_CSS = `${INTERACTION_CSS}\n${INPUT_TARGET_CSS}`;

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
  /** One complete operator Theme. Invalid/hostile input falls back as a whole. */
  readonly theme?: FacetTheme;
  /** Host preference; `system` resolves in the browser and falls back to light on SSR. */
  readonly colorMode?: ColorModePreference;
  /**
   * Read-only publish of the browser's live view snapshot
   * (`{screen, toggled, viewport, colorMode}`) — the counterpart of how `fields`
   * rides `onAction`. Sampled after each commit whenever screen/overrides or
   * the detected device classes change; the host attaches it to an OUTGOING
   * event, exactly like `fields`. Optional (narrower props stay assignable);
   * it NEVER writes stage state — the renderer's setters stay private to
   * `handlePress`, and no server/patch path can drive it.
   */
  readonly onViewSnapshot?: (snapshot: ViewSnapshot) => void;
}

/**
 * Renders a stage tree into React elements from the closed brick vocabulary.
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
  theme: rawTheme,
  colorMode = "system",
  onViewSnapshot,
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
  // The THIRD browser-private view-state holder (sibling of currentScreen /
  // visibilityOverrides): a per-table-node sort override. A Map, not a plain
  // object, for the same prototype-safety reason as visibilityOverrides — a node
  // id like "toString" must never resolve through Object.prototype. Mutated ONLY
  // in `handleHeaderSort` below (no server/patch path can reach it), and the sort
  // rides only the read-only `view` snapshot — it fires NO transport/agent event.
  const [sortOverrides, setSortOverrides] = useState<
    ReadonlyMap<NodeId, { column: string; direction: SortDirection }>
  >(() => new Map());
  // Scope handle for collectFieldValues — reads stay inside THIS renderer
  // instance so two stages on one page never cross-read each other's inputs.
  const stageRootRef = useRef<HTMLDivElement>(null);
  // Browser classes are host/view state, never Facet Document syntax. The
  // effective color mode selects only the Theme's paint branch; viewport stays
  // report-only and never reaches layout resolution.
  const { viewport, colorMode: effectiveColorMode } = useViewportColorMode(colorMode);
  const theme = useMemo(
    () => resolveTheme(rawTheme, effectiveColorMode),
    [rawTheme, effectiveColorMode],
  );
  const { motionState, normalizedTransition, renderable, currentRootId, activeScreen } =
    useStageMotion({
      tree,
      transition,
      currentScreen,
      visibilityOverrides,
      theme,
    });

  // Publish the live view snapshot AFTER commit whenever the browser-owned
  // view-state (screen/overrides) or the detected device classes change. This
  // is a read-only sample the host attaches to an outgoing event; it writes no
  // stage state and cannot be driven by a server/patch path.
  useEffect(() => {
    if (onViewSnapshot === undefined) {
      return;
    }
    onViewSnapshot(
      captureViewSnapshot(
        currentScreen ?? undefined,
        visibilityOverrides,
        viewport,
        effectiveColorMode,
        sortOverrides,
      ),
    );
  }, [
    onViewSnapshot,
    currentScreen,
    visibilityOverrides,
    viewport,
    effectiveColorMode,
    sortOverrides,
  ]);

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
        if (resolveTreeScreen(tree, press.to).activeScreen === press.to) {
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

  // Cycle a table's local sort for one column: asc → desc → unsorted (entry
  // removed). CRITICAL (RISK-INV-2): this is pure browser VIEW-STATE — it fires
  // NO recordLocalTap/onRecord/onAction and NO transport, unlike navigate/toggle.
  // The sort rides only the next `view` snapshot. The functional updater form
  // makes rapid clicks deterministic (last click wins), and a Map keeps node-id
  // keys off the prototype chain.
  const handleHeaderSort = (tableId: NodeId, column: string): void => {
    setSortOverrides((prev) => {
      const current = prev.get(tableId);
      const next = new Map(prev);
      if (current === undefined || current.column !== column) {
        next.set(tableId, { column, direction: "asc" });
      } else if (current.direction === "asc") {
        next.set(tableId, { column, direction: "desc" });
      } else {
        next.delete(tableId); // desc → unsorted
      }
      return next;
    });
  };

  // Renderer-owned overlay close (RISK-INV-3 / RISK-INV-4). A DETERMINISTIC
  // set-to-hidden — `next.set(boxId, false)`, where the override Map stores
  // EFFECTIVE VISIBILITY (`true` = shown / `false` = hidden, matching the read
  // convention in renderer-render.tsx and the view-snapshot toggled loop). It is
  // idempotent: closing twice stays `false` (hidden) and NEVER re-flips open, so
  // a rapid double Esc/scrim can't reopen the overlay (unlike the blind
  // `!effective` flip the TRIGGER uses in `handlePress` above). It reuses the
  // SAME view-state writer + `recordLocalTap` as a trigger toggle, so
  // `view.toggled` stays single-sourced (the agent never reads a closed overlay
  // as open); `onAction` NEVER fires for a close. Threaded to the renderer as the
  // private `overlayClose` — no new public StageRenderer prop.
  const closeOverlay = (boxId: NodeId): void => {
    setVisibilityOverrides((prev) => {
      const next = new Map(prev);
      next.set(boxId, false);
      return next;
    });
    recordLocalTap({ kind: "tap", target: boxId, effect: { toggle: boxId } });
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
    // The live path carries the sort read map + the cycle setter. The inert
    // previous-screen clone below deliberately omits this, so it reads no sort and
    // never becomes a second sort writer mid-transition (RISK-INV-5).
    sortControl: { overrides: sortOverrides, onSort: handleHeaderSort },
    // The private overlay-close writer (sibling of sortControl.onSort). Present
    // only on this LIVE path; the inert previous-screen clone below omits it, so
    // a valid-overlay box mid-transition renders inline instead of a second
    // fixed frame (RISK-INV-4 idempotency lives in closeOverlay, not here).
    overlayClose: closeOverlay,
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
      <style>{BRICK_STATE_CSS}</style>
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
