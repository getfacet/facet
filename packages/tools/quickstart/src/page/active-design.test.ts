import { DEFAULT_CATALOG, DEFAULT_THEME } from "@facet/assets";
import { DEFAULT_REGISTRY } from "@facet/assets/react";
import { describe, expect, it } from "vitest";

import {
  resolveQuickstartPageActiveDesign,
  type ResolveQuickstartPageActiveDesignOptions,
} from "./active-design.js";

const defaultTags = DEFAULT_CATALOG.components.map((component) => component.tag);

function accepted(options?: ResolveQuickstartPageActiveDesignOptions) {
  const result = resolveQuickstartPageActiveDesign(options);
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.detail}`);
  }
  return result.design;
}

describe("quickstart page active design", () => {
  it("builds the default active design from the framework catalog and registry", () => {
    const design = accepted();

    expect(design.mode).toBe("default");
    expect(design.bootstrap.catalog).toEqual(DEFAULT_CATALOG);
    expect(design.bootstrap.theme).toEqual(DEFAULT_THEME);
    expect(design.defaultRegistryTags).toEqual(defaultTags);
    expect(design.customRegistryTags).toEqual([]);
    expect(design.registryTags).toEqual(defaultTags);
    expect(design.examples).toEqual([]);
    expect(design.notes).toEqual([]);
  });

  it("builds an overlay active design with custom registry entries and notes", () => {
    const PromoBanner = () => null;
    const design = accepted({
      overlay: {
        components: [
          {
            tag: "PromoBanner",
            whenToUse: "Use for a promotional banner.",
            props: {},
            acceptsChildren: false,
          },
        ],
        registry: { PromoBanner },
        examples: [
          {
            id: "promo-banner",
            kind: "component",
            label: "Promo banner",
            markup: `<Facet entry="preview">
  <Screen name="preview">
    <PromoBanner />
  </Screen>
</Facet>`,
            tags: ["PromoBanner"],
          },
        ],
        notes: [{ id: "voice", title: "Voice", body: "Keep copy concise." }],
      },
    });

    expect(design.mode).toBe("overlay");
    expect(design.customRegistryTags).toEqual(["PromoBanner"]);
    expect(design.registryTags).toEqual([...defaultTags, "PromoBanner"]);
    expect(design.bootstrap.registry["PromoBanner"]).toBe(PromoBanner);
    expect(design.examples[0]?.id).toBe("promo-banner");
    expect(design.notes[0]?.id).toBe("voice");
  });

  it("reports active-design bootstrap failure without falling back to defaults", () => {
    const Text = DEFAULT_REGISTRY["Text"];
    if (Text === undefined) {
      throw new Error("DEFAULT_REGISTRY is missing Text");
    }
    const result = resolveQuickstartPageActiveDesign({
      defaultRegistry: { Text },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("active_design_bootstrap_failed");
    expect(result.error.detail).toMatch(/registry|Screen|tag/u);
  });
});
