import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import {
  FIELD_INPUTS,
  isSafeImageSrc,
  isTreeShaped,
  MAX_DEPTH,
  MAX_FIELD_VALUE_CHARS,
  MAX_FIELDS_KEYS,
  MAX_RENDER_NODES,
  sanitizeActionPayload,
  type AgentAction,
  type FacetAction,
  type FacetNode,
  type FacetTheme,
  type FacetTree,
  type NodeId,
} from "@facet/core";
import { boxStyle, fieldStyle, imageStyle, resolveTheme, textStyle } from "./theme.js";
import type { ResolvedTheme } from "./theme.js";
import { APPEAR_CSS, appearClass } from "./appear.js";

const EMPTY_ANCESTORS: ReadonlySet<NodeId> = new Set<NodeId>();

/**
 * Long-press gesture thresholds — renderer constants, never tokens or theme
 * data (RISK-API-5): agents author `onHold`, not durations. A press held for
 * HOLD_MS fires the hold; pointer travel beyond HOLD_SLOP_PX disarms it.
 */
const HOLD_MS = 500;
const HOLD_SLOP_PX = 8;

/**
 * Fail-safe cap on total nodes visited in ONE render pass / field gather
 * (invariant #2). Depth alone is not enough: a shared-child DAG reaching the raw
 * live path (no validateTree) is acyclic and shallow yet has an exponential
 * number of root-to-node paths, which would hang the tab. This bounds the whole
 * pass to a linear budget, mirroring how MAX_DEPTH already bounds nesting.
 * Sourced from core's MAX_RENDER_NODES so the validator's node-count warning and
 * the renderer's truncation point are the same number, never drifting.
 */
const RENDER_BUDGET = MAX_RENDER_NODES;

// Fail-safe (invariant #2): the live path applies raw RFC 6902 patches with no
// validateTree, so any node FIELD can hold arbitrary JSON (children: "oops",
// src: 42, style: null). Coerce shapes here instead of trusting the types.
function styleOf<T extends object>(style: T | undefined): T | undefined {
  return typeof style === "object" && style !== null ? style : undefined;
}

/** A tree is renderable only if it's tree-shaped (core floor) AND its root resolves. */
function isRenderableTree(tree: FacetTree): boolean {
  // != null: a patch can set the root node to JSON null, not just remove it.
  return isTreeShaped(tree) && tree.nodes[tree.root] != null;
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
function liveScreenRoot(tree: FacetTree, name: unknown): NodeId | null {
  const screens: unknown = tree.screens;
  if (typeof screens !== "object" || screens === null || typeof name !== "string") {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(screens, name)) {
    return null;
  }
  const rootId: unknown = (screens as Record<string, unknown>)[name];
  if (typeof rootId !== "string") {
    return null;
  }
  const node = tree.nodes[rootId];
  return node != null && node.type === "box" ? rootId : null;
}

/**
 * Total function from view-state to the node id to render (invariant #6):
 * current screen if live → entry if live → first live screen → plain `root`.
 */
function resolveScreenRoot(tree: FacetTree, currentScreen: string | null): NodeId {
  const current = liveScreenRoot(tree, currentScreen);
  if (current !== null) {
    return current;
  }
  const entry = liveScreenRoot(tree, tree.entry);
  if (entry !== null) {
    return entry;
  }
  const screens: unknown = tree.screens;
  if (typeof screens === "object" && screens !== null) {
    for (const name of Object.keys(screens)) {
      const first = liveScreenRoot(tree, name);
      if (first !== null) {
        return first;
      }
    }
  }
  return tree.root;
}

/** A press the renderer has classified from an UNTRUSTED `onPress` value. */
type ClassifiedPress =
  | { readonly kind: "navigate"; readonly to: string }
  | { readonly kind: "toggle"; readonly target: NodeId }
  | { readonly kind: "agent"; readonly action: AgentAction; readonly collect?: NodeId };

/**
 * Snapshots the visitor-typed values of the MOUNTED field inputs inside the
 * `collectId` box's subtree (invariant #6: field text is browser view-state —
 * this read-only, press-time snapshot lives only in the emitted event; nothing
 * is ever written back into the tree).
 *
 * Enumeration is data-side (the tree names the fields, in walk order — first
 * name wins) and the read is DOM-side, scoped to `root` so two renderers on one
 * page can never cross-read. Only mounted inputs are readable: a field on a
 * non-current screen or hidden by toggle simply isn't in the DOM and is omitted.
 * Every failure mode (unknown/non-box target, zero fields, missing DOM input,
 * cyclic/too-deep subtree) degrades to omission / `{}` — never a throw (DC-002).
 */
function collectFieldValues(
  tree: FacetTree,
  collectId: NodeId,
  root: ParentNode,
): Readonly<Record<string, string>> {
  const target = tree.nodes[collectId];
  if (target == null || target.type !== "box") {
    return {};
  }

  // Data-side pass: (name → node ids) for every field in the subtree, in walk
  // order — mirrors renderNode's own ancestor-set cycle guard + depth cap so a
  // cyclic raw-path tree terminates. Keeping ALL ids per name (not just the
  // first) lets the DOM pass pick a MOUNTED one, so a hidden/off-screen field
  // can't shadow a visible same-named field and drop its value.
  const idsByName = new Map<string, NodeId[]>();
  // Total-visit budget for THIS invocation: `ancestors` breaks cycles but a raw
  // shared-child DAG (no validateTree on the live path) has an exponential number
  // of paths, so cap total gather steps the way renderNode caps total renders.
  let gatherBudget = RENDER_BUDGET;
  const gather = (id: NodeId, ancestors: ReadonlySet<NodeId>, depth: number): void => {
    if (depth > MAX_DEPTH || ancestors.has(id) || --gatherBudget < 0) {
      return;
    }
    const node = tree.nodes[id];
    if (node == null) {
      return;
    }
    if (node.type === "field") {
      // Never harvest secrets: a password field's value is excluded from
      // collection outright, so it can't ride the action event into an agent
      // (and, for the reference brain, into a third-party LLM + history replay).
      if (node.input === "password") {
        return;
      }
      if (typeof node.name === "string") {
        // Cap the NAME the same way the value is capped below: field names come
        // from untrusted LLM output, and an over-cap key would make the server's
        // isFieldsRecord reject the whole submit (a silent no-op). Capping keeps
        // the two sides from drifting so an over-long name degrades gracefully.
        const name = node.name.slice(0, MAX_FIELD_VALUE_CHARS);
        const ids = idsByName.get(name);
        if (ids === undefined) idsByName.set(name, [id]);
        else ids.push(id);
      }
      return;
    }
    if (node.type !== "box") {
      return; // non-field, non-box nodes contribute nothing (DC-003)
    }
    const childIds: readonly NodeId[] = Array.isArray(node.children) ? node.children : [];
    const childAncestors = new Set(ancestors).add(id);
    for (const childId of childIds) {
      gather(childId, childAncestors, depth + 1);
    }
  };
  gather(collectId, EMPTY_ANCESTORS, 0);

  // DOM-side pass: enumerate the stamped inputs ONCE and match by attribute
  // comparison — no CSS.escape (jsdom exposes no window.CSS, and comparing
  // sidesteps escaping arbitrary node ids). If a node is mounted more than
  // once, the FIRST match in DOM order wins (deterministic).
  const inputByNodeId = new Map<string, Element>();
  for (const el of Array.from(root.querySelectorAll("input[data-facet-field-id]"))) {
    const nodeId = el.getAttribute("data-facet-field-id");
    if (nodeId !== null && !inputByNodeId.has(nodeId)) {
      inputByNodeId.set(nodeId, el);
    }
  }

  const fields: Record<string, string> = {};
  for (const [name, ids] of idsByName) {
    // Bound the field COUNT with the same cap the server enforces, so the
    // renderer can't emit a fields object the server rejects wholesale (400).
    if (Object.keys(fields).length >= MAX_FIELDS_KEYS) break;
    // Pick the first MOUNTED input among same-named fields (a hidden earlier
    // one must not shadow a visible later one).
    const mountedId = ids.find((id) => inputByNodeId.has(id));
    const input = mountedId === undefined ? undefined : inputByNodeId.get(mountedId);
    if (input !== undefined) {
      // The selector only matches <input> elements, whose .value is a string;
      // String() is belt-and-braces before the shared cap is applied.
      fields[name] = String((input as HTMLInputElement).value).slice(0, MAX_FIELD_VALUE_CHARS);
    }
  }
  return fields;
}

/**
 * Classifies an untrusted `onPress` (the raw live-patch path bypasses
 * validateTree). Unclassifiable shapes return null — the box renders as a plain
 * NON-pressable box, never a broken button.
 */
function classifyPress(onPress: unknown): ClassifiedPress | null {
  if (typeof onPress !== "object" || onPress === null) {
    return null;
  }
  const press = onPress as {
    readonly kind?: unknown;
    readonly to?: unknown;
    readonly target?: unknown;
    readonly name?: unknown;
    readonly payload?: unknown;
    readonly collect?: unknown;
  };
  if (press.kind === "navigate") {
    return typeof press.to === "string" ? { kind: "navigate", to: press.to } : null;
  }
  if (press.kind === "toggle") {
    return typeof press.target === "string" ? { kind: "toggle", target: press.target } : null;
  }
  if ((press.kind === undefined || press.kind === "agent") && typeof press.name === "string") {
    // Emit the canonical kind-stamped agent action (a bare {name} IS an agent action).
    // Reuse core's fail-safe filter: a plain (non-array) object keeps only its
    // primitive values; anything else yields undefined and no payload is emitted.
    const payload = sanitizeActionPayload(press.payload);
    const action: AgentAction =
      payload !== undefined
        ? { kind: "agent", name: press.name, payload }
        : { kind: "agent", name: press.name };
    // A string collect rides the classification (not the emitted action): it is
    // the renderer's instruction to snapshot fields at press time. Non-string
    // raw-path junk is dropped — the button still works, just without fields.
    if (typeof press.collect === "string") {
      return { kind: "agent", action, collect: press.collect };
    }
    return { kind: "agent", action };
  }
  return null;
}

/** Content-declared default visibility; only literal `true` hides (raw-path junk is visible). */
function isHiddenByDefault(node: FacetNode): boolean {
  return (node as { readonly hidden?: unknown }).hidden === true;
}

/** Pointer coordinates on the raw event path can be missing (synthetic events); degrade to 0. */
function finiteCoord(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

interface HoldableBoxProps {
  /** Classified onPress — null renders a hold-only box (a quick tap no-ops). */
  readonly press: ClassifiedPress | null;
  /** Classified onHold — non-null by construction: renderNode mounts this component ONLY then. */
  readonly hold: ClassifiedPress;
  /**
   * The ONE existing view-state switch (StageRenderer's handlePress) — press
   * and hold both route through it (one classifier, one switch, RISK-INV-1), so
   * a hold-emitted agent event is byte-identical IN SHAPE to a press-emitted
   * one: no gesture discriminator field exists anywhere (RISK-INV-5).
   */
  readonly dispatch: (press: ClassifiedPress) => void;
  readonly style: CSSProperties;
  readonly className: string | undefined;
  readonly children: ReactNode;
}

/**
 * A pressable box that ALSO detects a long press (Decision 3). Used exclusively
 * for boxes whose `onHold` classifies — press-only and plain boxes keep today's
 * exact inline elements (byte-identical DOM). `pointerdown` arms a HOLD_MS
 * timer; `pointermove` beyond HOLD_SLOP_PX, `pointerup` before threshold,
 * `pointercancel` (incl. the browser claiming a touch gesture for scrolling —
 * free disambiguation, so no touch-action CSS is set here), or `pointerleave`
 * disarms it. The timer firing executes the hold and latches suppression of the
 * browser-synthesized click that follows pointerup, so press and hold never
 * both fire.
 */
function HoldableBox({
  press,
  hold,
  dispatch,
  style,
  className,
  children,
}: HoldableBoxProps): ReactNode {
  // Latest-classification refs, updated each render: the timer callback must
  // act on the CURRENT content, not the content captured at pointerdown. A
  // patch that CHANGES onHold mid-press lands here
  // before the timer fires; a patch that REMOVES onHold unmounts this component
  // entirely (renderNode only mounts it for a classifiable onHold) and the
  // unmount cleanup below clears the pending timer — either way the stale hold
  // no-ops.
  const holdRef = useRef(hold);
  holdRef.current = hold;
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  // Pending hold timer + gesture origin (the slop reference); null = disarmed.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originRef = useRef<{ readonly x: number; readonly y: number } | null>(null);
  /**
   * Suppress-next-click latch (pinned lifecycle): SET when the hold timer
   * fires; cleared when CONSUMED by the next click on this box OR RESET on the
   * next pointerdown on this box, whichever comes first. The arm-time reset
   * matters: a hold whose pointer is released OUTSIDE the box makes the browser
   * target the synthesized click at the common ancestor — this box never sees
   * it, and the stale latch must NOT swallow the visitor's NEXT quick tap.
   */
  const suppressNextClickRef = useRef(false);
  // True from the hold firing until the pointer ends — with the armed timer it
  // scopes contextmenu suppression to the live gesture only.
  const holdingRef = useRef(false);

  // Unmount cleanup: a patch that removes onHold (or the whole node) mid-press
  // swaps this component out; the pending timer must die with it.
  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    },
    [],
  );

  const disarm = (): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    originRef.current = null;
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    // Only the PRIMARY pointer's PRIMARY button can arm a hold — and the guard
    // runs before ANY state change: a right/middle-button press must neither
    // dispatch a 500ms "hold" the visitor never meant (incl. collect field
    // snapshots) nor leave an armed timer that makes handleContextMenu suppress
    // every native right-click menu over this box.
    if (!event.isPrimary || event.button !== 0) {
      return;
    }
    // pointerdown bubbles: a holdable box nested in another holdable box would
    // arm BOTH timers and one long press would dispatch two hold actions. Only
    // the innermost HoldableBox arms — primary presses stop here (non-primary
    // presses returned above WITHOUT stopping, leaving ancestors unaffected).
    event.stopPropagation();
    // Arm-time latch reset — see the latch lifecycle above.
    suppressNextClickRef.current = false;
    holdingRef.current = false;
    originRef.current = { x: finiteCoord(event.clientX), y: finiteCoord(event.clientY) };
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      originRef.current = null;
      holdingRef.current = true;
      // Swallow the browser-synthesized click that follows the coming pointerup.
      suppressNextClickRef.current = true;
      // One press pipeline: the hold rides the same handlePress switch a press
      // does, reading the LATEST classification (see holdRef above).
      dispatchRef.current(holdRef.current);
    }, HOLD_MS);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const origin = originRef.current;
    if (timerRef.current === null || origin === null) {
      return;
    }
    const dx = finiteCoord(event.clientX) - origin.x;
    const dy = finiteCoord(event.clientY) - origin.y;
    if (dx * dx + dy * dy > HOLD_SLOP_PX * HOLD_SLOP_PX) {
      disarm();
    }
  };

  const handlePointerEnd = (): void => {
    // pointerup before the threshold, pointercancel, or pointerleave: the hold
    // disarms; a below-threshold release lets the native click run onPress as
    // today.
    disarm();
    holdingRef.current = false;
  };

  const handleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false; // consumed by this click
      // The synthesized post-hold click must not bubble into an ancestor
      // pressable box's onClick — a completed hold on a nested box would
      // otherwise ALSO fire the ancestor's onPress ("press and hold never
      // both fire" is pinned). A normal quick-tap click keeps bubbling below.
      event.stopPropagation();
      return;
    }
    if (press !== null) {
      dispatch(press);
    }
    // Hold-only box (press === null): a quick tap deliberately no-ops.
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>): void => {
    // Suppressed ONLY while a hold gesture is live (armed, or fired and not yet
    // released) — so a touch long-press context menu can't race the hold.
    // Boxes without onHold never mount this component and keep the native menu.
    if (timerRef.current !== null || holdingRef.current) {
      event.preventDefault();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={className}
      style={style}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onPointerLeave={handlePointerEnd}
      onContextMenu={handleContextMenu}
    >
      {children}
    </div>
  );
}

export interface StageRendererProps {
  readonly tree: FacetTree;
  /**
   * Invoked when an interactive brick fires (a pressed box, a submitted field).
   * When the pressed action declares `collect`, `fields` carries the press-time
   * snapshot of the mounted field values in that box's subtree (possibly `{}`);
   * without `collect` it is `undefined` — narrower `(action) => void` handlers
   * remain assignable, so existing consumers compile unchanged.
   */
  readonly onAction?: (action: FacetAction, fields?: Readonly<Record<string, string>>) => void;
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
 * `visibilityOverrides` live here as React state; navigate/toggle presses
 * mutate only this state and NEVER reach `onAction` (the only channel to any
 * transport). Content stays server-owned via the patch flow.
 */
export function StageRenderer({ tree, onAction, themes }: StageRendererProps): ReactNode {
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

  // Fail-safe boundary (invariant #2): a malformed tree — e.g. `render 'null'` on
  // the unvalidated CLI path — renders as nothing, never a crash.
  if (!isRenderableTree(tree)) {
    return null;
  }

  const handlePress = (press: ClassifiedPress): void => {
    switch (press.kind) {
      case "navigate":
        // Only a live screen is navigable; unknown targets no-op (DC-004).
        if (liveScreenRoot(tree, press.to) !== null) {
          setCurrentScreen(press.to);
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

  // Appear prescan (Decision 4): ONE flat, NON-recursive pass over the
  // `tree.nodes` record VALUES decides whether this stage needs the appear
  // stylesheet at all. It never follows `children` — so a cyclic or over-deep
  // RAW tree cannot hang it, by construction — and it null-guards every value
  // (`n != null && typeof n === "object"`) before touching `.style`, mirroring
  // renderNode's `node == null` guard: the raw live path can hold null/scalar
  // node values (isTreeShaped only checks that `nodes` is an object, never its
  // values). Only BOX styles count — appear is BoxStyle-only (Decision 2) and
  // validateTree strips it from non-box styles, so the raw unvalidated path
  // must not diverge from the validated one. Reachability is deliberately
  // ignored: an appear token on an unreachable node costs one harmless
  // idempotent <style>, while a reachability walk would be a new unguarded
  // traversal.
  const nodeValues: readonly unknown[] = Object.values(tree.nodes);
  const usesAppear = nodeValues.some(
    (n) =>
      n != null &&
      typeof n === "object" &&
      (n as { readonly type?: unknown }).type === "box" &&
      appearClass(styleOf((n as { readonly style?: object }).style)) !== undefined,
  );

  // One mutable budget per render pass, LOCAL to this StageRenderer render and
  // threaded down the plain `renderNode` recursion. `renderNode` is a plain
  // function, not a React component, so the counter is never shared across
  // separate component invocations — under StrictMode React double-invokes
  // StageRenderer (each making its own fresh budget) rather than double-decrementing
  // one shared object per node, so a valid tree renders in full at either cap.
  const budget: { left: number; warned?: boolean } = { left: RENDER_BUDGET };
  const stage = renderNode({
    tree,
    id: resolveScreenRoot(tree, currentScreen),
    onPress: handlePress,
    visibilityOverrides,
    theme,
    budget,
    depth: 0,
  });
  // The appear stylesheet rides ONCE per stage, and only when the tree uses
  // appear — appear-free trees stay byte-identical to today. Two stages on one
  // page each emit the identical namespaced constant (idempotent). Replay
  // semantics are pinned as replay-on-MOUNT (Decision 2): the animation is pure
  // CSS on the class, so it runs whenever the element mounts — first paint,
  // node re-add, toggle re-show, screen navigation (hidden/off-screen nodes are
  // unmounted) — with no JS played-state bookkeeping; a remounted node
  // deliberately replays its animation.
  const staged = usesAppear ? (
    <Fragment>
      <style>{APPEAR_CSS}</style>
      {stage}
    </Fragment>
  ) : (
    stage
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

interface RenderArgs {
  readonly tree: FacetTree;
  readonly id: NodeId;
  readonly onPress: (press: ClassifiedPress) => void;
  readonly visibilityOverrides: ReadonlyMap<NodeId, boolean>;
  /** The resolved theme threaded from StageRenderer to every style call site. */
  readonly theme: ResolvedTheme;
  /** Ids on the path from the root to here — used to break cycles fail-safe. */
  readonly ancestors?: ReadonlySet<NodeId> | undefined;
  /**
   * Per-render-pass node budget — bounds total renders (invariant #2). `warned`
   * latches the one-time console.warn when the budget first trips.
   */
  readonly budget: { left: number; warned?: boolean };
  readonly depth: number;
}

/**
 * Renders one node to a `ReactNode`, recursing into box children. A PLAIN
 * function (not a React component) invoked from StageRenderer's body: the mutable
 * `budget` it decrements is therefore local to a single StageRenderer render and
 * never shared across separate component invocations, so React StrictMode's
 * double-invoke can't silently halve the effective cap (it re-runs StageRenderer,
 * which makes a fresh budget each time).
 */
function renderNode({
  tree,
  id,
  onPress,
  visibilityOverrides,
  theme,
  ancestors,
  budget,
  depth,
}: RenderArgs): ReactNode {
  const node = tree.nodes[id];
  // == null also skips a node a patch replaced with JSON null (not just missing
  // ids), and short-circuits BEFORE the budget decrement so a skipped id doesn't
  // spend budget.
  if (node == null || depth > MAX_DEPTH) {
    return null;
  }
  // The budget guard bounds a shared-child DAG's exponential path count the same
  // way depth bounds nesting — decremented only for a node we'd actually render.
  // Warn ONCE when the budget trips so a truncated render isn't silent (the
  // validator emits the matching node-count issue at store time).
  if (--budget.left < 0) {
    if (budget.warned !== true) {
      budget.warned = true;
      console.warn(
        `[facet] render budget of ${MAX_RENDER_NODES} nodes exceeded; the excess is truncated`,
      );
    }
    return null;
  }
  // Effective visibility = browser override ?? content default. A hidden node
  // is skipped (never thrown on), same as an unresolvable id.
  const visible = visibilityOverrides.get(id) ?? !isHiddenByDefault(node);
  if (!visible) {
    return null;
  }

  switch (node.type) {
    case "box": {
      // Fail-safe (invariant #2): skip a child that points back to an ancestor so
      // a cyclic tree (which never passes through validateTree on the live path)
      // can't infinitely recurse and crash the render.
      const seen = ancestors ?? EMPTY_ANCESTORS;
      const childAncestors = new Set(seen).add(id);
      const childIds: readonly NodeId[] = Array.isArray(node.children) ? node.children : [];
      // One linear pass skips ancestors (cycle break) and dedupes sibling ids
      // (raw path can repeat one; validateTree dedupes too) — first occurrence
      // wins so React keys stay unique.
      const emitted = new Set<NodeId>(seen);
      const uniqueChildIds = childIds.filter((childId) => {
        if (emitted.has(childId)) {
          return false;
        }
        emitted.add(childId);
        return true;
      });
      // Each child is rendered by a direct recursive call; a keyed Fragment
      // carries the React list key without adding a DOM node (flow layout and the
      // byte-identical output are unchanged — a Fragment emits no markup).
      const children = uniqueChildIds.map((childId) => (
        <Fragment key={childId}>
          {renderNode({
            tree,
            id: childId,
            onPress,
            visibilityOverrides,
            theme,
            ancestors: childAncestors,
            budget,
            depth: depth + 1,
          })}
        </Fragment>
      ));
      // onPress is untrusted on the raw path — an unclassifiable action renders
      // a plain non-pressable box instead of a dead or dangerous button.
      const press = classifyPress(node.onPress);
      // onHold is untrusted the same way, classified by the SAME classifier
      // (one classifier, one switch — RISK-INV-1): junk (`onHold: 42`)
      // classifies null and the box keeps today's exact press-only or plain
      // element below (byte-identical DOM). Only a classifiable onHold mounts
      // the gesture-detecting HoldableBox.
      const hold = classifyPress(node.onHold);
      // appearClass is TOTAL on raw-path junk: only "fade"/"slide" yield a
      // class; undefined adds no attribute, keeping token-free output
      // byte-identical.
      const appear = appearClass(styleOf(node.style));
      if (hold !== null) {
        return (
          <HoldableBox
            press={press}
            hold={hold}
            dispatch={onPress}
            className={appear}
            style={{ ...boxStyle(styleOf(node.style), theme), cursor: "pointer" }}
          >
            {children}
          </HoldableBox>
        );
      }
      if (press !== null) {
        return (
          <div
            role="button"
            tabIndex={0}
            className={appear}
            style={{ ...boxStyle(styleOf(node.style), theme), cursor: "pointer" }}
            onClick={() => onPress(press)}
          >
            {children}
          </div>
        );
      }
      return (
        <div className={appear} style={boxStyle(styleOf(node.style), theme)}>
          {children}
        </div>
      );
    }
    case "text":
      // A non-string value (an object would make React itself throw) is skipped.
      // No appear class here: appear is BoxStyle-only (Decision 2) — validateTree
      // strips it from non-box styles, so the raw path must render it as absent.
      return typeof node.value === "string" ? (
        <p style={textStyle(styleOf(node.style), theme)}>{node.value}</p>
      ) : null;
    case "image":
      // Fail-safe/security: never put an unsafe URL scheme (javascript:, …) in the DOM.
      return typeof node.src === "string" && isSafeImageSrc(node.src) ? (
        <img
          src={node.src}
          alt={typeof node.alt === "string" ? node.alt : ""}
          style={imageStyle(styleOf(node.style), theme)}
        />
      ) : null;
    case "field": {
      // Raw-path junk: constrain `input` to the token set (else "text") and
      // omit non-string name/placeholder, mirroring core's field coercion.
      const input =
        typeof node.input === "string" && (FIELD_INPUTS as readonly string[]).includes(node.input)
          ? node.input
          : "text";
      const name = typeof node.name === "string" ? node.name : undefined;
      const placeholder = typeof node.placeholder === "string" ? node.placeholder : undefined;
      return (
        <label
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            ...fieldStyle(styleOf(node.style), theme),
          }}
        >
          {typeof node.label === "string" ? <span>{node.label}</span> : null}
          {/* Uncontrolled on purpose (invariant #6): the DOM owns the text; the
              stamp lets a collect press find this input by node id at press time. */}
          <input type={input} name={name} placeholder={placeholder} data-facet-field-id={id} />
        </label>
      );
    }
  }
}
