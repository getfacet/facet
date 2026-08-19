// @vitest-environment jsdom

import type { ComponentMountProps, MountedComponent } from "@facet/core";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import * as Layout from "./layout.js";

type MountProps = ComponentMountProps<ReactNode>["props"];
type Slots = ComponentMountProps<ReactNode>["slots"];

const THEME_VARS = Object.freeze({
  "--facet-test-surface": "rgb(250, 250, 250)",
  "--facet-test-text": "rgb(20, 20, 20)",
});

const EXPECTED_EXPORTS = [
  "AppShell",
  "Card",
  "Divider",
  "Grid",
  "Modal",
  "Row",
  "Screen",
  "Section",
  "Split",
  "Stack",
] as const;

const OUT_OF_FLOW_PROPERTIES = [
  "position",
  "z-index",
  "top",
  "right",
  "bottom",
  "left",
  "inset",
  "float",
] as const;

afterEach(cleanup);

function noop(): void {
  return undefined;
}

function renderComponent(
  implementation: MountedComponent<ReactNode, ReactNode>,
  options: {
    readonly props?: MountProps;
    readonly children?: ReactNode;
    readonly slots?: Slots;
  } = {},
): HTMLElement {
  const Component = implementation;
  const { container } = render(
    <Component
      props={options.props ?? {}}
      slots={options.slots ?? {}}
      themeVars={THEME_VARS}
      onAction={noop}
    >
      {options.children ?? null}
    </Component>,
  );
  expect(container.childElementCount).toBe(1);
  const root = container.firstElementChild;
  if (!(root instanceof HTMLElement)) {
    throw new Error("Expected one HTMLElement root.");
  }
  return root;
}

function declarations(root: HTMLElement): readonly (readonly [string, string])[] {
  return [root, ...Array.from(root.querySelectorAll("*"))].flatMap((node) => {
    if (!(node instanceof HTMLElement)) return [];
    return Array.from(node.style)
      .map((name) => [name, node.style.getPropertyValue(name)] as const)
      .filter(([, value]) => value !== "");
  });
}

describe("trusted structure React components", () => {
  it("exports exactly the locked structure roster", () => {
    expect(Object.keys(Layout).sort()).toEqual(EXPECTED_EXPORTS);
  });

  it("renders container content only from children", () => {
    const containers = [
      Layout.Screen,
      Layout.Stack,
      Layout.Row,
      Layout.Grid,
      Layout.Section,
      Layout.Card,
    ] as const;

    for (const implementation of containers) {
      const root = renderComponent(implementation, {
        children: <span data-testid="child">child</span>,
        slots: { unused: <span data-testid="slot">slot</span> },
      });
      expect(root.querySelector('[data-testid="child"]')).not.toBeNull();
      expect(root.querySelector('[data-testid="slot"]')).toBeNull();
      cleanup();
    }
  });

  it("renders Split from primary and secondary slots in semantic order", () => {
    const root = renderComponent(Layout.Split, {
      children: <span data-testid="ignored">ignored</span>,
      slots: {
        primary: <span>Primary</span>,
        secondary: <span>Secondary</span>,
      },
    });

    expect(root.textContent).toBe("PrimarySecondary");
    expect(root.querySelector('[data-testid="ignored"]')).toBeNull();
    expect(root.querySelector('[data-facet-slot="primary"]')?.textContent).toBe("Primary");
    expect(root.querySelector('[data-facet-slot="secondary"]')?.textContent).toBe("Secondary");
  });

  it("renders AppShell navigation, header, and main slots without child-order inference", () => {
    const root = renderComponent(Layout.AppShell, {
      children: "ignored",
      slots: {
        navigation: <span>Navigation</span>,
        header: <span>Header</span>,
        main: <span>Main</span>,
      },
    });

    expect(root.textContent).toBe("NavigationHeaderMain");
    expect(root.querySelector("aside")?.textContent).toBe("Navigation");
    expect(root.querySelector("header")?.textContent).toBe("Header");
    expect(root.querySelector("main")?.textContent).toBe("Main");
  });

  it("honors AppShell side, gap, and collapse props without moving slot ownership", () => {
    const root = renderComponent(Layout.AppShell, {
      props: { sidebar: "end", gap: "sm", collapse: false },
      slots: { navigation: "Navigation", main: "Main" },
    });

    expect(root.style.flexWrap).toBe("nowrap");
    expect(root.style.gap).toContain("var(--facet-foundation-space-sm)");
    expect(root.lastElementChild?.getAttribute("data-facet-slot")).toBe("navigation");
    expect(root.querySelector("main")?.textContent).toBe("Main");
  });

  it("keeps Modal content flow-only inside the renderer-owned frame", () => {
    const root = renderComponent(Layout.Modal, {
      props: {
        title: "Renderer heading",
        triggerLabel: "Open",
        description: "Review the changes.",
      },
      children: "ignored",
      slots: {
        body: <span>Body</span>,
        actions: <button type="button">Confirm</button>,
      },
    });

    expect(root.textContent).toBe("Review the changes.BodyConfirm");
    expect(root.getAttribute("role")).toBeNull();
    expect(root.querySelector("p")?.textContent).toBe("Review the changes.");
    expect(root.querySelector('[data-facet-slot="body"]')?.textContent).toBe("Body");
    expect(root.querySelector('[data-facet-slot="actions"]')?.textContent).toBe("Confirm");
  });

  it("renders declared container headings before ordered children", () => {
    const screen = renderComponent(Layout.Screen, {
      props: { name: "home", title: "Home" },
      children: <span>Screen body</span>,
    });
    expect(screen.querySelector("h1")?.textContent).toBe("Home");
    expect(screen.textContent).toBe("HomeScreen body");
    cleanup();

    const section = renderComponent(Layout.Section, {
      props: { title: "Details", description: "Current account details." },
      children: <span>Section body</span>,
    });
    expect(section.querySelector("h2")?.textContent).toBe("Details");
    expect(section.querySelector("p")?.textContent).toBe("Current account details.");
    expect(section.textContent).toBe("DetailsCurrent account details.Section body");
    cleanup();

    const card = renderComponent(Layout.Card, {
      props: { title: "Invoice" },
      children: <span>Card body</span>,
    });
    expect(card.querySelector("h2")?.textContent).toBe("Invoice");
    expect(card.textContent).toBe("InvoiceCard body");
  });

  it("uses semantic section, article, and separator elements", () => {
    expect(renderComponent(Layout.Screen).tagName).toBe("SECTION");
    cleanup();
    expect(renderComponent(Layout.Section).tagName).toBe("SECTION");
    cleanup();
    expect(renderComponent(Layout.Card).tagName).toBe("ARTICLE");
    cleanup();

    const divider = renderComponent(Layout.Divider, { props: { label: "Details" } });
    expect(divider.getAttribute("role")).toBe("separator");
    expect(divider.getAttribute("aria-label")).toBe("Details");
    expect(divider.textContent).toBe("Details");
  });

  it("uses intrinsic responsive tracks and wrapping with stable child bounds", () => {
    const grid = renderComponent(Layout.Grid, { children: "Grid" });
    expect(grid.style.gridTemplateColumns).toContain("auto-fit");
    expect(grid.style.gridTemplateColumns).toContain("var(--facet-");
    expect(grid.style.minWidth).toBe("0px");
    cleanup();

    const split = renderComponent(Layout.Split, {
      slots: { primary: "Primary", secondary: "Secondary" },
    });
    expect(split.style.flexWrap).toBe("wrap");
    for (const region of split.querySelectorAll<HTMLElement>("[data-facet-slot]")) {
      expect(region.style.minWidth).toContain("var(--facet-");
      expect(region.style.maxWidth).toBe("100%");
    }
    cleanup();

    const shell = renderComponent(Layout.AppShell, { slots: { main: "Main" } });
    expect(shell.style.flexWrap).toBe("wrap");
    expect(shell.style.gap).toContain("var(--facet-");
    expect(shell.querySelector("main")?.style.minWidth).toBe("0px");
  });

  it("projects bounded layout props into normal-flow styles", () => {
    const stack = renderComponent(Layout.Stack, {
      props: { gap: "sm", align: "center", justify: "between", grow: true, padding: "lg" },
      children: "Stack",
    });
    expect(stack.style.gap).toContain("var(--facet-foundation-space-sm)");
    expect(stack.style.alignItems).toBe("center");
    expect(stack.style.justifyContent).toBe("space-between");
    expect(stack.style.flexGrow).toBe("1");
    expect(stack.style.padding).toContain("var(--facet-foundation-space-lg)");
    cleanup();

    const row = renderComponent(Layout.Row, {
      props: { gap: "xs", align: "baseline", justify: "end", wrap: false },
      children: "Row",
    });
    expect(row.style.gap).toContain("var(--facet-foundation-space-xs)");
    expect(row.style.alignItems).toBe("baseline");
    expect(row.style.justifyContent).toBe("flex-end");
    expect(row.style.flexWrap).toBe("nowrap");
    cleanup();

    const grid = renderComponent(Layout.Grid, {
      props: { columns: 4, gap: "sm", collapse: false },
      children: "Grid",
    });
    expect(grid.style.gridTemplateColumns).toBe("repeat(4, minmax(0, 1fr))");
    expect(grid.style.gap).toContain("var(--facet-foundation-space-sm)");
    cleanup();

    const split = renderComponent(Layout.Split, {
      props: { ratio: "30:70", gap: "sm", align: "center", reverse: true, collapse: false },
      slots: { primary: "Primary", secondary: "Secondary" },
    });
    expect(split.getAttribute("data-facet-split-ratio")).toBe("30:70");
    expect(split.style.flexWrap).toBe("nowrap");
    expect(split.style.alignItems).toBe("center");
    expect(split.firstElementChild?.getAttribute("data-facet-slot")).toBe("secondary");
    expect((split.firstElementChild as HTMLElement).style.flex).toContain("7 1");
  });

  it("keeps roots theme-mounted, flow-contained, and dimensionally stable", () => {
    for (const implementation of Object.values(Layout)) {
      const root = renderComponent(implementation, {
        children: "Child",
        slots: {
          primary: "Primary",
          secondary: "Secondary",
          main: "Main",
          body: "Body",
          actions: "Actions",
        },
      });

      for (const [name, value] of Object.entries(THEME_VARS)) {
        expect(root.style.getPropertyValue(name)).toBe(value);
      }
      expect(
        declarations(root).filter(([name]) => OUT_OF_FLOW_PROPERTIES.includes(name as never)),
      ).toEqual([]);
      expect(root.style.boxSizing).toBe("border-box");
      expect(root.style.maxWidth).toBe("100%");
      cleanup();
    }
  });

  it("keeps cards equal-height capable without changing their width", () => {
    const card = renderComponent(Layout.Card, { children: "Card body" });
    expect(card.style.width).toBe("100%");
    expect(card.style.height).toBe("100%");
    expect(card.style.minWidth).toBe("0px");
  });
});
