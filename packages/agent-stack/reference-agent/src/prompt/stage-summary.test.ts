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
        "01-text": { id: "01-text", type: "text", value: "hello" },
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
          variant: "compact",
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
          variant: "compact",
        },
        "07-list": {
          id: "07-list",
          type: "list",
          items: [{ title: "One" }, { title: "Two" }],
          variant: "compact",
        },
        "08-keyValue": {
          id: "08-keyValue",
          type: "keyValue",
          items: [{ label: "Owner", value: "Ada" }],
          variant: "compact",
        },
        "09-progress": {
          id: "09-progress",
          type: "progress",
          value: 72,
          label: "Migration",
          tone: "success",
          variant: "compact",
        },
        "10-loading": {
          id: "10-loading",
          type: "loading",
          label: "Loading rows",
          variant: "compact",
        },
      },
    };

    const summary = summarizeStageForPrompt(stage);
    expect(summary).toContain("- 00-box: type=box children=10");
    expect(summary).toContain("- 01-text: type=text chars=5");
    expect(summary).toContain("- 02-media: type=media kind=image srcChars=19 altChars=7");
    expect(summary).toContain("- 03-input: type=input name=status input=select options=2");
    expect(summary).toContain(
      "- 04-richtext: type=richtext blocks=2 runs=3 text=Welcome aboardMore",
    );
    expect(summary).toContain(
      "- 05-table: type=table columns=1 rows=2 captionChars=8 variant=compact",
    );
    expect(summary).toContain(
      "- 06-chart: type=chart kind=bar series=2 points=3 labels=2 titleChars=5 variant=compact",
    );
    expect(summary).toContain("- 07-list: type=list items=2 variant=compact");
    expect(summary).toContain("- 08-keyValue: type=keyValue items=1 variant=compact");
    expect(summary).toContain(
      "- 09-progress: type=progress value=72 labelChars=9 tone=success variant=compact",
    );
    expect(summary).toContain("- 10-loading: type=loading labelChars=12 variant=compact");
    expect(summary).not.toContain("type=unknown");
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
