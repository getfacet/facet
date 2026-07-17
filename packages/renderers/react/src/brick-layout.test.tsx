// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DataWarehouse, FacetNode, FacetTree, NodeId } from "@facet/core";
import { foldPatchIntoStage } from "@facet/core";
import { StageRenderer } from "./StageRenderer.js";
import { tableHeaderTargetStyle, tableRowTargetStyle } from "./brick-style-layout.js";
import { INTERACTION_CSS } from "./interaction-style.js";
import { resolveTheme } from "./theme.js";

const SAFE_MEDIA_SRC = "https://cdn.example.com/layout.jpg";

function tree(nodes: Record<NodeId, FacetNode>, root: NodeId = "root"): FacetTree {
  return { root, nodes };
}

function render(tree: FacetTree): string {
  return renderToStaticMarkup(createElement(StageRenderer, { tree }));
}

const box = (id: NodeId, children: readonly NodeId[], maxWidth?: "narrow"): FacetNode => ({
  id,
  type: "box",
  children,
  ...(maxWidth === undefined ? {} : { style: { maxWidth } }),
});
const text = (id: NodeId, value: string): FacetNode => ({ id, type: "text", value });
const stale = (id: NodeId, type: string, children: readonly NodeId[] = []): FacetNode =>
  ({ id, type, children }) as unknown as FacetNode;

const RETIRED_RENDERERS = {
  layout: ["renderButton", "renderTabs", "renderNav"],
  inputs: ["renderForm", "renderFilterBar"],
  data: ["renderMetric", "renderStat"],
} as const;
const RETIRED_TYPES = ["button", "tabs", "nav", "form", "filterBar", "metric", "stat"] as const;

describe("StageRenderer brick layout contract", () => {
  it("gives a table row hover border a solid style when the base is borderless", () => {
    const target = tableRowTargetStyle({ hover: { borderWidth: "medium" } }, resolveTheme(), false);

    expect(target.style.borderStyle).toBeUndefined();
    expect(target.style["--facet-hover-borderWidth" as keyof typeof target.style]).toBe("2px");
    expect(target.className).toContain("facet-hover-borderWidth");
    expect(INTERACTION_CSS).toContain(
      ".facet-interaction.facet-hover-borderWidth:hover{border-width:var(--facet-hover-borderWidth)!important;border-style:solid!important}",
    );
  });

  it("maps only the closed layout style vocabulary", () => {
    const out = render(
      tree({
        root: {
          id: "root",
          type: "box",
          style: {
            direction: "row",
            gap: "lg",
            padding: "md",
            alignItems: "end",
            justifyContent: "between",
            wrap: true,
            grow: true,
            width: "full",
            minHeight: "half",
            maxWidth: "wide",
            scroll: "horizontal",
            sticky: true,
            background: "successSurface",
            color: "successForeground",
            backgroundGradient: "success",
            borderColor: "success",
            borderWidth: "thick",
            borderRadius: "lg",
            shadow: "md",
            hover: { background: "accentSurface", shadow: "lg" },
            pressed: { color: "accent" },
            focus: { borderColor: "focusRing", borderWidth: "medium" },
            cssText: "position:fixed",
            inset: "0",
          },
          children: ["copy", "media", "table"],
        } as unknown as FacetNode,
        copy: {
          id: "copy",
          type: "text",
          value: "Closed typography",
          style: {
            fontFamily: "serif",
            fontSize: "2xl",
            fontWeight: "bold",
            fontStyle: "italic",
            color: "info",
            textAlign: "end",
            letterSpacing: "wide",
            lineHeight: "relaxed",
            highlight: "warning",
          },
        },
        media: {
          id: "media",
          type: "media",
          kind: "image",
          src: SAFE_MEDIA_SRC,
          alt: "Closed media",
          style: {
            width: "auto",
            aspectRatio: "square",
            objectFit: "contain",
            objectPosition: "top",
            borderRadius: "full",
          },
        },
        table: {
          id: "table",
          type: "table",
          caption: "Styled table",
          columns: [{ key: "name", label: "Name", sortable: true }],
          rows: [{ name: "Facet" }, { name: "Theme" }],
          style: {
            width: "full",
            background: "surface",
            color: "foreground",
            borderColor: "danger",
            borderWidth: "medium",
            borderRadius: "md",
            shadow: "sm",
            caption: {
              fontFamily: "mono",
              fontSize: "lg",
              fontWeight: "bold",
              fontStyle: "italic",
              color: "warning",
              textAlign: "center",
              letterSpacing: "wide",
              lineHeight: "tight",
              padding: "md",
              background: "warningSurface",
            },
            header: {
              fontFamily: "sans",
              fontSize: "sm",
              fontWeight: "semibold",
              color: "info",
              padding: "sm",
              background: "infoSurface",
              borderColor: "info",
              borderWidth: "thin",
              hover: { background: "accentSurface", color: "accent", borderColor: "accent" },
              pressed: { background: "dangerSurface" },
              focus: { borderColor: "focusRing", borderWidth: "medium" },
              sorted: { background: "successSurface", color: "success", fontWeight: "bold" },
            },
            row: {
              background: "surface",
              color: "foreground",
              borderColor: "border",
              borderWidth: "thin",
              alternate: { background: "mutedSurface", color: "mutedForeground" },
              hover: { background: "accentSurface", borderColor: "accent" },
            },
            cell: {
              fontFamily: "serif",
              fontSize: "md",
              fontWeight: "medium",
              color: "foreground",
              textAlign: "end",
              letterSpacing: "normal",
              lineHeight: "normal",
              padding: "lg",
              borderColor: "border",
              borderWidth: "thin",
            },
          },
        },
      }),
    );

    expect(out).toContain("display:flex");
    expect(out).toContain("flex-direction:row");
    expect(out).toContain("gap:24px");
    expect(out).toContain("padding:16px");
    expect(out).toContain("align-items:flex-end");
    expect(out).toContain("justify-content:space-between");
    expect(out).toContain("flex-wrap:wrap");
    expect(out).toContain("min-height:50svh");
    expect(out).toContain("max-width:1200px");
    expect(out).toContain("overflow-x:auto");
    expect(out).toContain("position:sticky");
    expect(out).toContain("background-image:linear-gradient(135deg, #15803d 0%, #16a34a 100%)");
    expect(out).toContain("--facet-hover-background:#eef2ff");
    expect(out).toContain("--facet-focus-borderWidth:2px");

    expect(out).toContain("font-family:Georgia, &quot;Times New Roman&quot;, serif");
    expect(out).toContain("font-size:36px");
    expect(out).toContain("font-style:italic");
    expect(out).toContain("text-align:right");
    expect(out).toContain("letter-spacing:0.04em");
    expect(out).toContain("line-height:1.75");
    expect(out).toContain("background-image:linear-gradient(0deg, #fde68a 0%, #fde68a 100%)");

    expect(out).toContain(`src="${SAFE_MEDIA_SRC}"`);
    expect(out).toContain("aspect-ratio:1 / 1");
    expect(out).toContain("object-fit:contain");
    expect(out).toContain("object-position:top");
    expect(out).toContain("border-radius:9999px");

    expect(out).toContain("Styled table");
    expect(out).toContain("border-collapse:collapse");
    expect(out).toContain("background:#fef3c7");
    expect(out).toContain("font-family:ui-monospace, SFMono-Regular, Menlo, monospace");
    expect(out).toContain("--facet-hover-borderColor:#4f46e5");
    expect(out).toContain("background:#eef2f7");
    expect(out).toContain("Facet");
    expect(out).not.toMatch(/position:(?:absolute|fixed)/);
    expect(out).not.toContain("cssText");

    const sorted = tableHeaderTargetStyle(
      {
        background: "surface",
        color: "foreground",
        fontWeight: "regular",
        sorted: { background: "successSurface", color: "success", fontWeight: "bold" },
      },
      resolveTheme(),
      true,
    );
    expect(sorted.style).toMatchObject({
      background: "#dcfce7",
      color: "#15803d",
      fontWeight: 700,
    });
  });

  it("exports no retired renderer and skips every stale subtree", async () => {
    const [layoutRenderers, inputRenderers, dataRenderers] = await Promise.all([
      import("./brick-renderer-layout.js"),
      import("./brick-renderer-inputs.js"),
      import("./brick-renderer-data.js"),
    ]);

    for (const name of RETIRED_RENDERERS.layout) expect(layoutRenderers).not.toHaveProperty(name);
    for (const name of RETIRED_RENDERERS.inputs) expect(inputRenderers).not.toHaveProperty(name);
    for (const name of RETIRED_RENDERERS.data) expect(dataRenderers).not.toHaveProperty(name);

    for (const type of RETIRED_TYPES) {
      const staleRoot = render(
        tree(
          {
            stale: stale("stale", type, ["secret"]),
            secret: text("secret", `secret root ${type}`),
          },
          "stale",
        ),
      );
      expect(staleRoot).not.toContain(`secret root ${type}`);

      const staleChild = render(
        tree({
          root: box("root", ["before", "stale", "after"]),
          before: text("before", "before safe"),
          stale: stale("stale", type, ["secret"]),
          secret: text("secret", `secret child ${type}`),
          after: text("after", "after safe"),
        }),
      );
      expect(staleChild).toContain("before safe");
      expect(staleChild).toContain("after safe");
      expect(staleChild).not.toContain(`secret child ${type}`);
    }

    const staleScreen = render({
      root: "fallback",
      screens: { home: "form" },
      entry: "home",
      nodes: {
        fallback: text("fallback", "fallback copy"),
        form: stale("form", "form", ["screenSecret"]),
        screenSecret: text("screenSecret", "secret screen/form descendant"),
      },
    });
    expect(staleScreen).not.toContain("secret screen/form descendant");
  });

  it("renders every survivor with bounded roots and no retired copy", () => {
    const out = render(
      tree({
        root: box("root", ["input", "table", "chart", "details", "progress", "list", "loading"]),
        input: {
          id: "input",
          type: "input",
          name: "email",
          input: "email",
          label: "Email",
          placeholder: "you@example.com",
        },
        table: {
          id: "table",
          type: "table",
          caption: "Accounts",
          columns: [{ key: "name", label: "Name" }],
          rows: [{ name: "Acme" }],
        },
        chart: {
          id: "chart",
          type: "chart",
          title: "Revenue",
          kind: "bar",
          series: [{ label: "ARR", values: [10, 20] }],
        },
        details: {
          id: "details",
          type: "keyValue",
          items: [{ label: "Owner", value: "Design" }],
        },
        progress: { id: "progress", type: "progress", label: "Migration", value: 72 },
        list: {
          id: "list",
          type: "list",
          items: [{ title: "Next", body: "Call customer" }],
        },
        loading: { id: "loading", type: "loading", label: "Loading accounts" },
      }),
    );

    for (const copy of [
      "Email",
      "Accounts",
      "Acme",
      "Revenue",
      "Owner",
      "Design",
      "Migration",
      "Next",
      "Call customer",
      "Loading accounts",
    ]) {
      expect(out).toContain(copy);
    }
    expect(out).toContain('role="progressbar"');
    expect(out).toContain('role="status"');
    expect(out.match(/box-sizing:border-box/g)?.length ?? 0).toBeGreaterThan(8);
    expect(out.match(/min-width:0/g)?.length ?? 0).toBeGreaterThan(8);
    expect(out.match(/max-width:100%/g)?.length ?? 0).toBeGreaterThan(8);
    expect(out.match(/overflow-wrap:anywhere/g)?.length ?? 0).toBeGreaterThan(8);
    expect(out.match(/overflow-x:auto/g)).toHaveLength(1);
    expect(out).not.toContain("Legacy ARR");
  });

  it("keeps long survivor labels inside a narrow normal-flow container", () => {
    const long = `Long-${"label".repeat(30)}`;
    const out = render(
      tree({
        root: box("root", ["input", "table", "details", "progress", "list", "loading"], "narrow"),
        input: { id: "input", type: "input", label: long, name: "query" },
        table: {
          id: "table",
          type: "table",
          columns: [{ key: "value", label: long }],
          rows: [{ value: long }],
        },
        details: { id: "details", type: "keyValue", items: [{ label: long, value: long }] },
        progress: { id: "progress", type: "progress", label: long, value: 50 },
        list: { id: "list", type: "list", items: [{ title: long, body: long }] },
        loading: { id: "loading", type: "loading", label: long },
      }),
    );

    expect(out).toContain("max-width:640px");
    expect(out).toContain(long);
    expect(out.match(/overflow-wrap:anywhere/g)?.length ?? 0).toBeGreaterThan(10);
    expect(out).not.toContain("position:absolute");
  });

  it("keeps hostile raw survivor data fail-safe and non-injecting", () => {
    const hostile = tree({
      root: box("root", ["input", "table", "details", "progress", "list", "loading", "safe"]),
      input: { id: "input", type: "input", label: { nope: true } } as unknown as FacetNode,
      table: { id: "table", type: "table", columns: "bad", rows: "bad" } as unknown as FacetNode,
      details: {
        id: "details",
        type: "keyValue",
        items: [
          { label: "Owner", value: { nope: true } },
          { label: "Plan", value: "Team" },
        ],
      } as unknown as FacetNode,
      progress: {
        id: "progress",
        type: "progress",
        label: { nope: true },
        value: Infinity,
      } as unknown as FacetNode,
      list: {
        id: "list",
        type: "list",
        items: [{ title: { nope: true } }, "Safe item"],
      } as unknown as FacetNode,
      loading: { id: "loading", type: "loading", label: { nope: true } } as unknown as FacetNode,
      safe: text("safe", "safe child"),
    });

    expect(() => render(hostile)).not.toThrow();
    const out = render(hostile);
    expect(out).toContain("safe child");
    expect(out).toContain("Team");
    expect(out).toContain("Safe item");
    expect(out).not.toContain("[object Object]");
    expect(out).not.toContain("<script");
  });
});

describe("StageRenderer table data bindings", () => {
  const SALES: DataWarehouse = {
    sales: [
      { region: "West", revenue: 50 },
      { region: "East", revenue: 100 },
    ],
  };

  it("renders a from:'sales' table's dataset rows via its own columns[].key", () => {
    const app: FacetTree = {
      root: "root",
      nodes: {
        root: box("root", ["table"]),
        table: {
          id: "table",
          type: "table",
          columns: [
            { key: "region", label: "Region" },
            { key: "revenue", label: "Revenue" },
          ],
          rows: [],
          from: "sales",
        },
      },
      data: SALES,
    };

    const out = render(app);
    expect(out).toContain(">West<");
    expect(out).toContain(">East<");
    expect(out).toContain(">50<");
    expect(out).toContain(">100<");
  });

  it("reflects one /data patch in both a from-bound table and chart", () => {
    const base: FacetTree = {
      root: "root",
      nodes: {
        root: box("root", ["table", "chart"]),
        table: {
          id: "table",
          type: "table",
          columns: [
            { key: "region", label: "Region" },
            { key: "revenue", label: "Revenue" },
          ],
          rows: [],
          from: "sales",
        },
        chart: { id: "chart", type: "chart", kind: "bar", series: [], from: "sales" },
      },
      data: SALES,
    };

    const before = render(base);
    expect(before).toContain(">100<");
    expect(before).toContain('height="50"');

    const { tree: updated } = foldPatchIntoStage(base, [
      { op: "replace", path: "/data/sales/1/revenue", value: 200 },
    ]);

    const after = render(updated);
    expect(after).toContain(">200<");
    expect(after).not.toContain(">100<");
    expect(after).toContain('height="25"');
    expect(after).not.toContain('height="50"');
  });
});
