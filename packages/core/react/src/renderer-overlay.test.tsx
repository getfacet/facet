// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FacetNode, FacetTree, NodeId, ViewSnapshot } from "@facet/core";
import { StageRenderer } from "./StageRenderer.js";
import { OVERLAY_FRAME_Z, OVERLAY_SCRIM_Z } from "./layout-contract.js";

// WU-4: a VISIBLE box carrying a valid `overlay` floats above flow content over
// a scrim, in a client `OverlayFrame` that owns the chrome (scrim + a close
// button) and the client effects (focus-in, Esc, scrim-click, body scroll-lock).
// Every close affordance routes through StageRenderer's `closeOverlay` — an
// idempotent set-to-hidden reusing the SAME `view.toggled` entry as the trigger
// toggle, never `onAction`. jsdom can verify the STRUCTURE (scrim present, preset
// applied, close dispatches the toggle, idempotent hide); real stacking / paint
// order / focus-trap are the mandatory live-journey (real-browser) tier.

afterEach(cleanup);

const tree = (nodes: Record<NodeId, FacetNode>, root: NodeId = "root"): FacetTree => ({
  root,
  nodes,
});
const text = (id: NodeId, value: string): FacetNode => ({ id, type: "text", value });
const node = (n: object): FacetNode => n as unknown as FacetNode;

const lastSnapshot = (onViewSnapshot: ReturnType<typeof vi.fn>): ViewSnapshot =>
  onViewSnapshot.mock.calls.at(-1)?.[0] as ViewSnapshot;

// A modal overlay box, visible by default, so it floats on mount.
const modalTree = (): FacetTree =>
  tree({
    root: node({ id: "root", type: "box", children: ["dialogBox"] }),
    dialogBox: node({
      id: "dialogBox",
      type: "box",
      overlay: { kind: "modal" },
      children: ["body"],
    }),
    body: text("body", "Modal body"),
  });

describe("overlay modal float + close affordances (DC-001)", () => {
  it("floats a visible modal over a scrim in a centered frame", () => {
    render(<StageRenderer tree={modalTree()} onAction={vi.fn()} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).not.toBeNull();
    // The centered modal preset (framework constants, not author values).
    expect(dialog.style.position).toBe("fixed");
    expect(dialog.style.top).toBe("50%");
    expect(dialog.style.left).toBe("50%");
    expect(dialog.style.transform).toBe("translate(-50%, -50%)");
    // The scrim renders behind the frame (its previous sibling), fixed + tinted.
    const scrim = dialog.previousElementSibling as HTMLElement;
    expect(scrim).not.toBeNull();
    expect(scrim.getAttribute("aria-hidden")).toBe("true");
    expect(scrim.style.position).toBe("fixed");
    expect(scrim.style.zIndex).toBe(String(OVERLAY_SCRIM_Z));
    // The box content renders inside the frame.
    expect(screen.getByText("Modal body")).toBeTruthy();
  });

  it("closes the overlay via Esc — hides through view.toggled, never onAction", () => {
    const onAction = vi.fn();
    const onRecord = vi.fn();
    const onViewSnapshot = vi.fn();
    render(
      <StageRenderer
        tree={modalTree()}
        onAction={onAction}
        onRecord={onRecord}
        onViewSnapshot={onViewSnapshot}
      />,
    );
    expect(screen.getByRole("dialog")).not.toBeNull();

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    // The box is hidden ⇒ its frame unmounts.
    expect(screen.queryByRole("dialog")).toBeNull();
    // Hidden via the overlay box's own view.toggled entry (the same channel a
    // trigger toggle writes), deterministically to "hidden".
    expect(lastSnapshot(onViewSnapshot).toggled).toEqual({ dialogBox: "hidden" });
    // The close was recorded as a local tap on the overlay box id (RISK-INV-3),
    // and the agent-routed onAction NEVER fired for a close.
    expect(onRecord).toHaveBeenCalledWith({
      kind: "tap",
      target: "dialogBox",
      effect: { toggle: "dialogBox" },
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("closes the overlay via a scrim click — hides through view.toggled, never onAction", () => {
    const onAction = vi.fn();
    const onViewSnapshot = vi.fn();
    render(
      <StageRenderer tree={modalTree()} onAction={onAction} onViewSnapshot={onViewSnapshot} />,
    );

    const scrim = screen.getByRole("dialog").previousElementSibling as HTMLElement;
    fireEvent.click(scrim);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(lastSnapshot(onViewSnapshot).toggled).toEqual({ dialogBox: "hidden" });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("closes the overlay via the framework close button — hides through view.toggled, never onAction", () => {
    const onAction = vi.fn();
    const onViewSnapshot = vi.fn();
    render(
      <StageRenderer tree={modalTree()} onAction={onAction} onViewSnapshot={onViewSnapshot} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(lastSnapshot(onViewSnapshot).toggled).toEqual({ dialogBox: "hidden" });
    expect(onAction).not.toHaveBeenCalled();
  });
});

describe("overlay drawer placement (DC-002)", () => {
  it("uses the logical end-edge drawer preset, not the modal center", () => {
    render(
      <StageRenderer
        tree={tree({
          root: node({ id: "root", type: "box", children: ["drawerBox"] }),
          drawerBox: node({
            id: "drawerBox",
            type: "box",
            overlay: { kind: "drawer" },
            children: ["dtext"],
          }),
          dtext: text("dtext", "Drawer body"),
        })}
        onAction={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.style.position).toBe("fixed");
    // Pinned to the end (right) edge, full height — the drawer preset.
    expect(dialog.style.right).toBe("0px");
    expect(dialog.style.top).toBe("0px");
    expect(dialog.style.bottom).toBe("0px");
    expect(dialog.style.height).toBe("100%");
    // NOT the modal center transform.
    expect(dialog.style.transform).toBe("");
  });
});

describe("overlay fail-safe: malformed / absent (DC-003)", () => {
  it("renders an inline box (no frame, no scrim) and never throws for a bad or absent overlay", () => {
    let rendered: ReturnType<typeof render> | undefined;
    expect(() => {
      rendered = render(
        <StageRenderer
          tree={tree({
            root: node({ id: "root", type: "box", children: ["bad", "str", "plain"] }),
            bad: node({ id: "bad", type: "box", overlay: { kind: "lightbox" }, children: ["bt"] }),
            bt: text("bt", "Bad kind body"),
            str: node({ id: "str", type: "box", overlay: "modal", children: ["st"] }),
            st: text("st", "String overlay body"),
            plain: node({ id: "plain", type: "box", children: ["pt"] }),
            pt: text("pt", "Plain body"),
          })}
          onAction={vi.fn()}
        />,
      );
    }).not.toThrow();
    expect(rendered).toBeDefined();
    // No overlay frame anywhere; all three boxes render their content inline.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Bad kind body")).toBeTruthy();
    expect(screen.getByText("String overlay body")).toBeTruthy();
    expect(screen.getByText("Plain body")).toBeTruthy();
  });
});

describe("overlay flow-only discipline: no author z/inset (DC-004)", () => {
  it("emits ONLY framework placement constants even when the author injects z/inset", () => {
    render(
      <StageRenderer
        tree={tree({
          root: node({ id: "root", type: "box", children: ["dialogBox"] }),
          // Extra author keys on the raw path must NEVER reach the emitted style.
          dialogBox: node({
            id: "dialogBox",
            type: "box",
            overlay: { kind: "modal", z: 999, top: "10px", position: "absolute" },
            children: ["body"],
          }),
          body: text("body", "Modal body"),
        })}
        onAction={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog");
    // Framework frame z, not the author 999.
    expect(dialog.style.zIndex).toBe(String(OVERLAY_FRAME_Z));
    expect(dialog.style.zIndex).not.toBe("999");
    // Framework center offset, not the author 10px, and fixed (not the author absolute).
    expect(dialog.style.top).toBe("50%");
    expect(dialog.style.position).toBe("fixed");
    const scrim = dialog.previousElementSibling as HTMLElement;
    expect(scrim.style.zIndex).toBe(String(OVERLAY_SCRIM_Z));
  });
});

describe("overlay close single-sources view.toggled (DC-005)", () => {
  it("close routes through the SAME view.toggled entry as the trigger toggle", () => {
    const onAction = vi.fn();
    const onRecord = vi.fn();
    const onViewSnapshot = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        onRecord={onRecord}
        onViewSnapshot={onViewSnapshot}
        tree={tree({
          root: node({ id: "root", type: "box", children: ["trigger", "dialogBox"] }),
          trigger: node({
            id: "trigger",
            type: "box",
            onPress: { kind: "toggle", target: "dialogBox" },
            children: ["tl"],
          }),
          tl: text("tl", "Open"),
          dialogBox: node({
            id: "dialogBox",
            type: "box",
            hidden: true,
            overlay: { kind: "modal" },
            children: ["body"],
          }),
          body: text("body", "Modal body"),
        })}
      />,
    );

    // Closed initially (hidden by default) → no frame.
    expect(screen.queryByRole("dialog")).toBeNull();

    // Trigger toggle opens it: view.toggled[dialogBox] === "shown".
    fireEvent.click(screen.getByText("Open"));
    expect(screen.getByRole("dialog")).not.toBeNull();
    expect(lastSnapshot(onViewSnapshot).toggled).toEqual({ dialogBox: "shown" });

    // Esc close hides it via the SAME entry: view.toggled[dialogBox] === "hidden".
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(lastSnapshot(onViewSnapshot).toggled).toEqual({ dialogBox: "hidden" });

    // Both the open and the close recorded a tap whose effect.toggle is the SAME
    // overlay box id; no close ever reached the agent-routed onAction.
    const toggleKeys = onRecord.mock.calls
      .map((call) => (call[0] as { effect?: { toggle?: string } }).effect?.toggle)
      .filter((key): key is string => key !== undefined);
    expect(toggleKeys).toEqual(["dialogBox", "dialogBox"]);
    expect(onAction).not.toHaveBeenCalled();
  });
});

describe("overlay stacking: two visible overlays (DC-006)", () => {
  it("renders both overlays in tree/DOM order", () => {
    render(
      <StageRenderer
        tree={tree({
          root: node({ id: "root", type: "box", children: ["first", "second"] }),
          first: node({ id: "first", type: "box", overlay: { kind: "modal" }, children: ["ft"] }),
          ft: text("ft", "First overlay"),
          second: node({
            id: "second",
            type: "box",
            overlay: { kind: "drawer" },
            children: ["st"],
          }),
          st: text("st", "Second overlay"),
        })}
        onAction={vi.fn()}
      />,
    );

    const dialogs = screen.getAllByRole("dialog");
    expect(dialogs).toHaveLength(2);
    expect(dialogs[0]?.textContent).toContain("First overlay");
    expect(dialogs[1]?.textContent).toContain("Second overlay");
  });
});

describe("overlay idempotent close (RISK-INV-4)", () => {
  it("rapid double Esc leaves the overlay HIDDEN — no reopen", () => {
    const onViewSnapshot = vi.fn();
    render(<StageRenderer tree={modalTree()} onAction={vi.fn()} onViewSnapshot={onViewSnapshot} />);
    expect(screen.getByRole("dialog")).not.toBeNull();

    // Two Esc keydowns batched in ONE commit hit the still-mounted listener with
    // the SAME prior visibility state. A blind toggle flip would set hidden then
    // re-flip to SHOWN (reopen); the deterministic set-to-false stays hidden.
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(lastSnapshot(onViewSnapshot).toggled).toEqual({ dialogBox: "hidden" });
  });
});
