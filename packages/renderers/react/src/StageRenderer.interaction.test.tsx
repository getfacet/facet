// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FacetNode, FacetTree, NodeId, ViewSnapshot } from "@facet/core";
import { StageRenderer } from "./StageRenderer.js";
import {
  interactionScreensTree as screensTree,
  interactionTree as tree,
} from "./StageRenderer.test-support.js";
import { resolveTheme } from "./theme.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StageRenderer interactions (jsdom)", () => {
  it("renders input targets and states by input kind", () => {
    const theme = resolveTheme();
    const normalizedColor = (value: string): string => {
      const sample = document.createElement("span");
      sample.style.color = value;
      return sample.style.color;
    };
    const { container } = render(
      <StageRenderer
        tree={tree({
          root: { id: "root", type: "box", children: ["email", "check", "radio"] },
          email: {
            id: "email",
            type: "input",
            name: "email",
            input: "email",
            label: "Email",
            placeholder: "you@example.com",
            style: {
              gap: "lg",
              label: { fontSize: "lg", color: "info" },
              control: {
                background: "successSurface",
                controlHeight: "lg",
                hover: { background: "warningSurface" },
                focus: { borderColor: "danger", borderWidth: "thick" },
              },
              placeholder: { color: "warning", fontStyle: "italic" },
              // Raw renderer path: these valid-but-inapplicable targets must not leak.
              indicator: { background: "danger", indicatorSize: "lg" },
              option: { color: "danger" },
            },
          },
          check: {
            id: "check",
            type: "input",
            name: "consent",
            input: "checkbox",
            label: "Consent",
            style: {
              control: { color: "info" },
              indicator: {
                indicatorSize: "lg",
                borderColor: "warning",
                checked: { background: "success", color: "successForeground" },
                focus: { borderColor: "focusRing", borderWidth: "medium" },
              },
              // Inapplicable for checkbox and therefore absent from rendered CSS.
              placeholder: { color: "danger", fontStyle: "italic" },
            },
          },
          radio: {
            id: "radio",
            type: "input",
            name: "plan",
            input: "radio",
            label: "Plan",
            options: ["Free", "Pro"],
            style: {
              option: {
                color: "info",
                checked: { color: "success", fontWeight: "bold" },
                hover: { color: "warning", fontWeight: "medium" },
              },
            },
          },
        })}
      />,
    );

    const email = container.querySelector('input[name="email"]') as HTMLInputElement;
    const emailRoot = email.closest("label") as HTMLLabelElement;
    const emailLabel = emailRoot.querySelector("span") as HTMLSpanElement;
    expect(emailRoot.style.gap).toBe(theme.space.lg);
    expect(emailLabel.style.fontSize).toBe(theme.fontSize.lg);
    expect(emailLabel.style.color).toBe(normalizedColor(theme.color.info));
    expect(email.style.background).toBe(normalizedColor(theme.color.successSurface));
    expect(email.style.minHeight).toBe(theme.controlHeight.lg);
    expect(email.classList).toContain("facet-hover-background");
    expect(email.classList).toContain("facet-focus-borderColor");
    expect(email.style.getPropertyValue("--facet-hover-background")).toBe(
      theme.color.warningSurface,
    );
    expect(email.style.getPropertyValue("--facet-focus-borderColor")).toBe(theme.color.danger);
    expect(email.classList).toContain("facet-placeholder-color");
    expect(email.style.getPropertyValue("--facet-placeholder-color")).toBe(theme.color.warning);
    expect(email.style.width).toBe("100%");
    expect(email.style.height).toBe("");

    const check = container.querySelector('input[name="consent"]') as HTMLInputElement;
    expect(check.style.width).toBe(theme.indicatorSize.lg);
    expect(check.style.height).toBe(theme.indicatorSize.lg);
    expect(check.style.borderColor).toBe(normalizedColor(theme.color.warning));
    expect(check.classList).toContain("facet-checked-background");
    expect(check.classList).toContain("facet-focus-borderColor");
    expect(check.style.getPropertyValue("--facet-checked-background")).toBe(theme.color.success);
    expect(check.classList).not.toContain("facet-placeholder-color");

    const pro = Array.from(container.querySelectorAll("label")).find(
      (label) => label.textContent === "Pro",
    ) as HTMLLabelElement;
    expect(pro.style.color).toBe(normalizedColor(theme.color.info));
    expect(pro.classList).toContain("facet-checked-color");
    expect(pro.classList).toContain("facet-hover-color");
    expect(pro.classList).toContain("facet-hover-fontWeight");
    expect(pro.style.getPropertyValue("--facet-checked-color")).toBe(theme.color.success);
    expect(pro.style.getPropertyValue("--facet-hover-color")).toBe(theme.color.warning);
    expect(pro.style.getPropertyValue("--facet-hover-fontWeight")).toBe(
      String(theme.fontWeight.medium),
    );
  });

  it("fires onAction with the box's action when a pressable box is clicked", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: {
            id: "root",
            type: "box",
            onPress: { name: "go", payload: { id: "7" } },
            children: ["t"],
          },
          t: { id: "t", type: "text", value: "press me" },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onAction).toHaveBeenCalledTimes(1);
    // The renderer stamps the canonical kind on legacy bare {name} actions at emit time.
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "go", payload: { id: "7" } });
  });

  it("filters non-primitive payload values from a raw-path press", () => {
    const onAction = vi.fn();
    const rootWithNoisyPayload = {
      id: "root",
      type: "box",
      onPress: { name: "go", payload: { ok: 1, bad: { nested: true }, alsoBad: [1] } },
      children: ["t"],
    } as unknown as FacetNode;
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: rootWithNoisyPayload,
          t: { id: "t", type: "text", value: "press me" },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onAction).toHaveBeenCalledTimes(1);
    // Only string/number/boolean payload values survive (mirror of core asAction).
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "go", payload: { ok: 1 } });
  });

  it("emits no payload for an array payload from a raw-path press", () => {
    const onAction = vi.fn();
    const rootWithArrayPayload = {
      id: "root",
      type: "box",
      onPress: { name: "go", payload: ["a", 5] },
      children: ["t"],
    } as unknown as FacetNode;
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: rootWithArrayPayload,
          t: { id: "t", type: "text", value: "press me" },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onAction).toHaveBeenCalledTimes(1);
    // An array is not a payload object (mirror of core asAction/isObject) — omit it entirely.
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "go" });
  });

  it("does not expose a button for a non-pressable box", () => {
    render(
      <StageRenderer
        tree={tree({
          root: { id: "root", type: "box", children: ["t"] },
          t: { id: "t", type: "text", value: "static" },
        })}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders a field as an input (value capture is a planned feature)", () => {
    render(
      <StageRenderer
        tree={tree({
          root: { id: "root", type: "box", children: ["f"] },
          f: { id: "f", type: "input", name: "email", input: "email", placeholder: "you@x.com" },
        })}
      />,
    );
    const input = screen.getByPlaceholderText("you@x.com") as HTMLInputElement;
    expect(input.name).toBe("email");
    expect(input.type).toBe("email");
    // NOTE: typing does NOT yet reach onAction — field-value transport is the
    // planned UI-IN work. When it lands, extend this to assert the captured value.
  });

  it("renders a box with an unknown-kind onPress as non-pressable (never a button)", () => {
    const rootWithAlienPress = {
      id: "root",
      type: "box",
      onPress: { kind: "mystery", name: "x" },
      children: ["t"],
    } as unknown as FacetNode;
    render(
      <StageRenderer
        tree={tree({
          root: rootWithAlienPress,
          t: { id: "t", type: "text", value: "inert" },
        })}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("inert")).toBeTruthy();
  });
});

describe("StageRenderer screens + navigate (jsdom)", () => {
  it("navigate press switches the rendered screen without calling onAction", () => {
    const onAction = vi.fn();
    render(<StageRenderer onAction={onAction} tree={screensTree()} />);

    expect(screen.getByText("home content")).toBeTruthy();
    expect(screen.queryByText("about content")).toBeNull();
    expect(screen.queryByText("plain root content")).toBeNull();

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("about content")).toBeTruthy();
    expect(screen.queryByText("home content")).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("navigate to an unknown screen no-ops (stays on the current screen, no emission)", () => {
    const onAction = vi.fn();
    const base = screensTree();
    const withDeadLink: FacetTree = {
      ...base,
      nodes: {
        ...base.nodes,
        goAbout: {
          id: "goAbout",
          type: "box",
          onPress: { kind: "navigate", to: "nowhere" },
          children: [],
        },
      },
    };
    render(<StageRenderer onAction={onAction} tree={withDeadLink} />);

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("home content")).toBeTruthy();
    expect(screen.queryByText("about content")).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("falls back to entry when the current screen is deleted by a new tree", () => {
    const onAction = vi.fn();
    const { rerender } = render(<StageRenderer onAction={onAction} tree={screensTree()} />);
    fireEvent.click(screen.getByRole("button")); // now on "about"
    expect(screen.getByText("about content")).toBeTruthy();

    const base = screensTree();
    const aboutDeleted: FacetTree = {
      root: base.root,
      nodes: {
        root: base.nodes["root"] as FacetNode,
        rootText: base.nodes["rootText"] as FacetNode,
        home: base.nodes["home"] as FacetNode,
        homeText: base.nodes["homeText"] as FacetNode,
        goAbout: base.nodes["goAbout"] as FacetNode,
      },
      screens: { home: "home" },
      entry: "home",
    };
    rerender(<StageRenderer onAction={onAction} tree={aboutDeleted} />);

    expect(screen.getByText("home content")).toBeTruthy();
    expect(screen.queryByText("about content")).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("treats a screen whose target is a NON-box node as not live and falls back (matches sanitizeScreens)", () => {
    // A raw-path patch can point a screen at a text node; sanitizeScreens drops
    // such a target on the stored tree, so the live fail-safe must NOT render the
    // text node as the whole screen — it falls back to the plain root instead.
    const onAction = vi.fn();
    const badScreen: FacetTree = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["rootText"] },
        rootText: { id: "rootText", type: "text", value: "plain root content" },
        txt: { id: "txt", type: "text", value: "text screen content" },
      },
      screens: { home: "txt" },
      entry: "home",
    };
    render(<StageRenderer onAction={onAction} tree={badScreen} />);

    expect(screen.getByText("plain root content")).toBeTruthy();
    expect(screen.queryByText("text screen content")).toBeNull();
  });

  it("falls back to the first live screen when the current screen AND entry are both dead", () => {
    const onAction = vi.fn();
    const { rerender } = render(<StageRenderer onAction={onAction} tree={screensTree()} />);
    fireEvent.click(screen.getByRole("button")); // currentScreen = "about"

    const bothDead: FacetTree = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["rootText"] },
        rootText: { id: "rootText", type: "text", value: "plain root content" },
        c: { id: "c", type: "box", children: ["cText"] },
        cText: { id: "cText", type: "text", value: "third screen content" },
      },
      // "about" (the current screen) and the entry both point at dead nodes.
      screens: { about: "goneNode", zeta: "c" },
      entry: "about",
    };
    rerender(<StageRenderer onAction={onAction} tree={bothDead} />);

    expect(screen.getByText("third screen content")).toBeTruthy();
    expect(screen.queryByText("plain root content")).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("stays on a live current screen across a rerender with a patched tree (DC-008)", () => {
    const onAction = vi.fn();
    const { rerender } = render(<StageRenderer onAction={onAction} tree={screensTree()} />);
    fireEvent.click(screen.getByRole("button")); // now on "about"

    const base = screensTree();
    const patched: FacetTree = {
      ...base,
      nodes: {
        ...base.nodes,
        about: { id: "about", type: "box", children: ["aboutText", "aboutExtra"] },
        aboutExtra: { id: "aboutExtra", type: "text", value: "fresh about line" },
      },
    };
    rerender(<StageRenderer onAction={onAction} tree={patched} />);

    expect(screen.getByText("about content")).toBeTruthy();
    expect(screen.getByText("fresh about line")).toBeTruthy();
    expect(screen.queryByText("home content")).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  // Enabler B (DC-004/DC-007): a `{screen}` active-look highlight MOVES with a
  // local navigate and fires ZERO transport — no onAction and no onRecord. The
  // predicate evaluation is read-only; only the browser-local screen switch runs.
  it("moves an active-look highlight on navigate with no onAction/onRecord (DC-004/DC-007)", () => {
    const onAction = vi.fn();
    const onRecord = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        onRecord={onRecord}
        tree={{
          root: "root",
          nodes: {
            root: { id: "root", type: "box", children: ["banner", "goAbout"] },
            home: { id: "home", type: "box", children: ["banner", "goAbout"] },
            about: { id: "about", type: "box", children: ["banner"] },
            banner: {
              id: "banner",
              type: "text",
              value: "Nav",
              activeWhen: { screen: "about" },
              style: { active: { fontWeight: "bold" } },
            },
            goAbout: {
              id: "goAbout",
              type: "box",
              onPress: { kind: "navigate", to: "about" },
              children: ["gt"],
            },
            gt: { id: "gt", type: "text", value: "Go about" },
          },
          screens: { home: "home", about: "about" },
          entry: "home",
        }}
      />,
    );

    expect((screen.getByText("Nav") as HTMLElement).style.fontWeight).toBe("400");
    fireEvent.click(screen.getByText("Go about"));
    expect((screen.getByText("Nav") as HTMLElement).style.fontWeight).toBe("700");
    // No agent event; the only record is the navigate's own pre-existing tap —
    // moving the highlight fired nothing extra.
    expect(onAction).not.toHaveBeenCalled();
    expect(onRecord).toHaveBeenCalledTimes(1);
    expect(onRecord).toHaveBeenCalledWith({
      kind: "tap",
      target: "goAbout",
      effect: { navigate: "about" },
    });
  });
});

describe("StageRenderer native local-navigation references (jsdom)", () => {
  const localControl = (id: NodeId, label: string, to: string): Record<NodeId, FacetNode> => {
    const labelId = `${id}-label`;
    return {
      [id]: {
        id,
        type: "box",
        activeWhen: { screen: to },
        style: { active: { borderColor: "accent" } },
        onPress: { kind: "navigate", to },
        children: [labelId],
      },
      [labelId]: { id: labelId, type: "text", value: label },
    };
  };

  const localNavigationTree = (): FacetTree => ({
    root: "root",
    data: { rows: [{ id: 1, status: "open" }] },
    nodes: {
      root: { id: "root", type: "box", children: ["rootText"] },
      rootText: { id: "rootText", type: "text", value: "plain root content" },
      home: { id: "home", type: "box", children: ["controls", "homeText"] },
      about: { id: "about", type: "box", children: ["controls", "aboutText"] },
      closed: { id: "closed", type: "box", children: ["controls", "closedText"] },
      controls: {
        id: "controls",
        type: "box",
        children: ["tab-home", "tab-about", "nav-home", "filter-closed", "dangling"],
      },
      ...localControl("tab-home", "Tab Home", "home"),
      ...localControl("tab-about", "Tab About", "about"),
      ...localControl("nav-home", "Nav Home", "home"),
      ...localControl("filter-closed", "Filter Closed", "closed"),
      ...localControl("dangling", "Dangling", "missing"),
      homeText: { id: "homeText", type: "text", value: "home content" },
      aboutText: { id: "aboutText", type: "text", value: "about content" },
      closedText: { id: "closedText", type: "text", value: "closed content" },
    },
    screens: { home: "home", about: "about", closed: "closed" },
    entry: "home",
  });

  it("navigates locally when the agent channel is absent or unavailable", () => {
    render(<StageRenderer tree={localNavigationTree()} />);
    expect(() => fireEvent.click(screen.getByText("Tab About"))).not.toThrow();
    expect(screen.getByText("about content")).toBeTruthy();

    cleanup();
    const unavailableAgent = vi.fn(() => {
      throw new Error("agent unavailable");
    });
    render(<StageRenderer onAction={unavailableAgent} tree={localNavigationTree()} />);
    expect(() => fireEvent.click(screen.getByText("Tab About"))).not.toThrow();
    expect(screen.getByText("about content")).toBeTruthy();
    expect(unavailableAgent).not.toHaveBeenCalled();
  });

  it("keeps rapid tab/nav/filter clicks local, ordered, and latest-screen coherent", () => {
    const stage = localNavigationTree();
    const before = structuredClone(stage);
    const dataBefore = stage.data;
    const onAction = vi.fn(() => {
      throw new Error("agent unavailable");
    });
    const onRecord = vi.fn();
    const onViewSnapshot = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(
      <StageRenderer
        onAction={onAction}
        onRecord={onRecord}
        onViewSnapshot={onViewSnapshot}
        tree={stage}
      />,
    );

    // Active-predicate evaluation is read-only and emits no record on mount.
    expect(onRecord).not.toHaveBeenCalled();
    onViewSnapshot.mockClear();
    fireEvent.click(screen.getByText("Tab About"));
    fireEvent.click(screen.getByText("Nav Home"));
    fireEvent.click(screen.getByText("Filter Closed"));

    expect(screen.getByText("closed content")).toBeTruthy();
    expect(screen.queryByText("home content")).toBeNull();
    expect(onRecord.mock.calls.map(([record]) => record)).toEqual([
      { kind: "tap", target: "tab-about", effect: { navigate: "about" } },
      { kind: "tap", target: "nav-home", effect: { navigate: "home" } },
      { kind: "tap", target: "filter-closed", effect: { navigate: "closed" } },
    ]);
    expect(
      onViewSnapshot.mock.calls.map(([snapshot]) => (snapshot as ViewSnapshot).screen),
    ).toEqual(["about", "home", "closed"]);
    expect((onViewSnapshot.mock.calls.at(-1)?.[0] as ViewSnapshot).screen).toBe("closed");

    // A dangling target is a complete no-op: no view change and no extra record.
    const snapshotCount = onViewSnapshot.mock.calls.length;
    fireEvent.click(screen.getByText("Dangling"));
    expect(screen.getByText("closed content")).toBeTruthy();
    expect(onRecord).toHaveBeenCalledTimes(3);
    expect(onViewSnapshot).toHaveBeenCalledTimes(snapshotCount);

    // Local navigation has no action/patch writer: the exact tree/data input is
    // untouched and there is no browser-side backend call.
    expect(onAction).not.toHaveBeenCalled();
    expect(stage).toEqual(before);
    expect(stage.data).toBe(dataBefore);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("StageRenderer toggle (jsdom)", () => {
  it("toggle hides then shows a visible panel across two clicks, browser-local", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["btn", "panel"] },
          btn: {
            id: "btn",
            type: "box",
            onPress: { kind: "toggle", target: "panel" },
            children: [],
          },
          panel: { id: "panel", type: "box", children: ["p"] },
          p: { id: "p", type: "text", value: "panel content" },
        })}
      />,
    );

    expect(screen.getByText("panel content")).toBeTruthy();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByText("panel content")).toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("panel content")).toBeTruthy();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("toggle shows then hides an initially-hidden (hidden: true) panel", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["btn", "menu"] },
          btn: {
            id: "btn",
            type: "box",
            onPress: { kind: "toggle", target: "menu" },
            children: [],
          },
          menu: { id: "menu", type: "box", hidden: true, children: ["m"] },
          m: { id: "m", type: "text", value: "menu content" },
        })}
      />,
    );

    expect(screen.queryByText("menu content")).toBeNull(); // hidden on first paint
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("menu content")).toBeTruthy();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByText("menu content")).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("keeps a hidden:true node keyed 'toString' hidden until toggled (no prototype-chain leak)", () => {
    // "toString" passes validateTree (only __proto__/prototype/constructor are
    // forbidden ids). A plain-object visibility store would read the inherited
    // Object.prototype.toString as the override and render the hidden node
    // VISIBLE; a Map never resolves through the prototype.
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["btn", "toString"] },
          btn: {
            id: "btn",
            type: "box",
            onPress: { kind: "toggle", target: "toString" },
            children: ["bt"],
          },
          bt: { id: "bt", type: "text", value: "Toggle" },
          // Cast: the literal key "toString" shadows Object.prototype.toString,
          // so the Record value context doesn't flow to narrow `type` here.
          toString: { id: "toString", type: "box", hidden: true, children: ["m"] } as FacetNode,
          m: { id: "m", type: "text", value: "prototype-safe content" },
        })}
      />,
    );

    expect(screen.queryByText("prototype-safe content")).toBeNull(); // hidden on first paint
    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
    expect(screen.getByText("prototype-safe content")).toBeTruthy(); // first toggle reveals it
    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
    expect(screen.queryByText("prototype-safe content")).toBeNull(); // and hides again
    expect(onAction).not.toHaveBeenCalled();
  });

  it("toggle on an unknown target no-ops (no crash, no emission)", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["btn", "t"] },
          btn: {
            id: "btn",
            type: "box",
            onPress: { kind: "toggle", target: "ghost" },
            children: [],
          },
          t: { id: "t", type: "text", value: "steady" },
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("steady")).toBeTruthy();
    expect(onAction).not.toHaveBeenCalled();
  });
});

// onRecord (WU-4, DC-001/DC-003): a locally-resolved navigate/toggle tap applies
// its optimistic view-state mutation FIRST/unconditionally, THEN fires the
// record-only `onRecord` channel with the resolved effect + the pressed box's
// id as `target` — distinct from `onAction` (the agent-routed channel), and
// fire-and-forget so a record failure can never unwind the view-state.
describe("StageRenderer onRecord (jsdom)", () => {
  it("a local navigate tap applies optimistically then fires onRecord with the resolved effect", () => {
    const onAction = vi.fn();
    const onRecord = vi.fn();
    render(<StageRenderer onAction={onAction} onRecord={onRecord} tree={screensTree()} />);

    fireEvent.click(screen.getByRole("button"));

    // Optimistic effect applied FIRST: the screen switched synchronously.
    expect(screen.getByText("about content")).toBeTruthy();
    expect(screen.queryByText("home content")).toBeNull();
    // The record-only channel fired AFTER, carrying the resolved effect + the
    // pressed box's node id as `target` (the effect is captured here, never
    // re-derived). navigate/toggle never reach the agent-routed onAction.
    expect(onRecord).toHaveBeenCalledTimes(1);
    expect(onRecord).toHaveBeenCalledWith({
      kind: "tap",
      target: "goAbout",
      effect: { navigate: "about" },
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("a local toggle tap applies optimistically then fires onRecord with the resolved toggle effect", () => {
    const onRecord = vi.fn();
    render(
      <StageRenderer
        onRecord={onRecord}
        tree={tree({
          root: { id: "root", type: "box", children: ["btn", "panel"] },
          btn: {
            id: "btn",
            type: "box",
            onPress: { kind: "toggle", target: "panel" },
            children: [],
          },
          panel: { id: "panel", type: "box", children: ["p"] },
          p: { id: "p", type: "text", value: "panel content" },
        })}
      />,
    );

    expect(screen.getByText("panel content")).toBeTruthy();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByText("panel content")).toBeNull(); // optimistic hide

    expect(onRecord).toHaveBeenCalledTimes(1);
    expect(onRecord).toHaveBeenCalledWith({
      kind: "tap",
      target: "btn",
      effect: { toggle: "panel" },
    });
  });

  it("an onRecord failure leaves the optimistic view-state unchanged (DC-003)", () => {
    const onRecord = vi.fn(() => {
      throw new Error("record channel down");
    });
    render(<StageRenderer onRecord={onRecord} tree={screensTree()} />);

    // A record-channel throw must be swallowed (fire-and-forget): the click
    // itself does not throw, and the optimistic navigate stands — the failure
    // never unwinds currentScreen.
    expect(() => fireEvent.click(screen.getByRole("button"))).not.toThrow();
    expect(onRecord).toHaveBeenCalledTimes(1);
    expect(screen.getByText("about content")).toBeTruthy();
    expect(screen.queryByText("home content")).toBeNull();
  });

  it("navigate/toggle with onRecord omitted stay browser-local (no throw, no emission)", () => {
    const onAction = vi.fn();
    render(<StageRenderer onAction={onAction} tree={screensTree()} />);

    // The record channel is optional: absent it, a navigate is exactly today's
    // browser-local screen switch with no transport traffic.
    expect(() => fireEvent.click(screen.getByRole("button"))).not.toThrow();
    expect(screen.getByText("about content")).toBeTruthy();
    expect(onAction).not.toHaveBeenCalled();
  });
});

// Collect (DC-001/002/003): a press whose agent action declares `collect` snapshots
// the VISIBLE, MOUNTED field values inside that box's subtree into a second
// onAction argument. Inputs stay uncontrolled (invariant #6): the DOM owns the
// text, nothing writes values into the tree, and typing alone emits no traffic.
