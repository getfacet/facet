import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import {
  FIELD_INPUTS,
  isSafeMediaSrc,
  isTreeShaped,
  MAX_DEPTH,
  MAX_FIELD_VALUE_CHARS,
  MAX_FIELDS_KEYS,
  MAX_RENDER_NODES,
  sanitizeActionPayload,
  type AgentAction,
  type CollectedEvent,
  type FacetAction,
  type FacetNode,
  type FacetTheme,
  type FacetTree,
  type FieldValue,
  type FieldValues,
  type NodeId,
} from "@facet/core";
import { boxStyle, fieldStyle, mediaStyle, resolveTheme, textStyle } from "./theme.js";
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

const MAX_FIELD_OPTIONS = 64;

function optionsOf(options: unknown): readonly string[] {
  if (!Array.isArray(options)) return [];
  const kept: string[] = [];
  for (const option of options) {
    if (kept.length >= MAX_FIELD_OPTIONS) break;
    if (typeof option === "string") {
      kept.push(option.slice(0, MAX_FIELD_VALUE_CHARS));
    }
  }
  return kept;
}

function isFieldInput(input: unknown): input is (typeof FIELD_INPUTS)[number] {
  return typeof input === "string" && (FIELD_INPUTS as readonly string[]).includes(input);
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
function collectFieldValues(tree: FacetTree, collectId: NodeId, root: ParentNode): FieldValues {
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

  // DOM-side pass: enumerate the stamped controls ONCE and match by attribute
  // comparison — no CSS.escape (jsdom exposes no window.CSS, and comparing
  // sidesteps escaping arbitrary node ids). Radio groups stamp several inputs
  // with ONE node id, so keep all matches in DOM order.
  const elementsByNodeId = new Map<string, Element[]>();
  for (const el of Array.from(root.querySelectorAll("[data-facet-field-id]"))) {
    const nodeId = el.getAttribute("data-facet-field-id");
    if (nodeId !== null) {
      const elements = elementsByNodeId.get(nodeId);
      if (elements === undefined) elementsByNodeId.set(nodeId, [el]);
      else elements.push(el);
    }
  }

  const readMountedValue = (elements: readonly Element[]): FieldValue | undefined => {
    const first = elements[0];
    if (first === undefined) {
      return undefined;
    }
    if (first instanceof HTMLSelectElement) {
      return first.value.slice(0, MAX_FIELD_VALUE_CHARS);
    }
    const inputs = elements.filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
    if (inputs.length === 0) {
      return undefined;
    }
    if (inputs.some((input) => input.type === "radio")) {
      const checked = inputs.find((input) => input.type === "radio" && input.checked);
      return checked === undefined ? undefined : checked.value.slice(0, MAX_FIELD_VALUE_CHARS);
    }
    const input = inputs[0];
    if (input === undefined) {
      return undefined;
    }
    if (input.type === "checkbox") {
      return input.checked ? true : undefined;
    }
    return String(input.value).slice(0, MAX_FIELD_VALUE_CHARS);
  };

  const fields: Record<string, FieldValue> = {};
  for (const [name, ids] of idsByName) {
    // Bound the field COUNT with the same cap the server enforces, so the
    // renderer can't emit a fields object the server rejects wholesale (400).
    if (Object.keys(fields).length >= MAX_FIELDS_KEYS) break;
    // Pick the first MOUNTED control among same-named fields (a hidden earlier
    // one must not shadow a visible later one).
    for (const id of ids) {
      const elements = elementsByNodeId.get(id);
      if (elements === undefined) continue;
      const value = readMountedValue(elements);
      if (value !== undefined) {
        fields[name] = value;
      }
      break;
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

/**
 * One-shot, WINDOW-level, CAPTURE-phase interceptor for the browser-synthesized
 * click that follows a completed hold. Lifecycle (pinned): SET when the hold
 * timer fires; then torn down by whichever comes first —
 * - CONSUMED by the next click anywhere (capture phase),
 * - RESET by the next PRIMARY pointerdown anywhere (a new gesture),
 * - EXPIRED by the PRIMARY pointer's pointercancel (its click will never come),
 * - RELEASED: one macrotask after the PRIMARY pointerup (the synthesized
 *   click, when the browser produces one, is dispatched synchronously in the
 *   same input sequence — so a click that never comes cannot leave the
 *   interceptor lingering to eat a later keyboard/programmatic activation),
 * - or any keydown (a keyboard user's activation must never be swallowed).
 *
 * Window scope + capture phase is structural, not stylistic. A component-scoped
 * latch consumed in the box's own bubble-phase click handler fails three ways:
 * - click runs target-first, so a pressable DESCENDANT box inside the held box
 *   dispatches its onPress from the synthesized click BEFORE the bubble ever
 *   reaches the holdable box ("press and hold never both fire" is pinned);
 * - a pointer released OUTSIDE the held box makes the browser target the
 *   synthesized click at the common ancestor — the held box never sees it and
 *   an ancestor onPress fires;
 * - a nested HoldableBox's pointerdown stopPropagation defeats the outer box's
 *   arm-time latch reset, leaving a stale latch that swallows a later
 *   legitimate tap. Window CAPTURE runs before any component handler can stop
 *   propagation, so the reset here cannot be defeated.
 *
 * Teardown is deliberately NOT tied to any component unmount: a hold whose
 * dispatch unmounts its own box (e.g. a toggle that hides it) must STILL
 * swallow the synthesized click that follows the release. The helper runs only
 * from the hold-timer callback (browser-only), so touching `window` is safe;
 * arming while already armed is a no-op (one interceptor, one click).
 */
let swallowArmed = false;
function swallowNextClick(): void {
  if (swallowArmed) {
    return;
  }
  swallowArmed = true;
  const teardown = (): void => {
    swallowArmed = false;
    window.removeEventListener("click", swallow, true);
    window.removeEventListener("pointerdown", reset, true);
    window.removeEventListener("pointercancel", expire, true);
    window.removeEventListener("pointerup", release, true);
    window.removeEventListener("keydown", expire, true);
  };
  // CONSUME: the next click anywhere is the synthesized post-hold click —
  // stop it at window capture (before React's root listeners) and tear down.
  const swallow = (event: Event): void => {
    event.stopPropagation();
    event.preventDefault();
    teardown();
  };
  // RESET: a new PRIMARY pointerdown means a new gesture — tear down WITHOUT
  // touching the event, so the fresh press proceeds untouched. Non-primary
  // pointers are ignored: a second finger landing while the held finger is
  // still down (multi-touch) must not disarm the swallow, or the held
  // finger's release would fire the press the interceptor exists to prevent
  // (review r3). A plain Event without `isPrimary` (keyboard/programmatic,
  // jsdom) counts as primary.
  const reset = (event: Event): void => {
    if ((event as Partial<PointerEvent>).isPrimary === false) {
      return;
    }
    teardown();
  };
  // EXPIRE: after the ARMING (primary) pointer's pointercancel the browser
  // will never synthesize the click this interceptor waits for — tear down so
  // it cannot linger and swallow an unrelated later click (keyboard /
  // assistive-tech activation, review r3). Non-primary cancels are ignored
  // with the same rationale as `reset` (review r5): a second finger's
  // palm-rejection cancel must not disarm the swallow while the held finger
  // is still down, or its release would fire the press this interceptor
  // exists to prevent. Also wired to `keydown` (no primacy concept there): a
  // keyboard activation must never be eaten.
  const expire = (event: Event): void => {
    if ((event as Partial<PointerEvent>).isPrimary === false) {
      return;
    }
    teardown();
  };
  // RELEASED: the synthesized click (when the browser produces one) arrives
  // synchronously in the same input sequence as the primary pointerup — so
  // one macrotask later the interceptor has either been consumed or will
  // never be. The deferred teardown is idempotent with all other paths.
  const release = (event: Event): void => {
    if ((event as Partial<PointerEvent>).isPrimary === false) {
      return;
    }
    setTimeout(teardown, 0);
  };
  window.addEventListener("click", swallow, true);
  window.addEventListener("pointerdown", reset, true);
  window.addEventListener("pointercancel", expire, true);
  window.addEventListener("pointerup", release, true);
  window.addEventListener("keydown", expire, true);
}

interface BoxElementProps {
  /** Classified onPress — null means a quick tap dispatches nothing. */
  readonly press: ClassifiedPress | null;
  /** Classified onHold — null means no long-press gesture is detected. */
  readonly hold: ClassifiedPress | null;
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
 * The ONE element type EVERY box renders through (review r6). Three arms, all
 * the same always-mounted component so a live patch that adds or removes
 * onPress/onHold never flips the React element type at that position — a flip
 * would remount the entire subtree and wipe visitor-typed uncontrolled field
 * text and scroll offsets:
 * - `hold` non-null: a long-pressable box (Decision 3). `pointerdown` arms a
 *   HOLD_MS timer; `pointermove` beyond HOLD_SLOP_PX, `pointerup` before
 *   threshold, `pointercancel` (incl. the browser claiming a touch gesture for
 *   scrolling — free disambiguation, so no touch-action CSS is set here), or
 *   `pointerleave` disarms it. The timer firing executes the hold and arms the
 *   window-level `swallowNextClick` interceptor against the browser-synthesized
 *   click that follows pointerup, so press and hold never both fire.
 * - `hold` null, `press` non-null: today's exact pressable div — role/tabIndex
 *   and a click dispatch, NO pointer/contextmenu listeners attached.
 * - both null: today's exact plain div — no role, no tabIndex, no handlers.
 * The static markup of all three arms is byte-identical to the previous
 * three-element structure (undefined props add no attributes; handlers never
 * serialize), pinned by the exact-markup tests.
 */
function BoxElement({
  press,
  hold,
  dispatch,
  style,
  className,
  children,
}: BoxElementProps): ReactNode {
  // Latest-classification refs, updated each render: the timer callback must
  // act on the CURRENT content, not the content captured at pointerdown. A
  // patch that CHANGES onHold mid-press lands here before the timer fires; a
  // patch that REMOVES onHold keeps this component mounted (stable element
  // type) with a null `hold` — the effect below clears the pending timer and
  // the timer callback's own null check backstops it — either way the stale
  // hold no-ops.
  const holdRef = useRef(hold);
  holdRef.current = hold;
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  // Pending hold timer + gesture origin (the slop reference); null = disarmed.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originRef = useRef<{ readonly x: number; readonly y: number } | null>(null);
  // The ARMING pointer's id: move/up/leave from any OTHER pointer (a second
  // finger, a resting palm) must be inert — without this, the second finger's
  // move measures against the FIRST finger's origin and disarms, and the
  // primary release's synthesized click then dispatches onPress: the WRONG
  // action from a gesture the visitor meant as a hold (review r4).
  const gesturePointerRef = useRef<number | null>(null);
  // True from the hold firing until the pointer ends — with the armed timer it
  // scopes contextmenu suppression to the live gesture only.
  const holdingRef = useRef(false);

  const holdable = hold !== null;

  // Unmount cleanup: a patch that removes the whole node mid-press unmounts
  // this component; the pending timer must die with it.
  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    },
    [],
  );

  // Mid-press onHold REMOVAL disarm: the component stays mounted when a patch
  // strips onHold (that is the point of the stable element type), so the
  // pending timer dies on the prop flip instead of on unmount. Also drops the
  // gesture bookkeeping so contextmenu suppression can't outlive the hold.
  useEffect(() => {
    if (!holdable && timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      originRef.current = null;
      gesturePointerRef.current = null;
      holdingRef.current = false;
    }
  }, [holdable]);

  const disarm = (): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    originRef.current = null;
    gesturePointerRef.current = null;
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
    // Hybrid re-entry guard (review r6): a hybrid mouse+touch device can have
    // TWO concurrent pointers that are each "primary" for their own pointer
    // type. A second primary pointer landing mid-gesture must not overwrite
    // the live gesture (re-basing the origin and restarting the timer) — the
    // first pointer keeps ownership until it ends.
    if (gesturePointerRef.current !== null && gesturePointerRef.current !== event.pointerId) {
      return;
    }
    // pointerdown bubbles: a holdable box nested in another holdable box would
    // arm BOTH timers and one long press would dispatch two hold actions. Only
    // the innermost HoldableBox arms — primary presses stop here (non-primary
    // presses returned above WITHOUT stopping, leaving ancestors unaffected).
    event.stopPropagation();
    holdingRef.current = false;
    gesturePointerRef.current = event.pointerId;
    originRef.current = { x: finiteCoord(event.clientX), y: finiteCoord(event.clientY) };
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      originRef.current = null;
      // Belt-and-braces for the mid-press onHold removal (the disarm effect
      // above already clears the timer on the prop flip): a stale hold whose
      // classification is now null must neither dispatch nor arm the swallow.
      const currentHold = holdRef.current;
      if (currentHold === null) {
        gesturePointerRef.current = null;
        return;
      }
      holdingRef.current = true;
      // Swallow the browser-synthesized click that follows the coming pointerup
      // — at WINDOW capture, wherever the browser targets it (see the helper).
      swallowNextClick();
      // One press pipeline: the hold rides the same handlePress switch a press
      // does, reading the LATEST classification (see holdRef above).
      dispatchRef.current(currentHold);
    }, HOLD_MS);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    // Gesture-scoped: only the arming pointer's movement measures slop.
    if (gesturePointerRef.current === null || event.pointerId !== gesturePointerRef.current) {
      return;
    }
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

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>): void => {
    // Gesture-scoped: a second finger's up/cancel/leave must not end the
    // primary hold (review r4).
    if (gesturePointerRef.current === null || event.pointerId !== gesturePointerRef.current) {
      return;
    }
    // pointerup before the threshold, pointercancel, or pointerleave: the hold
    // disarms; a below-threshold release lets the native click run onPress as
    // today.
    disarm();
    holdingRef.current = false;
  };

  const handleClick = (): void => {
    // A synthesized post-hold click never reaches here: swallowNextClick stops
    // it at window capture, before React's root listeners.
    if (press !== null) {
      dispatch(press);
    }
    // Hold-only box (press === null): a quick tap deliberately no-ops.
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>): void => {
    // Suppressed ONLY while a hold gesture is live (armed, or fired and not yet
    // released) — so a touch long-press context menu can't race the hold.
    // Boxes without onHold never attach this listener and keep the native menu.
    if (timerRef.current !== null || holdingRef.current) {
      event.preventDefault();
    }
  };

  const interactive = holdable || press !== null;
  // Style composition per arm, byte-identical to the previous three-element
  // structure: plain boxes pass the base style through UNTOUCHED; interactive
  // boxes add cursor:pointer; a holdable box additionally disables text
  // selection and the iOS long-press callout so a real-device long press runs
  // the hold instead of starting a selection / the share sheet (review r6).
  const finalStyle: CSSProperties = holdable
    ? { ...style, cursor: "pointer", userSelect: "none", WebkitTouchCallout: "none" }
    : interactive
      ? { ...style, cursor: "pointer" }
      : style;

  // Conditionally ATTACHED props: undefined adds no attribute to the static
  // markup (the exact-markup pins stay byte-identical) and attaches no
  // listener — a press-only or plain box carries zero pointer/contextmenu
  // handlers, exactly like the inline divs it replaces.
  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      className={className}
      style={finalStyle}
      onClick={interactive ? handleClick : undefined}
      onPointerDown={holdable ? handlePointerDown : undefined}
      onPointerMove={holdable ? handlePointerMove : undefined}
      onPointerUp={holdable ? handlePointerEnd : undefined}
      onPointerCancel={holdable ? handlePointerEnd : undefined}
      onPointerLeave={holdable ? handlePointerEnd : undefined}
      onContextMenu={holdable ? handleContextMenu : undefined}
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
export function StageRenderer({ tree, onAction, onRecord, themes }: StageRendererProps): ReactNode {
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
    appearSeen,
    depth: 0,
  });
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
      {stage}
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

interface RenderArgs {
  readonly tree: FacetTree;
  readonly id: NodeId;
  /**
   * StageRenderer's `handlePress` — receives the classified press AND the
   * pressed box's node id (`sourceId`), so a locally-resolved navigate/toggle
   * can be recorded with its source `target`. Bound to this node's id at the
   * `BoxElement` call site below.
   */
  readonly onPress: (press: ClassifiedPress, sourceId: NodeId) => void;
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
  /**
   * Set to `true` the moment a REACHABLE box renders with an appear class, so
   * the caller can gate the one-per-stage `<style>` on the same budget-bounded
   * walk that renders the tree — never a separate unbounded scan of the whole
   * `tree.nodes` map (which the raw live path can grow to arbitrary size with
   * unreachable/dangling entries). Reachable-only is also MORE correct: an
   * appear token on an unrendered node no longer forces a useless stylesheet.
   */
  readonly appearSeen: { used: boolean };
  readonly depth: number;
}

function renderMediaNode(raw: unknown, theme: ResolvedTheme): ReactNode {
  const rawMedia = raw as {
    readonly type?: unknown;
    readonly kind?: unknown;
    readonly src?: unknown;
    readonly alt?: unknown;
    readonly poster?: unknown;
    readonly controls?: unknown;
    readonly style?: object;
  };
  // Fail-safe/security: never put an unsafe URL scheme (javascript:, …) in the DOM.
  if (typeof rawMedia.src !== "string" || !isSafeMediaSrc(rawMedia.src)) {
    return null;
  }
  const kind =
    rawMedia.type === "image" ? "image" : rawMedia.kind === undefined ? "image" : rawMedia.kind;
  if (kind !== "image" && kind !== "video") {
    return null;
  }
  const style = mediaStyle(styleOf(rawMedia.style), theme);
  if (kind === "video") {
    const poster =
      typeof rawMedia.poster === "string" && isSafeMediaSrc(rawMedia.poster)
        ? rawMedia.poster
        : undefined;
    return (
      <video
        src={rawMedia.src}
        poster={poster}
        controls={rawMedia.controls === true ? true : undefined}
        style={style}
      />
    );
  }
  return (
    <img
      src={rawMedia.src}
      alt={typeof rawMedia.alt === "string" ? rawMedia.alt : ""}
      style={style}
    />
  );
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
  appearSeen,
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
  if ((node as { readonly type?: unknown }).type === "image") {
    return renderMediaNode(node, theme);
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
            appearSeen,
            depth: depth + 1,
          })}
        </Fragment>
      ));
      // onPress is untrusted on the raw path — an unclassifiable action renders
      // a plain non-pressable box instead of a dead or dangerous button.
      const press = classifyPress(node.onPress);
      // onHold is untrusted the same way, classified by the SAME classifier
      // (one classifier, one switch — RISK-INV-1): junk (`onHold: 42`)
      // classifies null and the box renders today's exact press-only or plain
      // markup (byte-identical DOM). Only a classifiable onHold attaches the
      // gesture-detecting pointer handlers.
      const hold = classifyPress(node.onHold);
      // appearClass is TOTAL on raw-path junk: only "fade"/"slide" yield a
      // class; undefined adds no attribute, keeping token-free output
      // byte-identical.
      const appear = appearClass(styleOf(node.style));
      // Record appear use during the budget-bounded walk (review r7): the
      // one-per-stage <style> is gated on this flag, never a separate O(N) scan
      // of the whole node map.
      if (appear !== undefined) {
        appearSeen.used = true;
      }
      // ONE element type for every box (review r6): a live patch that adds or
      // removes onPress/onHold changes only BoxElement's props, never the
      // element type at this position — so React updates in place instead of
      // remounting the subtree (which would wipe visitor-typed field text and
      // scroll offsets).
      // Bind the pressed box's id so press AND hold (both route through the ONE
      // dispatch) record a local navigate/toggle with this box as `target`.
      const dispatch = (classified: ClassifiedPress): void => onPress(classified, id);
      return (
        <BoxElement
          press={press}
          hold={hold}
          dispatch={dispatch}
          className={appear}
          style={boxStyle(styleOf(node.style), theme)}
        >
          {children}
        </BoxElement>
      );
    }
    case "text":
      // A non-string value (an object would make React itself throw) is skipped.
      // No appear class here: appear is BoxStyle-only (Decision 2) — validateTree
      // strips it from non-box styles, so the raw path must render it as absent.
      return typeof node.value === "string" ? (
        <p style={textStyle(styleOf(node.style), theme)}>{node.value}</p>
      ) : null;
    case "media":
      return renderMediaNode(node, theme);
    case "field": {
      // Raw-path junk: constrain `input` to the token set (else "text") and
      // omit non-string name/placeholder, mirroring core's field coercion.
      const input = isFieldInput(node.input) ? node.input : "text";
      const name = typeof node.name === "string" ? node.name : undefined;
      const placeholder = typeof node.placeholder === "string" ? node.placeholder : undefined;
      const options = optionsOf((node as { readonly options?: unknown }).options);
      const wrapperStyle: CSSProperties = {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        ...fieldStyle(styleOf(node.style), theme),
      };
      const label = typeof node.label === "string" ? <span>{node.label}</span> : null;
      // Uncontrolled on purpose (invariant #6): the DOM owns values; the stamp
      // lets a collect press find these controls by node id at press time.
      if (input === "select") {
        return (
          <label style={wrapperStyle}>
            {label}
            <select name={name} data-facet-field-id={id}>
              {options.map((option, index) => (
                <option key={`${String(index)}:${option}`} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        );
      }
      if (input === "radio") {
        return (
          <div style={wrapperStyle}>
            {label}
            {options.map((option, index) => (
              <label key={`${String(index)}:${option}`}>
                <input type="radio" name={name} value={option} data-facet-field-id={id} />
                {option}
              </label>
            ))}
          </div>
        );
      }
      if (input === "checkbox") {
        return (
          <label style={wrapperStyle}>
            {label}
            <input type="checkbox" name={name} data-facet-field-id={id} />
          </label>
        );
      }
      if (input === "switch") {
        return (
          <label style={wrapperStyle}>
            {label}
            <input type="checkbox" role="switch" name={name} data-facet-field-id={id} />
          </label>
        );
      }
      return (
        <label style={wrapperStyle}>
          {label}
          <input type={input} name={name} placeholder={placeholder} data-facet-field-id={id} />
        </label>
      );
    }
  }
}
