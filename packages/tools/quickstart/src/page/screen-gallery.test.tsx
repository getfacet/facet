// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { ComponentSpec, MountedComponent } from "@facet/core";

import { resolveQuickstartDesignOverlay, type QuickstartDesignOverlay } from "../design-overlay.js";
import { resolveQuickstartPageActiveDesign } from "./active-design.js";
import { screenPatterns } from "./screen-gallery-fixtures.js";
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

function activeScreenPatterns() {
  const result = resolveQuickstartDesignOverlay({
    examples: [
      {
        id: "launch-operations-screen",
        kind: "screen",
        label: "Launch operations",
        description: "Active design launch screen with table-backed rollout data.",
        tags: ["Screen", "Grid", "Card", "Metric", "Table"],
        data: {
          launchRows: [
            { item: "Creative brief", owner: "Mina", status: "Ready" },
            { item: "Partner proof", owner: "Jules", status: "Review" },
          ],
        },
        markup: `<Facet entry="preview">
  <Screen name="preview" title="Launch operations" maxWidth="wide" padding="lg">
    <Grid columns="2" gap="md" collapse="true">
      <Card title="Readiness" tone="accent" padding="lg">
        <Metric label="Launch score" value="92" unit="%" />
      </Card>
      <Card title="Rollout queue" tone="neutral" padding="md">
        <Table rows="data:launchRows" caption="Launch queue" />
      </Card>
    </Grid>
  </Screen>
</Facet>`,
      },
    ],
  });

  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.detail}`);
  }

  return screenPatterns({ catalog: result.design.catalog, examples: result.design.examples });
}

const PROMO_BANNER_SPEC = Object.freeze({
  tag: "PromoBanner",
  whenToUse: "Use for active design launch announcements.",
  authoring: {
    role: "display",
    informationTypes: ["test_content"],
    visualEmphasis: "supporting",
  } as const,
  acceptsChildren: false,
  props: Object.freeze({
    title: Object.freeze({
      type: "string",
      required: true,
      guidance: "Primary announcement copy.",
    }),
  }),
}) satisfies ComponentSpec;

const PromoBanner: MountedComponent<ReactNode, ReactNode> = ({ props }) => {
  const title = typeof props["title"] === "string" ? props["title"] : "";
  return <aside data-active-promo-banner>{title}</aside>;
};

function activeCustomScreenDesign() {
  const overlay: QuickstartDesignOverlay = {
    components: [PROMO_BANNER_SPEC],
    registry: { PromoBanner },
    examples: [
      {
        id: "promo-screen",
        kind: "screen",
        label: "Promo screen",
        tags: ["Screen", "PromoBanner"],
        markup: `<Facet entry="preview">
  <Screen name="preview">
    <PromoBanner title="Private beta is open" />
  </Screen>
</Facet>`,
      },
    ],
  };
  const result = resolveQuickstartPageActiveDesign({ overlay });
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.detail}`);
  }
  return result.design;
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

  it("renders active overlay screen examples without changing default selection", () => {
    const patterns = activeScreenPatterns();
    const host = render(<ScreenGallery patterns={patterns} renderPreview={stubPreview} />);
    const launch = host.querySelector('[data-screen-pattern-option="launch-operations-screen"]');

    expect(host.querySelectorAll("[data-screen-pattern-option]")).toHaveLength(14);
    expect(host.querySelector("[data-facet-screen-gallery]")?.textContent).toContain("14 patterns");
    expect(host.querySelector('[data-screen-pattern="revenue-command-center"]')).toBeTruthy();
    expect(launch?.textContent).toContain("Launch operations");
    if (!(launch instanceof HTMLButtonElement)) {
      throw new Error("Missing launch operations pattern option");
    }

    act(() => {
      launch.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(host.querySelector('[data-screen-pattern="launch-operations-screen"]')).toBeTruthy();
    expect(host.querySelector('[data-screen-pattern="revenue-command-center"]')).toBeNull();
    expect(host.querySelectorAll("[data-facet-component-preview]")).toHaveLength(1);
  });

  it("can isolate imported screen examples from default patterns", () => {
    const patterns = activeScreenPatterns();
    const host = render(
      <ScreenGallery patterns={patterns} sourceFilter="imported" renderPreview={stubPreview} />,
    );

    expect(host.querySelectorAll("[data-screen-pattern-option]")).toHaveLength(1);
    expect(host.querySelector("[data-facet-screen-gallery]")?.textContent).toContain("1 patterns");
    expect(host.querySelector('[data-screen-pattern-option="launch-operations-screen"]')).toBe(
      host.querySelector("[data-screen-pattern-option]"),
    );
    expect(host.querySelector('[data-screen-pattern-option="revenue-command-center"]')).toBeNull();
    expect(host.querySelector('[data-screen-pattern="launch-operations-screen"]')).toBeTruthy();
  });

  it("can show only default screen patterns while imported examples exist", () => {
    const patterns = activeScreenPatterns();
    const host = render(
      <ScreenGallery patterns={patterns} sourceFilter="default" renderPreview={stubPreview} />,
    );

    expect(host.querySelectorAll("[data-screen-pattern-option]")).toHaveLength(13);
    expect(host.querySelector("[data-facet-screen-gallery]")?.textContent).toContain("13 patterns");
    expect(
      host.querySelector('[data-screen-pattern-option="revenue-command-center"]'),
    ).toBeTruthy();
    expect(
      host.querySelector('[data-screen-pattern-option="launch-operations-screen"]'),
    ).toBeNull();
  });

  it("renders active screen examples through the active component registry", () => {
    const activeDesign = activeCustomScreenDesign();
    const host = render(
      <ScreenGallery
        patterns={screenPatterns({
          catalog: activeDesign.bootstrap.catalog,
          examples: activeDesign.examples,
        })}
        rendererBootstrap={activeDesign.bootstrap}
        suppressPreviewModals
      />,
    );
    const promo = host.querySelector('[data-screen-pattern-option="promo-screen"]');
    if (!(promo instanceof HTMLButtonElement)) {
      throw new Error("Missing promo screen pattern option");
    }

    act(() => {
      promo.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(host.querySelector("[data-active-promo-banner]")?.textContent).toContain(
      "Private beta is open",
    );
    expect(
      host
        .querySelector('[data-facet-component-preview="Screen"]')
        ?.getAttribute("data-facet-component-preview-state"),
    ).toBe("ready");
  }, 20_000);
});
