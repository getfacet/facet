// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FacetTree } from "@facet/core";
import { StageRenderer } from "./StageRenderer.js";
import {
  interactionPointerEvent as pointerEvent,
  interactionTree as tree,
} from "./StageRenderer.test-support.js";

const HOLD_MS = 500;
const pointerDown = (el: Element): void => {
  fireEvent(el, pointerEvent("pointerdown"));
};
const pointerUp = (el: Element): void => {
  fireEvent(el, pointerEvent("pointerup"));
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// View-state coherence (DC-006) + replay-on-mount (Decision 2): an unrelated
// content patch must keep the scroll container's DOM identity (the proxy for
// scrollTop), while a toggle re-show REMOUNTS the node — the accepted semantic
// under which the appear animation replays per mount.
describe("StageRenderer view-state coherence (jsdom)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Reset the global one-shot click interceptor between tests (see the hold
    // suite's beforeEach for the rationale).
    fireEvent(window, pointerEvent("pointerdown"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("scroll-container element identity and scrollTop survive an unrelated sibling patch", () => {
    const onAction = vi.fn();
    const scrollTree = (label: string): FacetTree =>
      tree({
        root: { id: "root", type: "box", children: ["list", "status"] },
        list: {
          id: "list",
          type: "box",
          style: { scroll: "vertical" },
          children: ["row"],
        },
        row: { id: "row", type: "text", value: "row content" },
        status: { id: "status", type: "text", value: label },
      });
    const { rerender } = render(<StageRenderer onAction={onAction} tree={scrollTree("before")} />);

    const listEl = screen.getByText("row content").parentElement as HTMLElement;
    expect(listEl.style.overflowY).toBe("auto"); // it IS the scroll container
    listEl.scrollTop = 120;
    const kept = listEl.scrollTop; // read back (jsdom clamps without layout)

    rerender(<StageRenderer onAction={onAction} tree={scrollTree("after")} />);

    expect(screen.getByText("after")).toBeTruthy();
    expect(screen.getByText("row content").parentElement).toBe(listEl);
    expect(listEl.scrollTop).toBe(kept);
  });

  it("a toggle re-shown appear box remounts (appear replays per mount — pinned semantics)", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["btn", "peek"] },
          btn: {
            id: "btn",
            type: "box",
            onPress: { kind: "toggle", target: "peek" },
            children: ["bt"],
          },
          bt: { id: "bt", type: "text", value: "Toggle" },
          peek: {
            id: "peek",
            type: "box",
            style: { enterAnimation: "fade" },
            children: ["pt"],
          },
          pt: { id: "pt", type: "text", value: "peek content" },
        })}
      />,
    );

    const first = screen.getByText("peek content").parentElement as HTMLElement;
    expect(first.classList).toContain("facet-appear-fade");

    fireEvent.click(screen.getByRole("button", { name: "Toggle" })); // hide ⇒ unmount
    expect(screen.queryByText("peek content")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Toggle" })); // re-show ⇒ REMOUNT

    const second = screen.getByText("peek content").parentElement as HTMLElement;
    expect(second).not.toBe(first); // a fresh element ⇒ the CSS animation replays
    expect(second.classList).toContain("facet-appear-fade");
  });

  it("adding the first / removing the last appear token never remounts the stage (review r3)", () => {
    // The <style> slot toggling must not change the stage child's element type:
    // `usesAppear ? <Fragment>…</Fragment> : stage` would remount EVERYTHING on
    // the flip, wiping scrollTop and visitor-typed field text.
    const onAction = vi.fn();
    const flipTree = (appear: boolean): FacetTree =>
      tree({
        root: { id: "root", type: "box", children: ["list", "badge"] },
        list: {
          id: "list",
          type: "box",
          style: { scroll: "vertical" },
          children: ["row"],
        },
        row: { id: "row", type: "text", value: "row content" },
        badge: appear
          ? {
              id: "badge",
              type: "box",
              style: { enterAnimation: "fade" },
              children: [],
            }
          : { id: "badge", type: "box", children: [] },
      });
    const { rerender, container } = render(
      <StageRenderer onAction={onAction} tree={flipTree(false)} />,
    );
    const hasAppearStylesheet = (): boolean =>
      Array.from(container.querySelectorAll("style")).some((style) =>
        style.textContent?.includes("@keyframes facet-appear-fade"),
      );
    expect(hasAppearStylesheet()).toBe(false);
    const listEl = screen.getByText("row content").parentElement as HTMLElement;
    listEl.scrollTop = 120;
    const kept = listEl.scrollTop;

    rerender(<StageRenderer onAction={onAction} tree={flipTree(true)} />); // first appear token arrives
    expect(hasAppearStylesheet()).toBe(true);
    expect(screen.getByText("row content").parentElement).toBe(listEl); // NO remount
    expect(listEl.scrollTop).toBe(kept);

    rerender(<StageRenderer onAction={onAction} tree={flipTree(false)} />); // last appear token leaves
    expect(hasAppearStylesheet()).toBe(false);
    expect(screen.getByText("row content").parentElement).toBe(listEl);
    expect(listEl.scrollTop).toBe(kept);
  });

  it("adding onHold to a pressable box does not remount it — typed field text and scrollTop survive (review r6)", () => {
    const onAction = vi.fn();
    // A pressable box holding an uncontrolled field and a scroll region.
    const cardTree = (withHold: boolean): FacetTree =>
      tree({
        root: { id: "root", type: "box", children: ["card"] },
        card: {
          id: "card",
          type: "box",
          onPress: { kind: "agent", name: "open" },
          ...(withHold ? { onHold: { kind: "agent", name: "peek" } } : {}),
          children: ["list", "f"],
        },
        list: {
          id: "list",
          type: "box",
          style: { scroll: "vertical" },
          children: ["row"],
        },
        row: { id: "row", type: "text", value: "row content" },
        f: { id: "f", type: "input", name: "email", label: "Email" },
      });
    const { rerender } = render(<StageRenderer onAction={onAction} tree={cardTree(false)} />);

    const input = screen.getByLabelText("Email") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "typed@example.com" } });
    const listEl = screen.getByText("row content").parentElement as HTMLElement;
    listEl.scrollTop = 90;
    const keptScroll = listEl.scrollTop;

    // A live patch merely ADDS a secondary gesture. Element type must be stable
    // (BoxElement → BoxElement), so React updates props in place: no remount.
    rerender(<StageRenderer onAction={onAction} tree={cardTree(true)} />);

    expect(screen.getByLabelText("Email")).toBe(input); // same element…
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("typed@example.com");
    expect(screen.getByText("row content").parentElement).toBe(listEl);
    expect(listEl.scrollTop).toBe(keptScroll);
  });

  it("removing onHold from a box does not remount it and the box still presses (review r6)", () => {
    const onAction = vi.fn();
    const cardTree = (withHold: boolean): FacetTree =>
      tree({
        root: { id: "root", type: "box", children: ["card"] },
        card: {
          id: "card",
          type: "box",
          onPress: { kind: "agent", name: "open" },
          ...(withHold ? { onHold: { kind: "agent", name: "peek" } } : {}),
          children: ["f"],
        },
        f: { id: "f", type: "input", name: "email", label: "Email" },
      });
    const { rerender } = render(<StageRenderer onAction={onAction} tree={cardTree(true)} />);
    const input = screen.getByLabelText("Email") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "kept" } });

    rerender(<StageRenderer onAction={onAction} tree={cardTree(false)} />); // onHold removed

    expect(screen.getByLabelText("Email")).toBe(input);
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("kept");
    // Still pressable after losing the hold gesture.
    fireEvent.click(screen.getByRole("button"));
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "open" });
  });

  it("adding onPress+onHold to a plain box does not remount it and it becomes holdable (review r6)", () => {
    const onAction = vi.fn();
    const boxTree = (interactive: boolean): FacetTree =>
      tree({
        root: { id: "root", type: "box", children: ["b"] },
        b: {
          id: "b",
          type: "box",
          ...(interactive
            ? {
                onPress: { kind: "agent", name: "open" },
                onHold: { kind: "agent", name: "peek" },
              }
            : {}),
          children: ["f"],
        },
        f: { id: "f", type: "input", name: "email", label: "Email" },
      });
    const { rerender } = render(<StageRenderer onAction={onAction} tree={boxTree(false)} />);
    const input = screen.getByLabelText("Email") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "stays" } });

    rerender(<StageRenderer onAction={onAction} tree={boxTree(true)} />); // plain → press+hold

    expect(screen.getByLabelText("Email")).toBe(input);
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("stays");
    // The box is now holdable: a long press fires onHold.
    const btn = screen.getByRole("button");
    pointerDown(btn);
    act(() => {
      vi.advanceTimersByTime(HOLD_MS + 100);
    });
    pointerUp(btn);
    fireEvent.click(btn);
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "peek" });
  });
});
