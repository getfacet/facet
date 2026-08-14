import { DEFAULT_CATALOG } from "@facet/assets";
import { parseMarkup, validateAuthorMarkup } from "@facet/core";
import type { ComponentSpec } from "@facet/core";
import { describe, expect, it } from "vitest";

import {
  deriveComponentPreviewFixtures,
  previewFixtureForTag,
  previewSpecimensForTag,
} from "./component-preview-fixtures.js";
import { resolveQuickstartDesignOverlay, type QuickstartDesignOverlay } from "../design-overlay.js";

function defaultTags(): readonly string[] {
  return DEFAULT_CATALOG.components.map((spec) => spec.tag);
}

const PROMO_BANNER_SPEC = Object.freeze({
  tag: "PromoBanner",
  whenToUse: "Use for active design launch announcements.",
  authoring: {
    role: "display",
    informationTypes: ["test_content"],
    visualEmphasis: "supporting",
  } as const,
  acceptsChildren: false,
  props: Object.freeze({
    title: Object.freeze({
      type: "string",
      required: true,
      guidance: "Primary announcement copy.",
    }),
  }),
}) satisfies ComponentSpec;

function activeOverlay(): QuickstartDesignOverlay {
  return {
    components: [PROMO_BANNER_SPEC],
    registry: { PromoBanner: () => null },
    examples: [
      {
        id: "promo-banner",
        kind: "component",
        label: "Promo banner",
        description: "A declarative example supplied by the active design module.",
        tags: ["PromoBanner"],
        markup: `<Facet entry="preview">
  <Screen name="preview">
    <PromoBanner title="Private beta is open" />
  </Screen>
</Facet>`,
      },
    ],
  };
}

function resolvedActiveOverlay() {
  const result = resolveQuickstartDesignOverlay(activeOverlay());
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.detail}`);
  }
  return result.design;
}

describe("component preview fixtures", () => {
  it("validates one preview fixture for every default catalog tag", () => {
    const results = deriveComponentPreviewFixtures(DEFAULT_CATALOG);

    expect(results.map((result) => result.tag)).toEqual(defaultTags());

    for (const result of results) {
      const message = result.ok
        ? result.tag
        : `${result.tag}: ${result.error.phase} ${result.error.code}`;
      expect(result.ok, message).toBe(true);
      if (!result.ok) {
        continue;
      }

      expect(result.fixture.tag).toBe(result.tag);
      expect(result.fixture.document.nodes[result.fixture.targetNodeId]?.tag).toBe(result.tag);

      const parsed = parseMarkup(result.fixture.source);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) {
        throw new Error(parsed.error.code);
      }

      const validated = validateAuthorMarkup(parsed.ast, DEFAULT_CATALOG, result.fixture.data);
      expect(validated.ok).toBe(true);
      if (!validated.ok) {
        throw new Error(validated.error.code);
      }
      expect(validated.document).toEqual(result.fixture.document);
    }
  });

  it("keeps structured preview data in the data model instead of inline markup", () => {
    const result = previewFixtureForTag("Table");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`${result.error.phase} ${result.error.code}`);
    }

    expect(result.fixture.source).toContain('rows="data:previewRows"');
    expect(result.fixture.source).not.toContain('rows="[');
    expect(result.fixture.data["previewRows"]).toEqual([
      { component: "Text", state: "Ready" },
      { component: "Table", state: "Bound" },
    ]);
  });

  it("validates recipe-backed specimens for every default catalog tag", () => {
    for (const tag of defaultTags()) {
      const specimens = previewSpecimensForTag(tag, DEFAULT_CATALOG);
      expect(specimens.length, tag).toBeGreaterThan(0);

      for (const specimen of specimens) {
        const message = `${tag}.${specimen.id}`;
        expect(specimen.label.length, message).toBeGreaterThan(0);
        expect(specimen.description.length, message).toBeGreaterThan(0);
        expect(specimen.result.ok, message).toBe(true);
        if (!specimen.result.ok) {
          continue;
        }
        expect(
          specimen.result.fixture.document.nodes[specimen.result.fixture.targetNodeId]?.tag,
        ).toBe(tag);
      }
    }

    const buttonSpecimens = previewSpecimensForTag("Button");
    expect(buttonSpecimens.map((specimen) => specimen.id)).toEqual([
      "button-primary",
      "button-secondary",
      "button-quiet",
    ]);
    expect(buttonSpecimens[0]?.recipeTokens).toContain("primaryBg");
    expect(buttonSpecimens[2]?.recipeTokens).toContain("quietText");
  });

  it("uses resolved active examples for additive custom component previews", () => {
    const design = resolvedActiveOverlay();
    const fixture = previewFixtureForTag("PromoBanner", design.catalog, design.examples);

    expect(fixture.ok).toBe(true);
    if (!fixture.ok) {
      throw new Error(`${fixture.error.phase} ${fixture.error.code}`);
    }
    expect(fixture.fixture.tag).toBe("PromoBanner");
    expect(fixture.fixture.source).toContain("<PromoBanner");
    expect(fixture.fixture.document.nodes[fixture.fixture.targetNodeId]?.tag).toBe("PromoBanner");

    const fixtures = deriveComponentPreviewFixtures(design.catalog, design.examples);
    const promoFixture = fixtures.find((result) => result.tag === "PromoBanner");
    expect(promoFixture?.ok).toBe(true);

    const specimens = previewSpecimensForTag("PromoBanner", design.catalog, design.examples);
    expect(specimens.map((specimen) => specimen.id)).toEqual(["promo-banner"]);
    expect(specimens[0]?.label).toBe("Promo banner");
    expect(specimens[0]?.description).toBe(
      "A declarative example supplied by the active design module.",
    );
    expect(specimens[0]?.result.ok).toBe(true);
  });
});
