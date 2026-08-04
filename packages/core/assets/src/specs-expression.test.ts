import { BOUNDS, parseMarkup, validateAuthorMarkup, validateComponentSpec } from "@facet/core";
import { describe, expect, it } from "vitest";

import { DEFAULT_CATALOG, DEFAULT_COMPONENT_SPECS } from "./catalog.js";
import { EXPRESSION_SPECS } from "./specs-expression.js";

const EXPRESSION_TAGS = [
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
] as const;

const DEFERRED_TAGS = ["Image", "Logo", "Pricing", "Form"] as const;

function authorResult(markup: string): string {
  const parsed = parseMarkup(markup);
  if (!parsed.ok) return parsed.error.code;
  const validated = validateAuthorMarkup(parsed.ast, DEFAULT_CATALOG, {});
  return validated.ok ? "accepted" : validated.error.code;
}

describe("expression component specs", () => {
  it("registers the service-surface expression set", () => {
    expect(EXPRESSION_SPECS.map((spec) => spec.tag)).toEqual(EXPRESSION_TAGS);
    expect(DEFAULT_COMPONENT_SPECS.map((spec) => spec.tag)).toEqual(
      expect.arrayContaining([...EXPRESSION_TAGS]),
    );
  });

  it("keeps unsafe or overly-specific candidates out of the v1 catalog", () => {
    const defaultTags = new Set(DEFAULT_COMPONENT_SPECS.map((spec) => spec.tag));

    for (const tag of DEFERRED_TAGS) {
      expect(defaultTags.has(tag), tag).toBe(false);
    }
  });

  it("keeps every expression spec inside catalog bounds and validation", () => {
    for (const spec of EXPRESSION_SPECS) {
      const result = validateComponentSpec(spec);
      expect(result.ok ? "accepted" : `${result.code} at ${result.at}`).toBe("accepted");
      expect(spec.whenToUse.length).toBeLessThanOrEqual(BOUNDS.componentWhenToUseChars);
      expect(Object.keys(spec.props).length).toBeLessThanOrEqual(BOUNDS.propsPerComponentSpec);
      for (const schema of Object.values(spec.props)) {
        expect(schema.guidance.length).toBeGreaterThan(0);
        expect(schema.guidance.length).toBeLessThanOrEqual(BOUNDS.propGuidanceChars);
        expect(schema.type).not.toBe("object");
        expect(schema.type).not.toBe("array");
      }
    }
  });

  it("does not expose raw URL, href, HTML, handler or style props", () => {
    const forbidden = /^(?:src|href|html|dangerouslySetInnerHTML|style|className|on[A-Z].*)$/u;

    for (const spec of EXPRESSION_SPECS) {
      expect(
        Object.keys(spec.props).filter((name) => forbidden.test(name)),
        spec.tag,
      ).toEqual([]);
    }
  });

  it("rejects undeclared props and invalid enum values through author validation", () => {
    expect(
      authorResult(
        `<Facet entry="home"><Screen name="home"><Hero title="Hello" level="1" /></Screen></Facet>`,
      ),
    ).toBe("undeclared-prop");
    expect(
      authorResult(
        `<Facet entry="home"><Screen name="home"><Alert title="Heads up" tone="rainbow" /></Screen></Facet>`,
      ),
    ).toBe("invalid-value");
  });
});
