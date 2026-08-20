import { readFileSync } from "node:fs";

import { BOUNDS, validateCatalog, validateModalConformance } from "@facet/core";
import type { ComponentSpec } from "@facet/core";
import { describe, expect, it } from "vitest";

import { DEFAULT_CATALOG, DEFAULT_COMPONENT_SPECS } from "./catalog.js";
import * as barrel from "./index.js";

const DEFAULT_TAGS: readonly string[] = [
  "Screen",
  "Stack",
  "Row",
  "Grid",
  "Split",
  "AppShell",
  "Section",
  "Card",
  "Modal",
  "Divider",
  "Navigation",
  "NavigationItem",
  "Button",
  "ActionGroup",
  "ActionBar",
  "Text",
  "Avatar",
  "Icon",
  "Image",
  "Badge",
  "Metric",
  "MetricGroup",
  "Table",
  "Chart",
  "Progress",
  "Timeline",
  "List",
  "Header",
  "Collection",
  "ItemCard",
  "Detail",
  "PropertyList",
  "Property",
  "Board",
  "BoardColumn",
  "Calendar",
  "Result",
  "Empty",
  "Alert",
  "Form",
  "Field",
  "Select",
  "ChoiceGroup",
  "Toggle",
  "MessageThread",
  "Accordion",
  "AccordionItem",
];

const CONTENT_CLASSES: Readonly<Record<string, readonly string[]>> = {
  Leaf: [
    "Divider",
    "NavigationItem",
    "Button",
    "Text",
    "Avatar",
    "Icon",
    "Image",
    "Badge",
    "Metric",
    "Table",
    "Chart",
    "Progress",
    "Property",
    "Calendar",
    "Field",
    "Select",
    "ChoiceGroup",
    "Toggle",
    "MessageThread",
  ],
  Container: [
    "Screen",
    "Stack",
    "Row",
    "Grid",
    "Section",
    "Card",
    "ActionGroup",
    "MetricGroup",
    "Timeline",
    "List",
    "BoardColumn",
  ],
  Structured: [
    "Split",
    "AppShell",
    "Modal",
    "Navigation",
    "ActionBar",
    "Header",
    "Collection",
    "ItemCard",
    "Detail",
    "PropertyList",
    "Board",
    "Result",
    "Empty",
    "Alert",
    "Form",
    "Accordion",
    "AccordionItem",
  ],
};

const retiredTag = (...parts: readonly string[]): string => parts.join("");
const RETIRED_TAGS: readonly string[] = [
  retiredTag("N", "av"),
  retiredTag("Side", "N", "av"),
  retiredTag("Side", "N", "av", "Item"),
  retiredTag("He", "ro"),
  retiredTag("Profile", "Header"),
  retiredTag("Product", "Showcase"),
  retiredTag("Media", "Card"),
  retiredTag("Link", "List"),
  retiredTag("Social", "Links"),
  retiredTag("Feature", "List"),
  retiredTag("Gall", "ery"),
  retiredTag("Stat", "Strip"),
  retiredTag("C", "TA"),
  retiredTag("Foot", "er"),
  retiredTag("Logo", "Mark"),
  retiredTag("Visual", "Panel"),
  retiredTag("Testi", "monial"),
];
const RETIRED_SPEC_FIELDS = [
  retiredTag("accepts", "Children"),
  retiredTag("authoring", "Role"),
] as const;

const BARREL_KEYS: readonly string[] = [
  "DEFAULT_CATALOG",
  "DEFAULT_COMPONENT_SPECS",
  "DEFAULT_THEME",
];

function catalogRecord(components: readonly ComponentSpec[]): Record<string, unknown> {
  return JSON.parse(JSON.stringify({ components })) as Record<string, unknown>;
}

function rejection(value: unknown): readonly [string, string] {
  const result = validateCatalog(value);
  return result.ok ? ["accepted", ""] : [result.code, result.at];
}

function deriveClass(spec: ComponentSpec): "Leaf" | "Container" | "Structured" {
  if (spec.content.mode === "none") {
    return "Leaf";
  }
  return spec.content.mode === "children" ? "Container" : "Structured";
}

function readSource(file: string): string {
  return readFileSync(new URL(file, import.meta.url), "utf8");
}

function readCode(file: string): string {
  return readSource(file)
    .replaceAll(/\/\*[\s\S]*?\*\//gu, "")
    .replaceAll(/\/\/[^\n]*/gu, "");
}

describe("DEFAULT_CATALOG", () => {
  it("assembles exactly the literal 47-tag roster in registration order", () => {
    expect(DEFAULT_COMPONENT_SPECS.map((spec) => spec.tag)).toEqual(DEFAULT_TAGS);
    expect(DEFAULT_COMPONENT_SPECS).toHaveLength(47);
    expect(new Set(DEFAULT_COMPONENT_SPECS.map((spec) => spec.tag)).size).toBe(47);
    expect(DEFAULT_CATALOG.components).toBe(DEFAULT_COMPONENT_SPECS);
  });

  it("pins the derived 19 Leaf, 11 Container, and 17 Structured classes", () => {
    const actual = Object.fromEntries(
      ["Leaf", "Container", "Structured"].map((contentClass) => [
        contentClass,
        DEFAULT_COMPONENT_SPECS.filter((spec) => deriveClass(spec) === contentClass).map(
          (spec) => spec.tag,
        ),
      ]),
    );
    expect(actual).toEqual(CONTENT_CLASSES);
    expect(Object.values(actual).map((tags) => tags.length)).toEqual([19, 11, 17]);
  });

  it("gives every component a two-part discovery boundary", () => {
    for (const spec of DEFAULT_COMPONENT_SPECS) {
      expect(spec.whenToUse).toMatch(
        new RegExp(`^Use ${spec.tag} .+\\. (?:Prefer|Avoid|Do not) .+\\.$`, "u"),
      );
    }
  });

  it("passes the Core catalog trust boundary with the same exact roster", () => {
    const result = validateCatalog(DEFAULT_CATALOG);
    expect(result.ok ? "accepted" : `${result.code} at ${result.at}`).toBe("accepted");
    expect(result.ok ? result.catalog.components.map((spec) => spec.tag) : []).toEqual(
      DEFAULT_TAGS,
    );
  });

  it("contains no retired tag or retired component-spec field", () => {
    const tags = new Set(DEFAULT_COMPONENT_SPECS.map((spec) => spec.tag));
    expect(RETIRED_TAGS.filter((tag) => tags.has(tag))).toEqual([]);
    for (const spec of DEFAULT_COMPONENT_SPECS as readonly unknown[]) {
      for (const field of RETIRED_SPEC_FIELDS) expect(spec).not.toHaveProperty(field);
    }
  });

  it("registers Facet nowhere and Screen exactly once", () => {
    expect(DEFAULT_COMPONENT_SPECS.filter((spec) => spec.tag === "Facet")).toEqual([]);
    expect(DEFAULT_COMPONENT_SPECS.filter((spec) => spec.tag === "Screen")).toHaveLength(1);
  });

  it("keeps Modal conformant with the renderer-owned frame", () => {
    const modal = DEFAULT_COMPONENT_SPECS.find((spec) => spec.tag === "Modal");
    const result = validateModalConformance(JSON.parse(JSON.stringify(modal)));
    expect(result.ok ? "conforms" : `${result.code} at ${result.at}`).toBe("conforms");
  });
});

describe("DEFAULT_CATALOG validation", () => {
  it("rejects the exact roster with Screen removed", () => {
    const without = DEFAULT_COMPONENT_SPECS.filter((spec) => spec.tag !== "Screen");
    expect(without).toHaveLength(46);
    expect(rejection(catalogRecord(without))).toEqual(["missing_screen_spec", "components"]);
  });

  it("rejects a duplicate Screen at the appended member", () => {
    const screen = DEFAULT_COMPONENT_SPECS.find((spec) => spec.tag === "Screen");
    if (screen === undefined) {
      throw new Error("The literal default roster must include Screen.");
    }
    expect(rejection(catalogRecord([...DEFAULT_COMPONENT_SPECS, screen]))).toEqual([
      "duplicate_tag",
      "components[47].tag",
    ]);
  });

  it("keeps every catalog metadata bound", () => {
    expect(DEFAULT_COMPONENT_SPECS.length).toBeLessThanOrEqual(BOUNDS.componentsPerCatalog);
    for (const spec of DEFAULT_COMPONENT_SPECS) {
      expect(Object.keys(spec.props).length).toBeLessThanOrEqual(BOUNDS.propsPerComponentSpec);
      expect(spec.whenToUse.length).toBeGreaterThan(0);
      expect(spec.whenToUse.length).toBeLessThanOrEqual(BOUNDS.componentWhenToUseChars);
      for (const schema of Object.values(spec.props)) {
        expect(schema.guidance.length).toBeGreaterThan(0);
        expect(schema.guidance.length).toBeLessThanOrEqual(BOUNDS.propGuidanceChars);
        const domain = "enum" in schema ? schema.enum : undefined;
        expect(domain?.length ?? 0).toBeLessThanOrEqual(BOUNDS.enumValuesPerProp);
      }
    }
  });
});

describe("catalog assembly", () => {
  it("is plain frozen JSON data", () => {
    expect(JSON.parse(JSON.stringify(DEFAULT_CATALOG))).toEqual(DEFAULT_CATALOG);
    expect(Object.isFrozen(DEFAULT_CATALOG)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CATALOG.components)).toBe(true);
    expect(Object.isFrozen(DEFAULT_COMPONENT_SPECS)).toBe(true);
  });

  it("duplicates no production roster and only concatenates the five private groups", () => {
    const code = readCode("./catalog.ts");
    expect(code.match(/\.\.\.[A-Z]+_SPECS/gu)).toEqual([
      "...LAYOUT_SPECS",
      "...SURFACE_SPECS",
      "...CONTENT_SPECS",
      "...EXPRESSION_SPECS",
      "...INTERACTIVE_SPECS",
    ]);
    expect(code).not.toMatch(/tag\s*:/u);
  });

  it("imports only Core and the five private spec groups", () => {
    const imports = [...readCode("./catalog.ts").matchAll(/from\s+"([^"]+)"/gu)].map(
      (match) => match[1],
    );
    expect([...new Set(imports)].sort()).toEqual([
      "./specs-content.js",
      "./specs-expression.js",
      "./specs-interactive.js",
      "./specs-layout.js",
      "./specs-surface.js",
      "@facet/core",
    ]);
    expect(readSource("./catalog.ts").indexOf("\0")).toBe(-1);
  });
});

describe("@facet/assets root barrel", () => {
  it("exports exactly the three approved symbols", () => {
    expect(Object.keys(barrel).sort()).toEqual([...BARREL_KEYS].sort());
    expect(barrel.DEFAULT_CATALOG).toBe(DEFAULT_CATALOG);
    expect(barrel.DEFAULT_COMPONENT_SPECS).toBe(DEFAULT_COMPONENT_SPECS);
  });

  it("uses explicit Node-safe re-exports", () => {
    expect(readCode("./index.ts")).not.toMatch(/export\s+\*/u);
    expect(readCode("./index.ts")).not.toMatch(/from\s+"react/u);
    expect(readCode("./catalog.ts")).not.toMatch(/from\s+"react/u);
  });
});
