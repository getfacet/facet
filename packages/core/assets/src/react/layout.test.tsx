// @vitest-environment jsdom
/**
 * The seven trusted layout and surface implementations, under a real DOM.
 *
 * These suites exist to prove three things the rest of the repository takes on
 * faith. First, that a registered implementation renders what its spec
 * declares: the same enum values, the same defaults, the same required props —
 * read out of the spec at run time rather than restated here, so a spec edit
 * that the implementation does not follow fails as a drift, not as a stale
 * expectation nobody updated. Second, that authored layout stays
 * **flow-contained**: nothing these components emit positions itself, stacks
 * itself, or floats out of the flow, so overlap remains available only through
 * the framework's own Modal frame. Third, that they style themselves from the
 * theme's token names and nothing else — every `var()` they reference is a
 * custom property `themeToCssVars` actually projects.
 *
 * The jsdom docblock above is load-bearing: vitest's default environment is
 * `node` and the repository's config declares none, so without it nothing here
 * can render at all.
 */

import type { ComponentMountProps, ComponentSpec, MountedComponent, PropSchema } from "@facet/core";
import { themeToCssVars } from "@facet/core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_CATALOG } from "../catalog.js";
import { GRID_SPEC, ROW_SPEC, SCREEN_SPEC, STACK_SPEC } from "../specs-layout.js";
import { CARD_SPEC, EMPTY_SPEC, MODAL_SPEC } from "../specs-surface.js";
import { DEFAULT_THEME } from "../theme-default.js";
import { Grid, Row, Screen, Stack } from "./layout.js";
import { Card, Empty, Modal } from "./surface.js";

/** The custom properties a real bootstrap hands every mount. */
const THEME_VARS = themeToCssVars(DEFAULT_THEME, { catalog: DEFAULT_CATALOG });

/** The scalar prop record a renderer hands a mounted component. */
type MountProps = Readonly<Record<string, string | number | boolean>>;

/** One registered component: its spec, its trusted implementation, its required props. */
interface Registered {
  readonly spec: ComponentSpec;
  readonly implementation: MountedComponent<ReactNode, ReactNode>;
  readonly required: MountProps;
}

/**
 * The seven this Work Unit owns. `required` supplies exactly the props the spec
 * marks required — document validation guarantees they are present, so a
 * fixture without them would be testing a state the renderer cannot produce.
 */
const REGISTERED: readonly Registered[] = [
  { spec: SCREEN_SPEC, implementation: Screen, required: { name: "invoices" } },
  { spec: STACK_SPEC, implementation: Stack, required: {} },
  { spec: ROW_SPEC, implementation: Row, required: {} },
  { spec: GRID_SPEC, implementation: Grid, required: {} },
  {
    spec: MODAL_SPEC,
    implementation: Modal,
    required: { triggerLabel: "Edit budget", title: "Edit the budget" },
  },
  { spec: CARD_SPEC, implementation: Card, required: {} },
  { spec: EMPTY_SPEC, implementation: Empty, required: { title: "No invoices yet" } },
];

/**
 * The declarations that would take a component out of the flow. A trusted
 * component may not emit any of them; the Modal frame in `@facet/react` owns
 * every one.
 */
const OUT_OF_FLOW_PROPERTIES: readonly string[] = [
  "position",
  "z-index",
  "top",
  "right",
  "bottom",
  "left",
  "inset",
  "inset-block",
  "inset-block-start",
  "inset-block-end",
  "inset-inline",
  "inset-inline-start",
  "inset-inline-end",
  "float",
];

/** The two whose every declared prop is required or free text, so neither carries a default. */
const TAGS_WITHOUT_DEFAULTS = new Set(["Modal", "Empty"]);

/**
 * How often each free-text prop may appear in the rendered text.
 *
 * Once for the copy a component is responsible for showing; **zero** times for
 * a string it merely carries. `Screen`'s `name` is an identity the renderer
 * navigates by, not a label, and `Modal`'s `triggerLabel` and `title` belong to
 * the framework's frame — a registered `Modal` that printed either would give
 * the visitor the heading twice.
 */
const TEXT_RENDERING: readonly { tag: string; prop: string; occurrences: number }[] = [
  { tag: "Screen", prop: "title", occurrences: 1 },
  { tag: "Screen", prop: "name", occurrences: 0 },
  { tag: "Card", prop: "title", occurrences: 1 },
  { tag: "Empty", prop: "title", occurrences: 1 },
  { tag: "Empty", prop: "description", occurrences: 1 },
  { tag: "Modal", prop: "description", occurrences: 1 },
  { tag: "Modal", prop: "title", occurrences: 0 },
  { tag: "Modal", prop: "triggerLabel", occurrences: 0 },
];

/** Matches one theme custom property reference inside a declaration value. */
const VAR_REFERENCE = /var\((--[a-z0-9-]+)\)/g;

afterEach(cleanup);

function noop(): void {
  return undefined;
}

/**
 * Renders one trusted component and returns its single root element. A second
 * root would break the containment the renderer wraps around every subtree, so
 * the count is asserted rather than assumed.
 */
function renderComponent(
  implementation: MountedComponent<ReactNode, ReactNode>,
  props: MountProps,
  children: ReactNode = null,
): HTMLElement {
  const Component = implementation;
  const { container } = render(
    <Component props={props} themeVars={THEME_VARS} onAction={noop}>
      {children}
    </Component>,
  );
  expect(container.childElementCount).toBe(1);
  const root = container.firstElementChild;
  if (!(root instanceof HTMLElement)) {
    throw new Error("A trusted component must render exactly one root element.");
  }
  return root;
}

/** The root plus every element below it. */
function subtree(root: HTMLElement): readonly Element[] {
  return [root, ...Array.from(root.querySelectorAll("*"))];
}

/** The property names one element actually declares, custom properties included. */
function declaredProperties(element: Element): readonly string[] {
  const style = element.getAttribute("style") ?? "";
  return style
    .split(";")
    .map((declaration) => declaration.split(":")[0]?.trim() ?? "")
    .filter((name) => name.length > 0);
}

/** Every theme custom property the subtree references through `var()`. */
function referencedVarNames(root: HTMLElement): readonly string[] {
  const names: string[] = [];
  for (const element of subtree(root)) {
    const style = element.getAttribute("style") ?? "";
    VAR_REFERENCE.lastIndex = 0;
    let match = VAR_REFERENCE.exec(style);
    while (match !== null) {
      const name = match[1];
      if (name !== undefined) {
        names.push(name);
      }
      match = VAR_REFERENCE.exec(style);
    }
  }
  return names;
}

/** The values worth exercising for one declared prop, taken from its own domain. */
function domainValues(schema: PropSchema): readonly (string | number | boolean)[] {
  if (schema.type === "string") {
    return schema.enum ?? ["A readable line of copy"];
  }
  if (schema.type === "boolean") {
    return [true, false];
  }
  if (schema.type === "number") {
    const minimum = schema.minimum ?? 1;
    const maximum = schema.maximum ?? minimum;
    const values: number[] = [];
    for (let value = minimum; value <= maximum; value += 1) {
      values.push(value);
    }
    return values;
  }
  return [];
}

/** The defaults the spec declares, as a prop record. */
function specDefaults(spec: ComponentSpec): MountProps {
  const entries: [string, string | number | boolean][] = [];
  for (const [name, schema] of Object.entries(spec.props)) {
    if ("default" in schema && schema.default !== undefined) {
      entries.push([name, schema.default]);
    }
  }
  return Object.fromEntries(entries);
}

/**
 * One prop varied across its whole domain at a time, plus the all-defaults
 * case. A full cartesian product would multiply out to hundreds of renders
 * without testing a different code path: each prop reaches its own declaration
 * independently.
 */
function variations(entry: Registered): readonly MountProps[] {
  const records: MountProps[] = [{ ...entry.required }];
  for (const [name, schema] of Object.entries(entry.spec.props)) {
    for (const value of domainValues(schema)) {
      records.push({ ...entry.required, ...Object.fromEntries([[name, value]]) });
    }
  }
  return records;
}

describe("flow containment", () => {
  it("emits no positioning or stacking declaration, for any value of any declared prop", () => {
    for (const entry of REGISTERED) {
      for (const props of variations(entry)) {
        const root = renderComponent(entry.implementation, props, <span>child</span>);
        for (const element of subtree(root)) {
          const declared = declaredProperties(element);
          for (const property of OUT_OF_FLOW_PROPERTIES) {
            expect({ tag: entry.spec.tag, property, declared }).toEqual({
              tag: entry.spec.tag,
              property,
              declared: declared.filter((name) => name !== property),
            });
          }
        }
        cleanup();
      }
    }
  });

  it("renders its children inside its own root", () => {
    for (const entry of REGISTERED) {
      const root = renderComponent(
        entry.implementation,
        entry.required,
        <span data-testid="child">child</span>,
      );
      expect(root.querySelector("[data-testid='child']")).not.toBeNull();
      cleanup();
    }
  });

  it("reports no interaction of its own — none of the seven declares an action", () => {
    for (const entry of REGISTERED) {
      const reported: string[] = [];
      const Component = entry.implementation;
      const { container } = render(
        <Component
          props={entry.required}
          themeVars={THEME_VARS}
          onAction={(prop) => reported.push(prop)}
        >
          <span>child</span>
        </Component>,
      );
      const root = container.firstElementChild;
      if (!(root instanceof HTMLElement)) {
        throw new Error("A trusted component must render exactly one root element.");
      }
      for (const element of subtree(root)) {
        fireEvent.click(element);
      }
      expect({ tag: entry.spec.tag, reported }).toEqual({ tag: entry.spec.tag, reported: [] });
      cleanup();
    }
  });
});

describe("authored text", () => {
  it("shows each free-text prop exactly as often as it owns it", () => {
    const sentinel = "Sentinel copy 7f3a";
    for (const { tag, prop, occurrences } of TEXT_RENDERING) {
      const entry = REGISTERED.find((candidate) => candidate.spec.tag === tag);
      if (entry === undefined) {
        throw new Error(`No registered component named ${tag}.`);
      }
      const root = renderComponent(
        entry.implementation,
        { ...entry.required, ...Object.fromEntries([[prop, sentinel]]) },
        <span>child</span>,
      );
      const text = root.textContent ?? "";
      expect({ tag, prop, count: text.split(sentinel).length - 1 }).toEqual({
        tag,
        prop,
        count: occurrences,
      });
      cleanup();
    }
  });
});

describe("theme discipline", () => {
  it("puts the active theme's custom properties on its own root", () => {
    for (const entry of REGISTERED) {
      const root = renderComponent(entry.implementation, entry.required);
      for (const [name, value] of Object.entries(THEME_VARS)) {
        expect({ tag: entry.spec.tag, name, value: root.style.getPropertyValue(name) }).toEqual({
          tag: entry.spec.tag,
          name,
          value,
        });
      }
      cleanup();
    }
  });

  it("references only custom properties the theme projection actually declares", () => {
    const projected = new Set(Object.keys(THEME_VARS));
    for (const entry of REGISTERED) {
      for (const props of variations(entry)) {
        const root = renderComponent(entry.implementation, props, <span>child</span>);
        for (const name of referencedVarNames(root)) {
          expect({ tag: entry.spec.tag, name, projected: projected.has(name) }).toEqual({
            tag: entry.spec.tag,
            name,
            projected: true,
          });
        }
        cleanup();
      }
    }
  });
});

describe("spec conformance", () => {
  it("renders a prop-less mount exactly as it renders the spec's own defaults", () => {
    for (const entry of REGISTERED) {
      const defaults = specDefaults(entry.spec);
      // Only Modal and Empty declare no default at all — every prop they carry
      // is either required or free text. Pinning that keeps this comparison
      // from passing vacuously if a spec's defaults ever disappear.
      expect({ tag: entry.spec.tag, hasDefaults: Object.keys(defaults).length > 0 }).toEqual({
        tag: entry.spec.tag,
        hasDefaults: !TAGS_WITHOUT_DEFAULTS.has(entry.spec.tag),
      });

      const implicit = renderComponent(entry.implementation, entry.required, <span>c</span>);
      const implicitHtml = implicit.outerHTML;
      cleanup();

      const explicit = renderComponent(
        entry.implementation,
        { ...entry.required, ...defaults },
        <span>c</span>,
      );
      expect({ tag: entry.spec.tag, html: implicitHtml }).toEqual({
        tag: entry.spec.tag,
        html: explicit.outerHTML,
      });
      cleanup();
    }
  });

  it("falls back to the spec default when a prop arrives outside its declared domain", () => {
    for (const entry of REGISTERED) {
      const defaults = specDefaults(entry.spec);
      const expected = renderComponent(
        entry.implementation,
        { ...entry.required, ...defaults },
        <span>c</span>,
      ).outerHTML;
      cleanup();

      for (const name of Object.keys(defaults)) {
        const hostile = renderComponent(
          entry.implementation,
          { ...entry.required, ...defaults, ...Object.fromEntries([[name, "not-in-the-domain"]]) },
          <span>c</span>,
        ).outerHTML;
        expect({ tag: entry.spec.tag, name, html: hostile }).toEqual({
          tag: entry.spec.tag,
          name,
          html: expected,
        });
        cleanup();
      }
    }
  });
});

describe("Screen", () => {
  it("frames the screen and names it without printing the name", () => {
    const root = renderComponent(Screen, { name: "invoices" }, <span>body</span>);
    expect(root.getAttribute("data-facet-screen")).toBe("invoices");
    expect(root.textContent).toBe("body");
  });

  it("renders the optional title as the screen's heading", () => {
    const root = renderComponent(Screen, { name: "invoices", title: "Invoices" });
    const heading = root.querySelector("h1");
    expect(heading?.textContent).toBe("Invoices");
  });

  it("bounds the reading column, and only 'full' releases the bound", () => {
    const widths = new Map<string, string>();
    for (const value of domainValues(SCREEN_SPEC.props["maxWidth"] as PropSchema)) {
      const root = renderComponent(Screen, { name: "invoices", maxWidth: value });
      const column = root.firstElementChild;
      if (!(column instanceof HTMLElement)) {
        throw new Error("Screen must render a content column.");
      }
      widths.set(String(value), column.style.getPropertyValue("max-width"));
      cleanup();
    }
    expect(widths.get("full")).toBe("100%");
    expect(new Set(widths.values()).size).toBe(widths.size);
  });

  it("spaces its edge from its content out of the theme's space tokens", () => {
    const none = renderComponent(Screen, { name: "invoices", padding: "none" });
    expect(none.style.getPropertyValue("padding")).toBe("0px");
    cleanup();
    const large = renderComponent(Screen, { name: "invoices", padding: "lg" });
    expect(large.style.getPropertyValue("padding")).toBe("var(--facet-foundation-space-lg)");
  });
});

describe("Stack and Row", () => {
  it("stacks children in reading order", () => {
    const root = renderComponent(Stack, {}, <span>one</span>);
    expect(root.style.getPropertyValue("display")).toBe("flex");
    expect(root.style.getPropertyValue("flex-direction")).toBe("column");
  });

  it("maps every declared alignment to a flow alignment", () => {
    const seen = new Set<string>();
    for (const value of domainValues(STACK_SPEC.props["align"] as PropSchema)) {
      const root = renderComponent(Stack, { align: value });
      seen.add(root.style.getPropertyValue("align-items"));
      cleanup();
    }
    expect(seen.size).toBe(domainValues(STACK_SPEC.props["align"] as PropSchema).length);
  });

  it("lays a row out on one line and wraps only when asked", () => {
    const wrapping = renderComponent(Row, { wrap: true });
    expect(wrapping.style.getPropertyValue("flex-direction")).toBe("row");
    expect(wrapping.style.getPropertyValue("flex-wrap")).toBe("wrap");
    cleanup();
    const fixed = renderComponent(Row, { wrap: false });
    expect(fixed.style.getPropertyValue("flex-wrap")).toBe("nowrap");
  });

  it("pushes the ends apart for 'between' and nowhere else", () => {
    const between = renderComponent(Row, { justify: "between" });
    expect(between.style.getPropertyValue("justify-content")).toBe("space-between");
    cleanup();
    const start = renderComponent(Row, { justify: "start" });
    expect(start.style.getPropertyValue("justify-content")).toBe("flex-start");
  });
});

describe("Grid", () => {
  it("lays out the requested number of equal columns when collapse is off", () => {
    const root = renderComponent(Grid, { columns: 4, collapse: false });
    expect(root.style.getPropertyValue("display")).toBe("grid");
    expect(root.style.getPropertyValue("grid-template-columns")).toBe("repeat(4, minmax(0, 1fr))");
  });

  it("collapses on a narrow viewport without a media query or a listener", () => {
    const root = renderComponent(Grid, { columns: 3, collapse: true });
    const columns = root.style.getPropertyValue("grid-template-columns");
    expect(columns).toContain("auto-fit");
    expect(columns).toContain("/ 3)");
    expect(root.ownerDocument.querySelector("style")).toBeNull();
  });

  it("keeps a column count outside the declared bounds inside them", () => {
    const wide = renderComponent(Grid, { columns: 99, collapse: false });
    expect(wide.style.getPropertyValue("grid-template-columns")).toBe("repeat(6, minmax(0, 1fr))");
    cleanup();
    const narrow = renderComponent(Grid, { columns: -4, collapse: false });
    expect(narrow.style.getPropertyValue("grid-template-columns")).toBe(
      "repeat(1, minmax(0, 1fr))",
    );
  });
});

describe("Card and Empty", () => {
  it("gives the card an edge and its own padding", () => {
    const root = renderComponent(Card, {}, <span>body</span>);
    expect(root.style.getPropertyValue("border-style")).toBe("solid");
    expect(root.style.getPropertyValue("padding")).toBe("var(--facet-recipe-card-padding)");
  });

  it("draws each declared card tone from a different theme color", () => {
    const colors = new Set<string>();
    const domain = domainValues(CARD_SPEC.props["tone"] as PropSchema);
    for (const value of domain) {
      const root = renderComponent(Card, Object.fromEntries([["tone", value]]));
      colors.add(root.style.getPropertyValue("border-color"));
      cleanup();
    }
    expect(colors.size).toBe(domain.length);
  });

  it("says what is missing, and leaves room for the next step", () => {
    const root = renderComponent(
      Empty,
      { title: "No invoices yet", description: "Send one to see it here." },
      <span data-testid="next">New invoice</span>,
    );
    expect(root.textContent).toContain("No invoices yet");
    expect(root.textContent).toContain("Send one to see it here.");
    expect(root.querySelector("[data-testid='next']")).not.toBeNull();
  });
});

describe("Modal", () => {
  it("supplies content only — the frame owns the trigger and the heading", () => {
    const root = renderComponent(
      Modal,
      { triggerLabel: "Edit budget", title: "Edit the budget" },
      <span>form</span>,
    );
    expect(root.textContent).toBe("form");
    expect(root.textContent).not.toContain("Edit budget");
    expect(root.textContent).not.toContain("Edit the budget");
  });

  it("renders the optional description above its content", () => {
    const root = renderComponent(
      Modal,
      {
        triggerLabel: "Edit budget",
        title: "Edit the budget",
        description: "This changes next month's plan.",
      },
      <span data-testid="form">form</span>,
    );
    expect(root.textContent).toContain("This changes next month's plan.");
    const description = root.firstElementChild;
    expect(description?.textContent).toBe("This changes next month's plan.");
  });

  it("emits no scrim, no frame, and nothing but its own content element", () => {
    const root = renderComponent(
      Modal,
      { triggerLabel: "Edit budget", title: "Edit the budget" },
      <span data-testid="form">form</span>,
    );
    expect(root.childElementCount).toBe(1);
    for (const element of subtree(root)) {
      const declared = declaredProperties(element);
      expect(declared).not.toContain("background-color");
      expect(declared).not.toContain("backdrop-filter");
      expect(declared).not.toContain("width");
      expect(declared).not.toContain("height");
    }
  });
});

describe("the mount contract", () => {
  it("accepts the payload the renderer builds, with no optional callback", () => {
    const payload: ComponentMountProps<ReactNode> = {
      props: { name: "invoices" },
      children: null,
      themeVars: THEME_VARS,
      onAction: noop,
    };
    expect(() => render(<Screen {...payload} />)).not.toThrow();
  });
});
