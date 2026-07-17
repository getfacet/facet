import { useEffect, useRef } from "react";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import type { ClassifiedPress } from "./renderer-press.js";

const HOLD_MS = 500;
const HOLD_SLOP_PX = 8;

export function finiteCoord(value: unknown): number {
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
  readonly inert?: boolean;
  readonly disabled?: boolean;
  readonly buttonRole?: boolean;
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
export function BoxElement({
  press,
  hold,
  dispatch,
  style,
  className,
  inert = false,
  disabled = false,
  buttonRole = false,
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

  const holdable = !inert && !disabled && hold !== null;

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
    if (!disabled && press !== null) {
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

  const interactive = holdable || (!inert && !disabled && press !== null);
  const hasButtonRole = buttonRole || interactive;
  // Style composition per arm, byte-identical to the previous three-element
  // structure: plain boxes pass the base style through UNTOUCHED; interactive
  // boxes add cursor:pointer; a holdable box additionally disables text
  // selection and the iOS long-press callout so a real-device long press runs
  // the hold instead of starting a selection / the share sheet (review r6).
  const interactionStyle: CSSProperties = holdable
    ? { ...style, cursor: "pointer", userSelect: "none", WebkitTouchCallout: "none" }
    : interactive
      ? { ...style, cursor: "pointer" }
      : style;
  const finalStyle: CSSProperties =
    inert || disabled ? { ...interactionStyle, pointerEvents: "none" } : interactionStyle;

  // Conditionally ATTACHED props: undefined adds no attribute to the static
  // markup (the exact-markup pins stay byte-identical) and attaches no
  // listener — a press-only or plain box carries zero pointer/contextmenu
  // handlers, exactly like the inline divs it replaces.
  return (
    <div
      role={hasButtonRole ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-hidden={inert ? true : undefined}
      aria-disabled={disabled ? true : undefined}
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
