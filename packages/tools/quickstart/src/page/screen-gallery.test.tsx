// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import type { ComponentPreviewFixtureResult } from "./component-preview-fixtures.js";
import { ScreenGallery } from "./screen-gallery.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mountedRoots: Root[] = [];

afterEach(() => {
  for (const root of mountedRoots) {
    act(() => root.unmount());
  }
  mountedRoots = [];
  document.body.replaceChildren();
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

describe("ScreenGallery", () => {
  it("renders a selectable screen gallery with one full screen preview", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<ScreenGallery renderPreview={stubPreview} />);

    const gallery = host.querySelector("[data-facet-screen-gallery]");
    expect(gallery).toBeInstanceOf(HTMLElement);
    expect(gallery?.textContent).toContain("Screens");
    expect(gallery?.textContent).toContain("13 patterns");
    expect(host.querySelectorAll("[data-screen-pattern-option]")).toHaveLength(13);
    expect(host.querySelectorAll("[data-screen-pattern]")).toHaveLength(1);
    expect(
      host.querySelector('[data-screen-pattern="revenue-command-center"]')?.textContent,
    ).toContain("Revenue command center");
    expect(host.querySelectorAll("[data-facet-component-preview]")).toHaveLength(1);
  });

  it("switches the full screen preview when a pattern is selected", () => {
    const host = render(<ScreenGallery renderPreview={stubPreview} />);
    const settings = host.querySelector('[data-screen-pattern-option="workspace-settings-flow"]');

    expect(host.querySelector('[data-screen-pattern="revenue-command-center"]')).toBeTruthy();
    if (!(settings instanceof HTMLButtonElement)) {
      throw new Error("Missing workspace settings pattern option");
    }
    act(() => {
      settings.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(host.querySelector('[data-screen-pattern="workspace-settings-flow"]')).toBeTruthy();
    expect(host.querySelector('[data-screen-pattern="revenue-command-center"]')).toBeNull();
    expect(host.querySelectorAll("[data-facet-component-preview]")).toHaveLength(1);
  });

  it("uses responsive sizing and stays free of transport APIs", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<ScreenGallery renderPreview={stubPreview} />);

    const gallery = host.querySelector("[data-facet-screen-gallery]");
    expect(gallery).toBeInstanceOf(HTMLElement);
    expect((gallery as HTMLElement).style.minWidth).toBe("0px");
    expect((gallery as HTMLElement).style.width).toBe("100%");
  });
});
