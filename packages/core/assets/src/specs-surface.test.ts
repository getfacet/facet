import { readFileSync } from "node:fs";

import { BOUNDS, validateComponentSpec } from "@facet/core";
import type { ComponentSpec } from "@facet/core";
import { describe, expect, it } from "vitest";

import {
  ACTION_BAR_SPEC,
  ACTION_GROUP_SPEC,
  BUTTON_SPEC,
  NAVIGATION_ITEM_SPEC,
  NAVIGATION_SPEC,
  SURFACE_SPECS,
} from "./specs-surface.js";

const EXPECTED_TAGS = [
  "Navigation",
  "NavigationItem",
  "Button",
  "ActionGroup",
  "ActionBar",
] as const;

const EXPECTED_PROP_CONTRACTS: Readonly<Record<string, Record<string, unknown>>> = {
  Navigation: {
    label: { type: "string" },
    orientation: {
      type: "string",
      enum: ["horizontal", "vertical"],
      default: "horizontal",
    },
    density: {
      type: "string",
      enum: ["compact", "comfortable"],
      default: "comfortable",
    },
    tone: {
      type: "string",
      enum: ["neutral", "accent", "inverse"],
      default: "neutral",
    },
  },
  NavigationItem: {
    label: { type: "string", required: true },
    action: { type: "string", required: true },
    arg: { type: "string" },
    mark: { type: "string" },
    meta: { type: "string" },
    active: { type: "boolean", default: false },
  },
  Button: {
    label: { type: "string", required: true },
    action: { type: "string", required: true },
    arg: { type: "string" },
    collect: { type: "string" },
    tone: {
      type: "string",
      enum: ["primary", "secondary", "quiet"],
      default: "secondary",
    },
  },
  ActionGroup: {
    title: { type: "string" },
    layout: { type: "string", enum: ["row", "stack"], default: "stack" },
    align: {
      type: "string",
      enum: ["start", "center", "end"],
      default: "start",
    },
    density: {
      type: "string",
      enum: ["compact", "comfortable"],
      default: "comfortable",
    },
    tone: {
      type: "string",
      enum: ["neutral", "accent", "inverse"],
      default: "neutral",
    },
  },
  ActionBar: {
    align: {
      type: "string",
      enum: ["start", "center", "between"],
      default: "start",
    },
    tone: {
      type: "string",
      enum: ["neutral", "accent", "inverse"],
      default: "neutral",
    },
  },
};

const EXPECTED_CONTENT: Readonly<Record<string, unknown>> = {
  Navigation: {
    mode: "slots",
    slots: {
      brand: { guidance: "Optional navigation identity.", minChildren: 0, maxChildren: 1 },
      items: {
        guidance: "Navigation destinations and commands.",
        minChildren: 1,
        maxChildren: 32,
      },
      actions: { guidance: "Optional navigation actions.", minChildren: 0, maxChildren: 4 },
    },
  },
  NavigationItem: { mode: "none" },
  Button: { mode: "none" },
  ActionGroup: { mode: "children" },
  ActionBar: {
    mode: "slots",
    slots: {
      context: { guidance: "Optional context for the actions.", minChildren: 0, maxChildren: 4 },
      actions: { guidance: "The available actions.", minChildren: 1, maxChildren: 4 },
    },
  },
};

const EXPECTED_CLASSES: Readonly<Record<string, string>> = {
  Navigation: "Structured",
  NavigationItem: "Leaf",
  Button: "Leaf",
  ActionGroup: "Container",
  ActionBar: "Structured",
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

describe("default navigation and action specs", () => {
  it("declares exactly the five locked navigation/action tags in catalog order", () => {
    expect(SURFACE_SPECS.map(({ tag }) => tag)).toEqual(EXPECTED_TAGS);
    expect(SURFACE_SPECS).toEqual([
      NAVIGATION_SPEC,
      NAVIGATION_ITEM_SPEC,
      BUTTON_SPEC,
      ACTION_GROUP_SPEC,
      ACTION_BAR_SPEC,
    ]);
  });

  it("pins every behavioral prop declaration", () => {
    expect(Object.fromEntries(SURFACE_SPECS.map((spec) => [spec.tag, propContract(spec)]))).toEqual(
      EXPECTED_PROP_CONTRACTS,
    );
  });

  it("pins each content branch, slot name, and cardinality", () => {
    expect(Object.fromEntries(SURFACE_SPECS.map((spec) => [spec.tag, spec.content]))).toEqual(
      EXPECTED_CONTENT,
    );
  });

  it("derives the locked Leaf, Container, and Structured classes", () => {
    expect(Object.fromEntries(SURFACE_SPECS.map((spec) => [spec.tag, contentClass(spec)]))).toEqual(
      EXPECTED_CLASSES,
    );
  });

  it("passes the ComponentSpec validator after a JSON round trip", () => {
    for (const spec of SURFACE_SPECS) {
      const result = validateComponentSpec(plainRecord(spec));
      expect(result.ok ? result.spec.tag : `${result.code} at ${result.at}`).toBe(spec.tag);
    }
  });

  it("pins literal action props and keeps action choice out of bindings", () => {
    for (const spec of [NAVIGATION_ITEM_SPEC, BUTTON_SPEC]) {
      const action = spec.props["action"];
      expect(action).toMatchObject({ type: "string", required: true });
      expect(action === undefined ? true : "bindable" in action).toBe(false);
    }
  });

  it("tells agents to preserve declared choice values in Button arguments", () => {
    expect(BUTTON_SPEC.whenToUse).toContain("one Button per offered value");
    expect(BUTTON_SPEC.whenToUse).toContain("Avoid replacing choices");
    expect(BUTTON_SPEC.props["arg"]?.guidance).toContain("Required when the event contract");
    expect(BUTTON_SPEC.props["arg"]?.guidance).toContain("one exact accepted value");
  });

  it("contains no retired role or child-acceptance fields", () => {
    const retiredFields = [
      ["authoring", "Role"],
      ["accepts", "Children"],
    ].map((parts) => parts.join(""));
    for (const spec of SURFACE_SPECS) {
      const record = plainRecord(spec);
      for (const field of retiredFields) expect(Object.hasOwn(record, field)).toBe(false);
      expect(Object.keys(record).sort()).toEqual(
        ["content", "props", "tag", "themeRecipe", "whenToUse"].sort(),
      );
    }
  });

  it("keeps guidance and finite theme recipes inside Core bounds", () => {
    for (const spec of SURFACE_SPECS) {
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

describe("specs-surface.ts source hygiene", () => {
  it("is private serializable data with no retired fields or forbidden dependencies", () => {
    const source = readFileSync(new URL("./specs-surface.ts", import.meta.url), "utf8");
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
