// @vitest-environment jsdom

import {
  BOUNDS,
  type CollectedValue,
  type ComponentMountProps,
  type MountedComponent,
} from "@facet/core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as Interactive from "./interactive.js";

type MountProps = ComponentMountProps<ReactNode>["props"];
type Slots = ComponentMountProps<ReactNode>["slots"];

const THEME_VARS = Object.freeze({ "--facet-test-input": "rgb(10, 20, 30)" });
const EXPECTED_EXPORTS = [
  "Accordion",
  "AccordionItem",
  "ChoiceGroup",
  "Field",
  "Form",
  "MessageThread",
  "Select",
  "Toggle",
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

function mount(
  props: MountProps,
  options: {
    readonly children?: ReactNode;
    readonly slots?: Slots;
    readonly onValueChange?: (value: CollectedValue) => void;
  } = {},
): ComponentMountProps<ReactNode> {
  const base: ComponentMountProps<ReactNode> = {
    props,
    children: options.children ?? null,
    slots: options.slots ?? {},
    themeVars: THEME_VARS,
    onAction: (): void => undefined,
  };
  return options.onValueChange === undefined
    ? base
    : { ...base, onValueChange: options.onValueChange };
}

function renderComponent(
  implementation: MountedComponent<ReactNode, ReactNode>,
  props: ComponentMountProps<ReactNode>,
): HTMLElement {
  const Component = implementation;
  const { container } = render(<Component {...props} />);
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

describe("trusted input, communication, and disclosure React components", () => {
  it("exports exactly the locked interactive roster", () => {
    expect(Object.keys(Interactive).sort()).toEqual(EXPECTED_EXPORTS);
  });

  it("renders Form only from its fields and actions slots", () => {
    const root = renderComponent(
      Interactive.Form,
      mount(
        { layout: "inline" },
        {
          children: <span data-testid="ignored">ignored</span>,
          slots: { fields: <label>Region</label>, actions: <button type="button">Apply</button> },
        },
      ),
    );

    expect(root.tagName).toBe("FORM");
    expect(root.getAttribute("data-facet-form-layout")).toBe("inline");
    expect(root.querySelector('[data-facet-slot="fields"]')?.textContent).toBe("Region");
    expect(root.querySelector('[data-facet-slot="actions"]')?.textContent).toBe("Apply");
    expect(root.querySelector('[data-testid="ignored"]')).toBeNull();
    expect(fireEvent.submit(root)).toBe(false);
  });

  it("keeps Field controlled and emits only a string value", () => {
    const onValueChange = vi.fn<(value: CollectedValue) => void>();
    const payload = mount(
      { name: "region", label: "Region", value: "north", placeholder: "Choose", secret: false },
      { onValueChange },
    );
    const Component = Interactive.Field;
    const { container, rerender } = render(<Component {...payload} />);
    const input = container.querySelector("input") as HTMLInputElement;

    expect(input.value).toBe("north");
    expect(input.name).toBe("");
    fireEvent.change(input, { target: { value: "south" } });
    expect(onValueChange).toHaveBeenCalledWith("south");
    expect(input.value).toBe("north");

    rerender(<Component {...mount({ ...payload.props, value: "south" }, { onValueChange })} />);
    expect(input.value).toBe("south");
  });

  it("masks a secret Field and keeps the collect identity out of the DOM", () => {
    const secret = "not-for-visible-copy";
    const root = renderComponent(
      Interactive.Field,
      mount({ name: "token", label: "API token", value: secret, secret: true }),
    );
    const input = root.querySelector("input") as HTMLInputElement;

    expect(input.type).toBe("password");
    expect(input.name).toBe("");
    expect(root.textContent).not.toContain(secret);
  });

  it("renders Select options defensively and emits a selected string", () => {
    const onValueChange = vi.fn<(value: CollectedValue) => void>();
    const root = renderComponent(
      Interactive.Select,
      mount(
        {
          name: "region",
          label: "Region",
          placeholder: "Choose a region",
          value: "south",
          options: [
            { label: "North", value: "north" },
            { label: "South", value: "south" },
            { label: "West", value: "west", disabled: true },
            { label: { unsafe: true }, value: "bad" },
          ],
        },
        { onValueChange },
      ),
    );
    const select = root.querySelector("select") as HTMLSelectElement;

    expect(select.value).toBe("south");
    expect(select.name).toBe("");
    expect(select.options).toHaveLength(4);
    expect(select.options[3]?.disabled).toBe(true);
    fireEvent.change(select, { target: { value: "north" } });
    expect(onValueChange).toHaveBeenCalledWith("north");
  });

  it("keeps an empty Select value visible and caps data-backed choices", () => {
    const options = Array.from({ length: BOUNDS.renderedCollectionItems + 20 }, (_, index) => ({
      label: `Option ${index}`,
      value: `option-${index}`,
    }));
    const root = renderComponent(
      Interactive.Select,
      mount({ name: "region", label: "Region", value: "", options }),
    );
    const select = root.querySelector("select") as HTMLSelectElement;

    expect(select.value).toBe("");
    expect(select.options[0]?.value).toBe("");
    expect(select.options[0]?.hidden).toBe(true);
    expect(select.options).toHaveLength(BOUNDS.renderedCollectionItems + 1);
  });

  it("clears a Select value that is absent from its current option set", () => {
    const onValueChange = vi.fn<(value: CollectedValue) => void>();
    const root = renderComponent(
      Interactive.Select,
      mount(
        {
          name: "region",
          label: "Region",
          value: "west",
          options: [
            { label: "North", value: "north" },
            { label: "South", value: "south" },
          ],
        },
        { onValueChange },
      ),
    );

    expect((root.querySelector("select") as HTMLSelectElement).value).toBe("");
    expect(onValueChange).toHaveBeenCalledWith("");
  });

  it("clears each distinct unavailable Select and ChoiceGroup value", () => {
    const onSelectChange = vi.fn<(value: CollectedValue) => void>();
    const Select = Interactive.Select;
    const selectProps = {
      name: "region",
      label: "Region",
      options: [{ label: "North", value: "north" }],
    };
    const select = render(
      <Select {...mount({ ...selectProps, value: "west" }, { onValueChange: onSelectChange })} />,
    );
    select.rerender(
      <Select {...mount({ ...selectProps, value: "south" }, { onValueChange: onSelectChange })} />,
    );
    expect(onSelectChange).toHaveBeenCalledTimes(2);
    cleanup();

    const onChoiceChange = vi.fn<(value: CollectedValue) => void>();
    const ChoiceGroup = Interactive.ChoiceGroup;
    const choiceProps = {
      name: "channels",
      label: "Channels",
      options: [{ label: "Email", value: "email" }],
    };
    const choices = render(
      <ChoiceGroup
        {...mount({ ...choiceProps, value: ["sms"] }, { onValueChange: onChoiceChange })}
      />,
    );
    choices.rerender(
      <ChoiceGroup
        {...mount({ ...choiceProps, value: ["push"] }, { onValueChange: onChoiceChange })}
      />,
    );
    expect(onChoiceChange).toHaveBeenCalledTimes(2);
  });

  it("keeps ChoiceGroup controlled and emits a string array in option order", () => {
    const onValueChange = vi.fn<(value: CollectedValue) => void>();
    const root = renderComponent(
      Interactive.ChoiceGroup,
      mount(
        {
          name: "channels",
          label: "Channels",
          layout: "inline",
          value: ["email"],
          options: [
            { label: "Email", value: "email" },
            { label: "SMS", value: "sms" },
            { label: "Push", value: "push", disabled: true },
          ],
        },
        { onValueChange },
      ),
    );
    const choices = root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');

    expect(choices).toHaveLength(3);
    expect(choices[0]?.checked).toBe(true);
    expect(choices[1]?.checked).toBe(false);
    expect(choices[2]?.disabled).toBe(true);
    expect(choices[0]?.name).toBe("");
    fireEvent.click(choices[1] as HTMLInputElement);
    expect(onValueChange).toHaveBeenCalledWith(["email", "sms"]);
    expect(choices[1]?.checked).toBe(false);
  });

  it("removes unavailable and duplicate ChoiceGroup values from the collected selection", () => {
    const onValueChange = vi.fn<(value: CollectedValue) => void>();
    const root = renderComponent(
      Interactive.ChoiceGroup,
      mount(
        {
          name: "channels",
          label: "Channels",
          value: ["removed", "email", "email"],
          options: [
            { label: "Email", value: "email" },
            { label: "SMS", value: "sms" },
          ],
        },
        { onValueChange },
      ),
    );
    const choices = root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');

    expect(choices[0]?.checked).toBe(true);
    expect(choices[1]?.checked).toBe(false);
    expect(onValueChange).toHaveBeenCalledWith(["email"]);
  });

  it("caps data-backed ChoiceGroup options and MessageThread messages", () => {
    const options = Array.from({ length: BOUNDS.renderedCollectionItems + 20 }, (_, index) => ({
      label: `Choice ${index}`,
      value: `choice-${index}`,
    }));
    const choices = renderComponent(
      Interactive.ChoiceGroup,
      mount({ name: "items", label: "Items", value: [], options }),
    );
    expect(choices.querySelectorAll('input[type="checkbox"]')).toHaveLength(
      BOUNDS.renderedCollectionItems,
    );
    cleanup();

    const messages = Array.from({ length: BOUNDS.renderedCollectionItems + 20 }, (_, index) => ({
      id: `message-${index}`,
      author: "Ada",
      body: `Message ${index}`,
      timestamp: "09:30",
      side: "incoming",
    }));
    const thread = renderComponent(Interactive.MessageThread, mount({ messages }));
    expect(thread.querySelectorAll("li")).toHaveLength(BOUNDS.renderedCollectionItems);
  });

  it("keeps the first unique collectable option value and drops invalid semantic values", () => {
    const onValueChange = vi.fn<(value: CollectedValue) => void>();
    const root = renderComponent(
      Interactive.ChoiceGroup,
      mount(
        {
          name: "regions",
          label: "Regions",
          value: [],
          options: [
            { label: "North", value: "north" },
            { label: "North duplicate", value: "north" },
            { label: "Too long", value: "x".repeat(BOUNDS.collectedValueChars + 1) },
          ],
        },
        { onValueChange },
      ),
    );
    const choices = root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');

    expect(choices).toHaveLength(1);
    fireEvent.click(choices[0] as HTMLInputElement);
    expect(onValueChange).toHaveBeenCalledWith(["north"]);
  });

  it("keeps Toggle controlled and emits a boolean", () => {
    const onValueChange = vi.fn<(value: CollectedValue) => void>();
    const root = renderComponent(
      Interactive.Toggle,
      mount({ name: "updates", label: "Product updates", value: false }, { onValueChange }),
    );
    const toggle = root.querySelector("input") as HTMLInputElement;

    expect(toggle.type).toBe("checkbox");
    expect(toggle.getAttribute("role")).toBe("switch");
    expect(toggle.checked).toBe(false);
    expect(toggle.name).toBe("");
    fireEvent.click(toggle);
    expect(onValueChange).toHaveBeenCalledWith(true);
    expect(toggle.checked).toBe(false);
  });

  it("renders a chronological MessageThread from valid shaped messages", () => {
    const root = renderComponent(
      Interactive.MessageThread,
      mount({
        messages: [
          {
            id: "m1",
            author: "Ada",
            body: "Ready for review",
            timestamp: "09:30",
            side: "incoming",
          },
          {
            id: "m2",
            author: "Lin",
            body: "Approved",
            timestamp: "09:32",
            side: "outgoing",
            status: "Delivered",
          },
          { id: "bad", author: "Invalid" },
          "not-a-message",
        ],
      }),
    );
    const messages = root.querySelectorAll("li");

    expect(root.tagName).toBe("OL");
    expect(messages).toHaveLength(2);
    expect(messages[0]?.textContent).toContain("Ready for review");
    expect(messages[1]?.textContent).toContain("Approved");
    expect(messages[1]?.getAttribute("data-facet-message-side")).toBe("outgoing");
    expect(root.textContent).not.toContain("object Object");
  });

  it("coordinates one open AccordionItem and consumes body and actions slots", () => {
    const Item = Interactive.AccordionItem;
    const items = (
      <>
        <Item
          {...mount({ title: "First", defaultOpen: true }, { slots: { body: "First body" } })}
        />
        <Item
          {...mount(
            { title: "Second" },
            { slots: { body: "Second body", actions: "Second action" } },
          )}
        />
      </>
    );
    const root = renderComponent(
      Interactive.Accordion,
      mount({ multiple: false }, { children: "ignored", slots: { items } }),
    );
    const triggers = root.querySelectorAll<HTMLButtonElement>("button");
    const regions = root.querySelectorAll<HTMLElement>('[role="region"]');

    expect(root.querySelector('[data-facet-slot="items"]')).not.toBeNull();
    expect(root.textContent).not.toContain("ignored");
    expect(triggers[0]?.getAttribute("aria-expanded")).toBe("true");
    expect(regions[0]?.hidden).toBe(false);
    expect(regions[1]?.hidden).toBe(true);

    fireEvent.click(triggers[1] as HTMLButtonElement);
    expect(triggers[0]?.getAttribute("aria-expanded")).toBe("false");
    expect(triggers[1]?.getAttribute("aria-expanded")).toBe("true");
    expect(regions[1]?.textContent).toContain("Second body");
    expect(regions[1]?.querySelector('[data-facet-slot="actions"]')?.textContent).toBe(
      "Second action",
    );
  });

  it("allows multiple disclosures and supports Enter and Space keyboard activation", () => {
    const Item = Interactive.AccordionItem;
    const root = renderComponent(
      Interactive.Accordion,
      mount(
        { multiple: true },
        {
          slots: {
            items: (
              <>
                <Item {...mount({ title: "First" }, { slots: { body: "One" } })} />
                <Item {...mount({ title: "Second" }, { slots: { body: "Two" } })} />
              </>
            ),
          },
        },
      ),
    );
    const triggers = root.querySelectorAll<HTMLButtonElement>("button");

    fireEvent.keyDown(triggers[0] as HTMLButtonElement, { key: "Enter" });
    fireEvent.keyDown(triggers[1] as HTMLButtonElement, { key: " " });
    expect(triggers[0]?.getAttribute("aria-expanded")).toBe("true");
    expect(triggers[1]?.getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps every root theme-mounted, bounded, and in normal flow", () => {
    for (const implementation of Object.values(Interactive)) {
      const root = renderComponent(
        implementation,
        mount(
          {
            label: "Averylonglabelwithoutanaturalbreakpoint",
            title: "Averylongtitlewithoutanaturalbreakpoint",
            options: [],
            messages: [],
          },
          { children: "Child", slots: { fields: "Fields", actions: "Actions", items: "Items" } },
        ),
      );

      expect(root.style.getPropertyValue("--facet-test-input")).toBe(
        THEME_VARS["--facet-test-input"],
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
