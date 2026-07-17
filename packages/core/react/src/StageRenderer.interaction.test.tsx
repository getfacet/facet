// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  MAX_FIELD_VALUE_CHARS,
  type FacetAction,
  type FacetNode,
  type FacetTree,
  type NodeId,
  type ViewSnapshot,
} from "@facet/core";
import { StageRenderer } from "./StageRenderer.js";
import { resolveTheme } from "./theme.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const tree = (nodes: Record<NodeId, FacetNode>, root: NodeId = "root"): FacetTree => ({
  root,
  nodes,
});

/** A two-screen tree: entry "home" (with a navigate button) and "about". */
const screensTree = (): FacetTree => ({
  root: "root",
  nodes: {
    root: { id: "root", type: "box", children: ["rootText"] },
    rootText: { id: "rootText", type: "text", value: "plain root content" },
    home: { id: "home", type: "box", children: ["homeText", "goAbout"] },
    homeText: { id: "homeText", type: "text", value: "home content" },
    goAbout: {
      id: "goAbout",
      type: "box",
      onPress: { kind: "navigate", to: "about" },
      children: [],
    },
    about: { id: "about", type: "box", children: ["aboutText"] },
    aboutText: { id: "aboutText", type: "text", value: "about content" },
  },
  screens: { home: "home", about: "about" },
  entry: "home",
});

// renderToStaticMarkup (StageRenderer.test.ts) covers static output + fail-safe.
// These jsdom tests cover the INTERACTION path — clicks reaching onAction — which
// a string render can't exercise. This is the seam the action-vocabulary work builds on.
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
describe("StageRenderer collect (jsdom)", () => {
  /** name+email form in box "form"; a submit button collecting it. */
  const formTree = (): FacetTree =>
    tree({
      root: { id: "root", type: "box", children: ["form", "submit"] },
      form: { id: "form", type: "box", children: ["nameF", "emailF"] },
      nameF: { id: "nameF", type: "input", name: "name", placeholder: "your name" },
      emailF: { id: "emailF", type: "input", name: "email", placeholder: "your email" },
      submit: {
        id: "submit",
        type: "box",
        onPress: { kind: "agent", name: "submit", collect: "form" },
        children: ["st"],
      },
      st: { id: "st", type: "text", value: "Send" },
    });

  it("collect press delivers the typed field values alongside the action", () => {
    const onAction = vi.fn();
    render(<StageRenderer onAction={onAction} tree={formTree()} />);

    fireEvent.change(screen.getByPlaceholderText("your name"), { target: { value: "Ada" } });
    fireEvent.change(screen.getByPlaceholderText("your email"), {
      target: { value: "ada@lovelace.dev" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith(
      { kind: "agent", name: "submit" },
      { name: "Ada", email: "ada@lovelace.dev" },
    );
  });

  it("collects fields from a native box target via a pressable box", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["panel", "submit"] },
          panel: {
            id: "panel",
            type: "box",
            children: ["emailF"],
          },
          emailF: { id: "emailF", type: "input", name: "email", placeholder: "your email" },
          submit: {
            id: "submit",
            type: "box",
            onPress: { kind: "agent", name: "submit", collect: "panel" },
            children: ["submit-label"],
          },
          "submit-label": { id: "submit-label", type: "text", value: "Send" },
        })}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("your email"), {
      target: { value: "ada@lovelace.dev" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith(
      { kind: "agent", name: "submit" },
      { email: "ada@lovelace.dev" },
    );
  });

  it("typing alone emits nothing (field text is browser view-state)", () => {
    const onAction = vi.fn();
    render(<StageRenderer onAction={onAction} tree={formTree()} />);

    const input = screen.getByPlaceholderText("your name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Ada" } });

    expect(input.value).toBe("Ada"); // uncontrolled input keeps the text
    expect(onAction).not.toHaveBeenCalled();
  });

  it("captures a visible field's value even when an earlier same-named field is hidden", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["hiddenBox", "visibleF", "submit"] },
          hiddenBox: { id: "hiddenBox", type: "box", hidden: true, children: ["dupHidden"] },
          dupHidden: { id: "dupHidden", type: "input", name: "email", placeholder: "hidden dup" },
          visibleF: { id: "visibleF", type: "input", name: "email", placeholder: "visible email" },
          submit: {
            id: "submit",
            type: "box",
            onPress: { kind: "agent", name: "submit", collect: "root" },
            children: ["st"],
          },
          st: { id: "st", type: "text", value: "Send" },
        })}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("visible email"), {
      target: { value: "typed@x.dev" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // The earlier (hidden) same-named field must NOT shadow the visible one.
    expect(onAction).toHaveBeenCalledWith(
      { kind: "agent", name: "submit" },
      { email: "typed@x.dev" },
    );
  });

  it("never harvests a password field's value", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["form", "submit"] },
          form: { id: "form", type: "box", children: ["userF", "passF"] },
          userF: { id: "userF", type: "input", name: "user", placeholder: "user" },
          passF: {
            id: "passF",
            type: "input",
            name: "password",
            input: "password",
            placeholder: "secret",
          },
          submit: {
            id: "submit",
            type: "box",
            onPress: { kind: "agent", name: "login", collect: "form" },
            children: ["st"],
          },
          st: { id: "st", type: "text", value: "Log in" },
        })}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("user"), { target: { value: "ada" } });
    fireEvent.change(screen.getByPlaceholderText("secret"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    // The password value is excluded outright; only the non-secret field rides.
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "login" }, { user: "ada" });
  });

  it("unknown collect id degrades to empty fields, never a throw", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["submit"] },
          submit: {
            id: "submit",
            type: "box",
            onPress: { kind: "agent", name: "submit", collect: "ghost" },
            children: ["st"],
          },
          st: { id: "st", type: "text", value: "Send" },
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "submit" }, {});
  });

  it("collect on a target with zero fields delivers {}", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["panel", "submit"] },
          panel: { id: "panel", type: "box", children: ["p"] },
          p: { id: "p", type: "text", value: "no inputs here" },
          submit: {
            id: "submit",
            type: "box",
            onPress: { kind: "agent", name: "submit", collect: "panel" },
            children: ["st"],
          },
          st: { id: "st", type: "text", value: "Send" },
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "submit" }, {});
  });

  it("non-field nodes in the collect subtree contribute nothing", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["form", "submit"] },
          form: { id: "form", type: "box", children: ["heading", "pic", "inner"] },
          heading: { id: "heading", type: "text", value: "Sign up" },
          pic: {
            id: "pic",
            type: "media",
            kind: "image",
            src: "https://example.com/a.png",
            alt: "pic",
          },
          inner: { id: "inner", type: "box", children: ["emailF"] },
          emailF: { id: "emailF", type: "input", name: "email", placeholder: "your email" },
          submit: {
            id: "submit",
            type: "box",
            onPress: { kind: "agent", name: "submit", collect: "form" },
            children: ["st"],
          },
          st: { id: "st", type: "text", value: "Send" },
        })}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("your email"), {
      target: { value: "a@b.dev" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "submit" }, { email: "a@b.dev" });
  });

  it("brick-vocab v1 collects select, checkbox, switch, and the checked radio member", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["form", "submit"] },
          form: {
            id: "form",
            type: "box",
            children: ["plan", "agree", "alerts", "size"],
          },
          plan: {
            id: "plan",
            type: "input",
            name: "plan",
            input: "select",
            options: ["Free", "Pro"],
          },
          agree: { id: "agree", type: "input", name: "agree", input: "checkbox" },
          alerts: { id: "alerts", type: "input", name: "alerts", input: "switch" },
          size: {
            id: "size",
            type: "input",
            name: "size",
            input: "radio",
            options: ["Small", "Large"],
          },
          submit: {
            id: "submit",
            type: "box",
            onPress: { kind: "agent", name: "submit", collect: "form" },
            children: ["st"],
          },
          st: { id: "st", type: "text", value: "Send" },
        })}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Pro" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "" }));
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByDisplayValue("Large"));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onAction).toHaveBeenCalledWith(
      { kind: "agent", name: "submit" },
      { plan: "Pro", agree: true, alerts: true, size: "Large" },
    );
  });

  it("collects the first defined same-name radio value when an earlier radio group is unchecked", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["form", "submit"] },
          form: {
            id: "form",
            type: "box",
            children: ["emptySize", "chosenSize"],
          },
          emptySize: {
            id: "emptySize",
            type: "input",
            name: "size",
            input: "radio",
            options: ["Small", "Medium"],
          },
          chosenSize: {
            id: "chosenSize",
            type: "input",
            name: "size",
            input: "radio",
            options: ["Large", "XL"],
          },
          submit: {
            id: "submit",
            type: "box",
            onPress: { kind: "agent", name: "submit", collect: "form" },
            children: ["st"],
          },
          st: { id: "st", type: "text", value: "Send" },
        })}
      />,
    );

    fireEvent.click(screen.getByDisplayValue("XL"));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "submit" }, { size: "XL" });
  });

  it("does not collect a same-named field OUTSIDE the collect subtree", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["outsideF", "form", "submit"] },
          outsideF: { id: "outsideF", type: "input", name: "email", placeholder: "outside" },
          form: { id: "form", type: "box", children: ["emailF"] },
          emailF: { id: "emailF", type: "input", name: "email", placeholder: "inside" },
          submit: {
            id: "submit",
            type: "box",
            onPress: { kind: "agent", name: "submit", collect: "form" },
            children: ["st"],
          },
          st: { id: "st", type: "text", value: "Send" },
        })}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("outside"), { target: { value: "evil@x" } });
    fireEvent.change(screen.getByPlaceholderText("inside"), { target: { value: "good@x" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "submit" }, { email: "good@x" });
  });

  it("duplicate field names inside the subtree: the first in walk order wins", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["form", "submit"] },
          form: { id: "form", type: "box", children: ["first", "inner"] },
          first: { id: "first", type: "input", name: "email", placeholder: "first" },
          inner: { id: "inner", type: "box", children: ["second"] },
          second: { id: "second", type: "input", name: "email", placeholder: "second" },
          submit: {
            id: "submit",
            type: "box",
            onPress: { kind: "agent", name: "submit", collect: "form" },
            children: ["st"],
          },
          st: { id: "st", type: "text", value: "Send" },
        })}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("first"), { target: { value: "first@x" } });
    fireEvent.change(screen.getByPlaceholderText("second"), { target: { value: "second@x" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "submit" }, { email: "first@x" });
  });

  it(`truncates a value longer than the cap to MAX_FIELD_VALUE_CHARS`, () => {
    const onAction = vi.fn();
    render(<StageRenderer onAction={onAction} tree={formTree()} />);

    fireEvent.change(screen.getByPlaceholderText("your name"), {
      target: { value: "x".repeat(MAX_FIELD_VALUE_CHARS + 25) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onAction).toHaveBeenCalledTimes(1);
    const fields = onAction.mock.calls[0]?.[1] as Record<string, string>;
    expect(fields["name"]).toBe("x".repeat(MAX_FIELD_VALUE_CHARS));
    expect(fields["email"]).toBe("");
  });

  it(`caps a field NAME longer than the cap so the server never rejects the submit`, () => {
    const onAction = vi.fn();
    const longName = "n".repeat(MAX_FIELD_VALUE_CHARS + 25);
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["form", "submit"] },
          form: { id: "form", type: "box", children: ["f"] },
          f: { id: "f", type: "input", name: longName, placeholder: "x" },
          submit: {
            id: "submit",
            type: "box",
            onPress: { kind: "agent", name: "submit", collect: "form" },
            children: ["st"],
          },
          st: { id: "st", type: "text", value: "Send" },
        })}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("x"), { target: { value: "v" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    const fields = onAction.mock.calls[0]?.[1] as Record<string, string>;
    const key = Object.keys(fields)[0] ?? "";
    expect(key.length).toBe(MAX_FIELD_VALUE_CHARS); // capped, so isFieldsRecord accepts it
    expect(fields[key]).toBe("v");
  });

  it("keeps long radio field DOM names distinct past the label cap", () => {
    const leftName = `${"n".repeat(220)}left`;
    const rightName = `${"n".repeat(220)}right`;
    render(
      <StageRenderer
        tree={tree({
          root: { id: "root", type: "box", children: ["left", "right"] },
          left: {
            id: "left",
            type: "input",
            name: leftName,
            input: "radio",
            options: ["Yes"],
          },
          right: {
            id: "right",
            type: "input",
            name: rightName,
            input: "radio",
            options: ["Yes"],
          },
        })}
      />,
    );

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(radios[0]?.getAttribute("name")).toBe(leftName);
    expect(radios[1]?.getAttribute("name")).toBe(rightName);
  });

  it("terminates on a cyclic collect subtree and keeps the fields it reached", () => {
    const onAction = vi.fn();
    // form → loop → form (cycle); the raw live-patch path can produce this.
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["form", "submit"] },
          form: { id: "form", type: "box", children: ["nameF", "loop"] },
          nameF: { id: "nameF", type: "input", name: "name", placeholder: "your name" },
          loop: { id: "loop", type: "box", children: ["form", "extraF"] },
          extraF: { id: "extraF", type: "input", name: "extra", placeholder: "extra" },
          submit: {
            id: "submit",
            type: "box",
            onPress: { kind: "agent", name: "submit", collect: "form" },
            children: ["st"],
          },
          st: { id: "st", type: "text", value: "Send" },
        })}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("your name"), { target: { value: "Ada" } });
    fireEvent.change(screen.getByPlaceholderText("extra"), { target: { value: "more" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith(
      { kind: "agent", name: "submit" },
      { name: "Ada", extra: "more" },
    );
  });

  it("an action without collect passes no fields argument at all", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["form", "submit"] },
          form: { id: "form", type: "box", children: ["nameF"] },
          nameF: { id: "nameF", type: "input", name: "name", placeholder: "your name" },
          submit: {
            id: "submit",
            type: "box",
            onPress: { kind: "agent", name: "go" },
            children: ["st"],
          },
          st: { id: "st", type: "text", value: "Send" },
        })}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("your name"), { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onAction).toHaveBeenCalledTimes(1);
    // Exactly ONE argument — today's emission, byte-for-byte (fields undefined).
    expect(onAction.mock.calls[0]).toEqual([{ kind: "agent", name: "go" }]);
    expect(onAction.mock.calls[0]).toHaveLength(1);
  });

  it("collect target living on a NON-current screen delivers {} (only mounted fields)", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={{
          root: "root",
          nodes: {
            root: { id: "root", type: "box", children: [] },
            home: { id: "home", type: "box", children: ["submit"] },
            submit: {
              id: "submit",
              type: "box",
              onPress: { kind: "agent", name: "submit", collect: "aboutForm" },
              children: ["st"],
            },
            st: { id: "st", type: "text", value: "Send" },
            about: { id: "about", type: "box", children: ["aboutForm"] },
            aboutForm: { id: "aboutForm", type: "box", children: ["secretF"] },
            secretF: { id: "secretF", type: "input", name: "secret", placeholder: "secret" },
          },
          screens: { home: "home", about: "about" },
          entry: "home",
        }}
      />,
    );

    // The form's screen is not current, so its input is not in the DOM at all.
    expect(screen.queryByPlaceholderText("secret")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "submit" }, {});
  });

  it("omits a toggled-hidden field inside the collect subtree", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["hideBtn", "form", "submit"] },
          hideBtn: {
            id: "hideBtn",
            type: "box",
            onPress: { kind: "toggle", target: "emailF" },
            children: ["ht"],
          },
          ht: { id: "ht", type: "text", value: "Hide" },
          form: { id: "form", type: "box", children: ["nameF", "emailF"] },
          nameF: { id: "nameF", type: "input", name: "name", placeholder: "your name" },
          emailF: { id: "emailF", type: "input", name: "email", placeholder: "your email" },
          submit: {
            id: "submit",
            type: "box",
            onPress: { kind: "agent", name: "submit", collect: "form" },
            children: ["st"],
          },
          st: { id: "st", type: "text", value: "Send" },
        })}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("your name"), { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Hide" })); // unmounts the email input
    expect(screen.queryByPlaceholderText("your email")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "submit" }, { name: "Ada" });
  });

  it("navigate and toggle stay browser-local in a collect-bearing tree (unchanged)", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={{
          root: "root",
          nodes: {
            root: { id: "root", type: "box", children: [] },
            home: { id: "home", type: "box", children: ["toggleBtn", "panel", "form", "goBtn"] },
            toggleBtn: {
              id: "toggleBtn",
              type: "box",
              onPress: { kind: "toggle", target: "panel" },
              children: ["tt"],
            },
            tt: { id: "tt", type: "text", value: "Toggle" },
            panel: { id: "panel", type: "box", children: ["pt"] },
            pt: { id: "pt", type: "text", value: "panel content" },
            form: { id: "form", type: "box", children: ["nameF"] },
            nameF: { id: "nameF", type: "input", name: "name", placeholder: "your name" },
            goBtn: {
              id: "goBtn",
              type: "box",
              onPress: { kind: "navigate", to: "about" },
              children: ["gt"],
            },
            gt: { id: "gt", type: "text", value: "Go" },
            about: { id: "about", type: "box", children: ["at"] },
            at: { id: "at", type: "text", value: "about content" },
          },
          screens: { home: "home", about: "about" },
          entry: "home",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
    expect(screen.queryByText("panel content")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(screen.getByText("about content")).toBeTruthy();
    expect(screen.queryByPlaceholderText("your name")).toBeNull();

    expect(onAction).not.toHaveBeenCalled();
  });
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

function pointerEvent(
  type: string,
  coords: { x?: number; y?: number } = {},
  options: { button?: number; isPrimary?: boolean; pointerId?: number } = {},
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    clientX: coords.x ?? 0,
    clientY: coords.y ?? 0,
    // Defaults mirror a real primary-button touch/left-click press; tests for
    // the pointer-button / pointer-identity guards override them explicitly.
    pointerId: options.pointerId ?? 1,
    button: options.button ?? 0,
    isPrimary: options.isPrimary ?? true,
  });
  return event;
}

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
