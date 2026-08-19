// @vitest-environment jsdom

import type { ComponentMountProps, MountedComponent } from "@facet/core";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import * as Content from "./content.js";

type Mount = ComponentMountProps<ReactNode>;

const EXPECTED_EXPORTS = [
  "Avatar",
  "Badge",
  "Chart",
  "Icon",
  "Image",
  "List",
  "Metric",
  "MetricGroup",
  "Progress",
  "Table",
  "Text",
  "Timeline",
];

interface MountOverrides {
  readonly props?: Mount["props"];
  readonly children?: ReactNode;
  readonly slots?: Mount["slots"];
}

function mount(overrides: MountOverrides = {}): Mount {
  return {
    props: overrides.props ?? {},
    children: overrides.children ?? null,
    slots: overrides.slots ?? {},
    themeVars: { "--facet-test-token": "active" },
    onAction: (): void => undefined,
  };
}

function renderComponent(
  implementation: MountedComponent<ReactNode, ReactNode>,
  overrides: MountOverrides = {},
): HTMLElement {
  const { container } = render(<>{implementation(mount(overrides))}</>);
  const root = container.firstElementChild;
  if (!(root instanceof HTMLElement)) {
    throw new Error("A content component must render one HTML root.");
  }
  return root;
}

afterEach(cleanup);

describe("trusted content and data React components", () => {
  it("exports exactly the locked content roster", () => {
    expect(Object.keys(Content).sort()).toEqual(EXPECTED_EXPORTS);
  });

  it("gives Text variants their semantic typographic roles", () => {
    expect(
      renderComponent(Content.Text, { props: { value: "Title", variant: "title" } }).tagName,
    ).toBe("H1");
    cleanup();
    expect(
      renderComponent(Content.Text, { props: { value: "Heading", variant: "heading" } }).tagName,
    ).toBe("H2");
    cleanup();
    expect(
      renderComponent(Content.Text, { props: { value: "Body", variant: "body" } }).tagName,
    ).toBe("P");
  });

  it("renders bounded identity initials and a closed native icon set accessibly", () => {
    const avatar = renderComponent(Content.Avatar, { props: { label: "Ada Lovelace" } });
    expect(avatar.getAttribute("role")).toBe("img");
    expect(avatar.getAttribute("aria-label")).toBe("Ada Lovelace");
    expect(avatar.textContent).toBe("AL");
    expect(avatar.style.boxSizing).toBe("border-box");
    cleanup();

    const explicit = renderComponent(Content.Avatar, {
      props: { label: "Operations", initials: "OPSX" },
    });
    expect(explicit.textContent).toBe("OPS");
    cleanup();

    const icon = renderComponent(Content.Icon, {
      props: { name: "check", label: "Complete", size: "lg" },
    });
    expect(icon.querySelector("svg")?.getAttribute("role")).toBe("img");
    expect(icon.querySelector("svg")?.getAttribute("aria-label")).toBe("Complete");
    cleanup();

    const decorative = renderComponent(Content.Icon, { props: { name: "info" } });
    expect(decorative.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    cleanup();

    expect(
      renderComponent(Content.Icon, { props: { name: "unregistered" } }).querySelector("svg"),
    ).toBeNull();
  });

  it("renders Image only from a resolved safe descriptor", () => {
    const descriptor = {
      kind: "image" as const,
      src: "https://cdn.example.test/lamp.png",
      width: 1200,
      height: 800,
    };
    const image = renderComponent(Content.Image, {
      props: { asset: descriptor, alt: "Desk lamp", aspect: "wide", fit: "contain" },
    });
    const element = image.querySelector("img");

    expect(element?.getAttribute("src")).toBe(descriptor.src);
    expect(element?.getAttribute("alt")).toBe("Desk lamp");
    expect(element?.getAttribute("width")).toBe("1200");
    expect(element?.getAttribute("height")).toBe("800");
    expect(image.style.aspectRatio).toBe("16 / 9");
    expect(image.style.boxSizing).toBe("border-box");
    expect(element?.style.objectFit).toBe("contain");
    cleanup();

    expect(
      renderComponent(Content.Image, {
        props: { asset: descriptor.src, alt: "Raw URL" },
      }).querySelector("img"),
    ).toBeNull();
    cleanup();
    expect(
      renderComponent(Content.Image, {
        props: { asset: { kind: "image", src: "javascript:alert(1)" }, alt: "Forged" },
      }).querySelector("img"),
    ).toBeNull();
  });

  it("formats Metric values and renders related metrics in a responsive group", () => {
    const metric = renderComponent(Content.Metric, {
      props: { label: "Revenue", value: 42_000_000, unit: "USD" },
    });
    expect(metric.tagName).toBe("DL");
    expect(metric.querySelector("dt")?.textContent).toBe("Revenue");
    expect(metric.querySelector("dd")?.textContent).toContain("42,000,000");
    cleanup();

    const invalidMetric = renderComponent(Content.Metric, {
      props: { label: "Revenue", value: Number.NaN },
    });
    expect(invalidMetric.textContent).not.toContain("NaN");
    cleanup();

    const badge = renderComponent(Content.Badge, {
      props: { label: "Live", tone: "positive" },
    });
    expect(badge.textContent).toBe("Live");
    expect(badge.style.boxSizing).toBe("border-box");
    cleanup();

    const group = renderComponent(Content.MetricGroup, {
      props: { title: "Highlights", columns: 3 },
      children: <span data-testid="metric">Metric</span>,
      slots: { ignored: <span data-testid="slot">Ignored</span> },
    });
    expect(group.querySelector("h2")?.textContent).toBe("Highlights");
    expect(group.querySelector('[data-testid="metric"]')).not.toBeNull();
    expect(group.querySelector('[data-testid="slot"]')).toBeNull();
    expect(group.querySelector('[data-facet-content="metrics"]')?.getAttribute("style")).toContain(
      "auto-fit",
    );
  });

  it("keeps Table semantic, keyboard-scrollable, and safe over malformed rows", () => {
    const hostile = {
      region: "east",
      get revenue(): number {
        throw new Error("hostile getter");
      },
    };
    const root = renderComponent(Content.Table, {
      props: {
        caption: "Revenue by region",
        rows: [
          { region: "north", revenue: 120 },
          hostile,
          "not-a-record",
          { region: { nested: true }, revenue: [1, 2] },
        ],
      },
    });

    expect(root.getAttribute("role")).toBe("region");
    expect(root.getAttribute("tabindex")).toBe("0");
    expect(root.style.overflowX).toBe("auto");
    expect(root.style.maxWidth).toBe("100%");
    expect(root.style.boxSizing).toBe("border-box");
    expect(root.querySelector("caption")?.textContent).toBe("Revenue by region");
    expect([...root.querySelectorAll("th")].map((cell) => cell.textContent)).toEqual([
      "region",
      "revenue",
    ]);
    expect(root.querySelectorAll("tbody tr")).toHaveLength(4);
    expect(root.textContent).not.toContain("object Object");
  });

  it("skips an unreadable first table row when deriving columns", () => {
    const unreadable = new Proxy(
      {},
      {
        ownKeys(): never {
          throw new Error("row trap");
        },
      },
    );
    const root = renderComponent(Content.Table, {
      props: { rows: [unreadable, { region: "north", revenue: 120 }] },
    });

    expect([...root.querySelectorAll("th")].map((cell) => cell.textContent)).toEqual([
      "region",
      "revenue",
    ]);
  });

  it("renders bounded native bar, line, and area charts from usable records", () => {
    const data = Array.from({ length: 140 }, (_, index) => ({
      month: `M${index + 1}`,
      revenue: index - 20,
    }));
    data.splice(3, 0, { month: "invalid", revenue: Number.NaN });

    for (const type of ["bar", "line", "area"] as const) {
      const root = renderComponent(Content.Chart, {
        props: { data, xKey: "month", yKey: "revenue", type, title: "Revenue trend" },
      });
      const svg = root.querySelector("svg");

      expect(svg?.getAttribute("viewBox")).toBe("0 0 640 320");
      expect(svg?.getAttribute("role")).toBe("img");
      expect(svg?.getAttribute("aria-label")).toBe("Revenue trend");
      expect(root.style.maxWidth).toBe("100%");
      expect(root.style.boxSizing).toBe("border-box");
      expect(root.querySelectorAll(`[data-facet-mark="${type}"]`).length).toBeGreaterThan(0);
      expect(root.querySelectorAll("[data-facet-point]")).toHaveLength(100);
      if (type === "area") {
        const path = root.querySelector('[data-facet-mark="area"]')?.getAttribute("d") ?? "";
        expect(path.match(/M/gu)).toHaveLength(1);
      }
      cleanup();
    }
  });

  it("ignores unusable chart rows without exposing non-finite geometry", () => {
    const root = renderComponent(Content.Chart, {
      props: {
        data: [null, "bad", { x: "A", y: Number.NaN }, { x: { nested: true }, y: 4 }],
        xKey: "x",
        yKey: "y",
        title: "Empty chart",
      },
    });

    expect(root.querySelectorAll("[data-facet-point]")).toHaveLength(0);
    expect(root.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it("keeps extreme finite chart values inside finite SVG geometry", () => {
    const root = renderComponent(Content.Chart, {
      props: {
        data: [
          { x: "low", y: -Number.MAX_VALUE },
          { x: "high", y: Number.MAX_VALUE },
        ],
        xKey: "x",
        yKey: "y",
      },
    });

    expect(root.querySelectorAll("[data-facet-point]")).toHaveLength(2);
    expect(root.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it("uses native progress semantics and clamps completion", () => {
    const root = renderComponent(Content.Progress, {
      props: { label: "Import", value: 140, tone: "success" },
    });
    const progress = root.querySelector("progress");

    expect(progress?.getAttribute("aria-label")).toBe("Import");
    expect(progress?.value).toBe(100);
    expect(progress?.max).toBe(100);
    expect(root.textContent).toContain("100%");
  });

  it("renders Timeline and List children as semantic sequences", () => {
    const timeline = renderComponent(Content.Timeline, {
      props: { title: "Milestones" },
      children: [<span key="one">Started</span>, <span key="two">Shipped</span>],
    });
    expect(timeline.querySelector("h2")?.textContent).toBe("Milestones");
    expect(timeline.querySelectorAll("ol > li")).toHaveLength(2);
    expect(timeline.textContent).toContain("Started");
    cleanup();

    const numbered = renderComponent(Content.List, {
      props: { title: "Steps", marker: "number", density: "compact" },
      children: [<span key="one">Prepare</span>, <span key="two">Ship</span>],
    });
    expect(numbered.querySelector("ol")).not.toBeNull();
    expect(numbered.querySelectorAll("ol > li")).toHaveLength(2);
    expect(numbered.querySelector('[aria-hidden="true"]')?.textContent).toBe("1.");
    cleanup();

    const bullets = renderComponent(Content.List, {
      props: { marker: "bullet" },
      children: <span>One item</span>,
    });
    expect(bullets.querySelector("ul")).not.toBeNull();
  });
});
