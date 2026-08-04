// @vitest-environment jsdom

import { DEFAULT_CATALOG } from "@facet/assets";
import { readFileSync } from "node:fs";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { ComponentInspector } from "./component-inspector.js";
import { deriveComponentInspectorRows } from "./component-inspector-model.js";
import type { ComponentPreviewFixtureResult } from "./component-preview-fixtures.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mountedRoots: Root[] = [];

afterEach(() => {
  for (const root of mountedRoots) {
    act(() => root.unmount());
  }
  mountedRoots = [];
  document.body.replaceChildren();
  document.body.style.overflow = "";
});

function render(ui: ReactNode): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mountedRoots.push(root);
  act(() => root.render(ui));
  return host;
}

function stubPreview(preview: ComponentPreviewFixtureResult): ReactNode {
  return (
    <div
      data-facet-component-preview={preview.tag}
      data-facet-component-preview-state={preview.ok ? "ready" : "fallback"}
    />
  );
}

function section(container: ParentNode, accessibleName: string): HTMLElement {
  for (const candidate of container.querySelectorAll("section")) {
    if (
      candidate.getAttribute("aria-label") === accessibleName &&
      candidate instanceof HTMLElement
    ) {
      return candidate;
    }
  }
  throw new Error(`Missing section: ${accessibleName}`);
}

function buttonNamed(container: ParentNode, name: string): HTMLButtonElement {
  for (const candidate of container.querySelectorAll("button")) {
    if (candidate.textContent?.includes(name) === true && candidate instanceof HTMLButtonElement) {
      return candidate;
    }
  }
  throw new Error(`Missing button: ${name}`);
}

function inputNamed(container: ParentNode, name: string): HTMLInputElement {
  for (const candidate of container.querySelectorAll("input")) {
    if (candidate.getAttribute("aria-label") === name && candidate instanceof HTMLInputElement) {
      return candidate;
    }
  }
  throw new Error(`Missing input: ${name}`);
}

function changeInput(input: HTMLInputElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (valueSetter === undefined) {
    throw new Error("Missing HTMLInputElement value setter");
  }
  act(() => {
    valueSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
  });
}

function click(element: HTMLElement): void {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function presentedTags(): readonly string[] {
  return [...deriveComponentInspectorRows(DEFAULT_CATALOG)]
    .sort((left, right) => left.presentation.order - right.presentation.order)
    .map((row) => row.tag);
}

describe("ComponentInspector", () => {
  it("shows catalog metadata inside the components section", () => {
    const rows = deriveComponentInspectorRows(DEFAULT_CATALOG);
    const screen = rows.find((row) => row.tag === "Screen");
    const field = rows.find((row) => row.tag === "Field");
    if (screen === undefined || field === undefined) {
      throw new Error("Missing Screen or Field metadata row");
    }

    const container = render(<ComponentInspector renderPreview={stubPreview} />);
    const components = section(container, "Components section");

    expect(components.querySelectorAll("[data-component-option]")).toHaveLength(
      DEFAULT_CATALOG.components.length,
    );
    expect(components.querySelector('[data-component-detail="Screen"]')?.textContent).toContain(
      screen.whenToUse,
    );
    expect(
      components.querySelector('[data-component-contract-summary-item="children"]')?.textContent,
    ).toContain("accepted");
    expect(components.querySelector('[data-component-prop="name"]')?.textContent).toContain(
      "required",
    );
    expect(
      components.querySelector('[data-component-theme-recipe="Screen"]')?.textContent,
    ).toContain("background color");
    expect(
      components
        .querySelector("[data-facet-component-preview]")
        ?.getAttribute("data-facet-component-preview"),
    ).toBe("Screen");
    expect(components.querySelector('[data-component-specimens="Screen"]')?.textContent).toContain(
      "Variants",
    );
    expect(components.querySelector('[data-component-specimens="Screen"]')?.textContent).toContain(
      "Default theme",
    );

    click(buttonNamed(components, "Field"));

    expect(components.querySelector('[data-component-detail="Field"]')?.textContent).toContain(
      field.whenToUse,
    );
    expect(components.querySelector('[data-component-collect="Field"]')?.textContent).toContain(
      "valueProp value",
    );
    expect(components.querySelector('[data-component-collect="Field"]')?.textContent).toContain(
      "sensitiveProp secret",
    );
  });

  it("renders a searchable list entry for every default catalog component", () => {
    const container = render(<ComponentInspector renderPreview={stubPreview} />);
    const components = section(container, "Components section");

    expect(
      [...components.querySelectorAll("[data-component-option]")].map((element) =>
        element.getAttribute("data-component-option"),
      ),
    ).toEqual(presentedTags());
    expect(components.textContent).toContain(`${DEFAULT_CATALOG.components.length} components`);

    changeInput(inputNamed(components, "Search components"), "mark a short status");

    expect(
      [...components.querySelectorAll("[data-component-option]")].map((element) =>
        element.getAttribute("data-component-option"),
      ),
    ).toEqual(["Badge"]);
    expect(components.querySelector('[data-component-detail="Badge"]')).toBeTruthy();
    expect(
      components
        .querySelector("[data-facet-component-preview]")
        ?.getAttribute("data-facet-component-preview"),
    ).toBe("Badge");
  });

  it("groups component names behind collapsible sidebar sections", () => {
    const container = render(<ComponentInspector renderPreview={stubPreview} />);
    const components = section(container, "Components section");
    const surfacesToggle = components.querySelector(
      '[data-component-group-toggle="surface"]',
    ) as HTMLButtonElement | null;

    if (surfacesToggle === null) {
      throw new Error("Missing surface group toggle");
    }
    expect(surfacesToggle).toBeInstanceOf(HTMLButtonElement);
    expect(surfacesToggle?.getAttribute("aria-expanded")).toBe("true");
    expect(components.querySelector('[data-component-option="Card"]')).toBeTruthy();

    click(surfacesToggle);

    expect(surfacesToggle?.getAttribute("aria-expanded")).toBe("false");
    expect(components.querySelector('[data-component-option="Card"]')).toBeNull();

    click(surfacesToggle);

    expect(surfacesToggle?.getAttribute("aria-expanded")).toBe("true");
    expect(components.querySelector('[data-component-option="Card"]')).toBeTruthy();
  });

  it("shows recipe-backed specimens for component prop variants", () => {
    const container = render(<ComponentInspector renderPreview={stubPreview} />);
    const components = section(container, "Components section");

    click(buttonNamed(components, "Button"));

    expect(
      [...components.querySelectorAll("[data-component-specimen]")].map((element) =>
        element.getAttribute("data-component-specimen"),
      ),
    ).toEqual(["button-primary", "button-secondary", "button-quiet"]);
    expect(
      components.querySelector('[data-component-specimen="button-primary"]')?.textContent,
    ).toContain('tone="primary"');
    expect(
      components.querySelector('[data-component-specimen="button-primary"]')?.textContent,
    ).toContain("primaryBg");
    expect(
      components.querySelector('[data-component-specimen="button-secondary"]')?.textContent,
    ).toContain("secondaryBg");
    expect(
      components.querySelector('[data-component-specimen="button-quiet"]')?.textContent,
    ).toContain("quietText");
  });

  it("lets wide layout specimens use the whole preview row", () => {
    const container = render(<ComponentInspector renderPreview={stubPreview} />);
    const components = section(container, "Components section");

    click(buttonNamed(components, "AppShell"));

    const appShellSpecimens = [
      ...components.querySelectorAll('[data-component-specimen-size="wide"]'),
    ];
    expect(
      appShellSpecimens.map((element) => element.getAttribute("data-component-specimen")),
    ).toEqual(["app-shell-start", "app-shell-end"]);
    for (const specimen of appShellSpecimens) {
      expect(specimen).toBeInstanceOf(HTMLElement);
      expect((specimen as HTMLElement).style.gridColumn).toBe("1 / -1");
    }
  });

  it("searches catalog metadata beyond component tags", () => {
    const container = render(<ComponentInspector renderPreview={stubPreview} />);
    const components = section(container, "Components section");

    changeInput(inputNamed(components, "Search components"), "secret");

    expect(
      [...components.querySelectorAll("[data-component-option]")].map((element) =>
        element.getAttribute("data-component-option"),
      ),
    ).toEqual(["Field"]);

    changeInput(inputNamed(components, "Search components"), "primaryBg");

    expect(components.querySelector("[data-component-empty-state]")).toBeNull();
    expect(components.querySelector("[data-component-option]")).not.toBeNull();
  });

  it("clears detail and preview state when component search has no matches", () => {
    const container = render(<ComponentInspector renderPreview={stubPreview} />);
    const components = section(container, "Components section");

    expect(components.querySelector('[data-component-detail="Screen"]')).toBeTruthy();
    expect(components.querySelector("[data-facet-component-preview]")).toBeTruthy();

    changeInput(inputNamed(components, "Search components"), "no matching component");

    expect(components.querySelector("[data-component-option]")).toBeNull();
    expect(components.querySelector("[data-component-empty-state]")?.textContent).toContain(
      "No components match",
    );
    expect(components.querySelector("[data-component-detail-empty]")).toBeTruthy();
    expect(components.querySelector("[data-component-detail]")).toBeNull();
    expect(components.querySelector("[data-facet-component-preview]")).toBeNull();
  });

  it("keeps catalog details in Components without adding a primary Catalog tab", () => {
    const container = render(<ComponentInspector renderPreview={stubPreview} />);

    expect(section(container, "Components section")).toBeTruthy();
    expect(
      [...container.querySelectorAll('[role="tab"]')].some((element) => {
        return element.textContent === "Catalog";
      }),
    ).toBe(false);
  });

  it("uses responsive sizing that keeps text and controls inside their containers", () => {
    const container = render(<ComponentInspector renderPreview={stubPreview} />);
    const root = container.querySelector("[data-facet-component-inspector]");
    const list = container.querySelector("[data-component-list-panel]");
    const detail = container.querySelector("[data-component-detail-panel]");

    expect(root).toBeInstanceOf(HTMLElement);
    expect((root as HTMLElement).style.gridTemplateColumns).toContain("minmax");
    expect(list).toBeInstanceOf(HTMLElement);
    expect((list as HTMLElement).style.minWidth).toBe("0px");
    expect(detail).toBeInstanceOf(HTMLElement);
    expect((detail as HTMLElement).style.minWidth).toBe("0px");
    expect((detail as HTMLElement).style.overflowWrap).toBe("anywhere");

    const source = readFileSync(
      "packages/tools/quickstart/src/page/component-inspector.tsx",
      "utf8",
    );
    expect(source).not.toMatch(
      /\b(?:fetch|SseTransport|LocalTransport|StageRenderer|useFacet|sendEvent|sendMessage)\b/,
    );
    expect(source).not.toMatch(/["']@facet\/(?:server|client|runtime|react|agent-client)["']/);
  });
});
