// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FacetAction, FacetTree } from "@facet/core";
import { StageRenderer } from "./StageRenderer.js";
import {
  interactionPointerEvent as pointerEvent,
  interactionScreensTree as screensTree,
  interactionTree as tree,
} from "./StageRenderer.test-support.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Hold gesture (Decision 3): pointerdown arms a HOLD_MS timer; slop / early
// release / cancel disarm it; the timer fires the onHold action through the ONE
// existing handlePress switch and swallows the browser-synthesized click via a
// one-shot WINDOW-level CAPTURE-phase interceptor (consumed by the next click
// anywhere OR reset by the next pointerdown anywhere — window scope so neither
// a descendant press target, a release-outside retarget, nor a nested box's
// stopPropagation can dodge it). jsdom implements no PointerEvent gestures, so
// pointer events are dispatched as plain bubbling Events with clientX/clientY
// assigned (React reads the coordinates off the native event); jsdom DOES
// propagate dispatched events through the window capture phase, which is what
// makes the interceptor testable here. Fake timers drive the hold threshold.
// ---------------------------------------------------------------------------

/** Mirrors the renderer's non-exported HOLD_MS constant. */
const HOLD_MS = 500;

const pointerDown = (el: Element, coords?: { x?: number; y?: number }): void => {
  fireEvent(el, pointerEvent("pointerdown", coords));
};
const pointerMove = (el: Element, coords?: { x?: number; y?: number }): void => {
  fireEvent(el, pointerEvent("pointermove", coords));
};
const pointerUp = (el: Element, coords?: { x?: number; y?: number }): void => {
  fireEvent(el, pointerEvent("pointerup", coords));
};

/** A completed hold: down → within-slop jitter → HOLD_MS elapses → up → the browser-synthesized click. */
function holdGesture(el: Element): void {
  pointerDown(el);
  // Within-slop jitter: dx=5, dy=3 (≈5.8px < HOLD_SLOP_PX = 8) — a small
  // finger tremor must NOT disarm the hold; every holdGesture exercises it.
  pointerMove(el, { x: 5, y: 3 });
  act(() => {
    vi.advanceTimersByTime(HOLD_MS + 100);
  });
  pointerUp(el);
  fireEvent.click(el);
}

/** A quick tap: down → a sub-threshold dwell → up → the native click. */
function tapGesture(el: Element, dwellMs = 100): void {
  pointerDown(el);
  act(() => {
    vi.advanceTimersByTime(dwellMs);
  });
  pointerUp(el);
  fireEvent.click(el);
}

/** A box carrying BOTH gestures: quick tap ⇒ "pressed", long press ⇒ "held". */
const pressHoldTree = (): FacetTree =>
  tree({
    root: { id: "root", type: "box", children: ["btn"] },
    btn: {
      id: "btn",
      type: "box",
      onPress: { kind: "agent", name: "pressed" },
      onHold: { kind: "agent", name: "held" },
      children: ["bt"],
    },
    bt: { id: "bt", type: "text", value: "target" },
  });

describe("StageRenderer hold gesture (jsdom, fake timers)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Between-test isolation for the deliberately GLOBAL one-shot click
    // interceptor: a prior test's completed hold may have left it armed. A
    // plain window pointerdown is exactly the RESET the pinned lifecycle
    // defines, so no test-only backdoor into the renderer is needed.
    fireEvent(window, pointerEvent("pointerdown"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("long press fires onHold only and quick tap fires onPress only", () => {
    const onAction = vi.fn();
    render(<StageRenderer onAction={onAction} tree={pressHoldTree()} />);
    const btn = screen.getByRole("button");

    holdGesture(btn); // the post-hold synthesized click must be swallowed
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "held" });

    tapGesture(btn);
    expect(onAction).toHaveBeenCalledTimes(2);
    expect(onAction.mock.calls[1]).toEqual([{ kind: "agent", name: "pressed" }]);
  });

  it("hold with a toggle kind hides the panel browser-locally with zero transport calls", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["btn", "panel"] },
          btn: {
            id: "btn",
            type: "box",
            onHold: { kind: "toggle", target: "panel" },
            children: ["bt"],
          },
          bt: { id: "bt", type: "text", value: "hold me" },
          panel: { id: "panel", type: "box", children: ["p"] },
          p: { id: "p", type: "text", value: "panel content" },
        })}
      />,
    );

    expect(screen.getByText("panel content")).toBeTruthy();
    holdGesture(screen.getByRole("button"));
    expect(screen.queryByText("panel content")).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("hold with a navigate kind switches the screen browser-locally with zero transport calls", () => {
    const onAction = vi.fn();
    const base = screensTree();
    const withHoldNav: FacetTree = {
      ...base,
      nodes: {
        ...base.nodes,
        goAbout: {
          id: "goAbout",
          type: "box",
          onHold: { kind: "navigate", to: "about" },
          children: [],
        },
      },
    };
    render(<StageRenderer onAction={onAction} tree={withHoldNav} />);

    expect(screen.getByText("home content")).toBeTruthy();
    holdGesture(screen.getByRole("button"));
    expect(screen.getByText("about content")).toBeTruthy();
    expect(screen.queryByText("home content")).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("a hold-emitted agent event is byte-identical in shape to a press-emitted one (payload/collect intact)", () => {
    const onAction = vi.fn();
    // The SAME action on both gestures (RISK-INV-5): the two emissions must be
    // deep-equal — same name, same payload, same collected fields, and no
    // gesture discriminator field anywhere.
    const action: FacetAction = {
      kind: "agent",
      name: "same",
      payload: { id: "7" },
      collect: "form",
    };
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["form", "btn"] },
          form: { id: "form", type: "box", children: ["emailF"] },
          emailF: { id: "emailF", type: "input", name: "email", placeholder: "your email" },
          btn: { id: "btn", type: "box", onPress: action, onHold: action, children: ["bt"] },
          bt: { id: "bt", type: "text", value: "dual" },
        })}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("your email"), {
      target: { value: "a@b.dev" },
    });
    const btn = screen.getByRole("button");

    tapGesture(btn); // the press-emitted reference event
    holdGesture(btn); // exactly ONE hold-emitted event

    expect(onAction).toHaveBeenCalledTimes(2);
    expect(onAction.mock.calls[0]).toEqual([
      { kind: "agent", name: "same", payload: { id: "7" } },
      { email: "a@b.dev" },
    ]);
    expect(onAction.mock.calls[1]).toEqual(onAction.mock.calls[0]);
  });

  it("a 300ms below-threshold release runs onPress as a plain press", () => {
    const onAction = vi.fn();
    render(<StageRenderer onAction={onAction} tree={pressHoldTree()} />);

    tapGesture(screen.getByRole("button"), 300);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "pressed" });
  });

  it("pointer movement beyond the slop cancels the hold", () => {
    const onAction = vi.fn();
    render(<StageRenderer onAction={onAction} tree={pressHoldTree()} />);
    const btn = screen.getByRole("button");

    pointerDown(btn, { x: 10, y: 10 });
    pointerMove(btn, { x: 30, y: 10 }); // 20px > HOLD_SLOP_PX (8)
    act(() => {
      vi.advanceTimersByTime(HOLD_MS + 200);
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("removing onHold mid-press no-ops the pending hold", () => {
    const onAction = vi.fn();
    const withoutHold = tree({
      root: { id: "root", type: "box", children: ["btn"] },
      btn: { id: "btn", type: "box", children: ["bt"] },
      bt: { id: "bt", type: "text", value: "target" },
    });
    const withHold = tree({
      root: { id: "root", type: "box", children: ["btn"] },
      btn: { id: "btn", type: "box", onHold: { kind: "agent", name: "held" }, children: ["bt"] },
      bt: { id: "bt", type: "text", value: "target" },
    });
    const { rerender } = render(<StageRenderer onAction={onAction} tree={withHold} />);

    pointerDown(screen.getByRole("button"));
    // A live patch removes onHold BEFORE the timer fires: the re-render leaves a
    // null classification, so the pending hold must do nothing.
    rerender(<StageRenderer onAction={onAction} tree={withoutHold} />);
    act(() => {
      vi.advanceTimersByTime(HOLD_MS + 200);
    });
    fireEvent.click(screen.getByText("target"));
    expect(onAction).not.toHaveBeenCalled();
  });

  it("a quick tap on a hold-only box no-ops (the box stays pressable-styled)", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["btn"] },
          btn: {
            id: "btn",
            type: "box",
            onHold: { kind: "agent", name: "held" },
            children: ["bt"],
          },
          bt: { id: "bt", type: "text", value: "hold only" },
        })}
      />,
    );

    // Focusable/pressable-styled (Decision 3), but a quick tap emits nothing.
    tapGesture(screen.getByRole("button"));
    expect(onAction).not.toHaveBeenCalled();
  });

  it("a hold released outside the box does not swallow the next quick tap", () => {
    const onAction = vi.fn();
    const { container } = render(<StageRenderer onAction={onAction} tree={pressHoldTree()} />);
    const btn = screen.getByRole("button");

    pointerDown(btn);
    act(() => {
      vi.advanceTimersByTime(HOLD_MS + 100); // the hold fires; the interceptor arms
    });
    // Pointer released OUTSIDE the box ⇒ the browser targets the synthesized
    // click at the common ancestor. The WINDOW-level interceptor still sees it
    // (capture phase) and CONSUMES it there — the box itself never gets a click.
    pointerUp(container);
    fireEvent.click(container);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "held" });

    // The next quick tap must fire normally — the interceptor was consumed by
    // the ancestor click above (and the tap's own pointerdown would RESET any
    // still-armed interceptor at window capture regardless).
    tapGesture(btn);
    expect(onAction).toHaveBeenCalledTimes(2);
    expect(onAction.mock.calls[1]).toEqual([{ kind: "agent", name: "pressed" }]);
  });

  it("hold-then-hold fires exactly two onHold actions", () => {
    const onAction = vi.fn();
    render(<StageRenderer onAction={onAction} tree={pressHoldTree()} />);
    const btn = screen.getByRole("button");

    holdGesture(btn);
    holdGesture(btn);

    expect(onAction).toHaveBeenCalledTimes(2);
    expect(onAction.mock.calls[0]).toEqual([{ kind: "agent", name: "held" }]);
    expect(onAction.mock.calls[1]).toEqual([{ kind: "agent", name: "held" }]);
  });

  it("a right-button press never arms the hold and keeps the native context menu", () => {
    const onAction = vi.fn();
    render(<StageRenderer onAction={onAction} tree={pressHoldTree()} />);
    const btn = screen.getByRole("button");

    // Right-button (button: 2) pointerdown must not arm the timer…
    fireEvent(btn, pointerEvent("pointerdown", {}, { button: 2 }));
    // …so the contextmenu that follows a right-click is NOT suppressed
    // (fireEvent returns false iff preventDefault was called).
    expect(fireEvent.contextMenu(btn)).toBe(true);
    act(() => {
      vi.advanceTimersByTime(HOLD_MS + 200);
    });
    expect(onAction).not.toHaveBeenCalled();

    // A non-primary pointer (a second touch) never arms either.
    fireEvent(btn, pointerEvent("pointerdown", {}, { isPrimary: false }));
    act(() => {
      vi.advanceTimersByTime(HOLD_MS + 200);
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("a right-button hold on a collect action never snapshots or emits fields", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["form", "btn"] },
          form: { id: "form", type: "box", children: ["emailF"] },
          emailF: { id: "emailF", type: "input", name: "email", placeholder: "your email" },
          btn: {
            id: "btn",
            type: "box",
            onHold: { kind: "agent", name: "submit", collect: "form" },
            children: ["bt"],
          },
          bt: { id: "bt", type: "text", value: "hold to send" },
        })}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("your email"), {
      target: { value: "a@b.dev" },
    });
    const btn = screen.getByRole("button");

    fireEvent(btn, pointerEvent("pointerdown", {}, { button: 2 }));
    act(() => {
      vi.advanceTimersByTime(HOLD_MS + 200);
    });
    fireEvent(btn, pointerEvent("pointerup", {}, { button: 2 }));

    // No field snapshot ever leaves the page on a non-primary-button hold.
    expect(onAction).not.toHaveBeenCalled();
  });

  it("a long press on a nested holdable box fires only the INNER hold action", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["outer"] },
          outer: {
            id: "outer",
            type: "box",
            onHold: { kind: "agent", name: "held-outer" },
            children: ["inner"],
          },
          inner: {
            id: "inner",
            type: "box",
            onHold: { kind: "agent", name: "held-inner" },
            children: ["it"],
          },
          it: { id: "it", type: "text", value: "inner target" },
        })}
      />,
    );

    // pointerdown bubbles — without stopPropagation BOTH timers would arm and
    // one long press would dispatch two hold actions.
    holdGesture(screen.getByText("inner target").parentElement as HTMLElement);

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "held-inner" });
  });

  it("a completed hold on a nested box never fires the ancestor's onPress (tap bubbling unchanged)", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["ancestor"] },
          ancestor: {
            id: "ancestor",
            type: "box",
            onPress: { kind: "agent", name: "ancestor-pressed" },
            children: ["holdChild", "plainChild"],
          },
          holdChild: {
            id: "holdChild",
            type: "box",
            onHold: { kind: "agent", name: "child-held" },
            children: ["ht"],
          },
          ht: { id: "ht", type: "text", value: "hold me" },
          plainChild: { id: "plainChild", type: "text", value: "plain tap target" },
        })}
      />,
    );

    // A completed hold — including the browser-synthesized bubbling click —
    // fires ONLY the hold; the ancestor's onPress must not also fire ("press
    // and hold never both fire" is pinned).
    holdGesture(screen.getByText("hold me").parentElement as HTMLElement);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "child-held" });

    // Control: a plain quick tap on a NON-holdable child still bubbles to and
    // activates the ancestor exactly as today.
    fireEvent.click(screen.getByText("plain tap target"));
    expect(onAction).toHaveBeenCalledTimes(2);
    expect(onAction.mock.calls[1]).toEqual([{ kind: "agent", name: "ancestor-pressed" }]);
  });

  it("suppresses the context menu only while a hold gesture is live", () => {
    const onAction = vi.fn();
    render(<StageRenderer onAction={onAction} tree={pressHoldTree()} />);
    const btn = screen.getByRole("button");

    // (c) No gesture in flight ⇒ the native menu is preserved.
    expect(fireEvent.contextMenu(btn)).toBe(true);

    // (a) Timer armed (primary press, pre-threshold) ⇒ suppressed.
    pointerDown(btn);
    expect(fireEvent.contextMenu(btn)).toBe(false);

    // (b) Hold fired but the pointer not yet released ⇒ still suppressed.
    act(() => {
      vi.advanceTimersByTime(HOLD_MS + 100);
    });
    expect(fireEvent.contextMenu(btn)).toBe(false);

    // After release the gesture is over ⇒ the native menu is back.
    pointerUp(btn);
    fireEvent.click(btn); // the synthesized click consumes the window interceptor
    expect(fireEvent.contextMenu(btn)).toBe(true);
    expect(onAction).toHaveBeenCalledTimes(1); // the one hold from phase (b)
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "held" });
  });

  it("pointercancel and pointerleave disarm the hold, and the box is not wedged after", () => {
    const onAction = vi.fn();
    render(<StageRenderer onAction={onAction} tree={pressHoldTree()} />);
    const btn = screen.getByRole("button");

    // (a) pointercancel (e.g. the browser claims the touch for scrolling).
    pointerDown(btn);
    fireEvent(btn, pointerEvent("pointercancel"));
    act(() => {
      vi.advanceTimersByTime(HOLD_MS + 200);
    });
    expect(onAction).not.toHaveBeenCalled();

    // (b) pointerleave (pointer slides off the box). React synthesizes
    // onPointerLeave from a native pointerout whose relatedTarget is outside
    // the element, so that is what a real leave delivers to the root listener.
    pointerDown(btn);
    const out = pointerEvent("pointerout");
    Object.assign(out, { relatedTarget: document.body });
    fireEvent(btn, out);
    act(() => {
      vi.advanceTimersByTime(HOLD_MS + 200);
    });
    expect(onAction).not.toHaveBeenCalled();

    // (c) After the disarms a fresh hold still fires exactly once.
    holdGesture(btn);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "held" });
  });

  it("a mid-press onHold change dispatches the LATEST classification exactly once", () => {
    const onAction = vi.fn();
    const holdTree = (name: string): FacetTree =>
      tree({
        root: { id: "root", type: "box", children: ["btn"] },
        btn: { id: "btn", type: "box", onHold: { kind: "agent", name }, children: ["bt"] },
        bt: { id: "bt", type: "text", value: "target" },
      });
    const { rerender } = render(<StageRenderer onAction={onAction} tree={holdTree("held-v1")} />);
    const btn = screen.getByRole("button");

    pointerDown(btn);
    // A live patch changes onHold WHILE the timer is pending: the fire must
    // read the current classification, not the one captured at pointerdown.
    rerender(<StageRenderer onAction={onAction} tree={holdTree("held-v2")} />);
    act(() => {
      vi.advanceTimersByTime(HOLD_MS + 100);
    });
    pointerUp(btn);
    fireEvent.click(btn);

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "held-v2" });
  });

  it("a completed hold never fires a pressable DESCENDANT's onPress from the synthesized click", () => {
    // click runs TARGET-FIRST: the synthesized post-hold click at the child
    // would dispatch the child's onClick before any bubble handler on the
    // holdable box — only the WINDOW-capture interceptor runs earlier still.
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["holdBox"] },
          holdBox: {
            id: "holdBox",
            type: "box",
            onHold: { kind: "agent", name: "held" },
            children: ["pressChild"],
          },
          pressChild: {
            id: "pressChild",
            type: "box",
            onPress: { kind: "agent", name: "child-pressed" },
            children: ["ct"],
          },
          ct: { id: "ct", type: "text", value: "child target" },
        })}
      />,
    );

    // The whole gesture happens ON THE CHILD: pointerdown bubbles up and arms
    // the parent's hold; the synthesized click is targeted at the child.
    const child = screen.getByText("child target").parentElement as HTMLElement;
    holdGesture(child);

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "held" });
  });

  it("a hold released outside never fires a pressable ANCESTOR targeted by the synthesized click", () => {
    // Releasing the pointer outside the held box makes the browser target the
    // synthesized click at the common ancestor — a component-scoped latch on
    // the held box would never see that click; the window interceptor does.
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["ancestor"] },
          ancestor: {
            id: "ancestor",
            type: "box",
            onPress: { kind: "agent", name: "ancestor-pressed" },
            children: ["holdChild"],
          },
          holdChild: {
            id: "holdChild",
            type: "box",
            onHold: { kind: "agent", name: "child-held" },
            children: ["ht"],
          },
          ht: { id: "ht", type: "text", value: "hold me" },
        })}
      />,
    );

    const holdChild = screen.getByText("hold me").parentElement as HTMLElement;
    const ancestor = holdChild.parentElement as HTMLElement;

    pointerDown(holdChild);
    act(() => {
      vi.advanceTimersByTime(HOLD_MS + 100); // the hold fires; the interceptor arms
    });
    // Release-outside simulation: pointerup + the synthesized click land on
    // the pressable ANCESTOR, not on the held child.
    pointerUp(ancestor);
    fireEvent.click(ancestor);

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "child-held" });
  });

  it("a nested box's pointerdown stopPropagation cannot leave a stale interceptor that swallows a later tap", () => {
    // Gesture 1 leaves the interceptor ARMED (release-outside, no click ever
    // dispatched). Gesture 2 taps the INNER holdable box, whose pointerdown
    // stopPropagation defeated the old component-scoped arm-time reset — the
    // WINDOW-capture reset runs before any component handler can stop
    // propagation, so the tap's click must reach the outer box's onPress.
    const onAction = vi.fn();
    const { container } = render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["outer"] },
          outer: {
            id: "outer",
            type: "box",
            onPress: { kind: "agent", name: "outer-pressed" },
            onHold: { kind: "agent", name: "outer-held" },
            children: ["inner"],
          },
          inner: {
            id: "inner",
            type: "box",
            onHold: { kind: "agent", name: "inner-held" },
            children: ["it"],
          },
          it: { id: "it", type: "text", value: "inner target" },
        })}
      />,
    );

    const inner = screen.getByText("inner target").parentElement as HTMLElement;
    const outer = inner.parentElement as HTMLElement;

    // Gesture 1: hold the OUTER box, release outside, and no synthesized click
    // arrives at all — the interceptor stays armed past the gesture.
    pointerDown(outer);
    act(() => {
      vi.advanceTimersByTime(HOLD_MS + 100);
    });
    pointerUp(container);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "outer-held" });

    // Gesture 2: quick tap the INNER box. Its pointerdown (which
    // stopPropagation-s at the React level) must still RESET the interceptor
    // at window capture, so this legitimate click is NOT swallowed; the inner
    // box is hold-only, so the click bubbles to the outer box's onPress.
    tapGesture(inner);
    expect(onAction).toHaveBeenCalledTimes(2);
    expect(onAction.mock.calls[1]).toEqual([{ kind: "agent", name: "outer-pressed" }]);
  });

  it("a holdable box carries its appear class on the mounted holdable element", () => {
    // FIX-B: the HoldableBox branch must thread className exactly like the
    // press-only and plain branches do.
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["btn"] },
          btn: {
            id: "btn",
            type: "box",
            style: { enterAnimation: "fade" },
            onHold: { kind: "agent", name: "held" },
            children: ["bt"],
          },
          bt: { id: "bt", type: "text", value: "animated hold" },
        })}
      />,
    );

    const btn = screen.getByRole("button");
    expect(btn.classList).toContain("facet-appear-fade");
  });

  it("a second finger's pointerdown does not defeat the post-hold click swallow (multi-touch)", () => {
    const onAction = vi.fn();
    render(<StageRenderer onAction={onAction} tree={pressHoldTree()} />);
    const btn = screen.getByRole("button");

    pointerDown(btn);
    act(() => {
      vi.advanceTimersByTime(HOLD_MS + 100);
    }); // hold fires, interceptor armed
    // A second (non-primary) finger lands elsewhere while the held finger is
    // still down — the RESET listener must ignore it.
    fireEvent(window, pointerEvent("pointerdown", {}, { isPrimary: false }));
    pointerUp(btn);
    fireEvent.click(btn); // the held finger's synthesized click — still swallowed

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "held" });
  });

  it("pointercancel expires the interceptor so a later unrelated click is not swallowed", () => {
    const onAction = vi.fn();
    render(<StageRenderer onAction={onAction} tree={pressHoldTree()} />);
    const btn = screen.getByRole("button");

    pointerDown(btn);
    act(() => {
      vi.advanceTimersByTime(HOLD_MS + 100);
    }); // hold fires, interceptor armed
    fireEvent(btn, pointerEvent("pointercancel")); // no click will ever follow this gesture
    fireEvent.click(btn); // a LATER keyboard/programmatic activation must not be eaten

    expect(onAction).toHaveBeenCalledTimes(2);
    expect(onAction.mock.calls[1]).toEqual([{ kind: "agent", name: "pressed" }]);
  });

  it("a pointerdown without coordinates degrades to origin 0,0 (finiteCoord — never NaN-arms)", () => {
    const onAction = vi.fn();
    render(<StageRenderer onAction={onAction} tree={pressHoldTree()} />);
    const btn = screen.getByRole("button");

    // A synthetic/assistive-tech pointerdown can lack clientX/clientY entirely.
    // Without finiteCoord the origin would be NaN and the slop check
    // (NaN > slop² === false) could never disarm — the drag below would still
    // fire the hold and swallow the click.
    const bare = new Event("pointerdown", { bubbles: true, cancelable: true });
    Object.assign(bare, { pointerId: 1, button: 0, isPrimary: true });
    fireEvent(btn, bare);
    pointerMove(btn, { x: 100, y: 0 }); // far from the degraded 0,0 origin ⇒ disarms
    act(() => {
      vi.advanceTimersByTime(HOLD_MS + 100);
    });
    pointerUp(btn);
    fireEvent.click(btn); // plain tap path — nothing suppressed

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "pressed" });
  });

  it("a re-press while a hold timer is already armed fires exactly one hold", () => {
    const onAction = vi.fn();
    render(<StageRenderer onAction={onAction} tree={pressHoldTree()} />);
    const btn = screen.getByRole("button");

    pointerDown(btn);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    pointerDown(btn); // pointer-capture loss / event replay: no pointerup between
    act(() => {
      vi.advanceTimersByTime(HOLD_MS + 100);
    });
    pointerUp(btn);
    fireEvent.click(btn);

    expect(onAction).toHaveBeenCalledTimes(1); // two live timers would dispatch twice
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "held" });
  });

  it("a second finger's far pointermove does not disarm the primary hold (gesture-scoped slop)", () => {
    // Without pointer-identity scoping the second finger's coords measure
    // against the FIRST finger's origin, disarm the hold, and the primary
    // release's synthesized click dispatches onPress — the WRONG action.
    const onAction = vi.fn();
    render(<StageRenderer onAction={onAction} tree={pressHoldTree()} />);
    const btn = screen.getByRole("button");

    pointerDown(btn); // arming pointer: id 1
    fireEvent(
      btn,
      pointerEvent("pointermove", { x: 200, y: 200 }, { pointerId: 2, isPrimary: false }),
    );
    act(() => {
      vi.advanceTimersByTime(HOLD_MS + 100);
    });
    pointerUp(btn); // primary release
    fireEvent.click(btn); // synthesized click — swallowed by the interceptor

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "held" });
  });

  it("a second finger's pointerup does not end the primary hold (gesture-scoped release)", () => {
    const onAction = vi.fn();
    render(<StageRenderer onAction={onAction} tree={pressHoldTree()} />);
    const btn = screen.getByRole("button");

    pointerDown(btn); // arming pointer: id 1
    fireEvent(btn, pointerEvent("pointerup", {}, { pointerId: 2, isPrimary: false })); // palm lifts
    act(() => {
      vi.advanceTimersByTime(HOLD_MS + 100);
    });
    pointerUp(btn);
    fireEvent.click(btn);

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "held" });
  });

  it("a hold that unmounts its own box still swallows the synthesized click — module-level interceptor, not lifecycle-tied", () => {
    // Pins the comment on swallowNextClick: teardown is deliberately NOT tied
    // to component unmount. The tempting useEffect-cleanup refactor would pass
    // every other test while regressing exactly this: a self-hiding hold's
    // synthesized click lands on the pressable ancestor and fires its onPress.
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["card"] },
          card: {
            id: "card",
            type: "box",
            onPress: { kind: "agent", name: "card-pressed" },
            children: ["peek", "ct"],
          },
          ct: { id: "ct", type: "text", value: "card body" },
          peek: {
            id: "peek",
            type: "box",
            onHold: { kind: "toggle", target: "peek" }, // hold hides ITSELF
            children: ["pt"],
          },
          pt: { id: "pt", type: "text", value: "hold me away" },
        })}
      />,
    );
    const peekEl = screen.getByText("hold me away").parentElement as HTMLElement;
    const cardEl = screen.getByText("card body").parentElement as HTMLElement;

    pointerDown(peekEl);
    act(() => {
      vi.advanceTimersByTime(HOLD_MS + 100);
    }); // hold fires ⇒ toggle unmounts the held box itself
    expect(screen.queryByText("hold me away")).toBeNull();

    // The release now happens over the ancestor card: the browser targets the
    // synthesized click there. It must still be swallowed.
    fireEvent(cardEl, pointerEvent("pointerup"));
    fireEvent.click(cardEl);

    expect(onAction).not.toHaveBeenCalled(); // toggle was local; card press swallowed
  });

  it("a second finger's pointercancel does not disarm the post-hold click swallow (palm rejection)", () => {
    // `expire` must mirror `reset`'s isPrimary guard: the browser cancelling a
    // resting palm (non-primary) must not tear the interceptor down while the
    // held finger is still down — its release's synthesized click would then
    // dispatch onPress after onHold already fired.
    const onAction = vi.fn();
    render(<StageRenderer onAction={onAction} tree={pressHoldTree()} />);
    const btn = screen.getByRole("button");

    pointerDown(btn);
    act(() => {
      vi.advanceTimersByTime(HOLD_MS + 100);
    }); // hold fires, interceptor armed
    fireEvent(window, pointerEvent("pointercancel", {}, { pointerId: 2, isPrimary: false }));
    pointerUp(btn);
    fireEvent.click(btn); // the held finger's synthesized click — still swallowed

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "held" });
    // The guard narrows the expire path, it does not remove it: the PRIMARY
    // pointer's own cancel still tears the interceptor down (pinned by the
    // dedicated pointercancel-expiry test above).
  });

  it("the interceptor expires one tick after the primary release when no click is synthesized", () => {
    // Some releases never produce a synthesized click. The interceptor must
    // not linger past the release and eat a later keyboard/programmatic
    // activation — it expires one macrotask after the primary pointerup (the
    // real synthesized click, when it comes, is dispatched synchronously
    // BEFORE that macrotask runs).
    const onAction = vi.fn();
    render(<StageRenderer onAction={onAction} tree={pressHoldTree()} />);
    const btn = screen.getByRole("button");

    pointerDown(btn);
    act(() => {
      vi.advanceTimersByTime(HOLD_MS + 100);
    }); // hold fires, interceptor armed
    pointerUp(btn); // release seen — expiry scheduled for the next macrotask
    act(() => {
      vi.advanceTimersByTime(1);
    }); // …which runs: no click ever arrived
    fireEvent.click(btn); // a LATER programmatic/assistive-tech activation

    expect(onAction).toHaveBeenCalledTimes(2); // held, then the later press
    expect(onAction.mock.calls[1]).toEqual([{ kind: "agent", name: "pressed" }]);
  });

  it("a keydown tears the interceptor down so a keyboard activation is never swallowed", () => {
    const onAction = vi.fn();
    render(<StageRenderer onAction={onAction} tree={pressHoldTree()} />);
    const btn = screen.getByRole("button");

    pointerDown(btn);
    act(() => {
      vi.advanceTimersByTime(HOLD_MS + 100);
    }); // hold fires, interceptor armed
    fireEvent.keyDown(window, { key: "Enter" }); // keyboard takes over
    fireEvent.click(btn); // the keyboard-activated click must land

    expect(onAction).toHaveBeenCalledTimes(2);
    expect(onAction.mock.calls[1]).toEqual([{ kind: "agent", name: "pressed" }]);
  });

  it("a second concurrent primary pointer (hybrid mouse+touch) cannot hijack a live hold", () => {
    // isPrimary is per pointer TYPE, so a touch and a mouse can both be
    // "primary" at once. A second primary pointerdown mid-gesture must NOT
    // overwrite the arming pointer's origin/timer (review r6), or it would
    // orphan the first gesture and mis-fire.
    const onAction = vi.fn();
    render(<StageRenderer onAction={onAction} tree={pressHoldTree()} />);
    const btn = screen.getByRole("button");

    pointerDown(btn); // arming pointer: id 1
    fireEvent(btn, pointerEvent("pointerdown", { x: 40, y: 40 }, { pointerId: 7 })); // 2nd primary, ignored
    act(() => {
      vi.advanceTimersByTime(HOLD_MS + 100);
    });
    pointerUp(btn);
    fireEvent.click(btn); // synthesized click swallowed

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "held" });
  });

  it("a move exactly at the slop radius does not disarm; one past it does (strict >)", () => {
    // The slop test is `dx²+dy² > HOLD_SLOP_PX²` — a move to exactly 8px must
    // KEEP the hold armed (64 > 64 is false); a move to 9px disarms it.
    const onActionA = vi.fn();
    const { unmount } = render(<StageRenderer onAction={onActionA} tree={pressHoldTree()} />);
    const btnA = screen.getByRole("button");
    pointerDown(btnA, { x: 0, y: 0 });
    pointerMove(btnA, { x: 8, y: 0 }); // exactly HOLD_SLOP_PX ⇒ still armed
    act(() => {
      vi.advanceTimersByTime(HOLD_MS + 100);
    });
    pointerUp(btnA);
    fireEvent.click(btnA);
    expect(onActionA).toHaveBeenCalledTimes(1);
    expect(onActionA).toHaveBeenCalledWith({ kind: "agent", name: "held" });
    unmount();

    const onActionB = vi.fn();
    render(<StageRenderer onAction={onActionB} tree={pressHoldTree()} />);
    const btnB = screen.getByRole("button");
    pointerDown(btnB, { x: 0, y: 0 });
    pointerMove(btnB, { x: 9, y: 0 }); // past the radius ⇒ disarm ⇒ tap presses
    act(() => {
      vi.advanceTimersByTime(HOLD_MS + 100);
    });
    pointerUp(btnB);
    fireEvent.click(btnB);
    expect(onActionB).toHaveBeenCalledTimes(1);
    expect(onActionB).toHaveBeenCalledWith({ kind: "agent", name: "pressed" });
  });
});
