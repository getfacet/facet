// @vitest-environment jsdom
/**
 * The render proof for the trusted content and interactive implementations.
 *
 * Four claims carry the weight here, and each one is a claim about what the
 * component *cannot* do rather than about how it looks.
 *
 * **`Field` is controlled by Facet.** The value the visitor types leaves through
 * the injected `onValueChange` and comes back only as a prop. The sharpest form
 * of that assertion is not "the callback fired" but "the DOM did not keep the
 * keystroke": a change event that does not move `input.value` proves the element
 * is not its own source of truth, so nothing but a re-render with new props can
 * change what the page shows (D-08, DC-022).
 *
 * **`Button` navigates nothing.** Its `action` prop may say `nav:pricing`, but
 * the renderer — not this component — decides what that means. So the button is
 * checked for the three ways a control navigates on its own: an anchor, an
 * `href`, and an implicit `type="submit"` that would navigate the moment the
 * control sat inside a form.
 *
 * **`Table` renders bound rows.** Rows arrive from the bounded data model, never
 * from markup, so the component is handed resolved values and must stay total
 * over them: a row that is not a record, a key whose getter throws, and a value
 * that is itself a structure all have to degrade to a blank cell rather than
 * unwind the subtree (DC-001, DC-019).
 *
 * **Every one of the six styles itself through the theme's custom properties.**
 * A mount is handed `themeVars` — the `themeToCssVars` projection, ready to put
 * on a style attribute — and the root puts them there, so the component renders
 * correctly wherever it is mounted, including inside the Modal frame's portal
 * which has no Screen ancestor to inherit from. Every token-backed declaration
 * is then a `var()` reference to a name that projection actually declares,
 * never the value read out and pasted in. The distinction is invisible to the
 * eye and decisive in fact: the value form re-resolves nothing, so a component
 * mounted where the theme differs would paint the wrong theme, and a host
 * reskin would stop at whatever was inlined at render time. The theme fixture
 * below is built to make that failure loud — every token's value is a unique
 * marker, so an inlined one is recognisable anywhere it appears.
 *
 * The content components share this file because WU-28 owns one test module for
 * both of its implementation modules; their assertions live in their own
 * `describe`.
 */

import type { ComponentMountProps, FacetTheme } from "@facet/core";
import { themeToCssVars } from "@facet/core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_CATALOG } from "../catalog.js";
import { DEFAULT_THEME } from "../theme-default.js";
import { Badge, Metric, Table, Text } from "./content.js";
import { Button, Field } from "./interactive.js";
import { errorsDuring } from "../../../../../test-support/errors-during.js";

afterEach(cleanup);

type Mount = ComponentMountProps<ReactNode>;
type MountedProps = Mount["props"];

/** What every token value in the fixture theme below begins with. */
const TOKEN_MARKER = "themetoken-";

type TokenLayer = Readonly<Record<string, Readonly<Record<string, string>>>>;

function markerThemeLayer<Layer extends TokenLayer>(layer: Layer, layerName: string): Layer {
  const groups: Record<string, Readonly<Record<string, string>>> = {};
  for (const [group, tokens] of Object.entries(layer)) {
    groups[group] = Object.freeze(
      Object.fromEntries(
        Object.keys(tokens).map((token) => [
          token,
          `${TOKEN_MARKER}${layerName}-${group}-${token}`,
        ]),
      ),
    );
  }
  return Object.freeze(groups) as Layer;
}

/**
 * A complete theme whose every fixed and recipe token value is a unique marker
 * rather than a colour or a length.
 */
const THEME: FacetTheme = Object.freeze({
  foundation: markerThemeLayer(DEFAULT_THEME.foundation, "foundation"),
  semantic: markerThemeLayer(DEFAULT_THEME.semantic, "semantic"),
  recipes: markerThemeLayer(DEFAULT_THEME.recipes ?? {}, "recipe"),
});

/**
 * The custom properties a real bootstrap hands every mount, produced by the same
 * projection the runtime uses rather than restated by hand — so the names the
 * assertions look for are the names that actually reach a browser.
 */
const THEME_VARS: Readonly<Record<string, string>> = themeToCssVars(THEME, {
  catalog: DEFAULT_CATALOG,
});

interface MountCallbacks {
  readonly onAction?: (prop: string) => void;
  readonly onValueChange?: (value: string) => void;
}

/**
 * One mount payload, built the way the renderer builds one.
 *
 * `onValueChange` is added only when the caller supplies it, because the
 * contract makes it present exactly for a catalog-declared collectable
 * component — handing every mount an undefined callback would erase the
 * distinction the test needs to exercise.
 */
function mount(props: MountedProps, callbacks: MountCallbacks = {}): Mount {
  const base: Mount = {
    props,
    children: null,
    themeVars: THEME_VARS,
    onAction: callbacks.onAction ?? ((): void => undefined),
  };
  return callbacks.onValueChange === undefined
    ? base
    : { ...base, onValueChange: callbacks.onValueChange };
}

/** Every element the render produced, root included. */
function elementsOf(container: HTMLElement): readonly Element[] {
  return [container, ...container.querySelectorAll("*")].flatMap((element) =>
    element === container ? [...container.children] : [element],
  );
}

/** Every attribute value carried by `element`, excluding the named attributes. */
function attributeValues(element: Element, except: readonly string[] = []): readonly string[] {
  return element
    .getAttributeNames()
    .filter((name) => !except.includes(name))
    .map((name) => element.getAttribute(name) ?? "");
}

/**
 * One mount of each of the six, with the props its spec requires.
 *
 * The suites that assert something about *every* implementation share this list
 * rather than each restating six elements, so a seventh default would be added
 * in one place and immediately be held to all of them.
 */
const DEFAULTS: readonly { readonly tag: string; readonly element: ReactNode }[] = [
  { tag: "Text", element: <Text {...mount({ value: "copy", variant: "title" })} /> },
  { tag: "Metric", element: <Metric {...mount({ label: "Revenue", value: 12, unit: "USD" })} /> },
  { tag: "Badge", element: <Badge {...mount({ label: "live", tone: "positive" })} /> },
  {
    tag: "Button",
    element: <Button {...mount({ label: "Go", action: "agent:go", tone: "primary" })} />,
  },
  {
    tag: "Field",
    element: <Field {...mount({ name: "a", label: "A", value: "v", secret: false })} />,
  },
  { tag: "Table", element: <Table {...mount({ rows: [{ a: 1 }], caption: "c" })} /> },
];

/**
 * The one root element a trusted component renders. More than one would break
 * the containment the renderer wraps around every subtree, so the count is
 * asserted rather than assumed — and the root is where `themeVars` must land.
 */
function rootOf(container: HTMLElement): HTMLElement {
  expect(container.childElementCount).toBe(1);
  const root = container.firstElementChild;
  if (!(root instanceof HTMLElement)) {
    throw new Error("A trusted component must render exactly one root element.");
  }
  return root;
}

/** The root plus every element below it. */
function subtree(root: HTMLElement): readonly HTMLElement[] {
  return [root, ...Array.from(root.querySelectorAll("*"))].filter(
    (element): element is HTMLElement => element instanceof HTMLElement,
  );
}

/** Every declaration one element actually carries, custom properties included. */
function declarationsOf(element: HTMLElement): readonly (readonly [string, string])[] {
  const declarations: [string, string][] = [];
  for (let index = 0; index < element.style.length; index += 1) {
    const property = element.style.item(index);
    declarations.push([property, element.style.getPropertyValue(property)]);
  }
  return declarations;
}

/** Matches one theme custom property reference inside a declaration value. */
const VAR_REFERENCE = /var\((--[a-z0-9-]+)\)/g;

/** Every theme custom property the subtree references through `var()`. */
function referencedVarNames(root: HTMLElement): readonly string[] {
  const names: string[] = [];
  for (const element of subtree(root)) {
    for (const [property, value] of declarationsOf(element)) {
      if (property.startsWith("--")) continue;
      VAR_REFERENCE.lastIndex = 0;
      let match = VAR_REFERENCE.exec(value);
      while (match !== null) {
        const name = match[1];
        if (name !== undefined) names.push(name);
        match = VAR_REFERENCE.exec(value);
      }
    }
  }
  return names;
}

describe("Field is controlled by Facet, not by the DOM", () => {
  it("shows the label and the value it was handed", () => {
    const { container } = render(
      <Field {...mount({ name: "region", label: "Region", value: "north", secret: false })} />,
    );
    const input = container.querySelector("input");

    expect(container.textContent).toContain("Region");
    expect(input?.value).toBe("north");
  });

  it("sends the visitor's value through the injected callback", () => {
    const onValueChange = vi.fn();
    const { container } = render(
      <Field
        {...mount(
          { name: "region", label: "Region", value: "north", secret: false },
          {
            onValueChange,
          },
        )}
      />,
    );
    const input = container.querySelector("input");
    expect(input).not.toBeNull();

    fireEvent.change(input as HTMLInputElement, { target: { value: "north east" } });

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith("north east");
  });

  it("does not keep the keystroke: the shown value only changes when props do", () => {
    const onValueChange = vi.fn();
    const payload = mount(
      { name: "region", label: "Region", value: "north", secret: false },
      {
        onValueChange,
      },
    );
    const { container, rerender } = render(<Field {...payload} />);
    const input = container.querySelector("input") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "north east" } });
    // The component is not the source of truth, so the typed text is gone.
    expect(input.value).toBe("north");

    rerender(
      <Field
        {...mount(
          { name: "region", label: "Region", value: "north east", secret: false },
          {
            onValueChange,
          },
        )}
      />,
    );
    expect(input.value).toBe("north east");
  });

  it("never stamps its collect identity or its value into the DOM", () => {
    const { container } = render(
      <Field {...mount({ name: "region", label: "Region", value: "north", secret: false })} />,
    );

    for (const element of elementsOf(container)) {
      // A `data-*` stamp or a form `name` would be a second, DOM-side channel
      // for a value Facet already owns.
      expect(element.getAttributeNames().filter((name) => name.startsWith("data-"))).toEqual([]);
      expect(element.hasAttribute("name")).toBe(false);
    }
  });

  it("masks a secret and keeps it out of every attribute but the control's own value", () => {
    const secretValue = "hunter2-correct-horse";
    const { container } = render(
      <Field {...mount({ name: "token", label: "API token", value: secretValue, secret: true })} />,
    );
    const input = container.querySelector("input") as HTMLInputElement;

    expect(input.type).toBe("password");
    expect(container.textContent ?? "").not.toContain(secretValue);
    expect(attributeValues(input, ["value"])).not.toContain(secretValue);
    for (const element of elementsOf(container)) {
      if (element === input) continue;
      expect(attributeValues(element)).not.toContain(secretValue);
    }
  });

  it("stays inert when the mount carries no collect callback", () => {
    const { container } = render(
      <Field {...mount({ name: "region", label: "Region", value: "north", secret: false })} />,
    );
    const input = container.querySelector("input") as HTMLInputElement;

    // `onValueChange` is absent exactly when the catalog does not declare the
    // component collectable, so the first keystroke must report nothing rather
    // than reach for a callback that was never injected.
    const escaped = errorsDuring(() => {
      fireEvent.change(input, { target: { value: "south" } });
    });

    expect(escaped).toEqual([]);
    expect(input.value).toBe("north");
  });
});

describe("Button reports the interaction and navigates nothing", () => {
  it("reports the prop that carries the action, once per activation", () => {
    const onAction = vi.fn();
    const { container } = render(
      <Button
        {...mount({ label: "Refresh", action: "agent:refresh", tone: "primary" }, { onAction })}
      />,
    );
    const button = container.querySelector("button") as HTMLButtonElement;

    fireEvent.click(button);

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith("action");
    expect(button.textContent).toBe("Refresh");
  });

  it("emits no navigation of its own for a nav: action", () => {
    const onAction = vi.fn();
    const before = window.location.href;
    const { container } = render(
      <Button
        {...mount({ label: "See pricing", action: "nav:pricing", tone: "secondary" }, { onAction })}
      />,
    );
    const button = container.querySelector("button") as HTMLButtonElement;

    expect(container.querySelector("a")).toBeNull();
    for (const element of elementsOf(container)) {
      expect(element.hasAttribute("href")).toBe(false);
    }
    // An implicit submit would navigate the instant this control sat in a form.
    expect(button.type).toBe("button");

    fireEvent.click(button);

    expect(window.location.href).toBe(before);
    expect(onAction).toHaveBeenCalledWith("action");
  });

  it("does not put the action, the argument or the collect list on the page", () => {
    const { container } = render(
      <Button
        {...mount({
          label: "Send",
          action: "agent:submit",
          arg: "annual",
          collect: "region token",
          tone: "primary",
        })}
      />,
    );

    expect(container.textContent).toBe("Send");
    for (const element of elementsOf(container)) {
      for (const value of attributeValues(element)) {
        expect(value).not.toContain("agent:submit");
        expect(value).not.toContain("region token");
      }
    }
  });

  it("keeps action labels on one line by default", () => {
    const { container } = render(
      <Button {...mount({ label: "Open forecast", action: "agent:openForecast" })} />,
    );
    const button = container.querySelector("button") as HTMLButtonElement;

    expect(button.style.whiteSpace).toBe("nowrap");
  });
});

describe("Table renders the rows the binding resolved", () => {
  it("renders one row per bound record, with the caption and derived columns", () => {
    const { container } = render(
      <Table
        {...mount({
          rows: [
            { region: "north", revenue: 120 },
            { region: "south", revenue: 90 },
          ],
          caption: "Revenue by region",
        })}
      />,
    );

    expect(container.querySelector("caption")?.textContent).toBe("Revenue by region");
    expect([...container.querySelectorAll("thead th")].map((cell) => cell.textContent)).toEqual([
      "region",
      "revenue",
    ]);
    const bodyRows = [...container.querySelectorAll("tbody tr")];
    expect(bodyRows).toHaveLength(2);
    expect([...bodyRows[0]!.querySelectorAll("td")].map((cell) => cell.textContent)).toEqual([
      "north",
      "120",
    ]);
    expect([...bodyRows[1]!.querySelectorAll("td")].map((cell) => cell.textContent)).toEqual([
      "south",
      "90",
    ]);
  });

  it("renders a republished collection without any markup change", () => {
    const first = mount({ rows: [{ region: "north", revenue: 120 }], caption: "Revenue" });
    const { container, rerender } = render(<Table {...first} />);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(1);

    // Same node, same props — only the value the `data:` binding resolved moved.
    rerender(
      <Table
        {...mount({
          rows: [
            { region: "north", revenue: 140 },
            { region: "south", revenue: 90 },
          ],
          caption: "Revenue",
        })}
      />,
    );

    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(container.textContent).toContain("140");
  });

  it("renders an empty bound collection as a table with no rows", () => {
    const { container } = render(<Table {...mount({ rows: [], caption: "Revenue" })} />);

    expect(container.querySelector("caption")?.textContent).toBe("Revenue");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(0);
    expect(container.querySelectorAll("thead th")).toHaveLength(0);
  });

  it("degrades a row it cannot read to blank cells instead of unwinding", () => {
    const throwing = {
      region: "east",
      get revenue(): number {
        throw new Error("hostile getter");
      },
    };
    const rows: readonly unknown[] = [
      { region: "north", revenue: 120 },
      throwing,
      "not-a-record",
      { region: { nested: true }, revenue: [1, 2] },
    ];

    const { container } = render(<Table {...mount({ rows, caption: "Revenue" })} />);

    const bodyRows = [...container.querySelectorAll("tbody tr")];
    expect(bodyRows).toHaveLength(4);
    expect([...bodyRows[1]!.querySelectorAll("td")].map((cell) => cell.textContent)).toEqual([
      "east",
      "",
    ]);
    expect([...bodyRows[2]!.querySelectorAll("td")].map((cell) => cell.textContent)).toEqual([
      "",
      "",
    ]);
    // A structured value is not stringified into the cell.
    expect(container.textContent ?? "").not.toContain("object Object");
  });
});

describe("the content components render what they were handed", () => {
  it("gives Text the typographic role the variant names", () => {
    const title = render(<Text {...mount({ value: "Quarterly review", variant: "title" })} />);
    expect(title.container.querySelector("h1")?.textContent).toBe("Quarterly review");
    cleanup();

    const heading = render(<Text {...mount({ value: "Revenue", variant: "heading" })} />);
    expect(heading.container.querySelector("h2")?.textContent).toBe("Revenue");
    cleanup();

    const body = render(<Text {...mount({ value: "Steady growth.", variant: "body" })} />);
    expect(body.container.querySelector("p")?.textContent).toBe("Steady growth.");
  });

  it("renders the value a Text binding resolved, with no markup change", () => {
    const { container, rerender } = render(
      <Text {...mount({ value: "north", variant: "body" })} />,
    );
    expect(container.textContent).toBe("north");

    rerender(<Text {...mount({ value: "south", variant: "body" })} />);
    expect(container.textContent).toBe("south");
  });

  it("formats a Metric number and shows its label and unit", () => {
    const { container } = render(
      <Metric {...mount({ label: "Total revenue", value: 42_000_000, unit: "USD" })} />,
    );

    expect(container.textContent).toContain("Total revenue");
    expect(container.textContent).toContain("42,000,000");
    expect(container.textContent).toContain("USD");
  });

  it("shows nothing rather than NaN when a Metric value is not a finite number", () => {
    const { container } = render(
      <Metric {...mount({ label: "Total revenue", value: Number.NaN })} />,
    );

    expect(container.textContent).toContain("Total revenue");
    expect(container.textContent ?? "").not.toContain("NaN");
  });

  it("renders a compact status Badge with the tone's status tokens", () => {
    const toneTokens = {
      neutral: [
        "--facet-recipe-badge-background",
        "--facet-recipe-badge-border",
        "--facet-recipe-badge-text",
      ],
      positive: [
        "--facet-semantic-status-success-bg",
        "--facet-semantic-status-success-border",
        "--facet-semantic-status-success-text",
      ],
      warning: [
        "--facet-semantic-status-warning-bg",
        "--facet-semantic-status-warning-border",
        "--facet-semantic-status-warning-text",
      ],
      danger: [
        "--facet-semantic-status-danger-bg",
        "--facet-semantic-status-danger-border",
        "--facet-semantic-status-danger-text",
      ],
    } as const;

    for (const tone of ["neutral", "positive", "warning", "danger"] as const) {
      const { container } = render(<Badge {...mount({ label: `state-${tone}`, tone })} />);
      const badge = rootOf(container);
      const style = badge.getAttribute("style") ?? "";

      expect(badge.textContent).toBe(`state-${tone}`);
      expect(badge.style.display).toBe("inline-flex");
      expect(badge.style.alignSelf).toBe("flex-start");
      for (const token of toneTokens[tone]) {
        expect(style).toContain(`var(${token})`);
      }
      cleanup();
    }
  });
});

describe("every default styles itself through the theme's custom properties", () => {
  it("carries the whole active theme on its own root", () => {
    for (const { tag, element } of DEFAULTS) {
      const { container } = render(<>{element}</>);
      const root = rootOf(container);

      // The projection is complete, so this is the assertion that a component
      // mounted anywhere — the Modal frame's portal included — resolves every
      // name it references without needing a Screen above it.
      for (const [name, value] of Object.entries(THEME_VARS)) {
        expect({ tag, name, value: root.style.getPropertyValue(name) }).toEqual({
          tag,
          name,
          value,
        });
      }
      cleanup();
    }
  }, 60_000);

  it("never inlines what a token resolved to", () => {
    for (const { tag, element } of DEFAULTS) {
      const { container } = render(<>{element}</>);

      // A component that read the value out of `themeVars` and pasted it into a
      // declaration paints the theme that was active when it rendered, and
      // stops tracking the one that is active now. The marker makes that
      // visible wherever in the declaration it was pasted.
      for (const element of subtree(rootOf(container))) {
        for (const [property, value] of declarationsOf(element)) {
          if (property.startsWith("--")) continue;
          expect({ tag, property, inlined: value.includes(TOKEN_MARKER) }).toEqual({
            tag,
            property,
            inlined: false,
          });
        }
      }
      cleanup();
    }
  }, 60_000);

  it("references the theme by name", () => {
    for (const { tag, element } of DEFAULTS) {
      const { container } = render(<>{element}</>);

      // The mirror of the two assertions above: a component that inlined
      // nothing and referenced nothing would satisfy both and still not be
      // styled from the theme at all.
      expect({ tag, references: referencedVarNames(rootOf(container)).length > 0 }).toEqual({
        tag,
        references: true,
      });
      cleanup();
    }
  }, 60_000);

  it("references only custom properties the theme projection actually declares", () => {
    const projected = new Set(Object.keys(THEME_VARS));
    for (const { tag, element } of DEFAULTS) {
      const { container } = render(<>{element}</>);
      for (const name of referencedVarNames(rootOf(container))) {
        expect({ tag, name, projected: projected.has(name) }).toEqual({
          tag,
          name,
          projected: true,
        });
      }
      cleanup();
    }
  }, 60_000);
});

describe("no content or interactive component reaches for a positioning escape hatch", () => {
  it("emits neither position nor z-index anywhere it renders", () => {
    for (const { element } of DEFAULTS) {
      const { container } = render(<>{element}</>);
      for (const element of elementsOf(container)) {
        const style = (element as HTMLElement).style;
        expect(style.position).toBe("");
        expect(style.zIndex).toBe("");
      }
      cleanup();
    }
  }, 60_000);
});
