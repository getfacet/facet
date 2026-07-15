import { readFileSync } from "node:fs";
import { BRICK_TYPES } from "@facet/core";
import type { FacetTree } from "@facet/core";
import { describe, expect, it, vi } from "vitest";
import { printTree } from "./print-tree.js";

/** Runs printTree and captures each printed line. */
function lines(tree: FacetTree): readonly string[] {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    printTree(tree);
    return spy.mock.calls.map((call) => String(call[0]));
  } finally {
    spy.mockRestore();
  }
}

const finalRosterTree: FacetTree = {
  root: "root",
  nodes: {
    root: {
      id: "root",
      type: "box",
      children: [
        "text",
        "media",
        "input",
        "richtext",
        "table",
        "chart",
        "list",
        "keyValue",
        "progress",
        "loading",
      ],
    },
    text: { id: "text", type: "text", value: "Overview" },
    media: { id: "media", type: "media", kind: "image", src: "https://example.com/hero.png" },
    input: { id: "input", type: "input", name: "email", placeholder: "you@example.com" },
    richtext: {
      id: "richtext",
      type: "richtext",
      blocks: [{ type: "paragraph", runs: [{ text: "Formatted copy" }] }],
    },
    table: {
      id: "table",
      type: "table",
      caption: "Pipeline",
      columns: [
        { key: "name", label: "Name" },
        { key: "value", label: "Value" },
      ],
      rows: [{ name: "ACME", value: 1200 }],
    },
    chart: {
      id: "chart",
      type: "chart",
      kind: "bar",
      title: "Trend",
      labels: ["Jan", "Feb"],
      series: [{ label: "Revenue", values: [1, 2] }],
    },
    list: { id: "list", type: "list", items: [{ title: "One" }, { title: "Two" }] },
    keyValue: {
      id: "keyValue",
      type: "keyValue",
      items: [
        { label: "Plan", value: "Pro" },
        { label: "Owner", value: "Ada" },
      ],
    },
    progress: { id: "progress", type: "progress", label: "Onboarding", value: 64 },
    loading: { id: "loading", type: "loading", label: "Loading customers" },
  },
};

describe("printTree", () => {
  it("prints exactly the final brick roster", () => {
    const out = lines(finalRosterTree);
    const printedTypes = out.map((line) => /^\s*([A-Za-z]+)/.exec(line)?.[1]);
    const source = readFileSync(new URL("./print-tree.ts", import.meta.url), "utf8");
    const switchTypes = [...source.matchAll(/case "([A-Za-z]+)":/g)].map((match) => match[1]);

    expect(printedTypes).toEqual(BRICK_TYPES);
    expect(switchTypes.sort()).toEqual([...BRICK_TYPES].sort());
    expect(out).toEqual([
      "box",
      '  text: "Overview"',
      "  media(image): https://example.com/hero.png",
      "  input: email",
      "  richtext: 1 block",
      '  table: "Pipeline" (2 columns, 1 row)',
      '  chart(bar): "Trend" (1 series, 2 labels)',
      "  list: 2 items",
      "  keyValue: 2 items",
      "  progress: Onboarding 64%",
      '  loading: "Loading customers"',
    ]);
  });

  it("labels box press, hold, hidden, navigate, toggle, and agent actions", () => {
    const out = lines({
      root: "root",
      nodes: {
        root: {
          id: "root",
          type: "box",
          onPress: { kind: "agent", name: "open" },
          onHold: { kind: "toggle", target: "menu" },
          children: ["navigate", "menu"],
        },
        navigate: {
          id: "navigate",
          type: "box",
          onPress: { kind: "navigate", to: "about" },
          children: [],
        },
        menu: { id: "menu", type: "box", hidden: true, children: [] },
      },
    });

    expect(out).toEqual(["box [→ open] [hold ⇄ menu]", "  box [→ screen:about]", "  box (hidden)"]);
  });

  it("keeps shipping App, generator, and CLI copy brick-and-reference-only", () => {
    const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const generatorSource = readFileSync(new URL("./gen.ts", import.meta.url), "utf8");
    const cliSource = readFileSync(
      new URL("../../../packages/extensions/cli/src/cli.ts", import.meta.url),
      "utf8",
    );
    const shippingCopy = [appSource, generatorSource, cliSource].join("\n");

    expect(appSource).toMatch(/closed brick vocabulary/i);
    expect(appSource).toMatch(/optional reference/i);
    expect(generatorSource).toMatch(/closed brick vocabulary/i);
    expect(generatorSource).toMatch(/optionally informed[^.]*reference/i);
    expect(cliSource).toMatch(/append <boxId>/);
    expect(cliSource).toMatch(/child brick/i);
    expect(shippingCopy).not.toMatch(/component\s*(?:→|->)\s*primitive/i);
    expect(shippingCopy).not.toMatch(/composition reference examples/i);
    expect(shippingCopy).not.toMatch(/a card, a button/i);
    expect(shippingCopy).not.toMatch(
      /type:\s*["'](?:button|form|filterBar|metric|tabs|nav|stat)["']/,
    );
  });
});
