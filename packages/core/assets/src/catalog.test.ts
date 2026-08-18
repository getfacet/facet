import { readFileSync } from "node:fs";

import { BOUNDS, validateCatalog, validateModalConformance } from "@facet/core";
import type { ComponentSpec } from "@facet/core";
import { describe, expect, it } from "vitest";

import { DEFAULT_CATALOG, DEFAULT_COMPONENT_SPECS } from "./catalog.js";
import * as barrel from "./index.js";

/**
 * The default catalog, written out once.
 *
 * This roster is the pin, not a restatement: DC-016 says the default catalog is
 * exactly this roster, so the list lives here in full rather than being
 * derived from the five group modules the implementation composes. A group that
 * grows, shrinks or renames a member fails against this literal instead of
 * quietly redefining the default asset catalog.
 */
const DEFAULT_TAGS: readonly string[] = [
  "Screen",
  "AppShell",
  "Stack",
  "Row",
  "Split",
  "Grid",
  "Modal",
  "Card",
  "Empty",
  "LogoMark",
  "Nav",
  "SideNav",
  "SideNavItem",
  "Section",
  "Divider",
  "Hero",
  "Avatar",
  "ProfileHeader",
  "ProductShowcase",
  "VisualPanel",
  "MediaCard",
  "LinkList",
  "SocialLinks",
  "FeatureList",
  "StatStrip",
  "Gallery",
  "Testimonial",
  "Timeline",
  "CTA",
  "Alert",
  "Progress",
  "Footer",
  "Text",
  "Metric",
  "Badge",
  "Table",
  "Button",
  "Field",
];

/** The exact `@facet/assets` root key set — Barrel Export Contract list 2 (D-12). */
const BARREL_KEYS: readonly string[] = [
  "DEFAULT_CATALOG",
  "DEFAULT_COMPONENT_SPECS",
  "DEFAULT_THEME",
  "DEFAULT_UI_PATTERN_SET",
];

function sortedTags(specs: readonly ComponentSpec[]): readonly string[] {
  return [...specs.map((spec) => spec.tag)].sort();
}

/** A catalog as plain JSON — which also proves the shipped constant is serializable. */
function catalogRecord(components: readonly ComponentSpec[]): Record<string, unknown> {
  return JSON.parse(JSON.stringify({ components })) as Record<string, unknown>;
}

/** The rejection `code`/`at` pair, or the sentinel so a stray acceptance reads clearly. */
function rejection(value: unknown): readonly [string, string] {
  const result = validateCatalog(value);
  return result.ok ? ["accepted", ""] : [result.code, result.at];
}

function readSource(file: string): string {
  return readFileSync(new URL(file, import.meta.url), "utf8");
}

/**
 * The module's source with its comments removed.
 *
 * The assertions below are about what the module *does* — what it re-exports
 * and what it imports — and prose that merely names a banned construct is not
 * the construct. Stripping comments first is what keeps a doc comment that
 * explains why `export *` is forbidden from reading as an `export *`.
 */
function readCode(file: string): string {
  return readSource(file)
    .replaceAll(/\/\*[\s\S]*?\*\//gu, "")
    .replaceAll(/\/\/[^\n]*/gu, "");
}

describe("DEFAULT_CATALOG — exact default service-surface roster (DC-016)", () => {
  it("registers exactly the default tags, no more and no fewer", () => {
    expect(sortedTags(DEFAULT_COMPONENT_SPECS)).toEqual([...DEFAULT_TAGS].sort());
    expect(DEFAULT_COMPONENT_SPECS).toHaveLength(38);
  });

  it("carries those same specs into the catalog it publishes", () => {
    expect(DEFAULT_CATALOG.components).toEqual(DEFAULT_COMPONENT_SPECS);
  });

  it("passes validateCatalog, and the accepted catalog has the exact default roster", () => {
    const result = validateCatalog(DEFAULT_CATALOG);
    expect(result.ok ? "accepted" : `${result.code} at ${result.at}`).toBe("accepted");
    expect(result.ok ? result.catalog.components.length : -1).toBe(38);
    expect(result.ok ? sortedTags(result.catalog.components) : []).toEqual(
      [...DEFAULT_TAGS].sort(),
    );
  });

  it("names Screen among them — it is a registered member, not a reserved position", () => {
    const screen = DEFAULT_COMPONENT_SPECS.find((spec) => spec.tag === "Screen");
    expect(screen?.tag).toBe("Screen");
    expect(screen?.acceptsChildren).toBe(true);
    expect(screen?.collect).toBeUndefined();
    expect(screen?.props["name"]?.type).toBe("string");
    expect(screen?.props["name"]?.required).toBe(true);
  });

  it("registers Facet nowhere: the one grammar position stays unregistered", () => {
    expect(DEFAULT_COMPONENT_SPECS.some((spec) => spec.tag === "Facet")).toBe(false);
  });

  it("resolves one tag to one spec: every default member has a distinct tag", () => {
    expect(new Set(DEFAULT_COMPONENT_SPECS.map((spec) => spec.tag)).size).toBe(38);
  });

  it("registers a Modal the framework frame can project", () => {
    const modal = DEFAULT_COMPONENT_SPECS.find((spec) => spec.tag === "Modal");
    const result = validateModalConformance(JSON.parse(JSON.stringify(modal)));
    expect(result.ok ? "conforms" : `${result.code} at ${result.at}`).toBe("conforms");
  });
});

describe("DEFAULT_CATALOG — the Screen requirement is what makes it complete", () => {
  it("rejects the same catalog with Screen removed", () => {
    const without = DEFAULT_COMPONENT_SPECS.filter((spec) => spec.tag !== "Screen");
    expect(without).toHaveLength(37);
    expect(rejection(catalogRecord(without))).toEqual(["missing_screen_spec", "components"]);
  });

  it("rejects a second Screen at the second member's position", () => {
    const screen = DEFAULT_COMPONENT_SPECS.find((spec) => spec.tag === "Screen") as ComponentSpec;
    const twice = [...DEFAULT_COMPONENT_SPECS, screen];
    expect(rejection(catalogRecord(twice))).toEqual(["duplicate_tag", "components[38].tag"]);
  });
});

describe("DEFAULT_CATALOG — every catalog bound is respected (B-09..B-13)", () => {
  it("keeps the component count inside B-09", () => {
    expect(DEFAULT_COMPONENT_SPECS.length).toBeLessThanOrEqual(BOUNDS.componentsPerCatalog);
  });

  it("keeps each spec's prop count inside B-10 and each enum domain inside B-11", () => {
    for (const spec of DEFAULT_COMPONENT_SPECS) {
      expect(Object.keys(spec.props).length).toBeLessThanOrEqual(BOUNDS.propsPerComponentSpec);
      for (const schema of Object.values(spec.props)) {
        const domain = "enum" in schema ? schema.enum : undefined;
        expect(domain === undefined ? 0 : domain.length).toBeLessThanOrEqual(
          BOUNDS.enumValuesPerProp,
        );
      }
    }
  });

  it("keeps when-to-use inside B-12 and every prop guidance inside B-13", () => {
    for (const spec of DEFAULT_COMPONENT_SPECS) {
      expect(spec.whenToUse.length).toBeGreaterThan(0);
      expect(spec.whenToUse.length).toBeLessThanOrEqual(BOUNDS.componentWhenToUseChars);
      for (const schema of Object.values(spec.props)) {
        expect(schema.guidance.length).toBeGreaterThan(0);
        expect(schema.guidance.length).toBeLessThanOrEqual(BOUNDS.propGuidanceChars);
      }
    }
  });
});

describe("DEFAULT_CATALOG — plain, frozen data", () => {
  it("survives a JSON round trip unchanged: the catalog travels to the agent and to disk", () => {
    expect(JSON.parse(JSON.stringify(DEFAULT_CATALOG))).toEqual(DEFAULT_CATALOG);
  });

  it("is frozen in both directions, so no consumer can lengthen the trust boundary", () => {
    expect(Object.isFrozen(DEFAULT_CATALOG)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CATALOG.components)).toBe(true);
    expect(Object.isFrozen(DEFAULT_COMPONENT_SPECS)).toBe(true);
  });
});

describe("@facet/assets root barrel — the exact key set (D-12)", () => {
  it("exports exactly the default theme, catalog, component specs and UI patterns", () => {
    expect(Object.keys(barrel).sort()).toEqual([...BARREL_KEYS].sort());
  });

  it("re-exports the same values the private modules declare", () => {
    expect(barrel.DEFAULT_CATALOG).toBe(DEFAULT_CATALOG);
    expect(barrel.DEFAULT_COMPONENT_SPECS).toBe(DEFAULT_COMPONENT_SPECS);
  });

  it("uses explicit named re-exports only — no export * anywhere in the barrel", () => {
    expect(readCode("./index.ts")).not.toMatch(/export\s+\*/u);
  });

  it("names only the three private modules the four public symbols come from", () => {
    const specifiers = [...readCode("./index.ts").matchAll(/from\s+"([^"]+)"/gu)].map(
      (match) => match[1],
    );
    expect([...new Set(specifiers)].sort()).toEqual([
      "./catalog.js",
      "./theme-default.js",
      "./ui-patterns.js",
    ]);
  });

  it("pulls no React into the root entry: the Node-only surface stays Node-only", () => {
    for (const file of ["./index.ts", "./catalog.ts"]) {
      expect(readCode(file)).not.toMatch(/from\s+"react/u);
    }
  });
});

describe("catalog.ts — source hygiene", () => {
  it("carries no NUL byte", () => {
    for (const file of ["./catalog.ts", "./index.ts"]) {
      expect(readFileSync(new URL(file, import.meta.url)).indexOf(0)).toBe(-1);
    }
  });

  it("imports nothing but @facet/core and this package's own private spec modules", () => {
    const specifiers = [...readCode("./catalog.ts").matchAll(/from\s+"([^"]+)"/gu)].map(
      (match) => match[1],
    );
    expect([...new Set(specifiers)].sort()).toEqual([
      "./specs-content.js",
      "./specs-expression.js",
      "./specs-interactive.js",
      "./specs-layout.js",
      "./specs-surface.js",
      "@facet/core",
    ]);
  });
});
