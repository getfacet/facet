// @vitest-environment jsdom

import type { CollectedValue, ComponentMountProps, MountedComponent } from "@facet/core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as Surface from "./surface.js";

type MountProps = ComponentMountProps<ReactNode>["props"];
type Slots = ComponentMountProps<ReactNode>["slots"];

const THEME_VARS = Object.freeze({ "--facet-test-task": "rgb(10, 20, 30)" });
const EXPECTED_EXPORTS = [
  "Alert",
  "Board",
  "BoardColumn",
  "Calendar",
  "Collection",
  "Detail",
  "Empty",
  "Header",
  "ItemCard",
  "Property",
  "PropertyList",
  "Result",
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

function renderComponent(
  implementation: MountedComponent<ReactNode, ReactNode>,
  options: {
    readonly props?: MountProps;
    readonly children?: ReactNode;
    readonly slots?: Slots;
    readonly onValueChange?: (value: CollectedValue) => void;
  } = {},
): HTMLElement {
  const Component = implementation;
  const mount = {
    props: options.props ?? {},
    slots: options.slots ?? {},
    themeVars: THEME_VARS,
    onAction: (): void => undefined,
    ...(options.onValueChange === undefined ? {} : { onValueChange: options.onValueChange }),
  };
  const { container } = render(<Component {...mount}>{options.children ?? null}</Component>);
  expect(container.childElementCount).toBe(1);
  const root = container.firstElementChild;
  if (!(root instanceof HTMLElement)) throw new Error("Expected one HTMLElement root.");
  return root;
}

function declarations(root: HTMLElement): readonly (readonly [string, string])[] {
  return [root, ...Array.from(root.querySelectorAll("*"))].flatMap((node) => {
    if (!(node instanceof HTMLElement)) return [];
    return Array.from(node.style).map((name) => [name, node.style.getPropertyValue(name)] as const);
  });
}

describe("trusted task-surface React components", () => {
  it("exports exactly the locked task-surface roster", () => {
    expect(Object.keys(Surface).sort()).toEqual(EXPECTED_EXPORTS);
  });

  it("renders Header from its four named slots and ignores ordered children", () => {
    const root = renderComponent(Surface.Header, {
      props: {
        eyebrow: "Account",
        title: "Ada Lovelace",
        description: "Workspace owner",
        align: "center",
        tone: "inverse",
      },
      children: <span data-testid="ignored">ignored</span>,
      slots: {
        leading: <span>AL</span>,
        meta: <span>Active</span>,
        actions: <button type="button">Edit</button>,
        media: <span>Portrait</span>,
      },
    });

    expect(root.tagName).toBe("HEADER");
    expect(root.querySelector("h1")?.textContent).toBe("Ada Lovelace");
    expect(root.getAttribute("data-facet-header-align")).toBe("center");
    expect(root.getAttribute("data-facet-header-tone")).toBe("inverse");
    expect(root.querySelector('[data-testid="ignored"]')).toBeNull();
    expect(root.querySelector('[data-facet-slot="leading"]')?.textContent).toBe("AL");
    expect(root.querySelector('[data-facet-slot="meta"]')?.textContent).toBe("Active");
    expect(root.querySelector('[data-facet-slot="actions"]')?.textContent).toBe("Edit");
    expect(root.querySelector('[data-facet-slot="media"]')?.textContent).toBe("Portrait");
  });

  it("renders collection, item, detail, and record slots in their named regions", () => {
    const collection = renderComponent(Surface.Collection, {
      props: { title: "Products", description: "Available now", layout: "grid", columns: 4 },
      children: "ignored",
      slots: { controls: "Filters", items: "LampDesk", actions: "Compare" },
    });
    expect(collection.querySelector('[data-facet-slot="controls"]')?.textContent).toBe("Filters");
    expect(collection.querySelector('[data-facet-slot="items"]')?.textContent).toBe("LampDesk");
    expect(collection.querySelector('[data-facet-slot="actions"]')?.textContent).toBe("Compare");
    expect(collection.textContent).not.toContain("ignored");
    expect(collection.getAttribute("data-facet-collection-columns")).toBe("4");
    expect(
      collection.querySelector<HTMLElement>('[data-facet-slot="items"]')?.style.gridTemplateColumns,
    ).toContain("auto-fit");
    expect(
      collection.querySelector<HTMLElement>('[data-facet-slot="items"]')?.style.maxWidth,
    ).toContain("calc(");
    cleanup();

    const item = renderComponent(Surface.ItemCard, {
      props: { title: "Desk lamp", description: "Warm light", eyebrow: "Lighting", meta: "$42" },
      slots: { media: "Photo", content: "In stock", actions: "View" },
    });
    expect(item.tagName).toBe("ARTICLE");
    expect(item.querySelector('[data-facet-slot="media"]')?.textContent).toBe("Photo");
    expect(item.querySelector('[data-facet-slot="content"]')?.textContent).toBe("In stock");
    expect(item.querySelector('[data-facet-slot="actions"]')?.textContent).toBe("View");
    cleanup();

    const detail = renderComponent(Surface.Detail, {
      props: { title: "Desk lamp", description: "Full record", meta: "Updated today" },
      slots: { media: "Photo", summary: "Available", details: "Properties", actions: "Buy" },
    });
    expect(detail.querySelector('[data-facet-slot="media"]')?.textContent).toBe("Photo");
    expect(detail.querySelector('[data-facet-slot="summary"]')?.textContent).toBe("Available");
    expect(detail.querySelector('[data-facet-slot="details"]')?.textContent).toBe("Properties");
    expect(detail.querySelector('[data-facet-slot="actions"]')?.textContent).toBe("Buy");
  });

  it("renders property lists and boards from named slots while columns use ordered children", () => {
    const properties = renderComponent(Surface.PropertyList, {
      props: { title: "Details", columns: 3 },
      slots: { items: "ColorWarm white" },
    });
    expect(properties.querySelector('[data-facet-slot="items"]')?.textContent).toBe(
      "ColorWarm white",
    );
    expect(properties.getAttribute("data-facet-property-list-columns")).toBe("3");
    expect(
      properties.querySelector<HTMLElement>('[data-facet-slot="items"]')?.style.maxWidth,
    ).toContain("calc(");
    cleanup();

    const property = renderComponent(Surface.Property, {
      props: { label: "Color", value: "Warm white", tone: "muted" },
      children: "ignored",
      slots: { ignored: "ignored" },
    });
    expect(property.querySelector("dt")?.textContent).toBe("Color");
    expect(property.querySelector("dd")?.textContent).toBe("Warm white");
    expect(property.textContent).not.toContain("ignored");
    cleanup();

    const board = renderComponent(Surface.Board, {
      props: { title: "Roadmap" },
      slots: { columns: "PlannedIn progressDone" },
    });
    expect(board.querySelector('[data-facet-slot="columns"]')?.textContent).toBe(
      "PlannedIn progressDone",
    );
    expect(board.querySelector<HTMLElement>('[data-facet-slot="columns"]')?.style.overflowX).toBe(
      "auto",
    );
    cleanup();

    const column = renderComponent(Surface.BoardColumn, {
      props: { title: "In progress", description: "Current work", tone: "accent" },
      children: <span>Task one</span>,
      slots: { ignored: "ignored" },
    });
    expect(column.textContent).toContain("Task one");
    expect(column.textContent).not.toContain("ignored");
  });

  it("renders result, empty, and alert supporting content from named slots", () => {
    const fixtures = [
      {
        component: Surface.Result,
        props: { title: "Import complete", description: "42 records", tone: "success" },
        slots: { summary: "Success", details: "No errors", actions: "View records" },
        names: ["summary", "details", "actions"],
      },
      {
        component: Surface.Empty,
        props: { title: "No invoices", description: "Create the first invoice" },
        slots: { body: "Invoices appear here", actions: "Create" },
        names: ["body", "actions"],
      },
      {
        component: Surface.Alert,
        props: { title: "Payment failed", description: "Try another card", tone: "danger" },
        slots: { body: "The card was declined", actions: "Update card" },
        names: ["body", "actions"],
      },
    ] as const;

    for (const fixture of fixtures) {
      const root = renderComponent(fixture.component, {
        props: fixture.props,
        children: "ignored",
        slots: fixture.slots,
      });
      for (const name of fixture.names) {
        expect(root.querySelector(`[data-facet-slot="${name}"]`)).not.toBeNull();
      }
      expect(root.textContent).not.toContain("ignored");
      cleanup();
    }
  });

  it("renders valid calendar events and emits the selected event id as a string", () => {
    const onValueChange = vi.fn<(value: CollectedValue) => void>();
    const root = renderComponent(Surface.Calendar, {
      props: {
        title: "Schedule",
        view: "agenda",
        value: "evt-2",
        events: [
          {
            id: "evt-1",
            title: "Kickoff",
            start: "2026-08-20T09:00:00Z",
            end: "2026-08-20T10:00:00Z",
            tone: "accent",
          },
          { id: "evt-2", title: "Review", start: "2026-08-21" },
        ],
      },
      onValueChange,
    });
    const events = root.querySelectorAll<HTMLButtonElement>("button");

    expect(events).toHaveLength(2);
    expect(events[1]?.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(events[0] as HTMLButtonElement);
    expect(onValueChange).toHaveBeenCalledWith("evt-1");
    expect(typeof onValueChange.mock.calls[0]?.[0]).toBe("string");
  });

  it("drops malformed calendar records instead of throwing or stringifying structures", () => {
    const root = renderComponent(Surface.Calendar, {
      props: {
        events: [
          { id: "ok", title: "Valid", start: "2026-08-20" },
          { id: "missing-start", title: "Invalid" },
          "not-an-event",
          { id: "nested", title: { unsafe: true }, start: "2026-08-21" },
        ],
      },
    });

    expect(root.querySelectorAll("button")).toHaveLength(1);
    expect(root.textContent).toContain("Valid");
    expect(root.textContent).not.toContain("object Object");
  });

  it("keeps every root theme-mounted, bounded, and in normal flow", () => {
    for (const implementation of Object.values(Surface)) {
      const root = renderComponent(implementation, {
        props: { title: "Averylongheadingwithoutanaturalbreakpoint", events: [] },
        children: "Child",
        slots: {
          items: "Items",
          columns: "Columns",
          actions: "Actions",
          body: "Body",
        },
      });

      expect(root.style.getPropertyValue("--facet-test-task")).toBe(
        THEME_VARS["--facet-test-task"],
      );
      expect(root.style.boxSizing).toBe("border-box");
      expect(root.style.minWidth).toBe("0px");
      expect(root.style.maxWidth).toBe("100%");
      expect(
        declarations(root).filter(([name]) => OUT_OF_FLOW_PROPERTIES.includes(name as never)),
      ).toEqual([]);
      cleanup();
    }
  });
});
