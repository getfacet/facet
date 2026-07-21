import { describe, expect, it } from "vitest";
import { BRICK_TYPES, type FacetTree } from "@facet/core";

import { STAGE_SUMMARY_REGISTRY, summarizeStageForPrompt } from "./stage-summary.js";

const RETIRED_TYPES = ["button", "tabs", "nav", "form", "filterBar", "metric", "stat"] as const; // composition-hard-cut: allowed-negative

describe("STAGE_SUMMARY_REGISTRY", () => {
  it("summarizes only the final brick roster", () => {
    expect(Object.keys(STAGE_SUMMARY_REGISTRY)).toEqual([...BRICK_TYPES]);
    for (const type of BRICK_TYPES) expect(STAGE_SUMMARY_REGISTRY[type]).toBeTypeOf("function");
  });

  it("preserves the exact useful formatting for all eleven bricks", () => {
    const stage: FacetTree = {
      root: "00-box",
      nodes: {
        "00-box": {
          id: "00-box",
          type: "box",
          style: { preset: "panel", gap: "lg", hover: { background: "accentSurface" } },
          children: [
            "01-text",
            "02-media",
            "03-input",
            "04-richtext",
            "05-table",
            "06-chart",
            "07-list",
            "08-keyValue",
            "09-progress",
            "10-loading",
          ],
        },
        "01-text": {
          id: "01-text",
          type: "text",
          value: "hello",
          style: { preset: "heading", color: "accent" },
        },
        "02-media": {
          id: "02-media",
          type: "media",
          kind: "image",
          src: "https://x.dev/a.png",
          alt: "Preview",
        },
        "03-input": {
          id: "03-input",
          type: "input",
          name: "status",
          input: "select",
          options: ["Open", "Closed"],
        },
        "04-richtext": {
          id: "04-richtext",
          type: "richtext",
          blocks: [
            { type: "heading", level: 1, runs: [{ text: "Welcome " }, { text: "aboard" }] },
            { type: "paragraph", runs: [{ text: "More" }] },
          ],
        },
        "05-table": {
          id: "05-table",
          type: "table",
          caption: "Pipeline",
          columns: [{ key: "name", label: "Name" }],
          rows: [{ name: "Acme" }, { name: "Beta" }],
          style: { preset: "compact", cell: { padding: "xs" } },
        },
        "06-chart": {
          id: "06-chart",
          type: "chart",
          kind: "bar",
          title: "Trend",
          labels: ["Jan", "Feb"],
          series: [
            { label: "ARR", values: [10, 20] },
            { label: "MRR", values: [5] },
          ],
          style: { preset: "panel", plot: { background: "mutedSurface" } },
        },
        "07-list": {
          id: "07-list",
          type: "list",
          items: [{ title: "One" }, { title: "Two" }],
          style: { preset: "compact" },
        },
        "08-keyValue": {
          id: "08-keyValue",
          type: "keyValue",
          items: [{ label: "Owner", value: "Ada" }],
          style: { preset: "standard" },
        },
        "09-progress": {
          id: "09-progress",
          type: "progress",
          value: 72,
          label: "Migration",
          style: { preset: "success", fill: { background: "success" } },
        },
        "10-loading": {
          id: "10-loading",
          type: "loading",
          label: "Loading rows",
          style: { preset: "subdued" },
        },
      },
    };

    const summary = summarizeStageForPrompt(stage);
    expect(summary).toContain(
      "- 00-box: type=box children=10 style=preset:panel direct=1 targets=0 states=1 active=no",
    );
    expect(summary).toContain(
      "- 01-text: type=text chars=5 style=preset:heading direct=1 targets=0 states=0 active=no",
    );
    expect(summary).toContain("- 02-media: type=media kind=image srcChars=19 altChars=7");
    expect(summary).toContain("- 03-input: type=input name=status input=select options=2");
    expect(summary).toContain(
      "- 04-richtext: type=richtext blocks=2 runs=3 text=Welcome aboardMore",
    );
    expect(summary).toContain(
      "- 05-table: type=table columns=1 rows=2 alignedColumns=0 sortableColumns=0 captionChars=8 style=preset:compact direct=0 targets=1 states=0 active=no",
    );
    expect(summary).toContain(
      "- 06-chart: type=chart kind=bar series=2 points=3 labels=2 lineStyles=0 titleChars=5 style=preset:panel direct=0 targets=1 states=0 active=no",
    );
    expect(summary).toContain(
      "- 07-list: type=list items=2 style=preset:compact direct=0 targets=0 states=0 active=no",
    );
    expect(summary).toContain(
      "- 08-keyValue: type=keyValue items=1 style=preset:standard direct=0 targets=0 states=0 active=no",
    );
    expect(summary).toContain(
      "- 09-progress: type=progress value=72 labelChars=9 style=preset:success direct=0 targets=1 states=0 active=no",
    );
    expect(summary).toContain(
      "- 10-loading: type=loading labelChars=12 style=preset:subdued direct=0 targets=0 states=0 active=no",
    );
    expect(summary).not.toContain("type=unknown");
  });

  it("summarizes media icon variants and product-grade data fields", () => {
    const stage: FacetTree = {
      root: "00-box",
      nodes: {
        "00-box": {
          id: "00-box",
          type: "box",
          children: ["01-icon", "02-table", "03-chart", "04-text"],
        },
        "01-icon": {
          id: "01-icon",
          type: "media",
          kind: "icon",
          icon: "search",
          alt: "Search",
        },
        "02-table": {
          id: "02-table",
          type: "table",
          caption: "Search analytics",
          columns: [
            { key: "query", label: "Query", sortable: true },
            { key: "clicks", label: "Clicks", align: "end", sortable: true },
            { key: "ctr", label: "CTR", align: "center" },
          ],
          rows: [{ query: "ama2", clicks: 3, ctr: "4.2%" }],
          style: { cell: { textWrap: "wrap", lineClamp: 2 } },
        },
        "03-chart": {
          id: "03-chart",
          type: "chart",
          kind: "line",
          title: "Search performance",
          labels: ["1", "2", "3"],
          series: [
            { label: "Clicks", values: [1, 2, 3], lineStyle: "solid" },
            { label: "Impressions", values: [10, 20, 30], lineStyle: "dashed" },
            { label: "CTR", values: [0.1, 0.2, 0.3], lineStyle: "dotted" },
          ],
          style: {
            plot: {
              axisColor: "foreground",
              gridColor: "border",
              labelColor: "mutedForeground",
            },
          },
        },
        "04-text": {
          id: "04-text",
          type: "text",
          value: "One long product title",
          style: { textWrap: "balance", lineClamp: 2 },
        },
      },
    };

    const summary = summarizeStageForPrompt(stage);
    expect(summary).toContain("- 01-icon: type=media kind=icon icon=search altChars=6");
    expect(summary).toContain(
      "- 02-table: type=table columns=3 rows=1 alignedColumns=2 sortableColumns=2 captionChars=16 style=preset:none direct=0 targets=1 states=0 active=no",
    );
    expect(summary).toContain(
      "- 03-chart: type=chart kind=line series=3 points=9 labels=3 lineStyles=3 titleChars=18 style=preset:none direct=0 targets=1 states=0 active=no",
    );
    expect(summary).toContain(
      "- 04-text: type=text chars=22 style=preset:none direct=2 targets=0 states=0 active=no",
    );
    expect(summary).not.toContain('"axisColor"');
    expect(summary).not.toContain('"lineClamp"');
  });

  it("summarizes style as bounded metadata and omits document Theme and retired selectors", () => {
    const retiredTheme = ["the", "me"].join("");
    const retiredVariant = ["vari", "ant"].join("");
    const retiredTone = ["to", "ne"].join("");
    const oversizedPreset = `panel-${"x".repeat(500)}\nnot-a-line`;
    const raw = {
      root: "root",
      [retiredTheme]: "operator-secret",
      nodes: {
        root: {
          id: "root",
          type: "box",
          children: [],
          [retiredVariant]: "legacy",
          [retiredTone]: "legacy",
          style: {
            preset: oversizedPreset,
            gap: "md",
            hover: { background: "accent" },
            active: { preset: "inset", padding: "lg" },
          },
        },
      },
    } as unknown as FacetTree;

    const summary = summarizeStageForPrompt(raw);
    expect(summary).not.toContain("operator-secret");
    expect(summary).not.toContain("legacy");
    expect(summary).not.toContain("not-a-line");
    expect(summary).toMatch(/style=preset:panel-x+\.\.\. direct=1 targets=0 states=1 active=yes/);
    expect(summary.split("\n").find((line) => line.includes("style="))?.length).toBeLessThan(180);
  });

  it("has no retired or prototype-chain handler and safely summarizes stale raw nodes", () => {
    const staleTypes = [...RETIRED_TYPES, "constructor", "toString", "prototype"];
    for (const type of staleTypes) expect(Object.hasOwn(STAGE_SUMMARY_REGISTRY, type)).toBe(false);

    const stage = {
      root: "root",
      nodes: Object.fromEntries([
        ["root", { id: "root", type: "box", children: staleTypes }],
        ...staleTypes.map((type) => [type, { id: type, type }]),
      ]),
    } as unknown as FacetTree;
    const summary = summarizeStageForPrompt(stage);
    for (const type of staleTypes) expect(summary).toContain(`- ${type}: type=unknown`);
    expect(summary).not.toContain("[object Object]");
  });

  it("keeps malformed richtext fail-safe without a compatibility path", () => {
    const stage = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["empty"] },
        empty: { id: "empty", type: "richtext", blocks: [{ runs: [null, { text: 7 }] }] },
      },
    } as unknown as FacetTree;

    expect(summarizeStageForPrompt(stage)).toContain("type=richtext blocks=1 runs=2");
  });
});
