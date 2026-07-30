import { describe, expect, it } from "vitest";

import {
  BOUNDS,
  NEUTRAL_COPY_DEFAULTS,
  validateCatalog,
  validateModalConformance,
  validateTheme,
} from "@facet/core";
import type { FacetCatalog, FacetTheme } from "@facet/core";

import { bootstrapSession } from "./bootstrap.js";

function spec(tag: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tag,
    whenToUse: `Use ${tag} when this component fits the page.`,
    props: {},
    acceptsChildren: false,
    ...overrides,
  };
}

function screenSpec(): Record<string, unknown> {
  return spec("Screen", {
    props: {
      name: {
        type: "string",
        required: true,
        guidance: "The screen name the document entry can target.",
      },
    },
    acceptsChildren: true,
  });
}

function textSpec(): Record<string, unknown> {
  return spec("Text", {
    props: { value: { type: "string", guidance: "The text to show." } },
  });
}

function modalSpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return spec("Modal", {
    whenToUse: "Show focused content over the page without leaving the screen.",
    props: {
      triggerLabel: { type: "string", required: true, guidance: "Label of the opening control." },
      title: { type: "string", required: true, guidance: "Title shown in the frame header." },
    },
    acceptsChildren: true,
    ...overrides,
  });
}

function catalogWithScreen(...components: readonly unknown[]): Record<string, unknown> {
  return { components: [...components, screenSpec()] };
}

function themeRecord(): Record<string, Record<string, string>> {
  return {
    color: {
      background: "#ffffff",
      surface: "#f8fafc",
      border: "#d0d7de",
      text: "#111827",
      textMuted: "#6b7280",
      accent: "#2563eb",
      onAccent: "#ffffff",
      success: "#16a34a",
      warning: "#ca8a04",
      danger: "#dc2626",
    },
    space: { xs: "4px", sm: "8px", md: "12px", lg: "16px", xl: "24px" },
    radius: { sm: "4px", md: "8px", lg: "12px", full: "999px" },
    borderWidth: { thin: "1px", thick: "2px" },
    shadow: { sm: "0 1px 2px #0001", md: "0 4px 8px #0002", lg: "0 12px 24px #0003" },
    fontFamily: { sans: "Inter, sans-serif", mono: "Menlo, monospace" },
    fontSize: { xs: "12px", sm: "14px", md: "16px", lg: "20px", xl: "24px" },
    fontWeight: { regular: "400", medium: "500", bold: "700" },
    lineHeight: { tight: "1.1", normal: "1.5", relaxed: "1.8" },
  };
}

function validCatalog(): FacetCatalog {
  const result = validateCatalog(catalogWithScreen(textSpec()));
  if (!result.ok) {
    throw new Error(`expected catalog acceptance, got ${result.code} at ${result.at}`);
  }
  return result.catalog;
}

function validTheme(): FacetTheme {
  const result = validateTheme(themeRecord());
  if (!result.ok) {
    throw new Error(`expected theme acceptance, got ${result.code} at ${result.at}`);
  }
  return result.theme;
}

function rejected(
  result: ReturnType<typeof bootstrapSession>,
): Extract<ReturnType<typeof bootstrapSession>, { readonly ok: false }> {
  if (result.ok) {
    throw new Error("expected bootstrap rejection");
  }
  return result;
}

describe("bootstrapSession", () => {
  it("accepts a catalog with Screen and no Modal", () => {
    const result = bootstrapSession({ catalog: validCatalog(), theme: validTheme() });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.catalog.components.map((component) => component.tag)).toEqual([
        "Text",
        "Screen",
      ]);
      expect(result.session.copy).toBe(NEUTRAL_COPY_DEFAULTS);
      expect(result.session.phase).toBe("preparing");
      expect(result.session.document).toBeNull();
    }
  });

  it("relays catalog duplicate-tag rejection without inventing a runtime code", () => {
    const result = bootstrapSession({
      catalog: catalogWithScreen(textSpec(), textSpec()) as unknown as FacetCatalog,
      theme: validTheme(),
    });

    expect(rejected(result).code).toBe("duplicate_tag");
  });

  it("validates a present Modal and relays the Modal conformance rejection verbatim", () => {
    const badModal = modalSpec({ acceptsChildren: false });
    const expected = validateModalConformance(badModal);
    const result = bootstrapSession({
      catalog: catalogWithScreen(textSpec(), badModal) as unknown as FacetCatalog,
      theme: validTheme(),
    });

    expect(expected.ok).toBe(false);
    expect(result).toEqual(expected);
  });

  it("rejects over-B-24 neutral copy at bootstrap", () => {
    const result = bootstrapSession({
      catalog: validCatalog(),
      theme: validTheme(),
      copy: { render: { preparing: "x".repeat(BOUNDS.frameworkCopyChars + 1) } },
    });

    expect(rejected(result)).toMatchObject({
      code: "copy_too_long",
      at: "render.preparing",
    });
  });

  it("validates optional initial markup fully and starts live only on acceptance", () => {
    const accepted = bootstrapSession({
      catalog: validCatalog(),
      theme: validTheme(),
      initialMarkup:
        '<Facet entry="home"><Screen name="home"><Text value="Ready" /></Screen></Facet>',
    });
    const rejectedMarkup = bootstrapSession({
      catalog: validCatalog(),
      theme: validTheme(),
      initialMarkup:
        '<Facet entry="home"><Screen name="home"><Widget value="Nope" /></Screen></Facet>',
    });

    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(accepted.session.phase).toBe("live");
      expect(accepted.session.document?.entry).toBe("home");
    }
    expect(rejected(rejectedMarkup).code).toBe("unknown-tag");
  });

  it("keeps each session on its own frozen catalog and theme snapshot", () => {
    const firstComponents = [textSpec(), screenSpec()];
    const secondComponents = [spec("Badge"), screenSpec()];
    const firstTheme = themeRecord();
    const secondTheme = themeRecord();

    const first = bootstrapSession({
      catalog: { components: firstComponents } as unknown as FacetCatalog,
      theme: firstTheme as unknown as FacetTheme,
    });
    const second = bootstrapSession({
      catalog: { components: secondComponents } as unknown as FacetCatalog,
      theme: secondTheme as unknown as FacetTheme,
    });

    firstComponents.push(spec("Injected"));
    firstTheme["color"] = { ...firstTheme["color"], text: "#ff00ff" };

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(Object.isFrozen(first.session.catalog.components)).toBe(true);
      expect(Object.isFrozen(first.session.theme.color)).toBe(true);
      expect(first.session.catalog.components.map((component) => component.tag)).toEqual([
        "Text",
        "Screen",
      ]);
      expect(second.session.catalog.components.map((component) => component.tag)).toEqual([
        "Badge",
        "Screen",
      ]);
      expect(first.session.theme.color.text).toBe("#111827");
    }
  });

  it("rejects undeclared own bootstrap options instead of accepting a second host input path", () => {
    const result = bootstrapSession({
      catalog: validCatalog(),
      theme: validTheme(),
      registry: {},
    } as unknown as Parameters<typeof bootstrapSession>[0]);

    expect(rejected(result)).toMatchObject({
      code: "unknown_session_bootstrap_key",
      at: "registry",
    });
  });
});
