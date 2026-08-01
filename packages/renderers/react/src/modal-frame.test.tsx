// @vitest-environment jsdom
/**
 * The proof that the one sanctioned overlap is the framework's, that containment
 * does not defeat it, and that everything shared between two open modals is
 * derived from one session-scoped ordered list.
 *
 * Six claims carry this file.
 *
 * **The frame escapes containment by portal, not by position.** Every mounted
 * subtree sits inside an `isolation: isolate` element, so a frame that placed
 * itself where the `Modal` node sits would be confined to that ancestor's
 * stacking context and paint below any later sibling subtree — however large a
 * `z-index` it wrote. The nesting case is therefore asserted here rather than
 * discovered at integration, and it is asserted **through the real mount seam**:
 * a `Modal` node declared inside a `Card` inside a `Grid`, mounted by
 * `MountNode` and routed through `renderModal`, opened beside a later sibling
 * subtree whose registered component paints itself at `z-index: 99999`. jsdom
 * does not paint, so the assertions are written where the guarantee actually
 * lives — the dialog's DOM parent, an ancestor walk that finds no containment
 * and no isolated element above it, the document order of the two subtrees, and
 * two `z-index` values compared numerically against each other rather than
 * against a constant this file also supplies.
 *
 * **Nothing renders in place, ever — including for the one commit before the
 * portal target exists.** `useOverlayRoot` answers `null` for exactly one commit
 * while the provider's ref attaches, and the frame renders no scrim and no
 * dialog anywhere for that commit. That branch cannot be reached through the
 * real provider — opening the modal requires a click, which lands many commits
 * after the ref attached — so the suite withholds the target through an
 * out-of-band switch on a partial mock of `containment.js` whose
 * `useOverlayRoot` still calls the real hook and then hides its answer. A
 * post-settle read of the DOM cannot tell "rendered nothing" from "never
 * opened", so the modal's own content counts its renders and the trigger's
 * `aria-expanded` anchors that the state really did change. Every other test in
 * this file runs against the real implementation, and the mock's own honesty is
 * asserted by the control beside it.
 *
 * **Everything shared is derived from one ordered list, and the list is
 * session-scoped.** Topmost-only Escape, topmost-only scrim close, the paint
 * order of two open dialogs, and the body scroll lock are all read off the same
 * `ModalHost` list — so the suite opens two modals in an order that disagrees
 * with both their document order and their id order, and states which one Escape
 * takes and which one paints on top. Two independent hosts on one page are
 * mounted together: with a module-level open list, the second host's first modal
 * would stack on the first host's, and one Escape would reach only one of them.
 * The scroll lock still coordinates through the shared page body: the first lock
 * saves the visitor's `overflow`, a later host never overwrites that restore
 * value with the lock's own value, and the restore happens only after the last
 * host unlocks.
 *
 * **The frame owns the whole dialog surface, and paints it from the theme.** A
 * custom conforming `Modal` supplies flow content only, so the background, the
 * padding, the radius, the shadow and the type all belong to the frame — pushing
 * them into `@facet/assets` would leave a host's own `Modal` frameless (DC-017),
 * and `@facet/react` may not import that package at all. The chrome is asserted
 * under two different themes: the same Core-owned custom-property names are
 * referenced both times, the values behind them differ, no reference carries a
 * fallback, and every `--facet-*` name the frame emits or reads is one
 * `themeToCssVars` actually projects.
 *
 * **The visible dismiss control is the framework's, not the author's.** Escape
 * and the scrim are not reachable by touch and are not discoverable, so the
 * frame draws a `Close` button. Its accessible name and its glyph are fixed in
 * the framework: a props record carrying a competing `closeLabel` changes
 * nothing, and the frame still asks that record about exactly two keys. It adds
 * no fourth neutral state — `NeutralCopy` stays the three-state bijection it is.
 *
 * **Opening and closing write nothing.** The frame holds no document, no patch
 * builder and no action seam, so its state cannot race a document write: through
 * the real mount seam, a full open/close cycle leaves the document byte-identical
 * and never reaches `onAction`, and the source scan states the absence as a
 * property of the file — including that it holds no module-level open stack for
 * a second session to share.
 *
 * The suite reads `node:fs` for that scan, the same exception
 * `containment.test.ts` and `error-boundary.test.tsx` take, and builds the path
 * with `fileURLToPath` because under jsdom `new URL(file, import.meta.url)`
 * resolves against `http://localhost:3000/` rather than against the file it
 * stands in.
 */

import { NEUTRAL_COPY_DEFAULTS, themeToCssVars } from "@facet/core";
import type {
  ComponentDocument,
  ComponentMountProps,
  ComponentNode,
  ComponentSpec,
  FacetTheme,
} from "@facet/core";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DataProvider } from "./binding.js";
import {
  CONTAINMENT_ATTRIBUTE,
  Containment,
  OVERLAY_ROOT_ATTRIBUTE,
  OVERLAY_Z_BAND,
  OverlayRootProvider,
} from "./containment.js";
import { createFieldStore } from "./field-store.js";
import { MODAL_PART_ATTRIBUTE, ModalFrame, ModalHost } from "./modal-frame.js";
import { MountNode } from "./mount-node.js";
import type { ModalMountRequest, MountContext } from "./mount-node.js";
import type { ComponentRegistry } from "./registry.js";
import { errorsDuring } from "../../../../test-support/errors-during.js";

/**
 * The switch the withheld-target tests flip. `vi.hoisted` is what lets the mock
 * factory — which vitest lifts above every import — see a value this file
 * declares, and an out-of-band switch is the only way to state a claim about a
 * commit that a settled DOM read cannot see.
 */
const overlayRoot = vi.hoisted(() => ({ withheld: false }));

vi.mock("./containment.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./containment.js")>();
  return {
    ...actual,
    // The real hook still runs: the provider requirement, the context read and
    // the hook order are all unchanged, and only the answer is hidden. A mock
    // that returned `null` without calling through would be testing itself.
    useOverlayRoot: (): HTMLElement | null => {
      const target = actual.useOverlayRoot();
      return overlayRoot.withheld ? null : target;
    },
  };
});

afterEach(() => {
  cleanup();
  overlayRoot.withheld = false;
  document.body.style.overflow = "";
  contentRenders.length = 0;
  childProps.length = 0;
  actions.length = 0;
});

const TRIGGER_LABEL = "Edit budget";
const TITLE = "Edit the monthly budget";

/** The framework's own dismiss chrome. Fixed here so a drifted glyph is visible. */
const DISMISS_NAME = "Close";
const DISMISS_GLYPH = "×";

// ── The two themes every chrome assertion is made under ──────────────────────
// Two complete, disjoint themes rather than one: a frame that hardcoded a colour
// looks correct under a single theme, and only a second set of values makes the
// projection observable as a projection.

const THEME: FacetTheme = {
  color: {
    background: "#f7f7f7",
    surface: "#ffffff",
    border: "#dcdcdc",
    text: "#101010",
    textMuted: "#6b6b6b",
    accent: "#1d4ed8",
    onAccent: "#ffffff",
    success: "#15803d",
    warning: "#b45309",
    danger: "#b91c1c",
  },
  space: { xs: "0.25rem", sm: "0.5rem", md: "0.75rem", lg: "1rem", xl: "1.5rem" },
  radius: { sm: "2px", md: "6px", lg: "12px", full: "9999px" },
  borderWidth: { thin: "1px", thick: "2px" },
  shadow: {
    sm: "0 1px 2px rgba(0, 0, 0, 0.08)",
    md: "0 4px 8px rgba(0, 0, 0, 0.1)",
    lg: "0 12px 32px rgba(0, 0, 0, 0.2)",
  },
  fontFamily: { sans: "Inter, sans-serif", mono: "Menlo, monospace" },
  fontSize: { xs: "0.75rem", sm: "0.875rem", md: "1rem", lg: "1.25rem", xl: "1.75rem" },
  fontWeight: { regular: "400", medium: "500", bold: "700" },
  lineHeight: { tight: "1.2", normal: "1.5", relaxed: "1.7" },
};

const DARK_THEME: FacetTheme = {
  color: {
    background: "#0b0b0f",
    surface: "#17171d",
    border: "#33333d",
    text: "#f2f2f5",
    textMuted: "#9a9aa6",
    accent: "#7dd3fc",
    onAccent: "#04121b",
    success: "#4ade80",
    warning: "#fbbf24",
    danger: "#f87171",
  },
  space: { xs: "0.2rem", sm: "0.45rem", md: "0.7rem", lg: "1.1rem", xl: "1.6rem" },
  radius: { sm: "3px", md: "7px", lg: "14px", full: "8888px" },
  borderWidth: { thin: "2px", thick: "4px" },
  shadow: {
    sm: "0 1px 3px rgba(0, 0, 0, 0.5)",
    md: "0 5px 9px rgba(0, 0, 0, 0.6)",
    lg: "0 14px 36px rgba(0, 0, 0, 0.7)",
  },
  fontFamily: { sans: "Iosevka Aile, sans-serif", mono: "Iosevka, monospace" },
  fontSize: { xs: "0.7rem", sm: "0.8rem", md: "0.95rem", lg: "1.2rem", xl: "1.7rem" },
  fontWeight: { regular: "350", medium: "550", bold: "750" },
  lineHeight: { tight: "1.1", normal: "1.45", relaxed: "1.8" },
};

/** The projection itself, from Core. The frame may name no property outside it. */
const THEME_VARS = themeToCssVars(THEME);
const DARK_VARS = themeToCssVars(DARK_THEME);

/** The conforming `Modal` schema's two projected strings, plus anything a test adds. */
function modalProps(
  overrides: Readonly<Record<string, string | number>> = {},
): ComponentMountProps["props"] {
  return { triggerLabel: TRIGGER_LABEL, title: TITLE, ...overrides };
}

/**
 * A props record that records every key the frame asks it about.
 *
 * Asserting on the *reads* rather than on the fixture's contents is what makes
 * "the frame consumes only its two projected strings" a real claim: a frame that
 * reached for a coordinate, or for its own dismiss label, is caught whether or
 * not this file thought to put that key in the fixture.
 *
 * All four traps matter, and three of them were learned by mutation. A total
 * read starts with `Object.hasOwn`, which is the **`getOwnPropertyDescriptor`**
 * trap and not `has` — so a proxy watching only `get`/`has` sees nothing at all
 * when the frame probes a key the backing record does not carry, which is
 * exactly the coordinate case this test exists for. `ownKeys` covers the other
 * escape: a frame that enumerated the record would read every key without
 * naming any.
 */
function recordingProps(read: string[]): ComponentMountProps["props"] {
  const backing: Record<string, unknown> = {
    triggerLabel: TRIGGER_LABEL,
    title: TITLE,
    // A content prop that belongs to the registered component, two shapes of
    // coordinate, and a competing name for the frame's own dismiss control — so
    // a read is caught whether or not the key is present.
    description: "Set the ceiling for this month.",
    width: 480,
    maxHeight: "20rem",
    closeLabel: "Dismiss",
  };
  return new Proxy(backing, {
    get(target, key: string | symbol): unknown {
      if (typeof key === "string") {
        read.push(key);
      }
      return Reflect.get(target, key);
    },
    has(target, key: string | symbol): boolean {
      if (typeof key === "string") {
        read.push(key);
      }
      return Reflect.has(target, key);
    },
    getOwnPropertyDescriptor(target, key: string | symbol): PropertyDescriptor | undefined {
      if (typeof key === "string") {
        read.push(key);
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    ownKeys(target): ArrayLike<string | symbol> {
      read.push("(enumerated)");
      return Reflect.ownKeys(target);
    },
  }) as ComponentMountProps["props"];
}

/** Props one mounted child actually received, so an injected value is visible. */
const childProps: Record<string, unknown>[] = [];

/** Every action the mount context was asked to report, in order. */
const actions: string[] = [];

/**
 * Every render of the modal's content, in order.
 *
 * The counter is what lets "renders nothing at all for that commit" be a claim
 * rather than a hope: a DOM read after the dust settles cannot tell a frame that
 * rendered nothing from a frame that never opened, and both leave an empty
 * container behind.
 */
const contentRenders: string[] = [];

/**
 * Stands in for the mounted `Modal` implementation. A local stub on purpose:
 * `@facet/react` must import nothing from `@facet/assets`, and what this suite
 * needs from a `Modal` is flow content with two focusable stops in it.
 */
function Content(props: { readonly label: string }): ReactNode {
  childProps.push({ ...props });
  contentRenders.push(props.label);
  return (
    <div data-testid="modal-content">
      <button type="button" data-testid="content-first">
        {props.label}
      </button>
      <button type="button" data-testid="content-second">
        Save
      </button>
    </div>
  );
}

/** A registered component that paints itself above everything it can reach. */
function Rogue(): ReactNode {
  return <div data-testid="rogue" style={{ position: "fixed", zIndex: 99_999 }} />;
}

function part(name: string): HTMLElement | null {
  return document.querySelector(`[${MODAL_PART_ATTRIBUTE}="${name}"]`);
}

function partsOf(name: string): readonly HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[${MODAL_PART_ATTRIBUTE}="${name}"]`)];
}

function requirePart(name: string): HTMLElement {
  const element = part(name);
  if (element === null) {
    throw new Error(`the frame rendered no ${name}`);
  }
  return element;
}

/** Every ancestor of `element`, nearest first, up to and including `<html>`. */
function ancestorsOf(element: Element): readonly Element[] {
  const chain: Element[] = [];
  let walk = element.parentElement;
  while (walk !== null) {
    chain.push(walk);
    walk = walk.parentElement;
  }
  return chain;
}

function isIsolated(element: Element): boolean {
  return globalThis.getComputedStyle(element).isolation === "isolate";
}

function zIndexOf(element: Element): number {
  return Number(globalThis.getComputedStyle(element).zIndex);
}

/** One frame under a real host and a real overlay root, the way a screen mounts it. */
function mountFrame(
  props: ComponentMountProps["props"] = modalProps(),
  themeVars: Readonly<Record<string, string>> = THEME_VARS,
  children: ReactNode = <Content label="Adjust" />,
): ReturnType<typeof render> {
  return render(
    <ModalHost>
      <OverlayRootProvider>
        <Containment>
          <ModalFrame nodeId="n-modal" props={props} themeVars={themeVars}>
            {children}
          </ModalFrame>
        </Containment>
      </OverlayRootProvider>
    </ModalHost>,
  );
}

/**
 * Two frames under one host, opened **against** both orders that could stand in
 * for the open order: `alpha` is first in the document and first by id, and it
 * is opened second. Every claim about "the topmost" below therefore fails for a
 * list that is DOM-ordered, id-ordered, or unordered.
 */
function mountTwo(): void {
  render(
    <ModalHost>
      <OverlayRootProvider>
        <Containment>
          <ModalFrame
            nodeId="alpha"
            props={modalProps({ triggerLabel: "Alpha", title: "The alpha" })}
            themeVars={THEME_VARS}
          >
            <Content label="Alpha body" />
          </ModalFrame>
        </Containment>
        <Containment>
          <ModalFrame
            nodeId="zeta"
            props={modalProps({ triggerLabel: "Zeta", title: "The zeta" })}
            themeVars={THEME_VARS}
          >
            <Content label="Zeta body" />
          </ModalFrame>
        </Containment>
      </OverlayRootProvider>
    </ModalHost>,
  );
  openTrigger("Zeta");
  openTrigger("Alpha");
}

/** Clicks the trigger whose label is `label`; throws when the fixture has none. */
function openTrigger(label: string): void {
  const trigger = partsOf("trigger").find((candidate) => candidate.textContent === label);
  if (trigger === undefined) {
    throw new Error(`no trigger labelled ${label}`);
  }
  fireEvent.click(trigger);
}

function openTheModal(): void {
  fireEvent.click(requirePart("trigger"));
}

/** The dialog whose heading reads `title`, so two open frames stay tellable apart. */
function frameTitled(title: string): HTMLElement {
  const heading = partsOf("title").find((candidate) => candidate.textContent === title);
  const frame = heading?.closest(`[${MODAL_PART_ATTRIBUTE}="frame"]`);
  if (!(frame instanceof HTMLElement)) {
    throw new Error(`no open dialog titled ${title}`);
  }
  return frame;
}

/**
 * The scrim that belongs to the dialog whose heading reads `title`.
 *
 * Read as the dialog's immediately preceding sibling, which also pins the pair:
 * one frame's scrim can only ever be the one rendered beside it, so a suite with
 * two open modals cannot accidentally assert one dialog's order against the
 * other's overlay.
 */
function scrimOf(title: string): HTMLElement {
  const scrim = frameTitled(title).previousElementSibling;
  if (!(scrim instanceof HTMLElement) || scrim.getAttribute(MODAL_PART_ATTRIBUTE) !== "scrim") {
    throw new Error(`no scrim beside the dialog titled ${title}`);
  }
  return scrim;
}

describe("the trigger, which is the only thing the frame puts in flow", () => {
  it("renders the authored trigger label and nothing else while the modal is closed", () => {
    mountFrame();
    const trigger = requirePart("trigger");

    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger.getAttribute("type")).toBe("button");
    expect(trigger.textContent).toBe(TRIGGER_LABEL);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(part("frame")).toBeNull();
    expect(part("scrim")).toBeNull();
    expect(part("dismiss")).toBeNull();
    expect(contentRenders).toEqual([]);
  });

  it("asks the props record about exactly two keys, present or absent", () => {
    const read: string[] = [];
    render(
      <ModalHost>
        <OverlayRootProvider>
          <ModalFrame nodeId="n-modal" props={recordingProps(read)} themeVars={THEME_VARS}>
            <Content label="Adjust" />
          </ModalFrame>
        </OverlayRootProvider>
      </ModalHost>,
    );
    openTheModal();

    expect(read.length).toBeGreaterThan(0);
    expect([...new Set(read)].sort()).toEqual(["title", "triggerLabel"]);
  });

  it("renders no trigger at all when the label is unusable, so the overlap cannot open", () => {
    // Registration conformance and prop resolution both make this unreachable
    // from an accepted document. If it happens anyway, the safe direction is no
    // control rather than a control with no name — and no way to open an
    // overlay whose chrome the frame could not render.
    //
    // Both frames are mounted together on purpose: "no trigger" asserted on its
    // own is satisfied by a frame that renders nothing at all, so the usable
    // sibling is what makes the absence mean what it says.
    render(
      <ModalHost>
        <OverlayRootProvider>
          <Containment>
            <ModalFrame
              nodeId="unnamed"
              props={modalProps({ triggerLabel: "   " })}
              themeVars={THEME_VARS}
            >
              <Content label="Unnamed" />
            </ModalFrame>
          </Containment>
          <Containment>
            <ModalFrame
              nodeId="named"
              props={modalProps({ triggerLabel: "Usable" })}
              themeVars={THEME_VARS}
            >
              <Content label="Named" />
            </ModalFrame>
          </Containment>
        </OverlayRootProvider>
      </ModalHost>,
    );

    expect(partsOf("trigger").map((trigger) => trigger.textContent)).toEqual(["Usable"]);
    expect(part("frame")).toBeNull();
    expect(document.body.textContent).not.toContain(TITLE);
  });
});

describe("opening, which happens outside every containment element", () => {
  it("portals the dialog into the overlay root rather than rendering it in place", () => {
    const view = mountFrame();
    openTheModal();
    const dialog = requirePart("frame");

    expect(dialog.parentElement?.hasAttribute(OVERLAY_ROOT_ATTRIBUTE)).toBe(true);
    expect(requirePart("scrim").parentElement).toBe(dialog.parentElement);
    // The trigger stayed where the node sits and the dialog did not: the two are
    // read off the same containment element, so "it moved" is a comparison
    // rather than an absence somewhere else in the document.
    const containment = view.container.querySelector(`[${CONTAINMENT_ATTRIBUTE}]`) as Element;
    expect(containment.contains(requirePart("trigger"))).toBe(true);
    expect(containment.contains(dialog)).toBe(false);
  });

  it("has no containment element and no isolated element among the dialog's ancestors", () => {
    mountFrame();
    openTheModal();

    expect(document.querySelectorAll(`[${CONTAINMENT_ATTRIBUTE}]`).length).toBeGreaterThan(0);
    for (const element of [requirePart("frame"), requirePart("scrim")]) {
      for (const ancestor of ancestorsOf(element)) {
        expect(ancestor.hasAttribute(CONTAINMENT_ATTRIBUTE)).toBe(false);
        expect(isIsolated(ancestor)).toBe(false);
      }
    }
  });

  it("orders its scrim under its own dialog and emits no stacking outside the band", () => {
    mountFrame();
    openTheModal();
    const scrim = requirePart("scrim");
    const dialog = requirePart("frame");

    // Measured against each other: a swapped pair fails here with no constant
    // involved, which is the failure this ordering exists to prevent.
    expect(zIndexOf(scrim)).toBeLessThan(zIndexOf(dialog));
    expect(zIndexOf(scrim)).toBe(OVERLAY_Z_BAND.scrim);
    expect(zIndexOf(dialog)).toBe(OVERLAY_Z_BAND.frame);
    expect(globalThis.getComputedStyle(dialog).position).toBe("fixed");
    expect(globalThis.getComputedStyle(scrim).position).toBe("fixed");
  });
});

/**
 * The nesting case, through the seam that actually routes it.
 *
 * A hand-composed `<ModalFrame>` proves the frame; it does not prove that a
 * `Modal` **node**, resolved and mounted three containment elements deep, still
 * reaches the overlay root. So this fixture is a document: `MountNode` walks it,
 * `mountOrFallback` wraps every level in containment, and the seam hands the
 * node's content to the frame exactly as the renderer will.
 */
describe("a Modal node declared inside a Card inside a Grid", () => {
  const SPECS: readonly ComponentSpec[] = [
    {
      tag: "Screen",
      whenToUse: "A screen root.",
      props: { name: { type: "string", required: true, guidance: "The screen name." } },
      acceptsChildren: true,
    },
    { tag: "Grid", whenToUse: "A layout container.", props: {}, acceptsChildren: true },
    { tag: "Card", whenToUse: "A surface.", props: {}, acceptsChildren: true },
    {
      tag: "Rogue",
      whenToUse: "A registered component that tries to escape its stacking context.",
      props: {},
      acceptsChildren: false,
    },
    {
      tag: "Modal",
      whenToUse: "The one overlap primitive: flow content the framework frame carries.",
      props: {
        triggerLabel: { type: "string", required: true, guidance: "What opens it." },
        title: { type: "string", required: true, guidance: "The dialog's name." },
      },
      acceptsChildren: true,
    },
  ];

  const INDEX: ReadonlyMap<string, ComponentSpec> = new Map(SPECS.map((spec) => [spec.tag, spec]));

  function Passthrough(testId: string): (mount: ComponentMountProps<ReactNode>) => ReactNode {
    return function Impl({ children }: ComponentMountProps<ReactNode>): ReactNode {
      return <div data-testid={testId}>{children}</div>;
    };
  }

  function ModalImpl({ props }: ComponentMountProps<ReactNode>): ReactNode {
    return <Content label={String(props["title"] ?? "")} />;
  }

  const REGISTRY: ComponentRegistry = Object.freeze({
    Screen: Passthrough("screen"),
    Grid: Passthrough("grid"),
    Card: Passthrough("card"),
    Rogue,
    Modal: ModalImpl,
  });

  function scalar(value: string): ComponentNode["props"][string] {
    return { kind: "scalar", value };
  }

  const DOCUMENT: ComponentDocument = Object.freeze({
    entry: "home",
    screens: ["n1"],
    nodes: {
      n1: { tag: "Screen", props: { name: scalar("home") }, children: ["n2", "n5"] },
      n2: { tag: "Grid", props: {}, children: ["n3"] },
      n3: { tag: "Card", props: {}, children: ["n4"] },
      n4: {
        tag: "Modal",
        props: { triggerLabel: scalar(TRIGGER_LABEL), title: scalar(TITLE) },
        children: [],
      },
      // The later sibling: a whole subtree that paints itself as high as it can.
      n5: { tag: "Rogue", props: {}, children: [] },
    },
  });

  const context: MountContext = {
    document: DOCUMENT,
    index: INDEX,
    registry: REGISTRY,
    themeVars: THEME_VARS,
    copy: NEUTRAL_COPY_DEFAULTS,
    store: createFieldStore(),
    onAction: (nodeId: string, prop: string): void => {
      actions.push(`${nodeId}:${prop}`);
    },
    renderModal: (request: ModalMountRequest): ReactNode => (
      <ModalFrame nodeId={request.nodeId} props={request.props} themeVars={THEME_VARS}>
        {request.content}
      </ModalFrame>
    ),
  };

  function mountDocument(): ReturnType<typeof render> {
    return render(
      <ModalHost>
        <OverlayRootProvider>
          <DataProvider model={{}}>
            <MountNode context={context} nodeId="n1" />
          </DataProvider>
        </OverlayRootProvider>
      </ModalHost>,
    );
  }

  it("really is three containment elements deep, beside a really elevated sibling", () => {
    // The anchor. Every claim below is about a modal that is nested and a
    // sibling that is elevated; a fixture that produced neither would make all
    // of them green for the wrong reason.
    mountDocument();
    const trigger = requirePart("trigger");
    const rogue = document.querySelector('[data-testid="rogue"]') as Element;

    expect(document.querySelector('[data-testid="card"]')?.contains(trigger)).toBe(true);
    expect(document.querySelector('[data-testid="grid"]')?.contains(trigger)).toBe(true);
    expect(ancestorsOf(trigger).filter((a) => a.hasAttribute(CONTAINMENT_ATTRIBUTE)).length) //
      .toBeGreaterThanOrEqual(3);
    expect(zIndexOf(rogue)).toBe(99_999);
    expect(ancestorsOf(rogue).some((a) => a.hasAttribute(CONTAINMENT_ATTRIBUTE) && isIsolated(a))) //
      .toBe(true);
  });

  it("paints above that later sibling once opened, from the overlay root", () => {
    mountDocument();
    openTheModal();
    const dialog = requirePart("frame");
    const rogue = document.querySelector('[data-testid="rogue"]') as Element;
    const root = dialog.parentElement as Element;

    expect(root.hasAttribute(OVERLAY_ROOT_ATTRIBUTE)).toBe(true);
    for (const ancestor of ancestorsOf(dialog)) {
      expect(ancestor.hasAttribute(CONTAINMENT_ATTRIBUTE)).toBe(false);
      expect(isIsolated(ancestor)).toBe(false);
    }
    // The rogue's number is resolved inside a stacking context it cannot leave;
    // the dialog's context is the overlay root, which is in no such context — so
    // these two numbers are compared in the same context, and the comparison is
    // between two measured values rather than against a constant.
    expect(zIndexOf(root)).toBeGreaterThan(zIndexOf(rogue));
    // Equal z-index would still resolve by document order, and the root is last.
    const position = rogue.compareDocumentPosition(root);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // And the content the seam handed over is inside the dialog, not in flow.
    const content = document.querySelector('[data-testid="modal-content"]') as Element;
    expect(dialog.contains(content)).toBe(true);
    expect(document.querySelector('[data-testid="card"]')?.contains(content)).toBe(false);
  });

  it("emits no patch and reaches no action seam across a whole open/close cycle", () => {
    const before = JSON.stringify(DOCUMENT);
    mountDocument();
    openTheModal();
    expect(part("frame")).not.toBeNull();
    fireEvent.click(requirePart("dismiss"));

    expect(part("frame")).toBeNull();
    expect(actions).toEqual([]);
    expect(JSON.stringify(DOCUMENT)).toBe(before);
  });
});

describe("the one commit before the portal target is attached", () => {
  it("renders nothing at all rather than falling back into the flow it exists to leave", () => {
    overlayRoot.withheld = true;
    const view = mountFrame();
    openTheModal();

    // The state really did change: the branch under test is the target, not the
    // click. A frame that rendered in place would satisfy this and fail the rest.
    expect(requirePart("trigger").getAttribute("aria-expanded")).toBe("true");
    expect(part("frame")).toBeNull();
    expect(part("scrim")).toBeNull();
    expect(part("dismiss")).toBeNull();
    // And the content was never rendered anywhere at all — which a DOM read
    // after the fact cannot distinguish from a modal that never opened.
    expect(contentRenders).toEqual([]);
    expect(view.container.querySelector('[data-testid="modal-content"]')).toBeNull();
    expect(document.querySelector('[data-testid="modal-content"]')).toBeNull();
  });

  it("renders the dialog again once the target is there, so the withholding is the cause", () => {
    // The control. With the switch off, the identical steps produce a dialog and
    // the content renders; without this, the test above would pass against a
    // frame that never opened at all.
    mountFrame();
    openTheModal();

    expect(part("frame")).not.toBeNull();
    expect(contentRenders.length).toBeGreaterThan(0);
  });
});

describe("what the frame draws around the content it was handed", () => {
  it("names the dialog with the authored title and prints it exactly once", () => {
    mountFrame();
    openTheModal();
    const dialog = requirePart("frame");
    const heading = requirePart("title");

    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(heading.id.length).toBeGreaterThan(0);
    expect(dialog.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(heading.textContent).toBe(TITLE);
    expect(partsOf("title").length).toBe(1);
    // The trigger's string is the trigger's, and stays out of the dialog.
    expect(dialog.textContent).not.toContain(TRIGGER_LABEL);
    expect(requirePart("trigger").textContent).not.toContain(TITLE);
  });

  it("draws a visible dismiss control the author neither named nor supplied", () => {
    // Escape and the scrim are not reachable by touch, are not discoverable, and
    // are not what a screen reader announces. The button is the frame's own: the
    // props record carries a competing `closeLabel` and it changes nothing.
    mountFrame(modalProps({ closeLabel: "Dismiss" }));
    openTheModal();
    const dismiss = requirePart("dismiss");

    expect(dismiss.tagName).toBe("BUTTON");
    expect(dismiss.getAttribute("type")).toBe("button");
    expect(dismiss.getAttribute("aria-label")).toBe(DISMISS_NAME);
    expect(dismiss.textContent).toBe(DISMISS_GLYPH);
    expect(dismiss.textContent).not.toBe("x");
    expect(requirePart("frame").contains(dismiss)).toBe(true);
  });

  it("closes on the dismiss control and returns focus to the trigger", () => {
    mountFrame();
    openTheModal();
    fireEvent.click(requirePart("dismiss"));

    expect(part("frame")).toBeNull();
    expect(document.activeElement).toBe(requirePart("trigger"));
  });

  it("adds no fourth neutral state to the framework's three", () => {
    // The dismiss control's name is framework chrome, not a render neutral state,
    // and `NeutralCopy` stays the exact bijection it is.
    expect(Object.keys(NEUTRAL_COPY_DEFAULTS.render).sort()).toEqual([
      "componentUnavailable",
      "corruptSubtree",
      "preparing",
    ]);
    expect(Object.values(NEUTRAL_COPY_DEFAULTS.render)).not.toContain(DISMISS_NAME);
  });

  it("hides the scrim from assistive technology and leaves the dialog visible to it", () => {
    mountFrame();
    openTheModal();

    expect(requirePart("scrim").getAttribute("aria-hidden")).toBe("true");
    expect(requirePart("frame").hasAttribute("aria-hidden")).toBe(false);
  });

  it("injects nothing into the mounted subtree", () => {
    mountFrame();
    openTheModal();

    expect(childProps.length).toBeGreaterThan(0);
    for (const received of childProps) {
      expect(Object.keys(received).sort()).toEqual(["label"]);
    }
  });
});

describe("the dialog surface, which the framework paints from the theme", () => {
  /** Every `--facet-*` custom property the element declares, with its value. */
  function declaredVars(element: HTMLElement): Record<string, string> {
    const declared: Record<string, string> = {};
    for (let index = 0; index < element.style.length; index += 1) {
      const name = element.style.item(index);
      if (name.startsWith("--")) {
        declared[name] = element.style.getPropertyValue(name);
      }
    }
    return declared;
  }

  /** Every custom property the element's own declarations *reference*. */
  function referencedVars(element: HTMLElement): readonly string[] {
    const style = element.getAttribute("style") ?? "";
    return [...style.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1] ?? "");
  }

  /** Every part of the frame that carries a style attribute of its own. */
  const CHROME = ["frame", "header", "title", "dismiss"];

  it("declares the complete projection on the dialog, and projects it exactly once", () => {
    mountFrame();
    openTheModal();

    expect(declaredVars(requirePart("frame"))).toEqual({ ...THEME_VARS });
    expect(Object.keys(THEME_VARS).length).toBeGreaterThan(30);
    // The dialog is the surface root, and the only element that declares them:
    // a second projection further down would be a second answer to the same
    // question the moment a host's theme changed.
    for (const name of ["header", "title", "dismiss", "scrim"]) {
      expect(declaredVars(requirePart(name))).toEqual({});
    }
  });

  it("references those names in its own chrome, and invents none of them", () => {
    mountFrame();
    openTheModal();
    const referenced = CHROME.flatMap((name) => referencedVars(requirePart(name)));

    expect(referenced.length).toBeGreaterThan(0);
    for (const name of referenced) {
      expect(Object.keys(THEME_VARS)).toContain(name);
    }
    // The surface a custom conforming Modal would otherwise have to draw itself.
    const dialog = requirePart("frame");
    expect(dialog.style.background).toBe("var(--facet-color-surface)");
    expect(dialog.style.color).toBe("var(--facet-color-text)");
    expect(dialog.style.padding).toBe("var(--facet-space-lg)");
    expect(dialog.style.borderRadius).toBe("var(--facet-radius-lg)");
    expect(dialog.style.boxShadow).toBe("var(--facet-shadow-lg)");
    expect(requirePart("dismiss").style.color).toBe("var(--facet-color-text-muted)");
  });

  it("carries no fallback value behind any reference", () => {
    mountFrame();
    openTheModal();

    for (const name of CHROME) {
      expect(requirePart(name).getAttribute("style") ?? "").not.toMatch(/var\(--[a-z0-9-]+\s*,/);
    }
  });

  it("paints the same chrome from a different theme's values", () => {
    mountFrame(modalProps(), DARK_VARS);
    openTheModal();
    const dialog = requirePart("frame");

    // Same names, different values: the surface is a projection rather than a
    // colour this file and the frame happen to agree on.
    expect(declaredVars(dialog)).toEqual({ ...DARK_VARS });
    expect(dialog.style.getPropertyValue("--facet-color-surface")).toBe(DARK_THEME.color.surface);
    expect(DARK_THEME.color.surface).not.toBe(THEME.color.surface);
    expect(dialog.style.background).toBe("var(--facet-color-surface)");
  });

  it("keeps a custom Modal's own content inside the frame it was given", () => {
    mountFrame(modalProps(), DARK_VARS, <Content label="Custom" />);
    openTheModal();
    const dialog = requirePart("frame");
    const content = document.querySelector('[data-testid="modal-content"]') as Element;

    expect(dialog.contains(content)).toBe(true);
    expect(content.parentElement).not.toBe(dialog.parentElement);
  });
});

describe("the ordered open list, which every shared behaviour is derived from", () => {
  it("opens both modals, in an order that disagrees with document and id order", () => {
    // The anchor for everything below: two dialogs really are open at once, and
    // the one opened last is neither first in the document nor last by id.
    mountTwo();

    expect(partsOf("frame").length).toBe(2);
    expect(partsOf("title").map((heading) => heading.textContent)).toEqual([
      "The zeta",
      "The alpha",
    ]);
  });

  it("closes only the topmost on Esc, then the one under it", () => {
    mountTwo();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(partsOf("title").map((heading) => heading.textContent)).toEqual(["The zeta"]);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(partsOf("frame").length).toBe(0);
  });

  it("paints the last one opened above the one under it, scrim and all", () => {
    mountTwo();
    const under = frameTitled("The zeta");
    const top = frameTitled("The alpha");

    expect(zIndexOf(top)).toBeGreaterThan(zIndexOf(under));
    // The topmost scrim covers the dialog beneath it, and never its own.
    expect(zIndexOf(scrimOf("The alpha"))).toBeGreaterThan(zIndexOf(under));
    expect(zIndexOf(scrimOf("The alpha"))).toBeLessThan(zIndexOf(top));
    expect(zIndexOf(scrimOf("The zeta"))).toBeLessThan(zIndexOf(under));
  });

  it("closes on the topmost scrim, and ignores a click on the one beneath it", () => {
    mountTwo();

    fireEvent.click(scrimOf("The zeta"));

    // The lower scrim is covered in a real browser and inert here: a modal that
    // closed from underneath its own overlay would jump the stack.
    expect(partsOf("frame").length).toBe(2);

    fireEvent.click(scrimOf("The alpha"));

    expect(partsOf("title").map((heading) => heading.textContent)).toEqual(["The zeta"]);
  });

  it("closes on Esc, and ignores a key that is not Escape", () => {
    mountFrame();
    openTheModal();

    fireEvent.keyDown(document, { key: "Enter" });
    expect(part("frame")).not.toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(part("frame")).toBeNull();
    expect(requirePart("trigger").getAttribute("aria-expanded")).toBe("false");
  });

  it("stays closed when two close paths land in the same commit", () => {
    mountFrame();
    openTheModal();
    const scrim = requirePart("scrim");

    // Batched on purpose. Both handlers run against the same state and before
    // the effect cleanup has taken this frame off the list, which is the one
    // arrangement where a close that toggled instead of setting would reopen the
    // modal it had just shut.
    const escaped = errorsDuring(() => {
      act(() => {
        fireEvent.click(scrim);
        fireEvent.keyDown(document, { key: "Escape" });
      });
    });

    expect(escaped).toEqual([]);
    expect(part("frame")).toBeNull();
    expect(requirePart("trigger").getAttribute("aria-expanded")).toBe("false");
  });

  it("removes its registration on unmount, so a later Esc reaches the next modal", () => {
    mountTwo();
    expect(partsOf("frame").length).toBe(2);

    cleanup();
    mountFrame();
    openTheModal();
    fireEvent.keyDown(document, { key: "Escape" });

    expect(part("frame")).toBeNull();
  });
});

describe("two independent hosts on one page", () => {
  function mountHost(id: string, label: string, title: string): ReturnType<typeof render> {
    return render(
      <ModalHost>
        <OverlayRootProvider>
          <Containment>
            <ModalFrame
              nodeId={id}
              props={modalProps({ triggerLabel: label, title })}
              themeVars={THEME_VARS}
            >
              <Content label={`${label} body`} />
            </ModalFrame>
          </Containment>
        </OverlayRootProvider>
      </ModalHost>,
    );
  }

  it("does not stack one session's modal on the other's", () => {
    mountHost("first", "First", "The first");
    mountHost("second", "Second", "The second");
    openTrigger("First");
    openTrigger("Second");

    // Both are the only modal open in their own session, so both sit at the
    // band's base. A list shared through a module-level variable would put the
    // second one a level higher, which is the whole difference.
    expect(partsOf("frame").length).toBe(2);
    expect(zIndexOf(frameTitled("The first"))).toBe(OVERLAY_Z_BAND.frame);
    expect(zIndexOf(frameTitled("The second"))).toBe(OVERLAY_Z_BAND.frame);
    expect(partsOf("scrim").map((scrim) => zIndexOf(scrim))).toEqual([
      OVERLAY_Z_BAND.scrim,
      OVERLAY_Z_BAND.scrim,
    ]);
  });

  it("lets each session's own topmost answer one Escape", () => {
    mountHost("first", "First", "The first");
    mountHost("second", "Second", "The second");
    openTrigger("First");
    openTrigger("Second");
    // The anchor: "none are open" is what this test ends on, and it is satisfied
    // by two modals that never opened at all.
    expect(partsOf("frame").length).toBe(2);

    fireEvent.keyDown(document, { key: "Escape" });

    // One list per session, so each session closes the topmost modal it owns.
    expect(partsOf("frame").length).toBe(0);
  });
});

describe("the body scroll lock, derived from the same list", () => {
  it("saves the page's own overflow and restores it, however often close runs", () => {
    document.body.style.overflow = "scroll";
    mountFrame();
    expect(document.body.style.overflow).toBe("scroll");

    openTheModal();
    expect(document.body.style.overflow).toBe("hidden");

    const escaped = errorsDuring(() => {
      fireEvent.keyDown(document, { key: "Escape" });
      fireEvent.keyDown(document, { key: "Escape" });
      fireEvent.keyDown(document, { key: "Escape" });
    });

    expect(escaped).toEqual([]);
    expect(document.body.style.overflow).toBe("scroll");
    expect(part("frame")).toBeNull();
  });

  it("never saves the lock's own value as the page's, however the two nest", () => {
    document.body.style.overflow = "scroll";
    mountTwo();
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(document, { key: "Escape" });
    // One of two is closed, so the page must still be locked.
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(document, { key: "Escape" });
    // And what comes back is the visitor's value, not the lock's.
    expect(document.body.style.overflow).toBe("scroll");

    openTrigger("Alpha");
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("restores the page when the host unmounts with a modal still open", () => {
    document.body.style.overflow = "scroll";
    const view = mountFrame();
    openTheModal();
    expect(document.body.style.overflow).toBe("hidden");

    view.unmount();

    expect(document.body.style.overflow).toBe("scroll");
  });

  it("keeps the page locked until every independent host releases", () => {
    document.body.style.overflow = "scroll";
    const first = render(
      <ModalHost>
        <OverlayRootProvider>
          <Containment>
            <ModalFrame
              nodeId="first"
              props={modalProps({ triggerLabel: "First", title: "The first" })}
              themeVars={THEME_VARS}
            >
              <Content label="First body" />
            </ModalFrame>
          </Containment>
        </OverlayRootProvider>
      </ModalHost>,
    );
    const second = render(
      <ModalHost>
        <OverlayRootProvider>
          <Containment>
            <ModalFrame
              nodeId="second"
              props={modalProps({ triggerLabel: "Second", title: "The second" })}
              themeVars={THEME_VARS}
            >
              <Content label="Second body" />
            </ModalFrame>
          </Containment>
        </OverlayRootProvider>
      </ModalHost>,
    );

    openTrigger("First");
    openTrigger("Second");
    expect(document.body.style.overflow).toBe("hidden");

    first.unmount();
    expect(document.body.style.overflow).toBe("hidden");

    second.unmount();
    expect(document.body.style.overflow).toBe("scroll");
  });

  it("leaves the page alone until something actually opens", () => {
    document.body.style.overflow = "scroll";
    mountFrame();

    // Anchored: a host that rendered nothing would leave the page alone too.
    expect(part("trigger")).not.toBeNull();
    expect(part("frame")).toBeNull();
    expect(document.body.style.overflow).toBe("scroll");
  });
});

describe("focus, which the frame keeps inside the dialog", () => {
  it("moves focus into the dialog on open", () => {
    mountFrame();
    openTheModal();

    expect(document.activeElement).toBe(requirePart("frame"));
  });

  it("wraps Tab and Shift+Tab around the dialog's own focusable stops", () => {
    mountFrame();
    openTheModal();
    const dismiss = requirePart("dismiss");
    const first = document.querySelector('[data-testid="content-first"]');
    const last = document.querySelector('[data-testid="content-second"]');

    fireEvent.keyDown(requirePart("frame"), { key: "Tab" });
    expect(document.activeElement).toBe(dismiss);

    fireEvent.keyDown(document.activeElement as Element, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(document.activeElement as Element, { key: "Tab" });
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(document.activeElement as Element, { key: "Tab" });
    expect(document.activeElement).toBe(dismiss);

    fireEvent.keyDown(document.activeElement as Element, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("keeps focus in the dialog when its content holds nothing focusable", () => {
    mountFrame(modalProps(), THEME_VARS, <p data-testid="inert">Nothing to focus here.</p>);
    openTheModal();
    const frame = requirePart("frame");

    // Focus is moved out first, which is the only arrangement where the wrap
    // does anything: with focus already inside, "keep it there" and "do nothing"
    // are the same observation and the test would pass either way.
    requirePart("trigger").focus();
    expect(document.activeElement).toBe(requirePart("trigger"));

    const escaped = errorsDuring(() => {
      fireEvent.keyDown(frame, { key: "Tab" });
    });

    expect(escaped).toEqual([]);
    // The dismiss control is the frame's own, so a dialog is never a trap with
    // no stop in it — which is what makes this the interesting case rather than
    // the degenerate one.
    expect(document.activeElement).toBe(requirePart("dismiss"));
  });
});

describe("the two providers the frame cannot do without", () => {
  it("is a determinate error with no host above it, and renders nothing in place", () => {
    const escaped = errorsDuring(() => {
      render(
        <OverlayRootProvider>
          <ModalFrame nodeId="n-modal" props={modalProps()} themeVars={THEME_VARS}>
            <Content label="Adjust" />
          </ModalFrame>
        </OverlayRootProvider>,
      );
    });

    expect(escaped.some((message) => message.includes("modal host"))).toBe(true);
    expect(part("trigger")).toBeNull();
    expect(contentRenders).toEqual([]);
  });

  it("is a determinate error with no overlay root above it", () => {
    const escaped = errorsDuring(() => {
      render(
        <ModalHost>
          <ModalFrame nodeId="n-modal" props={modalProps()} themeVars={THEME_VARS}>
            <Content label="Adjust" />
          </ModalFrame>
        </ModalHost>,
      );
    });

    expect(escaped.some((message) => message.includes("overlay root"))).toBe(true);
    expect(part("trigger")).toBeNull();
  });
});

describe("modal-frame.tsx source", () => {
  const raw = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "modal-frame.tsx"),
    "utf8",
  );
  const code = withoutComments(raw);

  it("strips its own comments before scanning, so the scan can actually fail", () => {
    // The prose above the code discusses every banned token at length, so a scan
    // over the raw text would match itself and pass for the wrong reason.
    expect(raw).toContain("onAction");
    expect(raw.toLowerCase()).toContain("z-index");
    expect(code).not.toContain("onAction");
  });

  it("has nothing in scope that could write the document", () => {
    for (const banned of [
      "onAction",
      "applyPatch",
      "stageRevision",
      ["local", ":"].join(""),
      "fetch(",
    ]) {
      expect(code).not.toContain(banned);
    }
  });

  it("holds no module-level open stack for a second session to share", () => {
    // Two `StageRenderer`s on one page are two sessions. A `let`, a `var`, or a
    // module-level array would make one session's open list the other's.
    expect(code).not.toMatch(/^let\s/m);
    expect(code).not.toMatch(/^var\s/m);
    expect(code).not.toMatch(/^const\s+\w+\s*(?::[^=]+)?=\s*\[\s*\]/m);
    expect(code).toContain("useState");
  });

  it("takes every stacking number from the band rather than writing its own", () => {
    expect(code).toContain("OVERLAY_Z_BAND");
    expect(code).not.toMatch(/zIndex\s*:\s*[-\d]/);
  });

  it("imports nothing from the assets package", () => {
    // D-09: the renderer does not depend on `@facet/assets`, so the frame cannot
    // reach for a default surface — which is exactly why it draws its own.
    expect(code).not.toContain("@facet/assets");
  });

  it("holds no NUL byte", () => {
    // Four NUL incidents in this repository, one of which hid a file from grep
    // entirely while passing typecheck, lint, prettier and a green suite. A
    // byte-level scan is the only one that answers.
    expect([...Buffer.from(raw, "utf8")].includes(0)).toBe(false);
  });
});

/** Source text with block and line comments removed, leaving the code alone. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
