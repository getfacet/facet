// @vitest-environment jsdom
/**
 * The proof that the renderer's public entry composes one session — and that the
 * pieces it wires together keep every guarantee they hold on their own.
 *
 * Seven claims carry this file.
 *
 * **Example 1 renders end to end, through registered implementations.** The
 * markup from the product contract is parsed by `@facet/core`, validated against
 * a **local trusted catalog** written in this file, and mounted through a local
 * registry of trusted React components — never through `@facet/assets`, which
 * this package may not import at all (D-09). The value-level proof that the
 * *shipped* defaults mount belongs to WU-29 and WU-81; what is proven here is
 * the composition: markup in, registered components on the page, with binding,
 * navigation, fields and the framework modal frame all live at once.
 *
 * **Navigation and collection are the renderer's, not a component's.** A
 * registered `Button` reports only that its `action` prop was activated. This
 * module holds the document, resolves the reference, moves the visitor for a
 * `nav:` and forwards an `agent:` event carrying exactly the fields the author
 * named in `collect` — assembled from the field store, never from the DOM. A
 * whole cycle of both leaves the document byte-identical, because the browser is
 * not a second writer.
 *
 * **A late publish refreshes bound components and blanks nothing.** The same
 * document is rendered under an empty model and under the published one: the
 * `Metric` mounts either way, without its value the first time and with it the
 * second, and no markup changed between them (DC-019).
 *
 * **The overlay root is mounted once per session, as a sibling of the document
 * tree.** Exactly one `[data-facet-overlay-root]` exists per `StageRenderer`,
 * two renderers on one page have one each, and an ancestor walk finds no
 * containment element above any of them (D-13). A `Modal` declared inside a
 * `Card` inside a `Grid`, beside a later sibling that paints itself at
 * `z-index: 99999`, is **not present inline** and paints from the overlay root —
 * asserted after an anchor test that the fixture really is that deep and the
 * sibling really is that elevated.
 *
 * **Two open modals are ordered by when they opened, in either order.** The
 * suite opens them against both orders that could stand in for the open order —
 * document order and id order — and states which dialog paints on top, which one
 * holds focus, and that Escape closes **only** that one.
 *
 * **The seam is the framework's and carries the theme.** `renderModal` is
 * memo-stable across unrelated stage updates — proven by counting the distinct
 * callback identities `MountContext` was given, beside a control that counts the
 * context identities and finds them changing, so the counter is known to be able
 * to see change. A host cannot replace the callback: one supplied through props
 * is never called and the framework frame still appears. And the dialog carries
 * the session's projected custom properties, which it can only have got from the
 * closure — it is portalled outside the screen subtree entirely, so nothing
 * above it in the DOM carries them.
 *
 * **The first commit before the portal target exists creates no in-place
 * frame.** That branch is unreachable through the real provider, so the target
 * is withheld through an out-of-band switch on a partial mock of
 * `containment.js` whose `useOverlayRoot` still calls the real hook and only
 * hides its answer. A settled DOM read cannot tell "rendered nothing" from
 * "never opened", so the registered `Modal` counts its own renders, and a
 * control test with the switch off proves the withholding was the cause.
 *
 * Two jsdom traps are avoided deliberately. `expect(() => fireEvent(…))
 * .not.toThrow()` can never fail for a React event handler — React catches at
 * its dispatch boundary and routes the error to the environment — so escapes are
 * captured from the `window` `error` event instead. And `result.current` after
 * `act()` cannot falsify a claim about an intermediate commit, which is why the
 * withheld-target case counts renders rather than reading the settled DOM.
 *
 * The suite reads `node:fs` for two source scans, the same exception
 * `containment.test.ts` and `modal-frame.test.tsx` take, and builds the path
 * with `fileURLToPath` because under jsdom `new URL(file, import.meta.url)`
 * resolves against `http://localhost:3000/` rather than against the file it
 * stands in.
 */

import { parseMarkup, themeToCssVars, validateAuthorMarkup, validateCatalog } from "@facet/core";
import type {
  ComponentDocument,
  ComponentMountProps,
  ComponentNode,
  ComponentSpec,
  DataModel,
  FacetTheme,
} from "@facet/core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { bootstrapRenderer } from "./bootstrap.js";
import type { RendererBootstrap } from "./bootstrap.js";
import { CONTAINMENT_ATTRIBUTE, OVERLAY_ROOT_ATTRIBUTE } from "./containment.js";
import { MODAL_PART_ATTRIBUTE } from "./modal-frame.js";
import type { ComponentRegistry } from "./registry.js";
import { StageRenderer } from "./StageRenderer.js";
import type { StageRendererProps } from "./StageRenderer.js";
import { errorsDuring } from "../../../../test-support/errors-during.js";
import { validTestTheme } from "../../../../test-support/theme-fixture.js";

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
    // the hook order are all unchanged, and only the answer is hidden.
    useOverlayRoot: (): HTMLElement | null => {
      const target = actual.useOverlayRoot();
      return overlayRoot.withheld ? null : target;
    },
  };
});

/**
 * What the mount seam was handed, on every render.
 *
 * The context object and the `renderModal` callback are recorded separately and
 * both are recorded from the **same** value, which is what makes the memo
 * assertion falsifiable: the context identity is expected to change across a
 * stage update and the callback identity is expected not to, so a recorder that
 * could not see change at all would fail its own control.
 */
const mounts = vi.hoisted(() => ({
  contexts: [] as unknown[],
  renderModals: [] as unknown[],
}));

vi.mock("./mount-node.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mount-node.js")>();
  return {
    ...actual,
    // A transparent wrapper: it records the two identities and then renders the
    // real walk with exactly what it was given.
    MountNode: (props: Parameters<typeof actual.MountNode>[0]): ReactNode => {
      mounts.contexts.push(props.context);
      mounts.renderModals.push(props.context.renderModal);
      return actual.MountNode(props);
    },
  };
});

/** Every render of a registered `Modal`'s content, in order. */
const modalContentRenders: string[] = [];

/** Every event the stage forwarded, in order. */
const events: Record<string, unknown>[] = [];

afterEach(() => {
  cleanup();
  overlayRoot.withheld = false;
  document.body.style.overflow = "";
  modalContentRenders.length = 0;
  events.length = 0;
  mounts.contexts.length = 0;
  mounts.renderModals.length = 0;
});

// ── The two themes every projection assertion is made under ──────────────────

const THEME: FacetTheme = validTestTheme({
  semantic: {
    surface: { default: "#ffffff" },
    text: { default: "#101010", muted: "#6b6b6b" },
  },
});

const DARK_THEME: FacetTheme = validTestTheme({
  semantic: {
    surface: { default: "#17171d" },
    text: { default: "#f2f2f5", muted: "#9a9aa6" },
  },
});

const THEME_VARS = themeToCssVars(THEME);
const DARK_VARS = themeToCssVars(DARK_THEME);

// ── Trusted implementations. Local, because @facet/react may not import assets ─

function screenImpl({ props, children }: ComponentMountProps<ReactNode>): ReactNode {
  return (
    <section data-testid="screen" data-screen={String(props["name"] ?? "")}>
      {children}
    </section>
  );
}

/** A container that shows its own tag, so nesting is visible in the DOM. */
function containerImpl(testId: string): (mount: ComponentMountProps<ReactNode>) => ReactNode {
  return function Impl({ children }: ComponentMountProps<ReactNode>): ReactNode {
    return <div data-testid={testId}>{children}</div>;
  };
}

function textImpl({ props }: ComponentMountProps<ReactNode>): ReactNode {
  return <p data-testid="text">{String(props["value"] ?? "")}</p>;
}

/**
 * The bound number. The value is written as an **attribute that is absent when
 * the binding did not resolve**, so "no value yet" and "the value is empty" stay
 * distinguishable — which is the whole of DC-019's late-publish case.
 */
function metricImpl({ props }: ComponentMountProps<ReactNode>): ReactNode {
  const value = props["value"];
  return (
    <div
      data-testid="metric"
      data-label={String(props["label"] ?? "")}
      {...(value === undefined ? {} : { "data-value": String(value) })}
    />
  );
}

function tableImpl({ props }: ComponentMountProps<ReactNode>): ReactNode {
  const rows = Array.isArray(props["rows"]) ? props["rows"] : [];
  return <div data-testid="table" data-rows={String(rows.length)} />;
}

/**
 * Reports the activation and nothing else: what it means is the renderer's.
 *
 * The declared `arg` is written as an **attribute that is absent when the prop
 * is**, the same way `metricImpl` writes its bound value, so "the component was
 * handed no argument" and "the component was handed an empty one" stay
 * distinguishable in the DOM. That distinction is what makes the claim about
 * what a trusted component receives assertable at all.
 */
function buttonImpl({ props, onAction }: ComponentMountProps<ReactNode>): ReactNode {
  const arg = props["arg"];
  return (
    <button
      type="button"
      data-testid="button"
      {...(arg === undefined ? {} : { "data-arg": String(arg) })}
      onClick={(): void => {
        onAction("action");
      }}
    >
      {String(props["label"] ?? "")}
    </button>
  );
}

function fieldImpl({ props, onValueChange }: ComponentMountProps<ReactNode>): ReactNode {
  return (
    <input
      data-testid="field"
      aria-label={String(props["label"] ?? "")}
      value={String(props["value"] ?? "")}
      onChange={(event): void => {
        onValueChange?.(event.target.value);
      }}
    />
  );
}

/**
 * Flow content, and a render counter.
 *
 * The counter is what lets "renders nothing at all for that commit" be a claim
 * rather than a hope: a DOM read after the dust settles cannot tell a frame that
 * rendered nothing from a frame that never opened.
 */
function modalImpl({ props, children }: ComponentMountProps<ReactNode>): ReactNode {
  modalContentRenders.push(String(props["title"] ?? ""));
  return <div data-testid="modal-content">{children}</div>;
}

/** A registered component that paints itself above everything it can reach. */
function rogueImpl(): ReactNode {
  return <div data-testid="rogue" style={{ position: "fixed", zIndex: 99_999 }} />;
}

// ── The catalog Example 1 is authored against ────────────────────────────────

const SCREEN_SPEC: ComponentSpec = {
  tag: "Screen",
  whenToUse: "The root of one named screen.",
  props: {
    name: { type: "string", required: true, guidance: "This screen's name, as `nav:` reaches it." },
  },
  acceptsChildren: true,
};

const STACK_SPEC: ComponentSpec = {
  tag: "Stack",
  whenToUse: "Stack children vertically in reading order.",
  props: {
    gap: {
      type: "string",
      enum: ["none", "sm", "md", "lg"],
      default: "md",
      guidance: "Space between children, named in theme space tokens.",
    },
  },
  acceptsChildren: true,
};

const TEXT_SPEC: ComponentSpec = {
  tag: "Text",
  whenToUse: "Show a line of prose.",
  props: {
    value: { type: "string", required: true, bindable: true, guidance: "The words to show." },
  },
  acceptsChildren: false,
};

const METRIC_SPEC: ComponentSpec = {
  tag: "Metric",
  whenToUse: "Show one headline number with the label that says what it measures.",
  props: {
    label: { type: "string", required: true, guidance: "What the number measures." },
    value: { type: "number", required: true, bindable: true, guidance: "The number itself." },
  },
  acceptsChildren: false,
};

const BUTTON_SPEC: ComponentSpec = {
  tag: "Button",
  whenToUse: "Give the visitor one control that navigates or sends an event.",
  props: {
    label: { type: "string", required: true, guidance: "The words on the control." },
    action: {
      type: "string",
      required: true,
      guidance: "`nav:<screen>` or `agent:<event>`; there is no other action.",
    },
    arg: {
      type: "string",
      guidance: "The one explicit argument this `agent:` event sends.",
    },
    collect: {
      type: "string",
      guidance: "The `Field` names this `agent:` event carries, separated by spaces.",
    },
  },
  acceptsChildren: false,
};

const FIELD_SPEC: ComponentSpec = {
  tag: "Field",
  whenToUse: "Ask the visitor for one value a `Button` can name in its `collect` list.",
  props: {
    name: {
      type: "string",
      required: true,
      guidance: "The name a `collect` list addresses it by.",
    },
    label: { type: "string", required: true, guidance: "What the visitor is being asked for." },
    value: { type: "string", default: "", guidance: "The value shown; Facet owns it." },
    secret: { type: "boolean", default: false, guidance: "Keeps the value out of every event." },
  },
  acceptsChildren: false,
  collect: { collectable: true, valueProp: "value", sensitiveProp: "secret" },
};

const TABLE_SPEC: ComponentSpec = {
  tag: "Table",
  whenToUse: "Show a published collection of records as rows.",
  props: {
    rows: { type: "array", required: true, bindable: true, guidance: "The rows, bound from data." },
  },
  acceptsChildren: false,
};

const MODAL_SPEC: ComponentSpec = {
  tag: "Modal",
  whenToUse: "Interrupt the screen for one focused decision. Facet owns the frame.",
  props: {
    triggerLabel: {
      type: "string",
      required: true,
      guidance: "Label of the control that opens it.",
    },
    title: { type: "string", required: true, guidance: "The dialog's heading." },
  },
  acceptsChildren: true,
};

const EXAMPLE_SPECS: readonly ComponentSpec[] = [
  SCREEN_SPEC,
  STACK_SPEC,
  TEXT_SPEC,
  METRIC_SPEC,
  BUTTON_SPEC,
  FIELD_SPEC,
  TABLE_SPEC,
  MODAL_SPEC,
];

const EXAMPLE_REGISTRY: ComponentRegistry = Object.freeze({
  Screen: screenImpl,
  Stack: containerImpl("stack"),
  Text: textImpl,
  Metric: metricImpl,
  Button: buttonImpl,
  Field: fieldImpl,
  Table: tableImpl,
  Modal: modalImpl,
});

// ── The second catalog: nesting, elevation, and two modals at once ───────────

const GRID_SPEC: ComponentSpec = {
  tag: "Grid",
  whenToUse: "A layout container.",
  props: {},
  acceptsChildren: true,
};

const CARD_SPEC: ComponentSpec = {
  tag: "Card",
  whenToUse: "A bounded surface.",
  props: {},
  acceptsChildren: true,
};

const ROGUE_SPEC: ComponentSpec = {
  tag: "Rogue",
  whenToUse: "A registered component that tries to escape its stacking context.",
  props: {},
  acceptsChildren: false,
};

const NESTING_SPECS: readonly ComponentSpec[] = [
  SCREEN_SPEC,
  GRID_SPEC,
  CARD_SPEC,
  TEXT_SPEC,
  ROGUE_SPEC,
  MODAL_SPEC,
];

const NESTING_REGISTRY: ComponentRegistry = Object.freeze({
  Screen: screenImpl,
  Grid: containerImpl("grid"),
  Card: containerImpl("card"),
  Text: textImpl,
  Rogue: rogueImpl,
  Modal: modalImpl,
});

// ── Fixture construction ─────────────────────────────────────────────────────

type AcceptedBootstrap = Extract<RendererBootstrap, { readonly ok: true }>;

/** Closes the trust boundary, or fails loudly with what the boundary said. */
function bootstrapOrThrow(
  specs: readonly ComponentSpec[],
  registry: ComponentRegistry,
  theme: FacetTheme = THEME,
): AcceptedBootstrap {
  const result = bootstrapRenderer({ catalog: { components: specs }, registry, theme });
  if (!result.ok) {
    throw new Error(`bootstrap refused the fixture: ${result.code} at ${result.at}`);
  }
  return result;
}

const EXAMPLE_BOOTSTRAP = bootstrapOrThrow(EXAMPLE_SPECS, EXAMPLE_REGISTRY);
const DARK_BOOTSTRAP = bootstrapOrThrow(EXAMPLE_SPECS, EXAMPLE_REGISTRY, DARK_THEME);
const NESTING_BOOTSTRAP = bootstrapOrThrow(NESTING_SPECS, NESTING_REGISTRY);

/** The published data the product contract's example publishes. */
const DATA: DataModel = {
  sales: {
    total: 42_000_000,
    rows: [
      { month: "2026-06", revenue: 19_000_000 },
      { month: "2026-07", revenue: 23_000_000 },
    ],
  },
};

/** The markup from the product contract, byte for byte. */
const EXAMPLE_MARKUP = `<Facet entry="home">
  <Screen name="home">
    <Stack gap="md">
      <Text value="July revenue" />
      <Metric label="Total" value="data:sales.total" />
      <Button label="View details" action="nav:details" />
    </Stack>
  </Screen>
  <Screen name="details">
    <Table rows="data:sales.rows" />
    <Modal triggerLabel="Filter" title="Revenue filter">
      <Field name="region" label="Region" />
      <Button label="Refresh" action="agent:refresh" collect="region" />
    </Modal>
  </Screen>
</Facet>`;

/** Parses and validates authored markup, or fails with what the author boundary said. */
function authorDocument(markup: string, specs: readonly ComponentSpec[]): ComponentDocument {
  const parsed = parseMarkup(markup);
  if (!parsed.ok) {
    throw new Error(`the fixture markup did not parse: ${parsed.error.code}`);
  }
  const catalog = validateCatalog({ components: specs });
  if (!catalog.ok) {
    throw new Error(`the fixture catalog is invalid: ${catalog.code} at ${catalog.at}`);
  }
  const validated = validateAuthorMarkup(parsed.ast, catalog.catalog, DATA);
  if (!validated.ok) {
    throw new Error(
      `the fixture markup was refused: ${validated.error.code} — ${validated.error.cause}`,
    );
  }
  return validated.document;
}

const EXAMPLE_DOCUMENT = authorDocument(EXAMPLE_MARKUP, EXAMPLE_SPECS);

function scalar(value: string): ComponentNode["props"][string] {
  return { kind: "scalar", value };
}

/**
 * Example 1 with one node added to the home screen — a **document** update.
 *
 * An accepted mutation folds a patch into the stage and yields a new document
 * object, so this is what the canonical stage update looks like from the
 * renderer's side. It is built to differ genuinely rather than being a
 * structurally-equal copy, because a claim about surviving a document change
 * that is only ever handed an identical document is a claim about nothing.
 */
const EXAMPLE_DOCUMENT_PATCHED: ComponentDocument = (() => {
  const stackId = nodeIdOf(EXAMPLE_DOCUMENT, "Stack", "gap", "md");
  const stack = requireNode(EXAMPLE_DOCUMENT, stackId);
  return {
    ...EXAMPLE_DOCUMENT,
    nodes: {
      ...EXAMPLE_DOCUMENT.nodes,
      [stackId]: { ...stack, children: [...stack.children, "patched"] },
      patched: { tag: "Text", props: { value: scalar("Added by a patch") }, children: [] },
    },
  };
})();

/**
 * The event-argument fixture — deliberately **not** Example 1.
 *
 * Example 1 is the product contract's markup byte for byte and stays that way,
 * so the argument gets its own screen. Five controls, each answering one
 * question: two `agent:` senders carrying **different** arguments, so a read
 * that finds the right value on the wrong node is visible; one that declares no
 * argument at all; one `nav:` that carries one anyway, which the author boundary
 * accepts and the renderer must ignore; and one that carries an argument *and* a
 * collect list, so the two ride together rather than one displacing the other.
 */
const ARG_MARKUP = `<Facet entry="home">
  <Screen name="home">
    <Stack gap="md">
      <Button label="North" action="agent:pick" arg="north" />
      <Button label="South" action="agent:pick" arg="south" />
      <Button label="Bare" action="agent:pick" />
      <Button label="Elsewhere" action="nav:elsewhere" arg="north" />
      <Field name="region" label="Region" />
      <Button label="Both" action="agent:pick" arg="north" collect="region" />
    </Stack>
  </Screen>
  <Screen name="elsewhere">
    <Text value="Arrived" />
  </Screen>
</Facet>`;

const ARG_DOCUMENT = authorDocument(ARG_MARKUP, EXAMPLE_SPECS);

/**
 * A `Button` whose `arg` sits on its props object's **prototype** rather than on
 * the object itself.
 *
 * This is the one document that tells a resolved read apart from a read of the
 * stored value, and it is reachable: `resolveProps` consults `hasOwnProperty`
 * and enumerates own keys only, so an inherited prop is neither resolved nor
 * reported as an unknown one — the node mounts perfectly cleanly. A renderer
 * that reached into the stored props and unwrapped the scalar itself would
 * forward `"planted"`; one that reads what resolution produced forwards nothing.
 *
 * Built with `Object.assign` over an `Object.create`, so the own keys really are
 * only `label` and `action`, which the anchor test states before anything is
 * claimed about it.
 */
const PLANTED_PROPS: ComponentNode["props"] = Object.assign(
  Object.create({ arg: scalar("planted") }) as ComponentNode["props"],
  { label: scalar("Planted"), action: scalar("agent:pick") },
);

const PLANTED_DOCUMENT: ComponentDocument = Object.freeze({
  entry: "home",
  screens: ["s1"],
  nodes: {
    s1: { tag: "Screen", props: { name: scalar("home") }, children: ["b1"] },
    b1: { tag: "Button", props: PLANTED_PROPS, children: [] },
  },
});

/** A `Modal` three containment elements deep, beside a later elevated sibling. */
const NESTING_DOCUMENT: ComponentDocument = Object.freeze({
  entry: "home",
  screens: ["s1"],
  nodes: {
    s1: { tag: "Screen", props: { name: scalar("home") }, children: ["g1", "r1"] },
    g1: { tag: "Grid", props: {}, children: ["c1"] },
    c1: { tag: "Card", props: {}, children: ["m1"] },
    m1: {
      tag: "Modal",
      props: { triggerLabel: scalar("Filter"), title: scalar("Revenue filter") },
      children: [],
    },
    // The later sibling: a whole subtree that paints itself as high as it can.
    r1: { tag: "Rogue", props: {}, children: [] },
  },
});

/**
 * Two modals, opened **against** both orders that could stand in for the open
 * order: `alpha` is first in the document and first by id.
 */
const TWO_MODALS: ComponentDocument = Object.freeze({
  entry: "home",
  screens: ["s1"],
  nodes: {
    s1: { tag: "Screen", props: { name: scalar("home") }, children: ["alpha", "zeta"] },
    alpha: {
      tag: "Modal",
      props: { triggerLabel: scalar("Alpha"), title: scalar("The alpha") },
      children: [],
    },
    zeta: {
      tag: "Modal",
      props: { triggerLabel: scalar("Zeta"), title: scalar("The zeta") },
      children: [],
    },
  },
});

/** The id of the one node with `tag` whose `prop` was authored as `value`. */
function nodeIdOf(document: ComponentDocument, tag: string, prop: string, value: string): string {
  const found = Object.entries(document.nodes).filter(([, node]) => {
    const authored = node.tag === tag ? node.props[prop] : undefined;
    return authored !== undefined && authored.kind === "scalar" && authored.value === value;
  });
  if (found.length !== 1 || found[0] === undefined) {
    throw new Error(`the fixture has ${found.length} ${tag} nodes with ${prop}="${value}"`);
  }
  return found[0][0];
}

function requireNode(document: ComponentDocument, nodeId: string): ComponentNode {
  const node = document.nodes[nodeId];
  if (node === undefined) {
    throw new Error(`the fixture has no node ${nodeId}`);
  }
  return node;
}

// ── DOM helpers ──────────────────────────────────────────────────────────────

function all(selector: string): readonly HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(selector)];
}

function one(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (element === null) {
    throw new Error(`nothing matched ${selector}`);
  }
  return element;
}

function testIds(testId: string): readonly HTMLElement[] {
  return all(`[data-testid="${testId}"]`);
}

function part(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${MODAL_PART_ATTRIBUTE}="${name}"]`);
}

function partsOf(name: string): readonly HTMLElement[] {
  return all(`[${MODAL_PART_ATTRIBUTE}="${name}"]`);
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

/** Every `--facet-*` custom property the element itself declares, with its value. */
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

/** The registered button whose label is `label`, for reading what it was handed. */
function buttonNamed(label: string): HTMLElement {
  const button = testIds("button").find((candidate) => candidate.textContent === label);
  if (button === undefined) {
    throw new Error(`no registered button labelled ${label}`);
  }
  return button;
}

/** Clicks the registered button whose label is `label`. */
function clickButton(label: string): void {
  fireEvent.click(buttonNamed(label));
}

/** Clicks the framework trigger whose label is `label`. */
function openTrigger(label: string): void {
  const trigger = partsOf("trigger").find((candidate) => candidate.textContent === label);
  if (trigger === undefined) {
    throw new Error(`no modal trigger labelled ${label}`);
  }
  fireEvent.click(trigger);
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

function openTitles(): readonly string[] {
  return partsOf("title").map((heading) => heading.textContent ?? "");
}

function sourceOf(file: string): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), file), "utf8");
}

/** Every module specifier a source imports, however the import is spelled. */
function importedModules(source: string): readonly string[] {
  return [...source.matchAll(/(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g)].map(
    (match) => match[1] ?? "",
  );
}

/** The stage as a host mounts it, with the fixture's accepted bootstrap. */
function stage(overrides: {
  readonly bootstrap?: AcceptedBootstrap;
  readonly document?: ComponentDocument | null;
  readonly data?: DataModel;
  readonly onEvent?: StageRendererProps["onEvent"];
}): ReactNode {
  const bootstrap = overrides.bootstrap ?? EXAMPLE_BOOTSTRAP;
  const chosen = overrides.document === undefined ? EXAMPLE_DOCUMENT : overrides.document;
  const onEvent =
    overrides.onEvent ??
    ((event): void => {
      events.push({ ...event });
    });
  return (
    <StageRenderer
      bootstrap={bootstrap}
      document={chosen}
      data={overrides.data ?? DATA}
      onEvent={onEvent}
    />
  );
}

// ── The suite ────────────────────────────────────────────────────────────────

describe("the fixture itself", () => {
  it("really parsed and validated the product contract's markup", () => {
    // The anchor for every Example 1 claim below: a fixture that silently
    // failed to author would make an empty page look like a passing render.
    expect(EXAMPLE_DOCUMENT.entry).toBe("home");
    expect(EXAMPLE_DOCUMENT.screens.length).toBe(2);
    const tags = Object.values(EXAMPLE_DOCUMENT.nodes)
      .map((node) => node.tag)
      .sort();
    expect(tags).toEqual([
      "Button",
      "Button",
      "Field",
      "Metric",
      "Modal",
      "Screen",
      "Screen",
      "Stack",
      "Table",
      "Text",
    ]);
    // And the registry really covers exactly those tags, so nothing below is
    // green because a tag quietly went missing.
    expect(Object.keys(EXAMPLE_BOOTSTRAP.registry).sort()).toEqual([
      "Button",
      "Field",
      "Metric",
      "Modal",
      "Screen",
      "Stack",
      "Table",
      "Text",
    ]);
  });
});

describe("Example 1, end to end through registered implementations", () => {
  it("mounts the entry screen and nothing else", () => {
    render(stage({}));

    expect(testIds("screen").length).toBe(1);
    expect(one('[data-testid="screen"]').getAttribute("data-screen")).toBe("home");
    expect(testIds("text").map((node) => node.textContent)).toEqual(["July revenue"]);
    expect(one('[data-testid="metric"]').getAttribute("data-label")).toBe("Total");
    expect(one('[data-testid="metric"]').getAttribute("data-value")).toBe("42000000");
    expect(testIds("button").map((node) => node.textContent)).toEqual(["View details"]);
    // The second screen is declared, not mounted.
    expect(testIds("table")).toEqual([]);
    expect(part("trigger")).toBeNull();
  });

  it("navigates on a nav: reference without writing a byte of the document", () => {
    const before = JSON.stringify(EXAMPLE_DOCUMENT);
    render(stage({}));
    clickButton("View details");

    expect(one('[data-testid="screen"]').getAttribute("data-screen")).toBe("details");
    expect(testIds("screen").length).toBe(1);
    expect(one('[data-testid="table"]').getAttribute("data-rows")).toBe("2");
    // The modal's trigger is in flow; its content is not, because it is closed.
    expect(requirePart("trigger").textContent).toBe("Filter");
    expect(testIds("modal-content")).toEqual([]);
    expect(JSON.stringify(EXAMPLE_DOCUMENT)).toBe(before);
    expect(events).toEqual([]);
  });

  it("forwards an agent: event carrying exactly the field the author named", () => {
    const before = JSON.stringify(EXAMPLE_DOCUMENT);
    const refreshId = nodeIdOf(EXAMPLE_DOCUMENT, "Button", "label", "Refresh");
    render(stage({}));
    clickButton("View details");
    openTrigger("Filter");
    fireEvent.change(one('[data-testid="field"]'), { target: { value: "emea" } });
    clickButton("Refresh");

    expect(events.length).toBe(1);
    // The key set is read as well as the values: `toEqual` ignores a key whose
    // value is `undefined`, so an event that carried a stray empty field would
    // otherwise pass.
    expect(Object.keys(events[0] ?? {}).sort()).toEqual([
      "collect",
      "eventName",
      "screen",
      "sourceNodeId",
    ]);
    expect(events[0]).toEqual({
      eventName: "refresh",
      sourceNodeId: refreshId,
      screen: "details",
      collect: { region: { kind: "value", value: "emea" } },
    });
    // The visitor typing and the event leaving both wrote nothing.
    expect(JSON.stringify(EXAMPLE_DOCUMENT)).toBe(before);
  });

  it("collects from the store rather than the page, so no address is in the DOM", () => {
    render(stage({}));
    clickButton("View details");
    openTrigger("Filter");
    const field = one('[data-testid="field"]');

    // The collection address is the framework's and stops at `FieldHost`.
    expect(field.hasAttribute("name")).toBe(false);
    fireEvent.change(field, { target: { value: "apac" } });
    clickButton("Refresh");
    expect(events[0]?.["collect"]).toEqual({ region: { kind: "value", value: "apac" } });
  });

  it("sends the field's seeded value when the visitor typed nothing, and names it either way", () => {
    render(stage({}));
    clickButton("View details");
    openTrigger("Filter");
    clickButton("Refresh");

    // A named field always produces a key: a missing one would read to the agent
    // as "the visitor left it blank", which is a different claim.
    expect(events[0]?.["collect"]).toEqual({ region: { kind: "value", value: "" } });
    fireEvent.click(requirePart("dismiss"));
    expect(testIds("modal-content")).toEqual([]);
  });
});

describe("the one explicit event argument", () => {
  it("really declares `arg`, so nothing below is green because the prop went missing", () => {
    // The anchor for the whole block: an undeclared prop would resolve to
    // nothing at all, and every omission claim would then be about a fixture
    // rather than about the renderer.
    expect(EXAMPLE_BOOTSTRAP.index.get("Button")?.props["arg"]?.type).toBe("string");
  });

  it("really authored the arguments, including one beside a `nav:` action", () => {
    const north = requireNode(ARG_DOCUMENT, nodeIdOf(ARG_DOCUMENT, "Button", "label", "North"));
    const south = requireNode(ARG_DOCUMENT, nodeIdOf(ARG_DOCUMENT, "Button", "label", "South"));
    const bare = requireNode(ARG_DOCUMENT, nodeIdOf(ARG_DOCUMENT, "Button", "label", "Bare"));
    const away = requireNode(ARG_DOCUMENT, nodeIdOf(ARG_DOCUMENT, "Button", "label", "Elsewhere"));

    expect(north.props["arg"]).toEqual({ kind: "scalar", value: "north" });
    expect(south.props["arg"]).toEqual({ kind: "scalar", value: "south" });
    // Absence is the fixture's own, not the assertion's: there is no bare
    // `props.arg` location, so the omission proven below is about a control that
    // genuinely declares none.
    expect(Object.hasOwn(bare.props, "arg")).toBe(false);
    // And the author boundary really accepted an argument beside a `nav:`.
    // Ignoring it is the renderer's job, not the validator's — which is only a
    // claim worth making if the document reaches the renderer carrying it.
    expect(away.props["action"]).toEqual({ kind: "reference", scheme: "nav", target: "elsewhere" });
    expect(away.props["arg"]).toEqual({ kind: "scalar", value: "north" });
  });

  it("forwards the acting node's own resolved argument with an `agent:` event", () => {
    const northId = nodeIdOf(ARG_DOCUMENT, "Button", "label", "North");
    render(stage({ document: ARG_DOCUMENT }));
    clickButton("North");
    clickButton("South");

    // Two senders carrying different arguments: an argument read off the wrong
    // node is right once and wrong once, and is a plausible string either time.
    expect(events.map((event) => event["arg"])).toEqual(["north", "south"]);
    // The resolved string, never the `{ kind: "scalar" }` descriptor it is
    // stored as — a read that reached into the document would carry the wrapper.
    expect(events.map((event) => typeof event["arg"])).toEqual(["string", "string"]);
    expect(Object.keys(events[0] ?? {}).sort()).toEqual([
      "arg",
      "collect",
      "eventName",
      "screen",
      "sourceNodeId",
    ]);
    expect(events[0]).toEqual({
      eventName: "pick",
      sourceNodeId: northId,
      screen: "home",
      arg: "north",
      collect: {},
    });
  });

  it("omits the key entirely when the interaction declares no argument", () => {
    // Read at the seam itself rather than from the suite's copy of the event,
    // and asserted with `in`: `toEqual` treats a key holding `undefined` as a
    // missing one, so a shape comparison cannot tell an omitted argument from an
    // explicitly empty one. The sender is clicked first as the recorder's own
    // control — a recorder that answered `false` for both would be blind.
    const seen: { readonly hasArg: boolean; readonly keys: readonly string[] }[] = [];
    render(
      stage({
        document: ARG_DOCUMENT,
        onEvent: (event): void => {
          seen.push({ hasArg: "arg" in event, keys: Object.keys(event).sort() });
        },
      }),
    );
    clickButton("North");
    clickButton("Bare");

    expect(seen.map((record) => record.hasArg)).toEqual([true, false]);
    expect(seen[0]?.keys).toEqual(["arg", "collect", "eventName", "screen", "sourceNodeId"]);
    expect(seen[1]?.keys).toEqual(["collect", "eventName", "screen", "sourceNodeId"]);
  });

  it("ignores an authored argument beside a `nav:` action and forwards nothing", () => {
    render(stage({ document: ARG_DOCUMENT }));
    clickButton("Elsewhere");

    expect(one('[data-testid="screen"]').getAttribute("data-screen")).toBe("elsewhere");
    expect(events).toEqual([]);
  });

  it("rides beside the collected fields rather than displacing them", () => {
    const bothId = nodeIdOf(ARG_DOCUMENT, "Button", "label", "Both");
    render(stage({ document: ARG_DOCUMENT }));
    fireEvent.change(one('[data-testid="field"]'), { target: { value: "emea" } });
    clickButton("Both");

    expect(events.length).toBe(1);
    expect(Object.keys(events[0] ?? {}).sort()).toEqual([
      "arg",
      "collect",
      "eventName",
      "screen",
      "sourceNodeId",
    ]);
    expect(events[0]).toEqual({
      eventName: "pick",
      sourceNodeId: bothId,
      screen: "home",
      arg: "north",
      collect: { region: { kind: "value", value: "emea" } },
    });
  });

  it("hands the trusted component its declared argument, unlike the collection address", () => {
    render(stage({ document: ARG_DOCUMENT }));

    // Nothing strips it on the way to the implementation: an argument is neither
    // a hidden address nor a sensitive channel …
    expect(buttonNamed("North").getAttribute("data-arg")).toBe("north");
    expect(buttonNamed("South").getAttribute("data-arg")).toBe("south");
    expect(buttonNamed("Bare").hasAttribute("data-arg")).toBe(false);
    // … which is exactly what does happen to `name`, on the same screen.
    expect(one('[data-testid="field"]').hasAttribute("name")).toBe(false);
  });

  it("really is a fixture whose argument is inherited rather than owned", () => {
    // The anchor: an inherited prop is the one thing that tells a stored read
    // apart from a resolved one, so the fixture has to genuinely be inherited —
    // and has to mount, or the claim below would be about a degraded subtree.
    expect("arg" in PLANTED_PROPS).toBe(true);
    expect(Object.hasOwn(PLANTED_PROPS, "arg")).toBe(false);
    expect(Object.keys(PLANTED_PROPS).sort()).toEqual(["action", "label"]);

    render(stage({ document: PLANTED_DOCUMENT }));
    expect(testIds("button").length).toBe(1);
    expect(all("[data-facet-neutral-state]")).toEqual([]);
  });

  it("forwards no argument for one the acting node does not own", () => {
    const seen: { readonly hasArg: boolean; readonly arg: unknown }[] = [];
    render(
      stage({
        document: PLANTED_DOCUMENT,
        onEvent: (event): void => {
          seen.push({ hasArg: "arg" in event, arg: event.arg });
        },
      }),
    );
    clickButton("Planted");

    expect(seen.length).toBe(1);
    expect(seen[0]?.hasArg).toBe(false);
    expect(seen[0]?.arg).toBeUndefined();
    // The trusted component was handed none either, for the same reason.
    expect(buttonNamed("Planted").hasAttribute("data-arg")).toBe(false);
  });
});

describe("a publish that lands after the markup", () => {
  it("refreshes the bound components without blanking them or rewriting a node", () => {
    const view = render(stage({ data: {} }));

    // Anchor: the region is mounted and simply has no number yet — not degraded,
    // not blank. A dangling binding is about the data, not about the document.
    expect(one('[data-testid="metric"]').getAttribute("data-label")).toBe("Total");
    expect(one('[data-testid="metric"]').hasAttribute("data-value")).toBe(false);
    expect(all("[data-facet-neutral-state]")).toEqual([]);

    view.rerender(stage({ data: DATA }));

    expect(one('[data-testid="metric"]').getAttribute("data-value")).toBe("42000000");
    // The same document produced both renders.
    expect(one('[data-testid="text"]').textContent).toBe("July revenue");
  });

  it("refreshes a bound collection the same way", () => {
    const view = render(stage({ data: {} }));
    clickButton("View details");
    expect(one('[data-testid="table"]').getAttribute("data-rows")).toBe("0");

    view.rerender(stage({ data: DATA }));
    expect(one('[data-testid="table"]').getAttribute("data-rows")).toBe("2");
  });
});

describe("a document that cannot be fully trusted", () => {
  const CORRUPT: ComponentDocument = Object.freeze({
    entry: "home",
    screens: ["s1"],
    nodes: {
      s1: { tag: "Screen", props: { name: scalar("home") }, children: ["t1", "gone", "t2"] },
      t1: { tag: "Text", props: { value: scalar("before") }, children: [] },
      t2: { tag: "Text", props: { value: scalar("after") }, children: [] },
    },
  });

  it("really is missing the node it references", () => {
    // The anchor: the degrade below is about a dangling reference, so the
    // reference has to actually dangle.
    expect(Object.hasOwn(CORRUPT.nodes, "gone")).toBe(false);
    expect(requireNode(CORRUPT, "s1").children).toContain("gone");
  });

  it("replaces exactly that subtree and keeps every valid sibling", () => {
    render(stage({ document: CORRUPT }));

    expect(testIds("text").map((node) => node.textContent)).toEqual(["before", "after"]);
    const neutral = all("[data-facet-neutral-state]");
    expect(neutral.length).toBe(1);
    expect(neutral[0]?.getAttribute("data-facet-neutral-state")).toBe("corrupt-subtree");
  });

  it("shows the preparing state while there is no document at all", () => {
    render(stage({ document: null }));

    const neutral = all("[data-facet-neutral-state]");
    expect(neutral.length).toBe(1);
    expect(neutral[0]?.getAttribute("data-facet-neutral-state")).toBe("preparing");
    expect(testIds("screen")).toEqual([]);
  });

  it("shows a safe empty stage — not a neutral state — when no screen is derivable", () => {
    const noScreens: ComponentDocument = Object.freeze({ entry: "home", screens: [], nodes: {} });
    render(stage({ document: noScreens }));

    expect(all("[data-facet-neutral-state]")).toEqual([]);
    expect(testIds("screen")).toEqual([]);
    // The session is still composed: the overlay root is there either way.
    expect(all(`[${OVERLAY_ROOT_ATTRIBUTE}]`).length).toBe(1);
  });
});

describe("the overlay root this module owns", () => {
  it("exists exactly once per session and never inside a containment element", () => {
    render(stage({}));

    const roots = all(`[${OVERLAY_ROOT_ATTRIBUTE}]`);
    expect(roots.length).toBe(1);
    for (const ancestor of ancestorsOf(roots[0] as Element)) {
      expect(ancestor.hasAttribute(CONTAINMENT_ATTRIBUTE)).toBe(false);
      expect(isIsolated(ancestor)).toBe(false);
    }
  });

  it("gives two renderers on one page one root each, not one between them", () => {
    render(
      <>
        {stage({})}
        {stage({ bootstrap: NESTING_BOOTSTRAP, document: NESTING_DOCUMENT })}
      </>,
    );

    expect(all(`[${OVERLAY_ROOT_ATTRIBUTE}]`).length).toBe(2);
    // Both sessions really mounted, so the count is about two sessions rather
    // than about one session rendered twice.
    expect(testIds("screen").length).toBe(2);
  });

  it("is composed exactly once in the source, host and provider alike", () => {
    const source = sourceOf("StageRenderer.tsx");

    expect(source.match(/<ModalHost/g)?.length).toBe(1);
    expect(source.match(/<OverlayRootProvider/g)?.length).toBe(1);
  });
});

function nestingStage(document: ComponentDocument = NESTING_DOCUMENT): ReactNode {
  return stage({ bootstrap: NESTING_BOOTSTRAP, document });
}

describe("a Modal declared inside a Card inside a Grid", () => {
  it("really is that deep, beside a really elevated sibling", () => {
    // The anchor. Every claim below is about a modal that is nested and a
    // sibling that is elevated; a fixture that produced neither would make all
    // of them green for the wrong reason.
    render(nestingStage());
    const trigger = requirePart("trigger");
    const rogue = one('[data-testid="rogue"]');

    expect(one('[data-testid="card"]').contains(trigger)).toBe(true);
    expect(one('[data-testid="grid"]').contains(trigger)).toBe(true);
    expect(
      ancestorsOf(trigger).filter((node) => node.hasAttribute(CONTAINMENT_ATTRIBUTE)).length,
    ).toBeGreaterThanOrEqual(3);
    expect(zIndexOf(rogue)).toBe(99_999);
    expect(
      ancestorsOf(rogue).some(
        (node) => node.hasAttribute(CONTAINMENT_ATTRIBUTE) && isIsolated(node),
      ),
    ).toBe(true);
  });

  it("is not present inline once opened, and paints from the overlay root", () => {
    render(nestingStage());
    openTrigger("Filter");
    const dialog = requirePart("frame");
    const root = dialog.parentElement as Element;
    const rogue = one('[data-testid="rogue"]');
    const content = one('[data-testid="modal-content"]');

    expect(root.hasAttribute(OVERLAY_ROOT_ATTRIBUTE)).toBe(true);
    for (const ancestor of ancestorsOf(dialog)) {
      expect(ancestor.hasAttribute(CONTAINMENT_ATTRIBUTE)).toBe(false);
      expect(isIsolated(ancestor)).toBe(false);
    }
    // The content the seam handed over is inside the dialog, not in the flow it
    // was declared in.
    expect(dialog.contains(content)).toBe(true);
    expect(one('[data-testid="card"]').contains(content)).toBe(false);
    // Two measured numbers, compared in the one context that contains both.
    expect(zIndexOf(root)).toBeGreaterThan(zIndexOf(rogue));
    expect(rogue.compareDocumentPosition(root) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("two modals open at once", () => {
  it("orders paint and focus by when they opened, against document order", () => {
    render(nestingStage(TWO_MODALS));
    // `alpha` is first in the document and first by id, and it is opened second.
    openTrigger("Zeta");
    openTrigger("Alpha");

    // The anchor: both really are open.
    expect([...openTitles()].sort()).toEqual(["The alpha", "The zeta"]);
    const alpha = frameTitled("The alpha");
    const zeta = frameTitled("The zeta");
    expect(zIndexOf(alpha)).toBeGreaterThan(zIndexOf(zeta));
    expect(document.activeElement).toBe(alpha);
  });

  it("closes only the topmost on Escape, whichever opened last", () => {
    render(nestingStage(TWO_MODALS));
    openTrigger("Zeta");
    openTrigger("Alpha");

    const escaped = errorsDuring(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    expect(escaped).toEqual([]);
    expect(openTitles()).toEqual(["The zeta"]);
  });

  it("states the same thing with the open order reversed", () => {
    render(nestingStage(TWO_MODALS));
    openTrigger("Alpha");
    openTrigger("Zeta");

    expect([...openTitles()].sort()).toEqual(["The alpha", "The zeta"]);
    expect(zIndexOf(frameTitled("The zeta"))).toBeGreaterThan(zIndexOf(frameTitled("The alpha")));
    expect(document.activeElement).toBe(frameTitled("The zeta"));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(openTitles()).toEqual(["The alpha"]);
  });
});

describe("the one commit before the portal target is attached", () => {
  it("creates no frame in place, anywhere", () => {
    overlayRoot.withheld = true;
    const view = render(nestingStage());
    openTrigger("Filter");

    // The state really did change: the branch under test is the target, not the
    // click. A frame that rendered in place would satisfy this and fail the rest.
    expect(requirePart("trigger").getAttribute("aria-expanded")).toBe("true");
    expect(part("frame")).toBeNull();
    expect(part("scrim")).toBeNull();
    expect(part("dismiss")).toBeNull();
    // And the content was never rendered anywhere at all — which a DOM read
    // after the fact cannot distinguish from a modal that never opened.
    expect(modalContentRenders).toEqual([]);
    expect(view.container.querySelector('[data-testid="modal-content"]')).toBeNull();
    expect(document.querySelector('[data-testid="modal-content"]')).toBeNull();
  });

  it("renders the dialog once the target is there, so the withholding was the cause", () => {
    // The control. With the switch off, the identical steps produce a dialog and
    // the content renders; without this, the test above would pass against a
    // renderer whose modal never opened at all.
    render(nestingStage());
    openTrigger("Filter");

    expect(part("frame")).not.toBeNull();
    expect(modalContentRenders.length).toBeGreaterThan(0);
  });
});

describe("the modal seam this module owns", () => {
  /**
   * The two identities the mount seam was last handed.
   *
   * Read as a **pair, per update**, rather than as one set over the whole
   * sequence. A set collapses the axes: a callback that survived every data
   * update and no document update yields the same set size as one that survived
   * both, so the aggregate cannot say which axis was actually exercised.
   */
  function lastSeen(): { readonly context: unknown; readonly renderModal: unknown } {
    return {
      context: mounts.contexts[mounts.contexts.length - 1],
      renderModal: mounts.renderModals[mounts.renderModals.length - 1],
    };
  }

  it("keeps one callback identity across a document update and across a data update", () => {
    // Both axes, because they are not the same claim. A document patch is the
    // canonical stage update, and a callback whose dependencies reach the
    // document would be rebuilt by every patch — handing `MountContext` a fresh
    // seam and remounting every open `Modal`, which is the regression this test
    // exists to prevent. An earlier version of this test varied only `data`, so
    // a document-derived dependency was invisible to it.
    const withExtraRow: DataModel = {
      sales: { total: 42_000_001, rows: [{ month: "2026-08", revenue: 1 }] },
    };
    const view = render(stage({}));
    const start = lastSeen();

    view.rerender(stage({ document: EXAMPLE_DOCUMENT_PATCHED }));
    const afterDocument = lastSeen();

    view.rerender(stage({ document: EXAMPLE_DOCUMENT_PATCHED, data: withExtraRow }));
    const afterData = lastSeen();

    // The anchors: each update really was an update. The document is a
    // different object **and** its change is visible on the page, and the data
    // change is visible too.
    expect(EXAMPLE_DOCUMENT_PATCHED).not.toBe(EXAMPLE_DOCUMENT);
    expect(testIds("text").map((node) => node.textContent)).toContain("Added by a patch");
    expect(one('[data-testid="metric"]').getAttribute("data-value")).toBe("42000001");

    // The controls, one per axis: the recorder observed the context identity
    // move across the document update **specifically**, and across the data
    // update **specifically**, so neither claim below is blind to its own axis.
    expect(afterDocument.context).not.toBe(start.context);
    expect(afterData.context).not.toBe(afterDocument.context);

    // The claims, one per axis, and then over the whole sequence.
    expect(afterDocument.renderModal).toBe(start.renderModal);
    expect(afterData.renderModal).toBe(afterDocument.renderModal);
    expect(mounts.renderModals.length).toBeGreaterThanOrEqual(3);
    expect(new Set(mounts.renderModals).size).toBe(1);
  });

  it("is not replaceable through props", () => {
    const replacement = vi.fn(() => <div data-testid="host-frame" />);
    // Spread first, so the declared props are the ones TypeScript sees as
    // winning; at run time the record still carries the extra key, which is the
    // whole point — a host that reached for the seam by name reaches nothing.
    const hostile = { renderModal: replacement } as unknown as StageRendererProps;
    render(
      <StageRenderer
        {...hostile}
        bootstrap={NESTING_BOOTSTRAP}
        document={NESTING_DOCUMENT}
        data={DATA}
      />,
    );
    openTrigger("Filter");

    expect(replacement).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="host-frame"]')).toBeNull();
    expect(part("frame")).not.toBeNull();
  });

  it("carries the session's theme into chrome that sits outside the screen subtree", () => {
    render(nestingStage());
    openTrigger("Filter");
    const dialog = requirePart("frame");

    // The **complete** projection, not a sample of it: a callback that passed a
    // trimmed record would satisfy any two names this file happened to name.
    expect(declaredVars(dialog)).toEqual({ ...THEME_VARS });
    expect(Object.keys(THEME_VARS).length).toBeGreaterThan(30);
    // It cannot have inherited them: nothing above it in the DOM declares one.
    for (const ancestor of ancestorsOf(dialog)) {
      expect(declaredVars(ancestor as HTMLElement)).toEqual({});
    }
  });

  it("carries a different theme's values under a different bootstrap", () => {
    // A frame that hardcoded a colour looks correct under a single theme.
    render(
      stage({
        bootstrap: bootstrapOrThrow(NESTING_SPECS, NESTING_REGISTRY, DARK_THEME),
        document: NESTING_DOCUMENT,
      }),
    );
    openTrigger("Filter");
    const dialog = requirePart("frame");

    expect(DARK_VARS["--facet-semantic-surface-default"]).not.toBe(
      THEME_VARS["--facet-semantic-surface-default"],
    );
    expect(dialog.style.getPropertyValue("--facet-semantic-surface-default")).toBe(
      DARK_VARS["--facet-semantic-surface-default"],
    );
  });

  it("hands ordinary mounts the same projection", () => {
    render(stage({ bootstrap: DARK_BOOTSTRAP }));
    // The theme reaches a registered component through the mount contract, so a
    // renderer that projected only into the modal chrome is caught here.
    expect(mounts.contexts.length).toBeGreaterThan(0);
    const context = mounts.contexts[0] as { readonly themeVars: Record<string, string> };
    expect(context.themeVars).toEqual(DARK_VARS);
  });
});

describe("an unrelated stage update", () => {
  it("preserves an open modal, what the visitor typed in it, and their focus", () => {
    const view = render(stage({}));
    clickButton("View details");
    openTrigger("Filter");
    const field = one('[data-testid="field"]');
    fireEvent.change(field, { target: { value: "emea" } });
    field.focus();

    // An update that touches neither the modal nor the screen the visitor is on:
    // a new node on the *other* screen, and a data publish.
    const stackId = nodeIdOf(EXAMPLE_DOCUMENT, "Stack", "gap", "md");
    const stack = requireNode(EXAMPLE_DOCUMENT, stackId);
    const updated: ComponentDocument = {
      ...EXAMPLE_DOCUMENT,
      nodes: {
        ...EXAMPLE_DOCUMENT.nodes,
        [stackId]: { ...stack, children: [...stack.children, "added"] },
        added: { tag: "Text", props: { value: scalar("Added later") }, children: [] },
      },
    };
    const republished: DataModel = {
      sales: {
        total: 42_000_000,
        rows: [
          { month: "2026-06", revenue: 19_000_000 },
          { month: "2026-07", revenue: 23_000_000 },
          { month: "2026-08", revenue: 27_000_000 },
        ],
      },
    };
    view.rerender(stage({ document: updated, data: republished }));

    // The anchor: the update really landed, visibly, on this screen.
    expect(one('[data-testid="table"]').getAttribute("data-rows")).toBe("3");
    // The claim.
    expect(part("frame")).not.toBeNull();
    expect(one('[data-testid="field"]')).toHaveProperty("value", "emea");
    expect(document.activeElement).toBe(one('[data-testid="field"]'));
  });
});

describe("what this module is written not to reach for", () => {
  it("imports nothing from @facet/assets, anywhere in the package", () => {
    // D-09: the assets edge runs one way, and `@facet/react` is not on its far
    // end. A single import here would make the renderer un-buildable without the
    // shipped defaults it is supposed to be independent of. The scan reads the
    // **import surface** rather than the whole file, because naming the package
    // in a docblock to say what a module no longer reaches for is not an edge.
    const modules = ["StageRenderer.tsx", "theme.ts", "index.ts", "bootstrap.ts", "mount-node.tsx"];
    let found = 0;
    for (const file of modules) {
      const imported = importedModules(sourceOf(file));
      found += imported.length;
      for (const specifier of imported) {
        expect(specifier.startsWith("@facet/assets")).toBe(false);
      }
    }
    // The positive control: the reader really does find imports.
    expect(found).toBeGreaterThan(modules.length);
  });

  it("declares no way for a host to reach the frame seam", () => {
    const source = sourceOf("StageRenderer.tsx");
    const props = /export interface StageRendererProps \{([\s\S]*?)\n\}/.exec(source);

    expect(props).not.toBeNull();
    expect(props?.[1]).not.toContain("renderModal");
  });
});
