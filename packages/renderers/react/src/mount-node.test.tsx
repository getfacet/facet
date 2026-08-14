// @vitest-environment jsdom
/**
 * The proof that mounting is total, that a corrupt subtree costs exactly that
 * subtree, and that a boundary's reset input is node-local.
 *
 * Six claims carry this file.
 *
 * **Structural corruptions, one outcome.** A corrupt node, a dangling
 * reference, an unknown runtime tag, a reference cycle, a subtree deeper
 * than `B-03`, and an exact lowercase resolved `arg` past `B-23` all replace
 * the **root of that subtree** with the corrupt-subtree neutral state, and their
 * outcomes are compared to each other for byte equality rather than merely
 * asserted one at a time (DC-013). If any cause
 * took a different path — a blank region, a different marker, a whole-tree
 * replacement — the comparison fails. Which corruption happened is therefore
 * not recoverable from the page, and neither is the persisted input.
 *
 * **And the node-scoped form hides.** `resolveProps` reports a **node-scoped**
 * issue when a node/spec cannot be read at all and when an exact lowercase
 * resolved `arg` is over-bound. The unreadable form hands back an empty prop
 * record — the same shape a healthy component with nothing to show produces —
 * while the `arg` form hands back an ordinary-looking string plus the issue. A
 * policy that ignored the discriminant would mount corrupt input and report
 * success from the code that exists to fail safe. Its own suite below anchors
 * the fixture to the real seam first, then holds it to the same single path as
 * the other causes.
 *
 * **Termination is asserted, not assumed.** A self-referential document and an
 * over-`B-03` document are both *rendered*. A visited-ancestor set and a depth
 * counter are the only two things standing between those fixtures and a render
 * that never returns, so the fixtures are what prove they are threaded. The
 * bounded-output assertions are the second half: a walk that terminated by luck
 * would still have expanded, so the element count is checked too.
 *
 * **A valid sibling is untouched.** Every degrade fixture carries a healthy
 * sibling, and the sibling is asserted *after* the degrade — isolation that
 * only holds until something goes wrong is not isolation.
 *
 * **`resetToken` is node-local (D3).** The token is derived here and nowhere
 * else, from that node's own post-binding `{tag, resolvedProps, childNodeIds}`.
 * The authoritative `stageRevision` is not an input, and cannot become one by
 * accident: it is not a parameter of anything in this module, and the source
 * scan at the end states that the module's code never names it. The derivation
 * proof is written both ways — the token is byte-identical when an unrelated
 * node changes and when an unrelated publish lands, and it changes when this
 * node's own resolved value or child ids change — and then again behaviourally,
 * because a token that is right and a boundary that is wired to it wrongly look
 * the same from the outside.
 *
 * **A `Modal` is inserted, never emitted in flow.** `Modal` is one of the
 * catalog's tags, so with no seam a modal node mounts as an ordinary component
 * *beside its own trigger* — the functional failure this suite has to be able to
 * see. Two halves make it visible, and they fail independently: that the seam
 * was **called**, and that the content was **not also emitted inline**. The
 * first alone would still pass for an implementation that handed the content to
 * the frame *and* rendered it in place, which is the mutation a careless
 * refactor actually produces. So the frame fixture has a **closed** mode that
 * renders nothing — what the real frame does before its trigger is pressed —
 * and the inline assertion is made against that, where an in-flow render has
 * nowhere to hide. The routing is `Modal`-specific and exact: near-miss tags
 * and a differently-cased one are mounted beside it and must stay in flow. And
 * because `Modal` is optional in a host catalog, the mirror is proved too — a
 * session that declares none renders ordinarily with the seam **never asked**,
 * which is the only way to tell an unreachable seam from a dead one.
 *
 * **Containment and the handler gap.** Every mounted implementation sits inside
 * a renderer-owned containment element, and the wrapper carries `isolation`
 * and nothing else — no `position`, no `z-index`, which stay with the overlay
 * frame Facet owns. Handlers Facet injects go through `safeInvoke`, so a host
 * `onAction` that throws is contained; that is asserted with `errorsDuring`
 * rather than `expect(…).not.toThrow()`, which cannot fail for a React event
 * handler because React catches the throw at its own dispatch boundary and
 * reports it to the environment instead of unwinding the caller.
 *
 * This suite reads `node:fs` to assert a property *of* the source. `@facet/react`
 * itself imports no `node:*`; a test that scans the module it covers is the same
 * exception `error-boundary.test.tsx` already takes. The path is built with
 * `fileURLToPath` because under jsdom `new URL(file, import.meta.url)` resolves
 * against `http://localhost:3000/` rather than against the file it stands in.
 */

import { BOUNDS, NEUTRAL_COPY_DEFAULTS } from "@facet/core";
import type {
  ComponentDocument,
  ComponentMountProps,
  ComponentNode,
  ComponentSpec,
  DataModel,
} from "@facet/core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DataProvider, resolveProps } from "./binding.js";
import { CONTAINMENT_ATTRIBUTE } from "./containment.js";
import { createFieldStore } from "./field-store.js";
import { deriveResetToken, MountNode } from "./mount-node.js";
import type { ModalMountRequest, MountContext } from "./mount-node.js";
import type { ComponentRegistry } from "./registry.js";
import { errorsDuring } from "../../../../test-support/errors-during.js";

afterEach(cleanup);

/** The copy every mount below runs with: the framework defaults, unmodified. */
const COPY = NEUTRAL_COPY_DEFAULTS;

/** The marker the corrupt-subtree neutral state carries. */
const CORRUPT = '[data-facet-neutral-state="corrupt-subtree"]';

/** The marker the crash neutral state carries. */
const CRASHED = '[data-facet-neutral-state="component-unavailable"]';

const THEME_VARS: Readonly<Record<string, string>> = Object.freeze({
  "--facet-semantic-text-default": "#101010",
});

/** The internal detail a deliberately crashing component carries. */
const CRASH_MESSAGE = "boom: internal detail 0xfeedface";

/** The message a deliberately throwing host action handler carries. */
const HANDLER_MESSAGE = "host action handler exploded";

/**
 * A fixture catalog. Small on purpose: every spec below exists to reach one
 * branch of mounting, and nothing here is a claim about the real catalog.
 */
const SPECS: readonly ComponentSpec[] = [
  {
    tag: "Screen",
    whenToUse: "A screen root.",
    authoring: {
      role: "display",
      informationTypes: ["test_content"],
      visualEmphasis: "supporting",
    } as const,
    props: { name: { type: "string", required: true, guidance: "The screen name." } },
    acceptsChildren: true,
  },
  {
    tag: "Stack",
    whenToUse: "A layout container.",
    authoring: {
      role: "display",
      informationTypes: ["test_content"],
      visualEmphasis: "supporting",
    } as const,
    props: {
      gap: { type: "string", enum: ["tight", "loose"], default: "tight", guidance: "Spacing." },
    },
    acceptsChildren: true,
  },
  {
    tag: "Text",
    whenToUse: "A run of text.",
    authoring: {
      role: "display",
      informationTypes: ["test_content"],
      visualEmphasis: "supporting",
    } as const,
    props: {
      value: { type: "string", required: true, guidance: "What it says." },
      total: { type: "number", bindable: true, guidance: "A bound number." },
      action: { type: "string", guidance: "May carry an action reference." },
      arg: { type: "string", guidance: "The event argument." },
    },
    acceptsChildren: false,
  },
  {
    tag: "Field",
    whenToUse: "A collectable control.",
    authoring: {
      role: "display",
      informationTypes: ["test_content"],
      visualEmphasis: "supporting",
    } as const,
    props: {
      name: { type: "string", guidance: "The collect name." },
      value: { type: "string", default: "", guidance: "The value shown." },
      secret: { type: "boolean", default: false, guidance: "Whether it is withheld." },
    },
    acceptsChildren: false,
    collect: { collectable: true, valueProp: "value", sensitiveProp: "secret" },
  },
  {
    tag: "Rogue",
    whenToUse: "A registered component that tries to escape its stacking context.",
    authoring: {
      role: "display",
      informationTypes: ["test_content"],
      visualEmphasis: "supporting",
    } as const,
    props: {},
    acceptsChildren: false,
  },
  {
    tag: "Flaky",
    whenToUse: "A registered component that throws for one authored value.",
    authoring: {
      role: "display",
      informationTypes: ["test_content"],
      visualEmphasis: "supporting",
    } as const,
    props: { value: { type: "string", required: true, guidance: "What it says, or `boom`." } },
    acceptsChildren: false,
  },
  {
    tag: "Modal",
    whenToUse: "The one overlap primitive: flow content the framework frame carries.",
    authoring: {
      role: "display",
      informationTypes: ["test_content"],
      visualEmphasis: "supporting",
    } as const,
    props: {
      triggerLabel: { type: "string", required: true, guidance: "What opens it." },
      title: { type: "string", default: "Details", guidance: "The dialog's name." },
      total: { type: "number", bindable: true, guidance: "A bound number." },
    },
    acceptsChildren: true,
  },
  // Two near misses, registered and mounted beside the real one. They exist so
  // "the exact tag" is a claim the suite can falsify: a prefix test and a
  // case-insensitive test each route one of them, and each fails here.
  {
    tag: "ModalPanel",
    whenToUse: "A tag whose name begins with the reserved one.",
    authoring: {
      role: "display",
      informationTypes: ["test_content"],
      visualEmphasis: "supporting",
    } as const,
    props: {},
    acceptsChildren: false,
  },
  {
    tag: "modal",
    whenToUse: "A tag that differs from the reserved one only in case.",
    authoring: {
      role: "display",
      informationTypes: ["test_content"],
      visualEmphasis: "supporting",
    } as const,
    props: {},
    acceptsChildren: false,
  },
];

const INDEX: ReadonlyMap<string, ComponentSpec> = new Map(SPECS.map((spec) => [spec.tag, spec]));

/** Every mount this suite observed, in order, so a remount is visible. */
const mounts: string[] = [];

function ScreenImpl({ props, children }: ComponentMountProps<ReactNode>): ReactNode {
  return (
    <section data-testid="screen" data-name={String(props["name"] ?? "")}>
      {children}
    </section>
  );
}

function StackImpl({ props, children }: ComponentMountProps<ReactNode>): ReactNode {
  return (
    <div data-testid="stack" data-gap={String(props["gap"] ?? "")}>
      {children}
    </div>
  );
}

function TextImpl({ props, themeVars, onAction }: ComponentMountProps<ReactNode>): ReactNode {
  const label = String(props["value"] ?? "");
  // Deliberately mount-only: a dependency list would re-fire on every render and
  // the question this records is whether the subtree was *remounted*.
  useEffect(() => {
    mounts.push(`Text:${label}`);
  }, []);
  return (
    <button
      type="button"
      data-testid="text"
      data-total={props["total"] === undefined ? "absent" : String(props["total"])}
      data-theme={themeVars["--facet-semantic-text-default"] ?? ""}
      onClick={() => {
        onAction("action");
      }}
    >
      {label}
    </button>
  );
}

function FieldImpl({ props, onValueChange }: ComponentMountProps<ReactNode>): ReactNode {
  return (
    <input
      data-testid="field"
      value={String(props["value"] ?? "")}
      onChange={(event) => onValueChange?.(event.target.value)}
    />
  );
}

function RogueImpl(): ReactNode {
  return <div data-testid="rogue" style={{ position: "fixed", zIndex: 99_999 }} />;
}

/**
 * Whether the crashing fixture is still armed.
 *
 * It is deliberately **not** one of the node's props, and that is the whole
 * mechanism behind the tests that follow. Disarming it changes what the
 * component would do without changing anything `resetToken` is derived from, so
 * a boundary that never gives the subtree another go leaves the crash state
 * standing and a boundary that resets for the wrong reason reveals itself by
 * rendering the recovered component. Latching alone cannot show that: a boundary
 * that clears and re-renders a component that still throws simply latches again,
 * which looks identical from the outside.
 */
let flakyArmed = true;

/** Every render of the crashing fixture that actually reached its body. */
let flakyRenders = 0;

/**
 * Throws for exactly one authored value.
 *
 * The conditional is what makes the reset tests mean something: the tag and the
 * node id stay put, so the boundary keeps the same identity and the same
 * instance, and the only thing that moves between renders is this node's own
 * resolved input — which is precisely what `resetToken` is derived from.
 */
function FlakyImpl({ props }: ComponentMountProps<ReactNode>): ReactNode {
  flakyRenders += 1;
  if (props["value"] === "boom" && flakyArmed) {
    throw new Error(CRASH_MESSAGE);
  }
  return <p data-testid="flaky">{String(props["value"] ?? "")}</p>;
}

/** Every mount contract the registered `Modal` was handed, in order. */
const modalContracts: ComponentMountProps<ReactNode>[] = [];

/**
 * The trusted registered `Modal`: flow content, and nothing else.
 *
 * It knows nothing about frames, scrims or portals — that is the whole ownership
 * split — so from its side the seam has to be invisible. What the suite reads
 * off it is whether it ran at all, and with what, which is how "the content was
 * not also emitted inline" becomes an assertion rather than a hope.
 */
function ModalImpl(contract: ComponentMountProps<ReactNode>): ReactNode {
  modalContracts.push(contract);
  if (contract.props["title"] === "boom") {
    throw new Error(CRASH_MESSAGE);
  }
  return (
    <div data-testid="modal-content" data-title={String(contract.props["title"] ?? "")}>
      {contract.children}
    </div>
  );
}

function NearMissImpl({ props }: ComponentMountProps<ReactNode>): ReactNode {
  return <div data-testid="near-miss">{String(props["value"] ?? "")}</div>;
}

const REGISTRY: ComponentRegistry = Object.freeze({
  Screen: ScreenImpl,
  Stack: StackImpl,
  Text: TextImpl,
  Field: FieldImpl,
  Rogue: RogueImpl,
  Flaky: FlakyImpl,
  Modal: ModalImpl,
  ModalPanel: NearMissImpl,
  modal: NearMissImpl,
});

/** Every Modal insertion the fixture frame was asked to make, in order. */
const seamRequests: ModalMountRequest[] = [];

/**
 * The default frame: it records the request and renders nothing.
 *
 * Closed is the right default, and not only because it is the state the real
 * frame starts in. A frame that rendered its content would make an inline
 * emission and a framed one look alike in the DOM; a closed one leaves the
 * content with exactly one place it could come from, so `[data-testid=
 * "modal-content"]` being present at all is the failure.
 */
function closedFrame(request: ModalMountRequest): ReactNode {
  seamRequests.push(request);
  return null;
}

/** The same frame, opened: it records, then renders the content it was handed. */
function openFrame(request: ModalMountRequest): ReactNode {
  seamRequests.push(request);
  return <div data-testid="frame">{request.content}</div>;
}

/** One stored prop value, named from the document rather than restated. */
type StoredValue = ComponentNode["props"][string];

function scalar(value: string): StoredValue {
  return { kind: "scalar", value };
}

function reference(scheme: "data" | "nav" | "agent", target: string): StoredValue {
  return { kind: "reference", scheme, target };
}

function node(
  tag: string,
  props: Readonly<Record<string, StoredValue>> = {},
  children: readonly string[] = [],
): ComponentNode {
  return { tag, props, children };
}

/** A screen root carrying the fixture name every document below lands on. */
function screen(children: readonly string[]): ComponentNode {
  return node("Screen", { name: scalar("home") }, children);
}

function document_(nodes: Readonly<Record<string, ComponentNode>>): ComponentDocument {
  return { entry: "home", screens: ["n1"], nodes };
}

/** A valid sibling every degrade fixture carries, so isolation is observable. */
const SIBLING = node("Text", { value: scalar("sibling") });

function context(document: ComponentDocument, overrides: Partial<MountContext> = {}): MountContext {
  return {
    document,
    index: INDEX,
    registry: REGISTRY,
    themeVars: THEME_VARS,
    copy: COPY,
    store: createFieldStore(),
    onAction: () => {},
    renderModal: closedFrame,
    ...overrides,
  };
}

/** Mounts a document's screen root under a Data Model. */
function mount(
  document: ComponentDocument,
  options: { readonly model?: DataModel; readonly overrides?: Partial<MountContext> } = {},
): ReturnType<typeof render> {
  return render(
    <DataProvider model={options.model ?? {}}>
      <MountNode context={context(document, options.overrides ?? {})} nodeId="n1" />
    </DataProvider>,
  );
}

/**
 * Silences React's own report of a caught error for the duration of `run`.
 *
 * React logs every error a boundary catches, by design. These tests provoke
 * those errors deliberately, so the log is noise — but it is silenced only
 * around the provoking call, so an unrelated React warning still surfaces.
 */
function withSilencedReactReport<Result>(run: () => Result): Result {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    return run();
  } finally {
    spy.mockRestore();
  }
}

/** The single corrupt-subtree element in a container, or a failure if there is not exactly one. */
function theCorruptElement(container: HTMLElement): Element {
  const found = container.querySelectorAll(CORRUPT);
  expect(found.length).toBe(1);
  const only = found[0];
  if (only === undefined) {
    throw new Error("no corrupt-subtree element");
  }
  return only;
}

describe("MountNode — mounting a registered implementation", () => {
  it("mounts the trusted implementation with resolved props, children and theme vars", () => {
    const { container } = mount(
      document_({
        n1: screen(["n2"]),
        n2: node("Stack", {}, ["n3"]),
        n3: node("Text", { value: scalar("hello"), total: reference("data", "sales.total") }),
      }),
      { model: { sales: { total: 42 } } },
    );

    const text = container.querySelector('[data-testid="text"]');
    expect(text?.textContent).toBe("hello");
    // The declared default filled the prop the author omitted; the binding
    // resolved through the model; the theme reached the mount contract.
    expect(container.querySelector('[data-testid="stack"]')?.getAttribute("data-gap")).toBe(
      "tight",
    );
    expect(text?.getAttribute("data-total")).toBe("42");
    expect(text?.getAttribute("data-theme")).toBe("#101010");
  });

  it("mounts children in document order", () => {
    const { container } = mount(
      document_({
        n1: screen(["n2", "n3", "n4"]),
        n2: node("Text", { value: scalar("first") }),
        n3: node("Text", { value: scalar("second") }),
        n4: node("Text", { value: scalar("third") }),
      }),
    );

    expect([...container.querySelectorAll('[data-testid="text"]')].map((el) => el.textContent)) //
      .toEqual(["first", "second", "third"]);
  });

  it("mounts children by index rather than through a hostile iterator", () => {
    const children = ["n2"];
    Object.defineProperty(children, Symbol.iterator, {
      value: (): never => {
        throw new Error("hostile iterator");
      },
    });
    const { container } = mount(
      document_({
        n1: { tag: "Screen", props: { name: scalar("home") }, children },
        n2: node("Text", { value: scalar("child") }),
      }),
    );

    expect(container.querySelector('[data-testid="text"]')?.textContent).toBe("child");
  });

  it("wraps every mounted implementation in a containment element carrying isolation alone", () => {
    const { container } = mount(document_({ n1: screen(["n2"]), n2: node("Rogue") }));

    const rogue = container.querySelector('[data-testid="rogue"]');
    const wrapper = rogue?.parentElement;
    expect(wrapper?.hasAttribute(CONTAINMENT_ATTRIBUTE)).toBe(true);
    // The wrapper is the renderer's own element, and the closed position/z band
    // is not its to emit: it carries the isolation and nothing else.
    expect(wrapper?.getAttribute("style")).toBe("isolation: isolate;");
    // And it holds the mounted implementation and nothing beside it — mounting
    // contributes exactly one element per node, never a second one carrying
    // geometry of its own.
    expect(wrapper?.children.length).toBe(1);
  });

  it("leaves a prop whose binding does not resolve absent, and still mounts the subtree", () => {
    const { container } = mount(
      document_({
        n1: screen(["n2"]),
        n2: node("Text", { value: scalar("still here"), total: reference("data", "sales.total") }),
      }),
      { model: {} },
    );

    // A publish that has not landed is not corruption: the prop is absent with
    // a structured issue, and the subtree keeps rendering (DC-019).
    expect(container.querySelectorAll(CORRUPT).length).toBe(0);
    expect(container.querySelector('[data-testid="text"]')?.getAttribute("data-total")) //
      .toBe("absent");
  });

  it("injects the field value through the store for a catalog-declared collectable", () => {
    const { container } = mount(
      document_({
        n1: screen(["n2"]),
        n2: node("Field", { name: scalar("region"), value: scalar("north") }),
      }),
    );

    const input = container.querySelector('[data-testid="field"]') as HTMLInputElement;
    expect(input.value).toBe("north");
    fireEvent.change(input, { target: { value: "south" } });
    expect(input.value).toBe("south");
  });

  it("contains a host action handler that throws", () => {
    const { container } = mount(document_({ n1: screen(["n2"]), n2: SIBLING }), {
      overrides: {
        onAction: () => {
          throw new Error(HANDLER_MESSAGE);
        },
      },
    });
    const text = container.querySelector('[data-testid="text"]') as HTMLElement;

    const escaped = errorsDuring(() => {
      fireEvent.click(text);
    });

    expect(escaped).toEqual([]);
    expect(container.querySelectorAll(CRASHED).length).toBe(0);
  });

  it("reports the activated prop and this node's id to the host handler", () => {
    const reported: string[] = [];
    const { container } = mount(document_({ n1: screen(["n2"]), n2: SIBLING }), {
      overrides: {
        onAction: (nodeId, prop) => {
          reported.push(`${nodeId}/${prop}`);
        },
      },
    });

    fireEvent.click(container.querySelector('[data-testid="text"]') as HTMLElement);

    expect(reported).toEqual(["n2/action"]);
  });
});

/**
 * The seam that keeps the one overlap primitive out of the flow it is declared
 * in.
 *
 * A `Modal` is a catalog tag like any other: it is stored as a node, it resolves
 * its props like a node, and its registered implementation renders flow content
 * like a node's. What must not be like any other is **where that content goes**.
 * Emitted in place it would sit in the document beside its own trigger, inside
 * the containment element whose `isolation` is exactly what stops it painting
 * over anything — the modal would be a box in the page rather than a dialog over
 * it. So mounting routes the exact registered `Modal` tag to a framework seam
 * and hands the content over instead of emitting it.
 *
 * Every test below asserts **both** halves where both are observable, because
 * "the frame was called" and "the content is not in the flow" fail
 * independently, and only the second one is the failure a visitor would see.
 */
describe("Mounted — the Modal insertion seam", () => {
  const MODAL_SPEC = SPECS.find((spec) => spec.tag === "Modal") as ComponentSpec;

  /** The model every fixture below resolves its bound prop against. */
  const MODEL: DataModel = { sales: { total: 7 } };

  /** The Modal node every fixture below mounts, with a valid sibling beside it. */
  const MODAL_NODE = node("Modal", {
    triggerLabel: scalar("Open"),
    total: reference("data", "sales.total"),
  });

  const DOCUMENT = document_({ n1: screen(["n2", "n3"]), n2: MODAL_NODE, n3: SIBLING });

  beforeEach(() => {
    seamRequests.length = 0;
    modalContracts.length = 0;
  });

  it("routes the Modal node to the frame exactly once, and hands it nothing else", () => {
    mount(DOCUMENT, { model: MODEL });

    expect(seamRequests.length).toBe(1);
    expect(seamRequests[0]?.nodeId).toBe("n2");
    // The request is closed. A `themeVars` or an `onAction` added here would be
    // a second route into the frame, and the frame's theme is the renderer's to
    // supply through the callback rather than the mount's to pass down.
    expect(Object.keys(seamRequests[0] ?? {}).sort()).toEqual(["content", "nodeId", "props"]);
  });

  it("never emits the Modal's content in the flow when the frame renders nothing", () => {
    const { container } = mount(DOCUMENT, { model: MODEL });

    // The seam ran — without this the two assertions below would also hold for
    // a document that mounted no Modal at all.
    expect(seamRequests.length).toBe(1);
    // And the content is nowhere in the document. Both the DOM and the
    // implementation's own record are read: a frame that renders nothing can
    // only leave the content unrendered, so anything here came from the flow.
    expect(container.querySelectorAll('[data-testid="modal-content"]').length).toBe(0);
    expect(modalContracts.length).toBe(0);
    // The rest of the screen is untouched.
    expect(container.querySelector('[data-testid="text"]')?.textContent).toBe("sibling");
  });

  it("renders the content once, inside the frame, when the frame opens", () => {
    const { container } = mount(DOCUMENT, {
      model: MODEL,
      overrides: { renderModal: openFrame },
    });
    const content = container.querySelectorAll('[data-testid="modal-content"]');

    // Exactly one: a route that also emitted the content inline would render it
    // twice, and the count is what says so.
    expect(content.length).toBe(1);
    expect(modalContracts.length).toBe(1);
    const frame = container.querySelector('[data-testid="frame"]');
    expect(frame).not.toBeNull();
    expect(frame?.contains(content[0] as Node)).toBe(true);
  });

  it("hands the frame the same resolved record it hands the implementation", () => {
    mount(DOCUMENT, { model: MODEL, overrides: { renderModal: openFrame } });
    const request = seamRequests[0] as ModalMountRequest;

    // Resolved, not stored: the declared default is filled and the binding is
    // resolved, neither of which a raw stored prop record carries.
    expect(request.props).toEqual(resolveProps(MODAL_NODE, MODAL_SPEC, MODEL).props);
    expect(request.props["triggerLabel"]).toBe("Open");
    expect(request.props["title"]).toBe("Details");
    expect(request.props["total"]).toBe(7);
    // The same record, not an equal one: the frame's total read and the
    // implementation's are reading the same values.
    expect(request.props).toBe(modalContracts[0]?.props);
  });

  it("mounts the Modal's children into the content the frame receives", () => {
    const withChild = document_({
      n1: screen(["n2", "n3"]),
      n2: node("Modal", { triggerLabel: scalar("Open") }, ["n4"]),
      n3: SIBLING,
      n4: node("Text", { value: scalar("inside") }),
    });

    const opened = mount(withChild, { overrides: { renderModal: openFrame } });
    expect(
      [...opened.container.querySelectorAll('[data-testid="text"]')].map((el) => el.textContent),
    ).toEqual(["inside", "sibling"]);
    expect(opened.container.querySelector('[data-testid="modal-content"]')?.textContent) //
      .toBe("inside");
    cleanup();

    // And the consequence worth stating: a frame that renders nothing mounts no
    // part of the subtree, so a modal's children do not exist until it opens.
    const closed = mount(withChild);
    expect(
      [...closed.container.querySelectorAll('[data-testid="text"]')].map((el) => el.textContent),
    ).toEqual(["sibling"]);
  });

  it("routes only the exact tag, not a prefix of it and not another case of it", () => {
    const { container } = mount(
      document_({
        n1: screen(["n2", "n3", "n4"]),
        n2: node("ModalPanel"),
        n3: node("modal"),
        n4: SIBLING,
      }),
    );

    // All three mounted — the document is not being rejected out from under the
    // claim — and none of them reached the frame.
    expect(container.querySelectorAll('[data-testid="near-miss"]').length).toBe(2);
    expect(container.querySelector('[data-testid="text"]')?.textContent).toBe("sibling");
    expect(seamRequests.length).toBe(0);
  });

  it("reads the discriminant from the spec rather than from the stored node", () => {
    // A fixture the real bootstrap cannot build: its index is keyed by each
    // spec's own tag, so the two reads always agree there. Separating them is
    // the only way to observe which one mounting actually performs.
    const index = new Map([...INDEX, ["Dialog", MODAL_SPEC]]);
    const registry: ComponentRegistry = Object.freeze({ ...REGISTRY, Dialog: ModalImpl });

    const { container } = mount(
      document_({
        n1: screen(["n2", "n3"]),
        n2: node("Dialog", { triggerLabel: scalar("Open") }),
        n3: SIBLING,
      }),
      { overrides: { index, registry } },
    );

    expect(seamRequests.length).toBe(1);
    expect(seamRequests[0]?.nodeId).toBe("n2");
    expect(container.querySelectorAll('[data-testid="modal-content"]').length).toBe(0);
  });

  it("degrades a corrupt Modal subtree instead of handing it to the frame", () => {
    const { container } = mount(
      // The required `triggerLabel` is missing, which describes the document
      // rather than the data and therefore refuses the mount.
      document_({ n1: screen(["n2", "n3"]), n2: node("Modal"), n3: SIBLING }),
    );

    expect(theCorruptElement(container).textContent).toBe(COPY.render.corruptSubtree);
    // The gate is upstream of the seam: a subtree that could not be trusted in
    // the flow is not one the frame may be handed either.
    expect(seamRequests.length).toBe(0);
    expect(container.querySelector('[data-testid="text"]')?.textContent).toBe("sibling");
  });

  it("keeps the routed content inside this node's containment element", () => {
    const { container } = mount(DOCUMENT, {
      model: MODEL,
      overrides: { renderModal: openFrame },
    });
    const frame = container.querySelector('[data-testid="frame"]') as Element;

    // The seam sits exactly where the ordinary mount sat — inside the
    // containment element — which is harmless for the real frame because it
    // portals out of the document tree regardless, and which keeps this
    // module's one wrapper-per-node shape intact for every other tag.
    expect(frame.parentElement?.hasAttribute(CONTAINMENT_ATTRIBUTE)).toBe(true);
    expect(frame.parentElement?.children.length).toBe(1);
  });

  it("keeps the routed content under this node's own subtree boundary", () => {
    const crashing = document_({
      n1: screen(["n2", "n3"]),
      n2: node("Modal", { triggerLabel: scalar("Open"), title: scalar("boom") }),
      n3: SIBLING,
    });

    // If the routed content were rendered outside this node's boundary, the
    // throw would unwind out of `render` and this call would be the failure.
    const { container } = withSilencedReactReport(() =>
      mount(crashing, { overrides: { renderModal: openFrame } }),
    );

    // Caught where every other node's crash is caught, and it cost this subtree
    // and nothing else.
    expect(container.querySelectorAll(CRASHED).length).toBe(1);
    expect(modalContracts.length).toBeGreaterThan(0);
    expect(container.querySelector('[data-testid="text"]')?.textContent).toBe("sibling");
  });

  it("does not route a Modal through the field store, and does not lose the routing if one claims to be collectable", () => {
    // The real catalog's Modal is not collectable, so the first half is the
    // contract: no value is injected and no change handler is offered.
    mount(DOCUMENT, { model: MODEL, overrides: { renderModal: openFrame } });
    expect(modalContracts[0]?.onValueChange).toBeUndefined();
    cleanup();
    seamRequests.length = 0;
    modalContracts.length = 0;

    // The second half is a fixture the catalog cannot produce, pinned in the
    // safe direction: were a Modal ever declared collectable, its content must
    // still leave the flow. Mounting it through the field host instead would
    // put a dialog in the page, which is the failure the seam exists to stop.
    const collectable: ComponentSpec = {
      ...MODAL_SPEC,
      collect: { collectable: true, valueProp: "title" },
    };
    const { container } = mount(DOCUMENT, {
      model: MODEL,
      overrides: { index: new Map([...INDEX, ["Modal", collectable]]) },
    });

    expect(seamRequests.length).toBe(1);
    expect(container.querySelectorAll('[data-testid="modal-content"]').length).toBe(0);
  });

  it("requires the seam on every mount context", () => {
    // A type-level assertion, and it is honest about being one: vitest does not
    // typecheck, so this test cannot fail in a run. It fails in `tsc`, where an
    // optional `renderModal` makes the directive below unused and reported. It
    // is here rather than in a type-only file because this is the module whose
    // contract it states.
    // @ts-expect-error — `renderModal` is required: a context without it is not a MountContext.
    const withoutSeam: MountContext = {
      document: DOCUMENT,
      index: INDEX,
      registry: REGISTRY,
      themeVars: THEME_VARS,
      copy: COPY,
      store: createFieldStore(),
      onAction: () => {},
    };

    expect(withoutSeam.index).toBe(INDEX);
  });
});

/**
 * The mirror-image proof: a session whose catalog never declares a `Modal` at
 * all.
 *
 * `Modal` is optional (WU-31): bootstrap runs `validateModalConformance` only
 * when a host registered one, and only `Screen` is mandatory. Because routing
 * keys on the exact tag, such a session cannot reach the seam — no spec carries
 * the tag, so no node can either. That makes the seam **unreachable rather than
 * broken**, and the two are indistinguishable from a green suite: everything
 * asserted here would also hold for an implementation that had quietly stopped
 * routing altogether.
 *
 * So the claim is about the callback, not the appearance. "The output looks
 * unwrapped" is a statement about this fixture's markup; "the frame was never
 * asked" is the one the ruling makes, and only the second survives a frame that
 * happens to render its content in place. Both are asserted, and the fixture's
 * own premise — two exactly-equal tag sets, neither holding `Modal` — is
 * asserted first, so neither test can pass because the catalog was accidentally
 * something else.
 */
describe("Mounted — a session whose catalog declares no Modal", () => {
  /** The tags this session has. One list, so the two sets cannot drift apart. */
  const TAGS = ["Screen", "Stack", "Text"] as const;

  const MODAL_LESS_INDEX: ReadonlyMap<string, ComponentSpec> = new Map(
    TAGS.map((tag) => [tag, SPECS.find((spec) => spec.tag === tag) as ComponentSpec]),
  );

  const MODAL_LESS_REGISTRY: ComponentRegistry = Object.freeze({
    Screen: ScreenImpl,
    Stack: StackImpl,
    Text: TextImpl,
  });

  const PLAIN = document_({
    n1: screen(["n2"]),
    n2: node("Stack", {}, ["n3", "n4"]),
    n3: node("Text", { value: scalar("first") }),
    n4: node("Text", { value: scalar("second") }),
  });

  function mountModalLess(document: ComponentDocument): ReturnType<typeof render> {
    return mount(document, {
      overrides: { index: MODAL_LESS_INDEX, registry: MODAL_LESS_REGISTRY },
    });
  }

  beforeEach(() => {
    seamRequests.length = 0;
    modalContracts.length = 0;
  });

  it("is built from two exactly-equal tag sets, and neither declares a Modal", () => {
    // The premise, asserted rather than assumed. An unequal pair would be
    // refused at bootstrap and would not be a session at all; a pair that still
    // held `Modal` would make both tests below vacuous.
    expect([...MODAL_LESS_INDEX.keys()].sort()).toEqual(Object.keys(MODAL_LESS_REGISTRY).sort());
    expect(MODAL_LESS_INDEX.has("Modal")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(MODAL_LESS_REGISTRY, "Modal")).toBe(false);
  });

  it("renders the whole document normally, and never asks for a frame", () => {
    const { container } = mountModalLess(PLAIN);

    // Ordinary rendering proceeds: every node mounted, nothing degraded.
    expect([...container.querySelectorAll('[data-testid="text"]')].map((el) => el.textContent)) //
      .toEqual(["first", "second"]);
    expect(container.querySelector('[data-testid="stack"]')).not.toBeNull();
    expect(container.querySelectorAll(CORRUPT).length).toBe(0);
    expect(container.querySelectorAll(CRASHED).length).toBe(0);
    // And the seam was never reached — the half that tells "correctly
    // unreachable" apart from "silently dead", because every assertion above
    // holds either way.
    expect(seamRequests.length).toBe(0);
  });

  it("degrades a persisted Modal node instead of reaching the seam for it", () => {
    // A document written by a session whose catalog *did* declare a Modal, read
    // back by one whose catalog does not. The tag is now unknown at runtime,
    // which is one of the five structural causes — so it takes that path, and
    // the frame is never asked to carry a node this session cannot mount.
    const { container } = mountModalLess(
      document_({
        n1: screen(["n2", "n3"]),
        n2: node("Modal", { triggerLabel: scalar("Open") }),
        n3: SIBLING,
      }),
    );

    expect(theCorruptElement(container).textContent).toBe(COPY.render.corruptSubtree);
    expect(seamRequests.length).toBe(0);
    expect(modalContracts.length).toBe(0);
    expect(container.querySelector('[data-testid="text"]')?.textContent).toBe("sibling");
  });
});

/**
 * The structural corruption causes, each with a healthy sibling beside it.
 *
 * Every fixture puts the fault under `n2` and a valid `Text` under `n3`, so one
 * shape of assertion covers all of them: exactly one corrupt-subtree element, the
 * sibling still rendered, and the whole tree still standing.
 */
const CAUSES: readonly {
  readonly name: string;
  readonly document: ComponentDocument;
}[] = [
  {
    name: "a corrupt node",
    document: document_({
      n1: screen(["n2", "n3"]),
      // Stored as a node, but not one: `children` is not a list of ids.
      n2: { tag: "Stack", props: {}, children: "n3" } as unknown as ComponentNode,
      n3: SIBLING,
    }),
  },
  {
    name: "a node with unreadable children",
    document: (() => {
      const revoked = Proxy.revocable<string[]>([], {});
      revoked.revoke();
      return document_({
        n1: screen(["n2", "n3"]),
        n2: { tag: "Stack", props: {}, children: revoked.proxy } as unknown as ComponentNode,
        n3: SIBLING,
      });
    })(),
  },
  {
    name: "a dangling reference",
    document: document_({ n1: screen(["n2", "n3"]), n3: SIBLING }),
  },
  {
    name: "an unknown runtime tag",
    document: document_({ n1: screen(["n2", "n3"]), n2: node("Nonesuch"), n3: SIBLING }),
  },
  {
    name: "a reference cycle",
    document: document_({
      n1: screen(["n2", "n3"]),
      n2: node("Stack", {}, ["n4"]),
      n3: SIBLING,
      // Back to an ancestor already on the mount path.
      n4: node("Stack", {}, ["n2"]),
    }),
  },
  {
    name: `a subtree deeper than B-03 (${BOUNDS.elementDepth})`,
    document: overDepthDocument(),
  },
  {
    name: "an exact lowercase resolved arg past B-23",
    document: document_({
      n1: screen(["n2", "n3"]),
      n2: node("Text", {
        value: scalar("argged"),
        arg: scalar("x".repeat(BOUNDS.collectedValueChars + 1)),
      }),
      n3: SIBLING,
    }),
  },
];

/**
 * A document whose first branch nests past `B-03`, with a healthy sibling.
 *
 * The screen root is the second level of the document — the `Facet` envelope is
 * the first, exactly as `serializeDocument` counts it — so the chain is built
 * long enough that its tail is unambiguously past the bound.
 */
function overDepthDocument(): ComponentDocument {
  const nodes: Record<string, ComponentNode> = {
    n1: screen(["n2", "n3"]),
    n3: SIBLING,
  };
  const chain = BOUNDS.elementDepth + 8;
  for (let level = 0; level < chain; level += 1) {
    const id = level === 0 ? "n2" : `d${level}`;
    const child = `d${level + 1}`;
    nodes[id] = node("Stack", {}, level + 1 < chain ? [child] : []);
  }
  return document_(nodes);
}

describe("mountOrFallback — the deterministic corrupt-subtree path (DC-013)", () => {
  for (const cause of CAUSES) {
    it(`replaces the subtree root and keeps valid siblings for ${cause.name}`, () => {
      const { container } = mount(cause.document);

      expect(theCorruptElement(container).textContent).toBe(COPY.render.corruptSubtree);
      // The sibling is asserted after the degrade: isolation that only holds
      // until something goes wrong is not isolation.
      expect(container.querySelector('[data-testid="text"]')?.textContent).toBe("sibling");
      expect(container.querySelector('[data-testid="screen"]')).not.toBeNull();
    });
  }

  it("produces one byte-identical outcome for every corrupt cause", () => {
    const rendered = CAUSES.map((cause) => {
      const view = mount(cause.document);
      const html = theCorruptElement(view.container).outerHTML;
      view.unmount();
      return html;
    });

    // Not separate assertions that each looks right — one assertion that they are
    // the same string. Which cause occurred is not recoverable from the page.
    expect(new Set(rendered).size).toBe(1);
    expect(rendered[0]).toContain('data-facet-neutral-state="corrupt-subtree"');
  });

  it("renders the same bytes on a repeat run of every cause", () => {
    for (const cause of CAUSES) {
      const first = mount(cause.document);
      const before = first.container.innerHTML;
      first.unmount();
      const second = mount(cause.document);
      const after = second.container.innerHTML;
      second.unmount();

      expect(after).toBe(before);
    }
  });

  it("terminates on a self-referential document without expanding it", () => {
    // A document that points at itself from two directions. Without the
    // visited-ancestor set this render does not return; with it, the walk stops
    // at the first repeat and the output stays bounded.
    const { container } = mount(
      document_({
        n1: screen(["n2", "n3"]),
        n2: node("Stack", {}, ["n2"]),
        n3: SIBLING,
      }),
    );

    expect(container.querySelectorAll(CORRUPT).length).toBe(1);
    expect(container.querySelectorAll("*").length).toBeLessThan(32);
    expect(container.querySelector('[data-testid="text"]')?.textContent).toBe("sibling");
  });

  it("cuts a chain at B-03 exactly, mounting the level at the bound and no level past it", () => {
    const { container } = mount(overDepthDocument());

    // The screen root stands at the second level of the document, so the levels
    // a `Stack` may occupy are 3 through `B-03` inclusive.
    expect(container.querySelectorAll('[data-testid="stack"]').length).toBe(
      BOUNDS.elementDepth - 2,
    );
    expect(container.querySelectorAll(CORRUPT).length).toBe(1);
  });

  it("never mounts the implementation of a degraded subtree", () => {
    const mounted: string[] = [];
    const watched: ComponentRegistry = Object.freeze({
      ...REGISTRY,
      Stack: (props: ComponentMountProps<ReactNode>) => {
        mounted.push("Stack");
        return StackImpl(props);
      },
    });

    mount(
      document_({
        n1: screen(["n2", "n3"]),
        n2: node("Stack", {}, ["n4"]),
        n3: SIBLING,
        n4: node("Stack", {}, ["n2"]),
      }),
      { overrides: { registry: watched } },
    );

    // Two `Stack`s are on the legal path; the third is the cycle, and it is not
    // handed to the implementation at all.
    expect(mounted).toEqual(["Stack", "Stack"]);
  });

  const PROP_FAULTS: readonly { readonly name: string; readonly node: ComponentNode }[] = [
    { name: "an undeclared prop", node: node("Text", { value: scalar("x"), nope: scalar("y") }) },
    { name: "a missing required prop", node: node("Text", {}) },
    {
      name: "a value outside the declared type",
      node: node("Text", { value: scalar("x"), total: scalar("not-a-number") }),
    },
    {
      name: "a binding on a prop that is not bindable",
      node: node("Text", { value: reference("data", "sales.label") }),
    },
  ];

  for (const fault of PROP_FAULTS) {
    it(`degrades the subtree root for ${fault.name}`, () => {
      const { container } = mount(
        document_({ n1: screen(["n2", "n3"]), n2: fault.node, n3: SIBLING }),
        { model: { sales: { label: "Sales" } } },
      );

      expect(theCorruptElement(container).textContent).toBe(COPY.render.corruptSubtree);
      expect(container.querySelector('[data-testid="text"]')?.textContent).toBe("sibling");
    });
  }

  it("degrades exact lowercase resolved arg past B-23 before mount or event dispatch", () => {
    const mounted: string[] = [];
    const reported: string[] = [];
    const watched: ComponentRegistry = Object.freeze({
      ...REGISTRY,
      Text: (props: ComponentMountProps<ReactNode>) => {
        mounted.push(String(props.props["value"] ?? ""));
        return TextImpl(props);
      },
    });

    const { container } = mount(
      document_({
        n1: screen(["n2", "n3"]),
        n2: node("Text", {
          value: scalar("call"),
          action: reference("agent", "refresh"),
          arg: scalar("x".repeat(BOUNDS.collectedValueChars + 1)),
        }),
        n3: SIBLING,
      }),
      {
        overrides: {
          registry: watched,
          onAction: (nodeId, prop) => {
            reported.push(`${nodeId}/${prop}`);
          },
        },
      },
    );

    expect(theCorruptElement(container).textContent).toBe(COPY.render.corruptSubtree);
    expect(container.querySelector('[data-testid="text"]')?.textContent).toBe("sibling");
    expect(mounted).toEqual(["sibling"]);
    expect(reported).toEqual([]);
  });

  it("degrades a node whose child list repeats an id", () => {
    // Every node in an accepted document has exactly one parent, so a repeated
    // child id is persisted corruption — and it is the one shape that would put
    // two subtrees under one boundary identity.
    const { container } = mount(
      document_({
        n1: screen(["n2", "n3"]),
        n2: node("Stack", {}, ["n3", "n3"]),
        n3: SIBLING,
      }),
    );

    expect(container.querySelectorAll(CORRUPT).length).toBe(1);
    expect(container.querySelector('[data-testid="text"]')?.textContent).toBe("sibling");
  });

  it("degrades a node carrying children its spec does not accept", () => {
    const { container } = mount(
      document_({
        n1: screen(["n2", "n3"]),
        n2: node("Text", { value: scalar("childless") }, ["n3"]),
        n3: SIBLING,
      }),
    );

    expect(container.querySelectorAll(CORRUPT).length).toBe(1);
  });
});

/**
 * The cause that hides: a node whose own shape, or whose spec, could not be read
 * at all.
 *
 * `resolveProps` answers such a node with an **empty prop record** and a
 * **node-scoped** issue. The empty record is the trap — it has exactly the shape
 * of a healthy component that has nothing to show — so a policy that inferred
 * health from `issues.length` or from an empty `props` would mount a
 * catastrophically failed node and call it success. The first test here anchors
 * the fixture to the real seam, so the two that follow cannot pass because
 * something rejected the node earlier for an unrelated reason.
 */
describe("mountOrFallback — a node-scoped resolution issue", () => {
  const TEXT_SPEC = SPECS.find((spec) => spec.tag === "Text") as ComponentSpec;

  /** A spec that cannot be read at all — every read on it throws. */
  function unreadableSpec(): ComponentSpec {
    const revocable = Proxy.revocable({ ...TEXT_SPEC }, {});
    revocable.revoke();
    return revocable.proxy as ComponentSpec;
  }

  /** The catalog index with `Text`'s spec replaced by one that cannot be read. */
  function poisonedIndex(): ReadonlyMap<string, ComponentSpec> {
    return new Map(
      [...INDEX].map(([tag, spec]) => [tag, tag === "Text" ? unreadableSpec() : spec]),
    );
  }

  const DOCUMENT = document_({
    n1: screen(["n2", "n3"]),
    n2: node("Text", { value: scalar("unreadable spec") }),
    n3: node("Stack", {}, []),
  });

  it("really does produce a node-scoped issue over an empty prop record", () => {
    // The anchor. Without it, the two tests below would still pass if mounting
    // happened to reject this node one step earlier, and the path the ruling is
    // about would never run.
    const resolution = resolveProps(DOCUMENT.nodes["n2"] as ComponentNode, unreadableSpec(), {});

    expect(Object.keys(resolution.props)).toEqual([]);
    expect(resolution.issues.some((issue) => issue.scope === "node")).toBe(true);
    // And this is why the scope has to be read: by shape alone, the resolution
    // is indistinguishable from a healthy component with nothing to show.
    expect(resolution.issues.some((issue) => issue.scope === "prop")).toBe(false);
  });

  it("degrades the subtree root and keeps valid siblings", () => {
    const { container } = mount(DOCUMENT, { overrides: { index: poisonedIndex() } });

    expect(theCorruptElement(container).textContent).toBe(COPY.render.corruptSubtree);
    expect(container.querySelector('[data-testid="stack"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="screen"]')).not.toBeNull();
  });

  it("never hands the failed node to its implementation", () => {
    const mounted: string[] = [];
    const watched: ComponentRegistry = Object.freeze({
      ...REGISTRY,
      Text: (props: ComponentMountProps<ReactNode>) => {
        mounted.push("Text");
        return TextImpl(props);
      },
    });

    mount(DOCUMENT, { overrides: { index: poisonedIndex(), registry: watched } });

    // Mounting it with zero props would be the fail-safe boundary reporting
    // success for a node that failed catastrophically.
    expect(mounted).toEqual([]);
  });

  it("takes the same path as the other causes, byte for byte", () => {
    const view = mount(DOCUMENT, { overrides: { index: poisonedIndex() } });
    const nodeScoped = theCorruptElement(view.container).outerHTML;
    view.unmount();

    const structural = mount(CAUSES[0]?.document as ComponentDocument);
    const other = theCorruptElement(structural.container).outerHTML;

    expect(nodeScoped).toBe(other);
  });

  it("is degraded through the corrupt path, not caught as a crash by the parent", () => {
    // The distinction is the whole point, and it is invisible if you only ask
    // whether an error escaped. Mounting reads a spec *before* `resolveProps`
    // runs — `acceptsChildren` — and an unguarded read there throws from inside
    // the **parent's** render, where the parent's own `SubtreeBoundary` catches
    // it. Nothing escapes, so a "did anything throw" assertion passes happily
    // while the blast radius has silently grown from this node's subtree to its
    // parent's. The crash state is what tells the two apart.
    const { container } = mount(DOCUMENT, { overrides: { index: poisonedIndex() } });

    expect(container.querySelectorAll(CRASHED).length).toBe(0);
    expect(container.querySelectorAll(CORRUPT).length).toBe(1);
  });
});

describe("deriveResetToken — the node-local derivation (D3)", () => {
  const props = Object.freeze({ value: "hello", total: 42 });

  it("is a pure function of tag, resolved props and child ids", () => {
    expect(deriveResetToken("Text", props, ["n5"])).toBe(deriveResetToken("Text", props, ["n5"]));
    expect(deriveResetToken("Text", { ...props }, ["n5"])).toBe(
      deriveResetToken("Text", props, ["n5"]),
    );
  });

  it("changes when this node's own resolved value or child ids change", () => {
    const base = deriveResetToken("Text", props, ["n5"]);
    expect(deriveResetToken("Text", { value: "hello", total: 43 }, ["n5"])).not.toBe(base);
    expect(deriveResetToken("Text", props, ["n6"])).not.toBe(base);
    expect(deriveResetToken("Text", props, [])).not.toBe(base);
    expect(deriveResetToken("Metric", props, ["n5"])).not.toBe(base);
  });

  it("survives a resolved value that cannot be serialised", () => {
    const hostile = { rows: [] as unknown[] };
    hostile.rows.push(hostile);

    const token = deriveResetToken("Text", { rows: hostile.rows }, []);
    expect(typeof token).toBe("string");
    // Deterministic, so a node holding an unserialisable value does not remount
    // on every render.
    expect(deriveResetToken("Text", { rows: hostile.rows }, [])).toBe(token);
  });

  it("is byte-identical when an unrelated node changes and when an unrelated publish lands", () => {
    // The three inputs a revision-keyed token would have folded in: another
    // node's props, another node's children, and a new Data Model. None of them
    // is an input here, so the token cannot move for any of them.
    const stable = deriveResetToken("Text", { value: "mine" }, ["n5"]);
    expect(deriveResetToken("Text", { value: "mine" }, ["n5"])).toBe(stable);
  });
});

describe("MountNode — boundary identity and node-local reset", () => {
  /**
   * A crashing node beside a healthy neighbour, parameterised so a re-render can
   * change exactly one of the two. The crashing node keeps its id **and its
   * tag** throughout, so its boundary keeps the same identity and the same
   * instance: anything that clears it cleared because of `resetToken`, not
   * because React threw the boundary away and built a new one.
   */
  function pair(crashValue: string, neighbourValue: string): ComponentDocument {
    return document_({
      n1: screen(["n2", "n3"]),
      n2: node("Flaky", { value: scalar(crashValue) }),
      n3: node("Text", { value: scalar(neighbourValue) }),
    });
  }

  function remount(view: ReturnType<typeof render>, document: ComponentDocument, model: DataModel) {
    view.rerender(
      <DataProvider model={model}>
        <MountNode context={context(document)} nodeId="n1" />
      </DataProvider>,
    );
  }

  /**
   * Latches the fixture, then disarms it out of band.
   *
   * After this, the crashing component would render happily if it were asked
   * again — and nothing `resetToken` is derived from has moved. Whether it is
   * asked again is therefore the whole question, and it is observable in two
   * ways at once: the crash state standing or not, and whether the component's
   * body ran at all.
   */
  function latchedAndDisarmed(document: ComponentDocument, model: DataModel = {}) {
    flakyArmed = true;
    const view = withSilencedReactReport(() => mount(document, { model }));
    expect(view.container.querySelectorAll(CRASHED).length).toBe(1);
    flakyArmed = false;
    flakyRenders = 0;
    return view;
  }

  afterEach(() => {
    flakyArmed = true;
  });

  it("keeps a latched subtree latched when a neighbour's input changes", () => {
    const view = latchedAndDisarmed(pair("boom", "before"));

    remount(view, pair("boom", "after"), {});

    // The neighbour moved; this node's own input did not. A revision-keyed reset
    // would clear here and hand the subtree back — and because the fixture is
    // disarmed, that would show as the component rendering instead of the crash
    // state. Asserting the crash state alone would not see it: a boundary that
    // cleared and re-rendered a component that *still* threw would latch again
    // and look identical.
    expect(view.container.querySelectorAll(CRASHED).length).toBe(1);
    expect(view.container.querySelector('[data-testid="flaky"]')).toBeNull();
    expect(flakyRenders).toBe(0);
    expect(view.container.querySelector('[data-testid="text"]')?.textContent).toBe("after");
  });

  it("keeps a latched subtree latched across an unrelated data publish", () => {
    const document = pair("boom", "steady");
    const view = latchedAndDisarmed(document, { sales: { total: 1 } });

    remount(view, document, { sales: { total: 2 } });

    expect(view.container.querySelectorAll(CRASHED).length).toBe(1);
    expect(view.container.querySelector('[data-testid="flaky"]')).toBeNull();
    expect(flakyRenders).toBe(0);
  });

  it("keeps a latched subtree latched when a node elsewhere in the tree is replaced", () => {
    // The third shape a stage-wide reset input would fold in: the document
    // gaining and losing nodes that have nothing to do with this subtree.
    const view = latchedAndDisarmed(pair("boom", "steady"));

    remount(
      view,
      document_({
        n1: screen(["n2", "n3", "n4"]),
        n2: node("Flaky", { value: scalar("boom") }),
        n3: node("Text", { value: scalar("steady") }),
        n4: node("Text", { value: scalar("brand new") }),
      }),
      {},
    );

    expect(view.container.querySelectorAll(CRASHED).length).toBe(1);
    expect(flakyRenders).toBe(0);
  });

  it("revives exactly the crashed subtree when its own input changes", () => {
    flakyArmed = true;
    const view = withSilencedReactReport(() => mount(pair("boom", "steady")));
    expect(view.container.querySelectorAll(CRASHED).length).toBe(1);
    flakyRenders = 0;

    // Same node id, same tag, same boundary instance — only this node's own
    // resolved prop moved, and that is the one event that justifies another go.
    remount(view, pair("recovered", "steady"), {});

    expect(flakyRenders).toBeGreaterThan(0);

    expect(view.container.querySelectorAll(CRASHED).length).toBe(0);
    expect(view.container.querySelector('[data-testid="flaky"]')?.textContent) //
      .toBe("recovered");
    expect(view.container.querySelector('[data-testid="text"]')?.textContent).toBe("steady");
  });

  it("does not remount a healthy subtree when a neighbour's input changes", () => {
    mounts.length = 0;
    const view = mount(
      document_({
        n1: screen(["n2", "n3"]),
        n2: node("Text", { value: scalar("steady") }),
        n3: node("Text", { value: scalar("before") }),
      }),
    );
    expect(mounts).toEqual(["Text:steady", "Text:before"]);

    view.rerender(
      <DataProvider model={{}}>
        <MountNode
          context={context(
            document_({
              n1: screen(["n2", "n3"]),
              n2: node("Text", { value: scalar("steady") }),
              n3: node("Text", { value: scalar("after") }),
            }),
          )}
          nodeId="n1"
        />
      </DataProvider>,
    );

    // `steady` re-rendered but did not remount, which is what protects unrelated
    // field state, focus and open modal state on every accepted mutation.
    expect(mounts.filter((entry) => entry === "Text:steady").length).toBe(1);
  });

  it("keeps a node's own React state across a neighbour's change, and drops it when the node moves", () => {
    function Stateful(): ReactNode {
      const [count, setCount] = useState(0);
      return (
        <button type="button" data-testid="stateful" onClick={() => setCount((n) => n + 1)}>
          {`clicked ${count}`}
        </button>
      );
    }
    const registry: ComponentRegistry = Object.freeze({ ...REGISTRY, Rogue: Stateful });
    const documentWith = (value: string): ComponentDocument =>
      document_({
        n1: screen(["n2", "n3"]),
        n2: node("Rogue"),
        n3: node("Text", { value: scalar(value) }),
      });

    const view = mount(documentWith("before"), { overrides: { registry } });
    fireEvent.click(view.container.querySelector('[data-testid="stateful"]') as HTMLElement);
    expect(view.container.querySelector('[data-testid="stateful"]')?.textContent) //
      .toBe("clicked 1");

    view.rerender(
      <DataProvider model={{}}>
        <MountNode context={context(documentWith("after"), { registry })} nodeId="n1" />
      </DataProvider>,
    );

    expect(view.container.querySelector('[data-testid="stateful"]')?.textContent) //
      .toBe("clicked 1");
  });
});

describe("mount-node.tsx source", () => {
  const path = join(dirname(fileURLToPath(import.meta.url)), "mount-node.tsx");
  const raw = readFileSync(path, "utf8");
  const source = withoutComments(raw);

  it("strips its own comments before scanning, so the scan can actually fail", () => {
    // The prose above the code discusses every banned token at length, so a scan
    // over the raw text would match itself and pass for the wrong reason.
    expect(raw).toContain("stageRevision");
    expect(raw.toLowerCase()).toContain("z-index");
    expect(source).not.toContain("stageRevision");
  });

  it("never names the authoritative revision in its code", () => {
    for (const banned of ["revision", "foldcount"]) {
      expect(source.toLowerCase()).not.toContain(banned);
    }
  });

  it("emits no positioning or stacking of its own", () => {
    for (const banned of ["position", "zindex", "z-index"]) {
      expect(source.toLowerCase()).not.toContain(banned);
    }
  });
});

/** Source text with block and line comments removed, leaving the code alone. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
