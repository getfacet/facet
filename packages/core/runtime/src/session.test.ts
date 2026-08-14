import { describe, expect, it } from "vitest";

import { validateCatalog } from "@facet/core";
import type { ComponentDocument, FacetCatalog, FacetTheme } from "@facet/core";

import { validTestTheme } from "../../../../test-support/theme-fixture.js";
import { bootstrapSession } from "./bootstrap.js";

function component(tag: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tag,
    whenToUse: `Use ${tag} when the page needs it.`,
    props: {},
    acceptsChildren: false,
    ...overrides,
  };
}

function screen(): Record<string, unknown> {
  return component("Screen", {
    props: {
      name: {
        type: "string",
        required: true,
        guidance: "The screen name the document entry selects.",
      },
    },
    acceptsChildren: true,
  });
}

function label(): Record<string, unknown> {
  return component("Label", {
    props: { value: { type: "string", guidance: "Short display text." } },
  });
}

function catalog(): FacetCatalog {
  const result = validateCatalog({ components: [label(), screen()] });
  if (!result.ok) {
    throw new Error(`expected catalog acceptance, got ${result.code}`);
  }
  return result.catalog;
}

function theme(): FacetTheme {
  return validTestTheme({
    foundation: {
      typography: { fontWeightBold: "800" },
    },
    semantic: {
      action: { primaryBg: "#1d4ed8" },
      status: {
        successText: "#15803d",
        warningText: "#a16207",
        dangerText: "#b91c1c",
      },
    },
  });
}

describe("Session", () => {
  it("stays preparing until bootstrap receives an accepted initial render", () => {
    const result = bootstrapSession({ catalog: catalog(), theme: theme() });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.phase).toBe("preparing");
      expect(result.session.document).toBeNull();
      expect(result.session.data).toEqual({});
      expect(result.session.stageRevision).toBe(0);
    }
  });

  it("uses valid initial markup as the first accepted render_page result", () => {
    const result = bootstrapSession({
      catalog: catalog(),
      theme: theme(),
      initialMarkup:
        '<Facet entry="main"><Screen name="main"><Label value="Ready" /></Screen></Facet>',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const document: ComponentDocument | null = result.session.document;
      expect(result.session.phase).toBe("live");
      expect(document?.entry).toBe("main");
      expect(result.session.stageRevision).toBe(0);
    }
  });

  it("freezes the session envelope and its catalog, theme and copy", () => {
    const result = bootstrapSession({
      catalog: catalog(),
      theme: theme(),
      copy: { render: { preparing: "Booting" } },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.isFrozen(result.session)).toBe(true);
      expect(Object.isFrozen(result.session.catalog.components)).toBe(true);
      expect(Object.isFrozen(result.session.theme.semantic.action)).toBe(true);
      expect(Object.isFrozen(result.session.copy.render)).toBe(true);
      expect(result.session.copy.render.preparing).toBe("Booting");
    }
  });
});
