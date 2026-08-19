import { readFileSync } from "node:fs";

import { BOUNDS, validateComponentSpec, validateModalConformance } from "@facet/core";
import type { ComponentSpec } from "@facet/core";
import { describe, expect, it } from "vitest";

import {
  APP_SHELL_SPEC,
  CARD_SPEC,
  DIVIDER_SPEC,
  GRID_SPEC,
  LAYOUT_SPECS,
  MODAL_SPEC,
  ROW_SPEC,
  SCREEN_SPEC,
  SECTION_SPEC,
  SPLIT_SPEC,
  STACK_SPEC,
} from "./specs-layout.js";

const EXPECTED_TAGS = [
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
] as const;

const EXPECTED_PROP_CONTRACTS: Readonly<Record<string, Record<string, unknown>>> = {
  Screen: {
    name: { type: "string", required: true },
    title: { type: "string" },
    maxWidth: {
      type: "string",
      enum: ["narrow", "medium", "wide", "full"],
      default: "medium",
    },
    padding: { type: "string", enum: ["none", "sm", "md", "lg"], default: "md" },
  },
  Stack: {
    gap: { type: "string", enum: ["none", "xs", "sm", "md", "lg", "xl"], default: "md" },
    align: {
      type: "string",
      enum: ["start", "center", "end", "stretch"],
      default: "stretch",
    },
    justify: {
      type: "string",
      enum: ["start", "center", "end", "between"],
      default: "start",
    },
    grow: { type: "boolean", default: false },
    padding: {
      type: "string",
      enum: ["none", "xs", "sm", "md", "lg", "xl"],
      default: "none",
    },
  },
  Row: {
    gap: { type: "string", enum: ["none", "xs", "sm", "md", "lg", "xl"], default: "md" },
    align: {
      type: "string",
      enum: ["start", "center", "end", "stretch", "baseline"],
      default: "center",
    },
    justify: {
      type: "string",
      enum: ["start", "center", "end", "between"],
      default: "start",
    },
    wrap: { type: "boolean", default: true },
  },
  Grid: {
    columns: { type: "number", minimum: 1, maximum: 6, default: 3 },
    gap: { type: "string", enum: ["none", "xs", "sm", "md", "lg", "xl"], default: "md" },
    collapse: { type: "boolean", default: true },
  },
  Split: {
    ratio: {
      type: "string",
      enum: ["50:50", "60:40", "40:60", "70:30", "30:70"],
      default: "60:40",
    },
    gap: { type: "string", enum: ["none", "xs", "sm", "md", "lg", "xl"], default: "lg" },
    align: {
      type: "string",
      enum: ["start", "center", "end", "stretch"],
      default: "stretch",
    },
    reverse: { type: "boolean", default: false },
    collapse: { type: "boolean", default: true },
  },
  AppShell: {
    gap: { type: "string", enum: ["none", "xs", "sm", "md", "lg", "xl"], default: "lg" },
    sidebar: { type: "string", enum: ["start", "end"], default: "start" },
    collapse: { type: "boolean", default: true },
  },
  Section: {
    title: { type: "string" },
    description: { type: "string" },
    tone: { type: "string", enum: ["neutral", "accent", "muted"], default: "neutral" },
    padding: { type: "string", enum: ["none", "sm", "md", "lg"], default: "md" },
  },
  Card: {
    title: { type: "string" },
    tone: {
      type: "string",
      enum: ["neutral", "accent", "success", "warning", "danger"],
      default: "neutral",
    },
    padding: { type: "string", enum: ["none", "sm", "md", "lg"], default: "md" },
  },
  Modal: {
    triggerLabel: { type: "string", required: true },
    title: { type: "string", required: true },
    description: { type: "string" },
  },
  Divider: {
    label: { type: "string" },
    emphasis: { type: "string", enum: ["subtle", "strong"], default: "subtle" },
  },
};

const EXPECTED_CONTENT: Readonly<Record<string, unknown>> = {
  Screen: { mode: "children" },
  Stack: { mode: "children" },
  Row: { mode: "children" },
  Grid: { mode: "children" },
  Split: {
    mode: "slots",
    slots: {
      primary: { guidance: "Primary side of the split.", minChildren: 1, maxChildren: 1 },
      secondary: { guidance: "Secondary side of the split.", minChildren: 1, maxChildren: 1 },
    },
  },
  AppShell: {
    mode: "slots",
    slots: {
      navigation: { guidance: "Optional app navigation.", minChildren: 0, maxChildren: 1 },
      header: { guidance: "Optional app header.", minChildren: 0, maxChildren: 1 },
      main: { guidance: "The app's main content.", minChildren: 1, maxChildren: 1 },
    },
  },
  Section: { mode: "children" },
  Card: { mode: "children" },
  Modal: {
    mode: "slots",
    slots: {
      body: { guidance: "Modal content in reading order.", minChildren: 1, maxChildren: 16 },
      actions: { guidance: "Optional modal actions.", minChildren: 0, maxChildren: 4 },
    },
  },
  Divider: { mode: "none" },
};

const EXPECTED_CLASSES: Readonly<Record<string, string>> = {
  Screen: "Container",
  Stack: "Container",
  Row: "Container",
  Grid: "Container",
  Split: "Structured",
  AppShell: "Structured",
  Section: "Container",
  Card: "Container",
  Modal: "Structured",
  Divider: "Leaf",
};

function plainRecord(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function propContract(spec: ComponentSpec): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(spec.props).map(([name, schema]) => {
      const contract = plainRecord(schema);
      delete contract["guidance"];
      return [name, contract];
    }),
  );
}

function contentClass(spec: ComponentSpec): string {
  return spec.content.mode === "none"
    ? "Leaf"
    : spec.content.mode === "children"
      ? "Container"
      : "Structured";
}

describe("default structure specs", () => {
  it("declares exactly the ten locked structure tags in catalog order", () => {
    expect(LAYOUT_SPECS.map(({ tag }) => tag)).toEqual(EXPECTED_TAGS);
    expect(LAYOUT_SPECS).toEqual([
      SCREEN_SPEC,
      STACK_SPEC,
      ROW_SPEC,
      GRID_SPEC,
      SPLIT_SPEC,
      APP_SHELL_SPEC,
      SECTION_SPEC,
      CARD_SPEC,
      MODAL_SPEC,
      DIVIDER_SPEC,
    ]);
  });

  it("pins every behavioral prop declaration", () => {
    expect(Object.fromEntries(LAYOUT_SPECS.map((spec) => [spec.tag, propContract(spec)]))).toEqual(
      EXPECTED_PROP_CONTRACTS,
    );
  });

  it("pins each content branch, slot name, and cardinality", () => {
    expect(Object.fromEntries(LAYOUT_SPECS.map((spec) => [spec.tag, spec.content]))).toEqual(
      EXPECTED_CONTENT,
    );
  });

  it("derives the locked Leaf, Container, and Structured classes", () => {
    expect(Object.fromEntries(LAYOUT_SPECS.map((spec) => [spec.tag, contentClass(spec)]))).toEqual(
      EXPECTED_CLASSES,
    );
  });

  it("passes the ComponentSpec validator after a JSON round trip", () => {
    for (const spec of LAYOUT_SPECS) {
      const result = validateComponentSpec(plainRecord(spec));
      expect(result.ok ? result.spec.tag : `${result.code} at ${result.at}`).toBe(spec.tag);
    }
  });

  it("keeps the framework Modal projection conforming", () => {
    const result = validateModalConformance(plainRecord(MODAL_SPEC));
    expect(result.ok ? "conforms" : `${result.code} at ${result.at}`).toBe("conforms");
  });

  it("contains no retired role or child-acceptance fields", () => {
    const retiredFields = [
      ["authoring", "Role"],
      ["accepts", "Children"],
    ].map((parts) => parts.join(""));
    for (const spec of LAYOUT_SPECS) {
      const record = plainRecord(spec);
      for (const field of retiredFields) expect(Object.hasOwn(record, field)).toBe(false);
      expect(Object.keys(record).sort()).toEqual(
        ["content", "props", "tag", "themeRecipe", "whenToUse"].sort(),
      );
    }
  });

  it("keeps guidance and finite theme recipes inside Core bounds", () => {
    for (const spec of LAYOUT_SPECS) {
      expect(spec.whenToUse.length).toBeGreaterThan(0);
      expect(spec.whenToUse.length).toBeLessThanOrEqual(BOUNDS.componentWhenToUseChars);
      expect(Object.keys(spec.props).length).toBeLessThanOrEqual(BOUNDS.propsPerComponentSpec);
      for (const schema of Object.values(spec.props)) {
        expect(schema.guidance.length).toBeGreaterThan(0);
        expect(schema.guidance.length).toBeLessThanOrEqual(BOUNDS.propGuidanceChars);
      }
      expect(Object.keys(spec.themeRecipe?.tokens ?? {}).length).toBeGreaterThan(0);
      expect(Object.keys(spec.themeRecipe?.tokens ?? {}).length).toBeLessThanOrEqual(
        BOUNDS.propsPerComponentSpec,
      );
    }
  });
});

describe("specs-layout.ts source hygiene", () => {
  it("is private serializable data with no retired fields or forbidden dependencies", () => {
    const source = readFileSync(new URL("./specs-layout.ts", import.meta.url), "utf8");
    for (const field of [
      ["authoring", "Role"],
      ["accepts", "Children"],
    ]) {
      expect(source.includes(field.join(""))).toBe(false);
    }
    expect(source.includes("\0")).toBe(false);
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    expect([...new Set(imports)]).toEqual(["@facet/core"]);
  });
});
