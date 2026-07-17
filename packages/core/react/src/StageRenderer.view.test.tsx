// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FacetNode, FacetTheme, FacetTree, NodeId, ViewSnapshot } from "@facet/core";
import { DEFAULT_THEME } from "@facet/assets";
import { StageRenderer } from "./StageRenderer.js";
import { MOTION_CLASS_NAMES, STAGE_CROSSFADE_MS } from "./motion.js";

const tree = (nodes: Record<NodeId, FacetNode>, root: NodeId = "root"): FacetTree => ({
  root,
  nodes,
});
const text = (id: NodeId, value: string): FacetNode => ({ id, type: "text", value });
const box = (id: NodeId, children: readonly NodeId[]): FacetNode => ({ id, type: "box", children });
const mountClient = render;

// onViewSnapshot (WU-3, DC-001): the renderer publishes its live view snapshot
// read-only via the optional callback, sampled after commit. A navigate press
// updates `screen`; a toggle press updates `toggled` — both surface through the
// callback without lifting the renderer's private state. Needs the client
// render path (effects), so these use @testing-library/react, not the static
// string renderer above.
describe("StageRenderer onViewSnapshot (jsdom)", () => {
  afterEach(cleanup);

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

  const lastSnapshot = (onViewSnapshot: ReturnType<typeof vi.fn>): ViewSnapshot =>
    onViewSnapshot.mock.calls.at(-1)?.[0] as ViewSnapshot;

  it("publishes the updated screen after a navigate press", () => {
    const onViewSnapshot = vi.fn();
    mountClient(createElement(StageRenderer, { tree: screensTree(), onViewSnapshot }));

    // Fires once on mount with the initial (entry) snapshot.
    expect(onViewSnapshot).toHaveBeenCalled();
    onViewSnapshot.mockClear();

    fireEvent.click(screen.getByRole("button"));

    expect(onViewSnapshot).toHaveBeenCalled();
    expect(lastSnapshot(onViewSnapshot).screen).toBe("about");
  });

  it("publishes the updated toggled record after a toggle press", () => {
    const onViewSnapshot = vi.fn();
    mountClient(
      createElement(StageRenderer, {
        onViewSnapshot,
        tree: tree({
          root: box("root", ["btn", "panel"]),
          btn: {
            id: "btn",
            type: "box",
            onPress: { kind: "toggle", target: "panel" },
            children: [],
          },
          panel: box("panel", ["p"]),
          p: text("p", "panel content"),
        }),
      }),
    );
    onViewSnapshot.mockClear();

    fireEvent.click(screen.getByRole("button"));

    expect(lastSnapshot(onViewSnapshot).toggled).toEqual({ panel: "hidden" });
  });
});

// A box/text brick may carry `activeWhen` (a closed ViewPredicate) while its
// active appearance stays under `style.active`. At render time the renderer evaluates the
// predicate READ-ONLY against the ALREADY-THREADED snapshot view-state
// (`activeScreen` + `visibilityOverrides`) and folds the active look into the
// pure style merge. It writes no view-state and fires no event. Observable via
// `style.active.fontWeight: "bold"` → the text's inline `font-weight:700`.
describe("active look", () => {
  afterEach(cleanup);

  const fontWeightOf = (el: HTMLElement): string => el.style.fontWeight;
  // The box branch folds active tokens into `borderRadius`/`background` — reading
  // `borderRadius` gives a verbatim px string in jsdom (no color normalization).
  const borderRadiusOf = (el: HTMLElement): string => el.style.borderRadius;
  // The rendered box div for a marker text is that text's parent element: a box
  // renders as a `<div style=…>` whose only DOM child (Fragment adds no node) is
  // the marker `<p>`.
  const boxOfMarker = (markerText: string): HTMLElement =>
    screen.getByText(markerText).parentElement as HTMLElement;

  // A two-screen tree carrying ONE persistent banner present on BOTH screen
  // roots. The banner highlights only while the visitor is on `about`.
  const bannerScreensTree = (predicateScreen: string): FacetTree => ({
    root: "root",
    nodes: {
      root: { id: "root", type: "box", children: ["banner", "goAbout"] },
      home: { id: "home", type: "box", children: ["banner", "goAbout"] },
      about: { id: "about", type: "box", children: ["banner", "goHome"] },
      banner: {
        id: "banner",
        type: "text",
        value: "Nav",
        activeWhen: { screen: predicateScreen },
        style: { active: { fontWeight: "bold" } },
      } as FacetNode,
      goAbout: {
        id: "goAbout",
        type: "box",
        onPress: { kind: "navigate", to: "about" },
        children: ["goAboutText"],
      },
      goAboutText: { id: "goAboutText", type: "text", value: "Go about" },
      goHome: {
        id: "goHome",
        type: "box",
        onPress: { kind: "navigate", to: "home" },
        children: ["goHomeText"],
      },
      goHomeText: { id: "goHomeText", type: "text", value: "Go home" },
    },
    screens: { home: "home", about: "about" },
    entry: "home",
  });

  // The box counterpart of `bannerScreensTree`: a persistent BOX carries a
  // box-only active token (`radius`) so the fold is observable as the div's
  // `border-radius`. Exercises the physically-separate `box` render branch, whose
  // active fold is independent of the `text` branch.
  const boxBannerScreensTree = (predicateScreen: string): FacetTree => ({
    root: "root",
    nodes: {
      root: { id: "root", type: "box", children: ["banner", "goAbout"] },
      home: { id: "home", type: "box", children: ["banner", "goAbout"] },
      about: { id: "about", type: "box", children: ["banner", "goHome"] },
      banner: {
        id: "banner",
        type: "box",
        activeWhen: { screen: predicateScreen },
        style: { active: { borderRadius: "lg" } },
        children: ["bannerText"],
      } as FacetNode,
      bannerText: { id: "bannerText", type: "text", value: "BoxBanner" },
      goAbout: {
        id: "goAbout",
        type: "box",
        onPress: { kind: "navigate", to: "about" },
        children: ["goAboutText"],
      },
      goAboutText: { id: "goAboutText", type: "text", value: "Go about" },
      goHome: {
        id: "goHome",
        type: "box",
        onPress: { kind: "navigate", to: "home" },
        children: ["goHomeText"],
      },
      goHomeText: { id: "goHomeText", type: "text", value: "Go home" },
    },
    screens: { home: "home", about: "about" },
    entry: "home",
  });

  // DC-004: a `{screen}` active look tracks the live screen, and a LOCAL navigate
  // MOVES the highlight with ZERO onAction/onRecord (browser view-state only).
  it("moves a {screen} highlight on a local navigate with no transport (DC-004)", () => {
    const onAction = vi.fn();
    const onRecord = vi.fn();
    render(
      <StageRenderer onAction={onAction} onRecord={onRecord} tree={bannerScreensTree("about")} />,
    );

    // On `home`: predicate {screen:about} is false → default look (not bold).
    expect(fontWeightOf(screen.getByText("Nav"))).toBe("400");

    fireEvent.click(screen.getByText("Go about")); // local navigate → about

    // On `about`: predicate true → the active look folds in (font-weight:700).
    expect(fontWeightOf(screen.getByText("Nav"))).toBe("700");
    // Read-only: the highlight move reaches NO agent-routed onAction, and the
    // ONLY record is the navigate press's own pre-existing tap — the active look
    // itself contributes zero additional events.
    expect(onAction).not.toHaveBeenCalled();
    expect(onRecord).toHaveBeenCalledTimes(1);
    expect(onRecord).toHaveBeenCalledWith({
      kind: "tap",
      target: "goAbout",
      effect: { navigate: "about" },
    });
  });

  // DC-004 (RISK-INV-1): during a stage crossfade the INERT previous-screen clone
  // must evaluate its predicate against its OWN captured snapshot screen, never a
  // fresh live read — so it keeps the OLD highlight while animating out (no
  // two-view flash). The banner highlights on `home`; after a root-replacing
  // transition to `about`, the live copy loses the highlight but the exit clone
  // (inside `.stage-previous`) keeps it.
  it("keeps the OLD highlight on the inert exit clone during a crossfade (DC-004)", () => {
    vi.useFakeTimers();
    try {
      const treeHome: FacetTree = {
        root: "root",
        nodes: {
          root: { id: "root", type: "box", children: ["banner"] },
          home: { id: "home", type: "box", children: ["banner"] },
          banner: {
            id: "banner",
            type: "text",
            value: "Nav",
            activeWhen: { screen: "home" },
            style: { active: { fontWeight: "bold" } },
          } as FacetNode,
        },
        screens: { home: "home" },
        entry: "home",
      };
      const treeAbout: FacetTree = {
        root: "aboutRoot",
        nodes: {
          aboutRoot: { id: "aboutRoot", type: "box", children: ["banner"] },
          about: { id: "about", type: "box", children: ["banner"] },
          banner: {
            id: "banner",
            type: "text",
            value: "Nav",
            activeWhen: { screen: "home" },
            style: { active: { fontWeight: "bold" } },
          } as FacetNode,
        },
        screens: { about: "about" },
        entry: "about",
      };
      const { container, rerender } = render(
        <StageRenderer tree={treeHome} transition={{ revision: 0, rootReplaced: false }} />,
      );
      // On `home`: predicate {screen:home} true → highlighted.
      expect(fontWeightOf(screen.getByText("Nav"))).toBe("700");

      // Root-replacing transition to `about` → a stage crossfade renders BOTH the
      // live `about` stage and the inert `home` clone simultaneously.
      rerender(
        <StageRenderer
          tree={treeAbout}
          transition={{ revision: 1, rootReplaced: true, rootReplacedRevision: 1 }}
        />,
      );

      const previous = container.querySelector(`.${MOTION_CLASS_NAMES.stagePrevious}`);
      expect(previous).not.toBeNull();
      const banners = screen.getAllByText("Nav") as HTMLElement[];
      expect(banners).toHaveLength(2);
      const previousBanner = banners.find((el) => previous?.contains(el)) as HTMLElement;
      const liveBanner = banners.find((el) => !previous?.contains(el)) as HTMLElement;
      // The inert exit clone (snapshot.activeScreen === "home") KEEPS the old
      // highlight; the live copy (activeScreen === "about") does not.
      expect(fontWeightOf(previousBanner)).toBe("700");
      expect(fontWeightOf(liveBanner)).toBe("400");

      act(() => {
        vi.advanceTimersByTime(STAGE_CROSSFADE_MS);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  // DC-005: a `{toggled}` active look is active iff that node id is locally
  // toggled-shown — read directly from the raw override map (never-toggled ⇒
  // false), byte-coherent with the reported `view.toggled`.
  it("activates a {toggled} highlight only after the node is toggled-shown (DC-005)", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["toggleBtn", "panel", "marker"] },
          toggleBtn: {
            id: "toggleBtn",
            type: "box",
            onPress: { kind: "toggle", target: "panel" },
            children: ["tt"],
          },
          tt: { id: "tt", type: "text", value: "Toggle" },
          panel: { id: "panel", type: "box", hidden: true, children: ["pt"] },
          pt: { id: "pt", type: "text", value: "panel content" },
          marker: {
            id: "marker",
            type: "text",
            value: "Marker",
            activeWhen: { toggled: "panel" },
            style: { active: { fontWeight: "bold" } },
          } as FacetNode,
        })}
      />,
    );

    // Never toggled: no override entry for "panel" → predicate false → default.
    expect(fontWeightOf(screen.getByText("Marker"))).toBe("400");

    fireEvent.click(screen.getByText("Toggle")); // override panel → true (shown)

    // Now toggled-shown → the marker highlights.
    expect(fontWeightOf(screen.getByText("Marker"))).toBe("700");
    expect(onAction).not.toHaveBeenCalled();
  });

  // DC-006: an unknown/future predicate kind or a dangling screen/nodeId degrades
  // to the DEFAULT look and never throws (future-kind additive-safe).
  it("renders the default look for unknown-kind / dangling predicates (DC-006)", () => {
    const bold = (id: NodeId, value: string, activeWhen: unknown): FacetNode =>
      ({
        id,
        type: "text",
        value,
        activeWhen,
        style: { active: { fontWeight: "bold" } },
      }) as unknown as FacetNode;
    let rendered: ReturnType<typeof render> | undefined;
    expect(() => {
      rendered = render(
        <StageRenderer
          tree={tree({
            root: {
              id: "root",
              type: "box",
              children: ["unknown", "danglingScreen", "danglingTog"],
            },
            unknown: bold("unknown", "UnknownKind", { mystery: "x" }),
            danglingScreen: bold("danglingScreen", "DanglingScreen", { screen: "ghost" }),
            danglingTog: bold("danglingTog", "DanglingToggle", { toggled: "ghost" }),
          })}
        />,
      );
    }).not.toThrow();
    expect(rendered).toBeDefined();
    expect(fontWeightOf(screen.getByText("UnknownKind"))).toBe("400");
    expect(fontWeightOf(screen.getByText("DanglingScreen"))).toBe("400");
    expect(fontWeightOf(screen.getByText("DanglingToggle"))).toBe("400");
  });

  // DC-007: evaluating either binding is READ-ONLY — a pure mount with active
  // bricks + a data-bound text fires NO onAction/onRecord and publishes only the
  // read-only view snapshot (never a view-state write from the render itself).
  it("fires no onAction/onRecord and mutates no view-state on render (DC-007)", () => {
    const onAction = vi.fn();
    const onRecord = vi.fn();
    const onViewSnapshot = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        onRecord={onRecord}
        onViewSnapshot={onViewSnapshot}
        tree={{
          root: "root",
          nodes: {
            root: { id: "root", type: "box", children: ["banner", "bound"] },
            home: { id: "home", type: "box", children: ["banner", "bound"] },
            banner: {
              id: "banner",
              type: "text",
              value: "Nav",
              activeWhen: { screen: "home" },
              style: { active: { fontWeight: "bold" } },
            } as FacetNode,
            bound: {
              id: "bound",
              type: "text",
              value: "INLINE_IGNORED",
              from: "sales",
              column: "revenue",
              row: 0,
            } as FacetNode,
          },
          screens: { home: "home" },
          entry: "home",
          data: { sales: [{ revenue: 100 }] },
        }}
      />,
    );

    // The active look folded in (home is the entry screen) and the store cell
    // projected — both purely at render time.
    expect(fontWeightOf(screen.getByText("Nav"))).toBe("700");
    expect(screen.getByText("100")).toBeTruthy();
    // Render itself wrote to no agent-routed / record channel.
    expect(onAction).not.toHaveBeenCalled();
    expect(onRecord).not.toHaveBeenCalled();
    // The only outward signal is the read-only view snapshot publish.
    expect(onViewSnapshot).toHaveBeenCalled();
  });

  // The BOX active-look fold is a physically-separate branch from the text
  // fold. A `box` carrying a box-only active style (`borderRadius:"lg"`) must
  // gain that token's CSS (`border-radius:16px`) ONLY on the
  // matching screen and lose it after a local navigate away — with ZERO
  // onAction/onRecord beyond the navigate's own tap. Fails if the box branch
  // drops or mis-spreads the active tokens.
  it("folds a box-only active token into the box's border-radius on the matching screen", () => {
    const onAction = vi.fn();
    const onRecord = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        onRecord={onRecord}
        tree={boxBannerScreensTree("about")}
      />,
    );

    // On `home`: predicate {screen:about} is false → default box (no radius).
    expect(borderRadiusOf(boxOfMarker("BoxBanner"))).toBe("0px");

    fireEvent.click(screen.getByText("Go about")); // local navigate → about

    // On `about`: predicate true → the box-only active token folds into the div's
    // own style (radius.lg === "16px").
    expect(borderRadiusOf(boxOfMarker("BoxBanner"))).toBe("16px");
    // Read-only: the highlight move reaches NO agent-routed onAction, and the
    // ONLY record is the navigate press's own tap — the box active fold itself
    // contributes zero additional events.
    expect(onAction).not.toHaveBeenCalled();
    expect(onRecord).toHaveBeenCalledTimes(1);
    expect(onRecord).toHaveBeenCalledWith({
      kind: "tap",
      target: "goAbout",
      effect: { navigate: "about" },
    });
  });

  // An active Preset folds at render for BOTH a box and a text. The `hl`
  // Presets live only in `style.active.preset`, so they apply only while the
  // predicate holds.
  const HIGHLIGHT_ACTIVE_THEME: FacetTheme = {
    ...DEFAULT_THEME,
    name: "hl-theme",
    presets: {
      ...DEFAULT_THEME.presets,
      box: {
        ...DEFAULT_THEME.presets?.box,
        hl: {
          description: "Highlight a box.",
          useWhen: "The active view needs a strong box cue.",
          style: { borderRadius: "lg" },
        },
      },
      text: {
        ...DEFAULT_THEME.presets?.text,
        hl: {
          description: "Highlight text.",
          useWhen: "The active view needs a strong text cue.",
          style: { fontWeight: "bold" },
        },
      },
    },
  };

  const activePresetTree = (predicateScreen: string): FacetTree => ({
    root: "root",
    nodes: {
      root: { id: "root", type: "box", children: ["avBox", "avText", "goAbout"] },
      home: { id: "home", type: "box", children: ["avBox", "avText", "goAbout"] },
      about: { id: "about", type: "box", children: ["avBox", "avText", "goHome"] },
      avBox: {
        id: "avBox",
        type: "box",
        activeWhen: { screen: predicateScreen },
        style: { active: { preset: "hl" } },
        children: ["avBoxText"],
      } as FacetNode,
      avBoxText: { id: "avBoxText", type: "text", value: "AvBox" },
      avText: {
        id: "avText",
        type: "text",
        value: "AvText",
        activeWhen: { screen: predicateScreen },
        style: { active: { preset: "hl" } },
      } as FacetNode,
      goAbout: {
        id: "goAbout",
        type: "box",
        onPress: { kind: "navigate", to: "about" },
        children: ["goAboutText"],
      },
      goAboutText: { id: "goAboutText", type: "text", value: "Go about" },
      goHome: {
        id: "goHome",
        type: "box",
        onPress: { kind: "navigate", to: "home" },
        children: ["goHomeText"],
      },
      goHomeText: { id: "goHomeText", type: "text", value: "Go home" },
    },
    screens: { home: "home", about: "about" },
    entry: "home",
  });

  it("resolves active Presets for box AND text on the matching screen", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        theme={HIGHLIGHT_ACTIVE_THEME}
        tree={activePresetTree("about")}
      />,
    );

    // On `home`: predicate false → neither node resolves its `hl` Preset (no base
    // Preset, so the base look is the plain default).
    expect(borderRadiusOf(boxOfMarker("AvBox"))).toBe("0px");
    expect(fontWeightOf(screen.getByText("AvText"))).toBe("400");

    fireEvent.click(screen.getByText("Go about")); // local navigate → about

    // On `about`: predicate true → each node folds ITS Brick's `hl` Preset
    // (box → radius.lg "16px"; text → weight bold "700").
    expect(borderRadiusOf(boxOfMarker("AvBox"))).toBe("16px");
    expect(fontWeightOf(screen.getByText("AvText"))).toBe("700");
    // Read-only: resolving the active style fires no agent-routed action.
    expect(onAction).not.toHaveBeenCalled();
  });
});

// DC-005 structural fence: the only stage-write setters live inside handlePress.
// No ServerMessage/patch path may write view state, so `setCurrentScreen(` and
// `setVisibilityOverrides(` must appear ONLY within the handlePress body — read
// the source as text and prove no call site exists outside it.
describe("StageRenderer view-state setter fence (DC-005)", () => {
  it("setCurrentScreen/setVisibilityOverrides are called only within handlePress", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "StageRenderer.tsx"),
      "utf8",
    );
    const start = src.indexOf("const handlePress");
    const end = src.indexOf("const appearSeen", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const body = src.slice(start, end);
    const outside = src.slice(0, start) + src.slice(end);
    for (const setter of ["setCurrentScreen(", "setVisibilityOverrides("]) {
      expect(body).toContain(setter);
      expect(outside).not.toContain(setter);
    }
  });
});
