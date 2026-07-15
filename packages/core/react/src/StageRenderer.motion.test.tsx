// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EMPTY_TREE, MAX_DEPTH, type FacetNode, type FacetTree, type NodeId } from "@facet/core";
import { StageRenderer } from "./StageRenderer.js";
import {
  MANY_CHANGE_THRESHOLD,
  MOTION_CLASS_NAMES,
  MOTION_CSS,
  MOTION_ENTER_MS,
  MOTION_EXIT_MS,
  STAGE_CROSSFADE_MS,
} from "./motion.js";

afterEach(cleanup);

const tree = (nodes: Record<NodeId, FacetNode>, root: NodeId = "root"): FacetTree => ({
  root,
  nodes,
});

const containerStyleText = (): string =>
  Array.from(document.querySelectorAll("style"), (style) => style.textContent ?? "").join("\n");

function pointerEvent(type: string): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { clientX: 0, clientY: 0, pointerId: 1, button: 0, isPrimary: true });
  return event;
}

describe("StageRenderer lifecycle motion (jsdom)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fireEvent(window, pointerEvent("pointerdown"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const transition = (revision: number, rootReplaced = false, rootReplacedRevision?: number) => ({
    revision,
    rootReplaced,
    ...(rootReplacedRevision !== undefined ? { rootReplacedRevision } : {}),
  });

  const removalTree = (includePanel: boolean): FacetTree =>
    tree({
      root: { id: "root", type: "box", children: includePanel ? ["panel", "stay"] : ["stay"] },
      panel: {
        id: "panel",
        type: "box",
        onPress: { kind: "agent", name: "stale-panel" },
        children: ["panelText", "panelField"],
      },
      panelText: { id: "panelText", type: "text", value: "Leaving panel" },
      panelField: {
        id: "panelField",
        type: "input",
        name: "email",
        placeholder: "stale email",
      },
      stay: { id: "stay", type: "text", value: "Staying content" },
    });

  it("renders the first contentful server paint from EMPTY_TREE without crossfade", () => {
    const firstContent = tree({
      root: { id: "root", type: "box", children: ["copy"] },
      copy: { id: "copy", type: "text", value: "First server content" },
    });
    const { container, rerender } = render(
      <StageRenderer tree={EMPTY_TREE} transition={transition(0)} />,
    );

    rerender(<StageRenderer tree={firstContent} transition={transition(1, true, 1)} />);

    expect(screen.getByText("First server content")).toBeTruthy();
    expect(container.querySelector(`.${MOTION_CLASS_NAMES.stageCrossfade}`)).toBeNull();
    expect(container.querySelector(`.${MOTION_CLASS_NAMES.stagePrevious}`)).toBeNull();
    expect(container.querySelector(`.${MOTION_CLASS_NAMES.brickEnter}`)).toBeNull();
  });

  it("keeps the blank-boot guard fail-safe for a raw tree with null screens", () => {
    const blankWithBadScreens = {
      ...EMPTY_TREE,
      screens: null,
    } as unknown as FacetTree;
    const firstContent = tree({
      root: { id: "root", type: "box", children: ["copy"] },
      copy: { id: "copy", type: "text", value: "First server content" },
    });
    const { container, rerender } = render(
      <StageRenderer tree={blankWithBadScreens} transition={transition(0)} />,
    );

    expect(() => {
      rerender(<StageRenderer tree={firstContent} transition={transition(1, true, 1)} />);
    }).not.toThrow();
    expect(screen.getByText("First server content")).toBeTruthy();
    expect(container.querySelector(`.${MOTION_CLASS_NAMES.stageCrossfade}`)).toBeNull();
  });

  // composition-hard-cut: allowed-negative — a raw pre-cutover form can still
  // arrive through the live patch path. Its descendants are neither rendered
  // nor admitted to enter/exit motion after form ceased to be a container.
  it("keeps a stale raw subtree out of both rendering and motion", () => {
    const staleTree = tree({
      root: { id: "root", type: "box", children: ["stale-form", "stay"] },
      "stale-form": {
        id: "stale-form",
        type: "form", // composition-hard-cut: allowed-negative
        children: ["stale-copy"],
      } as unknown as FacetNode,
      "stale-copy": { id: "stale-copy", type: "text", value: "Never animate me" },
      stay: { id: "stay", type: "text", value: "Staying content" },
    });
    const cleanTree = tree({
      root: { id: "root", type: "box", children: ["stay"] },
      stay: { id: "stay", type: "text", value: "Staying content" },
    });
    const { container, rerender } = render(
      <StageRenderer tree={staleTree} transition={transition(0)} />,
    );

    expect(screen.queryByText("Never animate me")).toBeNull();
    rerender(<StageRenderer tree={cleanTree} transition={transition(1)} />);
    expect(container.querySelector(`.${MOTION_CLASS_NAMES.brickExit}`)).toBeNull();

    rerender(<StageRenderer tree={staleTree} transition={transition(2)} />);
    expect(screen.queryByText("Never animate me")).toBeNull();
    expect(container.querySelector(`.${MOTION_CLASS_NAMES.brickEnter}`)).toBeNull();
    expect(screen.getByText("Staying content")).toBeTruthy();
  });

  it("keeps a removed brick as inert exit visual until the exit timer completes", () => {
    const onAction = vi.fn();
    const { rerender } = render(
      <StageRenderer onAction={onAction} tree={removalTree(true)} transition={transition(0)} />,
    );

    rerender(
      <StageRenderer onAction={onAction} tree={removalTree(false)} transition={transition(1)} />,
    );

    const staleText = screen.getByText("Leaving panel");
    const stalePanel = staleText.parentElement as HTMLElement;
    expect(stalePanel.classList.contains(MOTION_CLASS_NAMES.brickExit)).toBe(true);
    expect(containerStyleText()).toContain(`@keyframes ${MOTION_CLASS_NAMES.brickExit}`);
    expect(stalePanel.getAttribute("aria-hidden")).toBe("true");
    expect(stalePanel.style.pointerEvents).toBe("none");
    expect(screen.queryByRole("button", { name: /Leaving panel/ })).toBeNull();
    const staleInput = screen.getByPlaceholderText("stale email");
    expect(staleInput.getAttribute("data-facet-field-id")).toBeNull();
    expect(staleInput.getAttribute("name")).toBeNull();
    expect((staleInput as HTMLInputElement).disabled).toBe(true);
    expect(staleInput.tabIndex).toBe(-1);

    fireEvent.click(stalePanel);
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.getByText("Staying content")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(MOTION_EXIT_MS - 1);
    });
    expect(screen.getByText("Leaving panel")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText("Leaving panel")).toBeNull();
    expect(containerStyleText()).not.toContain(MOTION_CSS);
  });

  it("adds enter motion only to newly visible ids and preserves same-id field identity", () => {
    const cardTree = (withBadge: boolean, label: string): FacetTree =>
      tree({
        root: { id: "root", type: "box", children: withBadge ? ["card", "badge"] : ["card"] },
        card: { id: "card", type: "box", children: ["label", "field"] },
        label: { id: "label", type: "text", value: label },
        field: { id: "field", type: "input", name: "email", label: "Email" },
        badge: { id: "badge", type: "box", style: { appear: "fade" }, children: ["badgeText"] },
        badgeText: { id: "badgeText", type: "text", value: "New badge" },
      });
    const { rerender } = render(
      <StageRenderer tree={cardTree(false, "Before")} transition={transition(0)} />,
    );
    const input = screen.getByLabelText("Email") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "typed@example.com" } });

    rerender(<StageRenderer tree={cardTree(true, "After")} transition={transition(1)} />);

    expect(screen.getByLabelText("Email")).toBe(input);
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("typed@example.com");
    expect(screen.getByText("After").className).not.toContain(MOTION_CLASS_NAMES.brickEnter);
    const badge = screen.getByText("New badge").parentElement as HTMLElement;
    expect(badge.classList.contains(MOTION_CLASS_NAMES.brickEnter)).toBe(true);
    expect(badge.classList.contains("facet-appear-fade")).toBe(true);
    expect(containerStyleText()).toContain(`@keyframes ${MOTION_CLASS_NAMES.brickEnter}`);

    act(() => {
      vi.advanceTimersByTime(MOTION_ENTER_MS);
    });
    expect(badge.classList.contains(MOTION_CLASS_NAMES.brickEnter)).toBe(false);
    expect(containerStyleText()).not.toContain(MOTION_CSS);
  });

  it("uses stage crossfade for root replacements without per-brick lifecycle classes", () => {
    const onAction = vi.fn();
    const first = tree({
      root: { id: "root", type: "box", children: ["oldButton", "oldField", "oldVideo"] },
      oldButton: {
        id: "oldButton",
        type: "box",
        onPress: { kind: "agent", name: "stale-root-button" },
        children: ["old"],
      },
      old: { id: "old", type: "text", value: "Old root" },
      oldField: { id: "oldField", type: "input", name: "email", placeholder: "old email" },
      oldVideo: {
        id: "oldVideo",
        type: "media",
        kind: "video",
        src: "https://example.com/clip.mp4",
        controls: true,
      },
    });
    const second = tree(
      {
        nextRoot: { id: "nextRoot", type: "box", children: ["next"] },
        next: { id: "next", type: "text", value: "New root" },
      },
      "nextRoot",
    );
    const { container, rerender } = render(
      <StageRenderer onAction={onAction} tree={first} transition={transition(0)} />,
    );

    rerender(<StageRenderer onAction={onAction} tree={second} transition={transition(1, true)} />);

    expect(container.querySelector(`.${MOTION_CLASS_NAMES.stageCrossfade}`)).not.toBeNull();
    const previousStage = container.querySelector(`.${MOTION_CLASS_NAMES.stagePrevious}`);
    expect(previousStage).not.toBeNull();
    expect(previousStage?.getAttribute("aria-hidden")).toBe("true");
    expect((previousStage as HTMLElement).style.pointerEvents).toBe("none");
    expect(screen.getByText("Old root")).toBeTruthy();
    expect(screen.getByText("New root")).toBeTruthy();
    expect(container.querySelector(`.${MOTION_CLASS_NAMES.brickEnter}`)).toBeNull();
    expect(container.querySelector(`.${MOTION_CLASS_NAMES.brickExit}`)).toBeNull();
    expect(containerStyleText()).toContain(`@keyframes ${MOTION_CLASS_NAMES.stageCurrent}`);
    expect(previousStage?.querySelector('[data-facet-field-id="oldField"]')).toBeNull();
    const staleInput = screen.getByPlaceholderText("old email") as HTMLInputElement;
    expect(staleInput.disabled).toBe(true);
    expect(staleInput.getAttribute("name")).toBeNull();
    expect(staleInput.tabIndex).toBe(-1);
    expect(previousStage?.querySelector("video")?.hasAttribute("controls")).toBe(false);
    expect(screen.queryByRole("button", { name: /Old root/ })).toBeNull();
    fireEvent.click(screen.getByText("Old root"));
    expect(onAction).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(STAGE_CROSSFADE_MS);
    });
    expect(screen.queryByText("Old root")).toBeNull();
    expect(containerStyleText()).not.toContain(MOTION_CSS);
  });

  it("uses root-replaced revision metadata even when a later batched patch is the visible revision", () => {
    const first = tree({
      root: { id: "root", type: "box", children: ["old"] },
      old: { id: "old", type: "text", value: "Old root" },
    });
    const second = tree(
      {
        nextRoot: { id: "nextRoot", type: "box", children: ["next", "followup"] },
        next: { id: "next", type: "text", value: "New root" },
        followup: { id: "followup", type: "text", value: "Follow-up patch" },
      },
      "nextRoot",
    );
    const { container, rerender } = render(
      <StageRenderer tree={first} transition={transition(0)} />,
    );

    rerender(<StageRenderer tree={second} transition={transition(2, false, 1)} />);

    expect(container.querySelector(`.${MOTION_CLASS_NAMES.stageCrossfade}`)).not.toBeNull();
    expect(screen.getByText("Old root")).toBeTruthy();
    expect(screen.getByText("New root")).toBeTruthy();
    expect(screen.getByText("Follow-up patch")).toBeTruthy();
  });

  it("keeps an active stage crossfade alive across a rapid non-root follow-up patch", () => {
    const first = tree({
      root: { id: "root", type: "box", children: ["old"] },
      old: { id: "old", type: "text", value: "Old root" },
    });
    const second = tree(
      {
        nextRoot: { id: "nextRoot", type: "box", children: ["next"] },
        next: { id: "next", type: "text", value: "New root" },
      },
      "nextRoot",
    );
    const followup = tree(
      {
        nextRoot: { id: "nextRoot", type: "box", children: ["next", "extra"] },
        next: { id: "next", type: "text", value: "New root" },
        extra: { id: "extra", type: "text", value: "Follow-up patch" },
      },
      "nextRoot",
    );
    const { container, rerender } = render(
      <StageRenderer tree={first} transition={transition(0)} />,
    );

    rerender(<StageRenderer tree={second} transition={transition(1, true, 1)} />);
    rerender(<StageRenderer tree={followup} transition={transition(2, false, 1)} />);

    expect(container.querySelector(`.${MOTION_CLASS_NAMES.stageCrossfade}`)).not.toBeNull();
    expect(screen.getByText("Old root")).toBeTruthy();
    expect(screen.getByText("Follow-up patch")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(STAGE_CROSSFADE_MS);
    });
    expect(screen.queryByText("Old root")).toBeNull();
    expect(screen.getByText("Follow-up patch")).toBeTruthy();
  });

  it("keeps the current stage wrapper stable across crossfade so same-id fields keep view-state", () => {
    const first = tree({
      root: { id: "root", type: "box", children: ["field"] },
      field: { id: "field", type: "input", name: "email", label: "Email" },
    });
    const second = tree(
      {
        nextRoot: { id: "nextRoot", type: "box", children: ["field"] },
        field: { id: "field", type: "input", name: "email", label: "Email" },
      },
      "nextRoot",
    );
    const { container, rerender } = render(
      <StageRenderer tree={first} transition={transition(0)} />,
    );
    const frame = container.querySelector(`.${MOTION_CLASS_NAMES.stageFrame}`);
    const current = container.querySelector(`.${MOTION_CLASS_NAMES.stageCurrent}`);
    expect(frame).not.toBeNull();
    expect(current).not.toBeNull();
    const input = screen.getByLabelText("Email") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "typed@example.com" } });

    rerender(<StageRenderer tree={second} transition={transition(1, true)} />);

    const currentAfter = container.querySelector(`.${MOTION_CLASS_NAMES.stageCurrent}`);
    expect(container.querySelector(`.${MOTION_CLASS_NAMES.stageFrame}`)).toBe(frame);
    expect(currentAfter).toBe(current);
    expect(currentAfter?.querySelector('input[data-facet-field-id="field"]')).toBe(input);
    expect(input.value).toBe("typed@example.com");
  });

  it("uses stage crossfade when enter and exit ids exceed the many-change threshold", () => {
    const manyTree = (prefix: string): FacetTree => {
      const nodes: Record<NodeId, FacetNode> = {
        root: { id: "root", type: "box", children: [] },
      };
      const children: NodeId[] = [];
      for (let i = 0; i <= MANY_CHANGE_THRESHOLD; i += 1) {
        const id = `${prefix}${String(i)}`;
        children.push(id);
        nodes[id] = { id, type: "text", value: `${prefix} ${String(i)}` };
      }
      nodes.root = { id: "root", type: "box", children };
      return { root: "root", nodes };
    };
    const { container, rerender } = render(
      <StageRenderer tree={manyTree("old")} transition={transition(0)} />,
    );

    rerender(<StageRenderer tree={manyTree("new")} transition={transition(1)} />);

    expect(container.querySelector(`.${MOTION_CLASS_NAMES.stageCrossfade}`)).not.toBeNull();
    expect(screen.getByText("old 0")).toBeTruthy();
    expect(screen.getByText("new 0")).toBeTruthy();
    expect(container.querySelector(`.${MOTION_CLASS_NAMES.brickEnter}`)).toBeNull();
    expect(container.querySelector(`.${MOTION_CLASS_NAMES.brickExit}`)).toBeNull();
  });

  it("keeps exactly the many-change threshold at brick-level lifecycle motion", () => {
    const changedPerSide = MANY_CHANGE_THRESHOLD / 2;
    const thresholdTree = (prefix: string): FacetTree => {
      const nodes: Record<NodeId, FacetNode> = {
        root: { id: "root", type: "box", children: [] },
      };
      const children: NodeId[] = [];
      for (let i = 0; i < changedPerSide; i += 1) {
        const id = `${prefix}${String(i)}`;
        children.push(id);
        nodes[id] = { id, type: "text", value: `${prefix} ${String(i)}` };
      }
      nodes.root = { id: "root", type: "box", children };
      return { root: "root", nodes };
    };
    const { container, rerender } = render(
      <StageRenderer tree={thresholdTree("old")} transition={transition(0)} />,
    );

    rerender(<StageRenderer tree={thresholdTree("new")} transition={transition(1)} />);

    expect(container.querySelector(`.${MOTION_CLASS_NAMES.stageCrossfade}`)).toBeNull();
    expect(container.querySelectorAll(`.${MOTION_CLASS_NAMES.brickEnter}`)).toHaveLength(
      changedPerSide,
    );
    expect(container.querySelectorAll(`.${MOTION_CLASS_NAMES.brickExit}`)).toHaveLength(
      changedPerSide,
    );
  });

  it("caps accumulated rapid enters by switching to a stage crossfade", () => {
    const firstBatch = Math.floor(MANY_CHANGE_THRESHOLD / 2) + 1;
    const total = MANY_CHANGE_THRESHOLD + 1;
    const withAddedCount = (count: number): FacetTree => {
      const nodes: Record<NodeId, FacetNode> = {
        root: { id: "root", type: "box", children: ["base"] },
        base: { id: "base", type: "text", value: "base content" },
      };
      const children: NodeId[] = ["base"];
      for (let i = 0; i < count; i += 1) {
        const id = `new${String(i)}`;
        children.push(id);
        nodes[id] = { id, type: "text", value: `new ${String(i)}` };
      }
      nodes.root = { id: "root", type: "box", children };
      return { root: "root", nodes };
    };
    const { container, rerender } = render(
      <StageRenderer tree={withAddedCount(0)} transition={transition(0)} />,
    );

    rerender(<StageRenderer tree={withAddedCount(firstBatch)} transition={transition(1)} />);
    rerender(<StageRenderer tree={withAddedCount(total)} transition={transition(2)} />);

    expect(container.querySelector(`.${MOTION_CLASS_NAMES.stageCrossfade}`)).not.toBeNull();
    expect(screen.getAllByText("base content").length).toBeGreaterThan(0);
    expect(screen.getByText(`new ${String(total - 1)}`)).toBeTruthy();
    expect(container.querySelector(`.${MOTION_CLASS_NAMES.brickEnter}`)).toBeNull();
  });

  it("caps accumulated small exits by switching to a stage crossfade", () => {
    const withCount = (count: number): FacetTree => {
      const nodes: Record<NodeId, FacetNode> = {
        root: { id: "root", type: "box", children: [] },
      };
      const children: NodeId[] = [];
      for (let i = 0; i < count; i += 1) {
        const id = `item${String(i)}`;
        children.push(id);
        nodes[id] = { id, type: "text", value: `item ${String(i)}` };
      }
      nodes.root = { id: "root", type: "box", children };
      return { root: "root", nodes };
    };
    const { container, rerender } = render(
      <StageRenderer tree={withCount(MANY_CHANGE_THRESHOLD + 2)} transition={transition(0)} />,
    );

    for (let revision = 1; revision <= MANY_CHANGE_THRESHOLD + 1; revision += 1) {
      rerender(
        <StageRenderer
          tree={withCount(MANY_CHANGE_THRESHOLD + 2 - revision)}
          transition={transition(revision)}
        />,
      );
    }

    expect(container.querySelector(`.${MOTION_CLASS_NAMES.stageCrossfade}`)).not.toBeNull();
  });

  it("counts pending subtree exits by visible descendants when capping accumulated changes", () => {
    const pendingSubtreeCount = Math.floor(MANY_CHANGE_THRESHOLD / 2) + 1;
    const followupExitCount = MANY_CHANGE_THRESHOLD - pendingSubtreeCount + 1;
    const withPanelAndTail = (includePanel: boolean, tailCount: number): FacetTree => {
      const panelChildren: NodeId[] = [];
      const tailChildren: NodeId[] = [];
      const nodes: Record<NodeId, FacetNode> = {
        root: { id: "root", type: "box", children: [] },
        panel: { id: "panel", type: "box", children: panelChildren },
      };
      for (let i = 0; i < pendingSubtreeCount - 1; i += 1) {
        const id = `panelItem${String(i)}`;
        panelChildren.push(id);
        nodes[id] = { id, type: "text", value: `panel ${String(i)}` };
      }
      for (let i = 0; i < tailCount; i += 1) {
        const id = `tail${String(i)}`;
        tailChildren.push(id);
        nodes[id] = { id, type: "text", value: `tail ${String(i)}` };
      }
      nodes.root = {
        id: "root",
        type: "box",
        children: includePanel ? ["panel", ...tailChildren] : tailChildren,
      };
      return { root: "root", nodes };
    };
    const { container, rerender } = render(
      <StageRenderer tree={withPanelAndTail(true, followupExitCount)} transition={transition(0)} />,
    );

    rerender(
      <StageRenderer
        tree={withPanelAndTail(false, followupExitCount)}
        transition={transition(1)}
      />,
    );
    expect(container.querySelector(`.${MOTION_CLASS_NAMES.stageCrossfade}`)).toBeNull();

    rerender(<StageRenderer tree={withPanelAndTail(false, 0)} transition={transition(2)} />);

    expect(container.querySelector(`.${MOTION_CLASS_NAMES.stageCrossfade}`)).not.toBeNull();
  });

  it("cancels a stale exit when the same id reappears before the timeout", () => {
    const panelTree = (visible: boolean, value: string): FacetTree =>
      tree({
        root: { id: "root", type: "box", children: visible ? ["panel"] : [] },
        panel: { id: "panel", type: "box", children: ["panelText"] },
        panelText: { id: "panelText", type: "text", value },
      });
    const { rerender } = render(
      <StageRenderer tree={panelTree(true, "Panel v1")} transition={transition(0)} />,
    );

    rerender(<StageRenderer tree={panelTree(false, "Panel v1")} transition={transition(1)} />);
    expect(screen.getByText("Panel v1")).toBeTruthy();

    rerender(<StageRenderer tree={panelTree(true, "Panel v2")} transition={transition(2)} />);

    expect(screen.queryByText("Panel v1")).toBeNull();
    expect(screen.getByText("Panel v2")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(MOTION_EXIT_MS);
    });
    expect(screen.getByText("Panel v2")).toBeTruthy();
  });

  it("cancels a stale parent exit when one of its descendants reappears", () => {
    const movingTree = (placement: "nested" | "none" | "top"): FacetTree =>
      tree({
        root: {
          id: "root",
          type: "box",
          children: placement === "nested" ? ["panel"] : placement === "top" ? ["moving"] : [],
        },
        panel: { id: "panel", type: "box", children: ["moving"] },
        moving: { id: "moving", type: "text", value: "Moving item" },
      });
    const { rerender } = render(
      <StageRenderer tree={movingTree("nested")} transition={transition(0)} />,
    );

    rerender(<StageRenderer tree={movingTree("none")} transition={transition(1)} />);
    expect(screen.getByText("Moving item")).toBeTruthy();

    rerender(<StageRenderer tree={movingTree("top")} transition={transition(2)} />);

    expect(screen.getAllByText("Moving item")).toHaveLength(1);
  });

  it("cleans up handler-less exit visuals without an onAction channel", () => {
    const { rerender } = render(
      <StageRenderer tree={removalTree(true)} transition={transition(0)} />,
    );

    rerender(<StageRenderer tree={removalTree(false)} transition={transition(1)} />);
    expect(screen.getByText("Leaving panel")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(MOTION_EXIT_MS);
    });
    expect(screen.queryByText("Leaving panel")).toBeNull();
  });

  it("treats a malformed transition prop as motion disabled instead of throwing", () => {
    const first = tree({
      root: { id: "root", type: "box", children: ["old"] },
      old: { id: "old", type: "text", value: "Old root" },
    });
    const second = tree({
      root: { id: "root", type: "box", children: ["next"] },
      next: { id: "next", type: "text", value: "New root" },
    });
    const { container, rerender } = render(
      <StageRenderer tree={first} transition={transition(0)} />,
    );

    expect(() =>
      rerender(<StageRenderer tree={second} transition={null as never} />),
    ).not.toThrow();
    expect(screen.getByText("New root")).toBeTruthy();
    expect(container.querySelector(`.${MOTION_CLASS_NAMES.stageCrossfade}`)).toBeNull();
  });

  it("keeps an exit visual when the surviving parent changes away from box", () => {
    const before = tree({
      root: { id: "root", type: "box", children: ["panel"] },
      panel: { id: "panel", type: "box", children: ["leaving"] },
      leaving: { id: "leaving", type: "text", value: "Leaving child" },
    });
    const after = tree({
      root: { id: "root", type: "box", children: ["panel"] },
      panel: { id: "panel", type: "text", value: "Panel became text" },
    });
    const { rerender } = render(<StageRenderer tree={before} transition={transition(0)} />);

    rerender(<StageRenderer tree={after} transition={transition(1)} />);

    expect(screen.getByText("Panel became text")).toBeTruthy();
    expect(screen.getByText("Leaving child").className).toContain(MOTION_CLASS_NAMES.brickExit);
  });

  it("keeps sibling exit visuals in their previous order around surviving children", () => {
    const before = tree({
      root: { id: "root", type: "box", children: ["a", "b", "c"] },
      a: { id: "a", type: "text", value: "A" },
      b: { id: "b", type: "text", value: "B" },
      c: { id: "c", type: "text", value: "C" },
    });
    const after = tree({
      root: { id: "root", type: "box", children: ["c"] },
      c: { id: "c", type: "text", value: "C" },
    });
    const { container, rerender } = render(
      <StageRenderer tree={before} transition={transition(0)} />,
    );

    rerender(<StageRenderer tree={after} transition={transition(1)} />);

    expect(Array.from(container.querySelectorAll("p"), (node) => node.textContent)).toEqual([
      "A",
      "B",
      "C",
    ]);
  });

  it("keeps accumulated sibling exits in order across rapid removals", () => {
    const withChildren = (children: readonly NodeId[]): FacetTree => {
      const nodes: Record<NodeId, FacetNode> = {
        root: { id: "root", type: "box", children },
      };
      for (const id of children) {
        nodes[id] = { id, type: "text", value: id.toUpperCase() };
      }
      return { root: "root", nodes };
    };
    const { container, rerender } = render(
      <StageRenderer tree={withChildren(["a", "b", "c", "d"])} transition={transition(0)} />,
    );

    rerender(<StageRenderer tree={withChildren(["a", "b", "d"])} transition={transition(1)} />);
    rerender(<StageRenderer tree={withChildren(["a", "d"])} transition={transition(2)} />);

    expect(Array.from(container.querySelectorAll("p"), (node) => node.textContent)).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
  });

  it("does not hang when an exiting node's previous parent chain self-cycles", () => {
    const before = tree({
      root: { id: "root", type: "box", children: ["loop"] },
      loop: { id: "loop", type: "box", children: ["loop", "leaving"] },
      leaving: { id: "leaving", type: "text", value: "Leaving self-cycle child" },
    });
    const after = tree({
      root: { id: "root", type: "box", children: ["loop"] },
      loop: { id: "loop", type: "box", children: ["loop"] },
    });
    const { rerender } = render(<StageRenderer tree={before} transition={transition(0)} />);

    expect(() => {
      rerender(<StageRenderer tree={after} transition={transition(1)} />);
    }).not.toThrow();
    expect(screen.getAllByText("Leaving self-cycle child").length).toBeGreaterThan(0);
  });

  it("renders an exit snapshot from its previous depth instead of exposing too-deep children", () => {
    const deepTree = (includeDeepExit: boolean): FacetTree => {
      const nodes: Record<NodeId, FacetNode> = {
        root: { id: "root", type: "box", children: ["depth1"] },
        tooDeep: { id: "tooDeep", type: "text", value: "Too deep child" },
      };
      for (let depth = 1; depth <= MAX_DEPTH; depth += 1) {
        const id = `depth${String(depth)}`;
        const nextId = depth === MAX_DEPTH ? "tooDeep" : `depth${String(depth + 1)}`;
        nodes[id] = { id, type: "box", children: [nextId] };
      }
      if (!includeDeepExit) {
        const parentId = `depth${String(MAX_DEPTH - 1)}`;
        nodes[parentId] = { id: parentId, type: "box", children: [] };
      }
      return { root: "root", nodes };
    };
    const { rerender } = render(<StageRenderer tree={deepTree(true)} transition={transition(0)} />);
    expect(screen.queryByText("Too deep child")).toBeNull();

    rerender(<StageRenderer tree={deepTree(false)} transition={transition(1)} />);

    expect(screen.queryByText("Too deep child")).toBeNull();
  });

  it("renders cyclic exit snapshots with the previous ancestor guard", () => {
    const before = tree({
      root: { id: "root", type: "box", children: ["panel", "stay"] },
      panel: { id: "panel", type: "box", children: ["root", "leaving"] },
      leaving: { id: "leaving", type: "text", value: "Leaving cyclic panel" },
      stay: { id: "stay", type: "text", value: "Staying content" },
    });
    const after = tree({
      root: { id: "root", type: "box", children: ["stay"] },
      stay: { id: "stay", type: "text", value: "Staying content" },
    });
    const { rerender } = render(<StageRenderer tree={before} transition={transition(0)} />);

    rerender(<StageRenderer tree={after} transition={transition(1)} />);

    expect(screen.getByText("Leaving cyclic panel")).toBeTruthy();
    expect(screen.getAllByText("Staying content")).toHaveLength(1);
  });
});
