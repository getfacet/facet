import { describe, expect, it } from "vitest";

import { validateCatalog, validateTheme } from "@facet/core";
import type { ComponentDocument, FacetCatalog, FacetTheme } from "@facet/core";

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
  const result = validateTheme({
    color: {
      background: "#fff",
      surface: "#f9fafb",
      border: "#e5e7eb",
      text: "#111827",
      textMuted: "#6b7280",
      accent: "#1d4ed8",
      onAccent: "#fff",
      success: "#15803d",
      warning: "#a16207",
      danger: "#b91c1c",
    },
    space: { xs: "2px", sm: "4px", md: "8px", lg: "16px", xl: "32px" },
    radius: { sm: "3px", md: "6px", lg: "9px", full: "999px" },
    borderWidth: { thin: "1px", thick: "3px" },
    shadow: { sm: "none", md: "0 2px 8px #0002", lg: "0 8px 24px #0003" },
    fontFamily: { sans: "system-ui", mono: "ui-monospace" },
    fontSize: { xs: "11px", sm: "13px", md: "15px", lg: "18px", xl: "22px" },
    fontWeight: { regular: "400", medium: "500", bold: "800" },
    lineHeight: { tight: "1", normal: "1.4", relaxed: "1.75" },
  });
  if (!result.ok) {
    throw new Error(`expected theme acceptance, got ${result.code}`);
  }
  return result.theme;
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
      expect(Object.isFrozen(result.session.theme.color)).toBe(true);
      expect(Object.isFrozen(result.session.copy.render)).toBe(true);
      expect(result.session.copy.render.preparing).toBe("Booting");
    }
  });
});
