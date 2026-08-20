import { describe, expect, it } from "vitest";
import { DEFAULT_CATALOG, DEFAULT_THEME } from "@facet/assets";
import type { ComponentSpec } from "@facet/core";

import {
  resolveQuickstartDesignOverlay,
  type QuickstartDesignOverlay,
  type QuickstartDesignRegistryEntry,
} from "./design-overlay.js";

const defaultTags = DEFAULT_CATALOG.components.map((component) => component.tag);

const PromoBanner: QuickstartDesignRegistryEntry = () => null;
// @ts-expect-error Registry entries must render React nodes, not arbitrary objects.
const NonReactRegistryEntry: QuickstartDesignRegistryEntry = () => ({ bad: true });
void NonReactRegistryEntry;

const PROMO_BANNER_SPEC: ComponentSpec = Object.freeze({
  tag: "PromoBanner",
  whenToUse: "Use for a branded promotional callout.",
  props: Object.freeze({
    eyebrow: Object.freeze({
      type: "string",
      guidance: "Short label above the headline.",
    }),
    title: Object.freeze({
      type: "string",
      guidance: "Concise promotional headline.",
      required: true,
    }),
  }),
  content: Object.freeze({ mode: "none" }),
});

function accepted(overlay: unknown) {
  const result = resolveQuickstartDesignOverlay(overlay);
  if (!result.ok) {
    throw new Error(`expected overlay acceptance, got ${result.error.code}: ${result.error.at}`);
  }
  return result.design;
}

function rejected(overlay: unknown) {
  const result = resolveQuickstartDesignOverlay(overlay);
  if (result.ok) throw new Error("expected overlay rejection");
  return result.error;
}

describe("quickstart design overlay validation", () => {
  it("composes a theme-only overlay over the default design", () => {
    const overlay = {
      theme: {
        semantic: {
          action: {
            primaryBg: "#123456",
          },
        },
      },
      notes: [
        {
          id: "brand-tone",
          title: "Brand tone",
          body: "Use the stronger primary action color for launch flows.",
        },
      ],
    } satisfies QuickstartDesignOverlay;

    const design = accepted(overlay);

    expect(design.catalog).toBe(DEFAULT_CATALOG);
    expect(design.theme.semantic.action.primaryBg).toBe("#123456");
    expect(design.theme.semantic.action.primaryText).toBe(
      DEFAULT_THEME.semantic.action.primaryText,
    );
    expect(design.defaultRegistryTags).toEqual(defaultTags);
    expect(design.customRegistryTags).toEqual([]);
    expect(design.registryTags).toEqual(defaultTags);
    expect(design.customRegistry).toEqual({});
    expect(design.examples).toEqual([]);
    expect(design.notes).toEqual(overlay.notes);
  });

  it("accepts an additive component spec when the callable registry entry matches", () => {
    const design = accepted({
      components: [PROMO_BANNER_SPEC],
      registry: { PromoBanner },
      examples: [
        {
          id: "promo-banner",
          kind: "component",
          label: "Promo banner",
          tags: ["PromoBanner"],
          markup: `<Facet entry="preview">
  <Screen name="preview">
    <PromoBanner eyebrow="Launch" title="Private beta is open" />
  </Screen>
</Facet>`,
        },
      ],
    } satisfies QuickstartDesignOverlay);

    expect(design.catalog.components.map((component) => component.tag)).toEqual([
      ...defaultTags,
      "PromoBanner",
    ]);
    expect(design.customRegistry).toEqual({ PromoBanner });
    expect(design.customRegistryTags).toEqual(["PromoBanner"]);
    expect(design.registryTags).toEqual([...defaultTags, "PromoBanner"]);
    const firstScreenId = design.examples[0]?.document.screens[0];
    expect(firstScreenId).toBeDefined();
    expect(design.examples[0]?.document.nodes[firstScreenId ?? ""]?.tag).toBe("Screen");
  });

  it("rejects an additive component that omits its registry entry", () => {
    expect(
      rejected({
        components: [PROMO_BANNER_SPEC],
      }).code,
    ).toBe("missing_registry_entry");
  });

  it("rejects default tag replacement and duplicate custom component tags", () => {
    expect(
      rejected({
        components: [{ ...PROMO_BANNER_SPEC, tag: "Text" }],
        registry: { Text: PromoBanner },
      }).code,
    ).toBe("default_component_replacement");

    expect(
      rejected({
        components: [PROMO_BANNER_SPEC, { ...PROMO_BANNER_SPEC }],
        registry: { PromoBanner },
      }).code,
    ).toBe("duplicate_custom_component");
  });

  it("rejects registry entries that replace defaults or lack matching specs", () => {
    expect(
      rejected({
        registry: { Text: PromoBanner },
      }).code,
    ).toBe("default_registry_replacement");

    expect(
      rejected({
        registry: { PromoBanner },
      }).code,
    ).toBe("unknown_registry_entry");

    expect(
      rejected({
        components: [PROMO_BANNER_SPEC],
        registry: { PromoBanner: "not callable" },
      }).code,
    ).toBe("registry_entry_not_callable");
  });

  it("rejects invalid theme overlays instead of widening token keys", () => {
    const error = rejected({
      theme: {
        semantic: {
          action: {
            inlineCss: "color: red",
          },
        },
      },
    });

    expect(error.code).toBe("theme_invalid");
    expect(error.at).toBe("theme.semantic.action.inlineCss");
  });

  it("rejects invalid additive component specs through core catalog validation", () => {
    expect(
      rejected({
        components: [
          {
            tag: "PromoBanner",
            whenToUse: "Use for a branded promotional callout.",
            props: {
              title: {
                type: "string",
                guidance: "Concise promotional headline.",
                required: true,
                default: "Launch",
              },
            },
            content: { mode: "none" },
          },
        ],
        registry: { PromoBanner },
      }).code,
    ).toBe("catalog_invalid");
  });

  it("rejects non-declarative and unsafe overlay examples", () => {
    expect(
      rejected({
        examples: [
          {
            id: "jsx-example",
            kind: "component",
            label: "JSX example",
            markup: { type: "Text", props: { value: "No JSX examples" } },
          },
        ],
      }).code,
    ).toBe("invalid_example_markup");

    expect(
      rejected({
        examples: [
          {
            id: "raw-style",
            kind: "component",
            label: "Raw style",
            markup: `<Facet entry="preview">
  <Screen name="preview">
    <Text value="No raw CSS" style="color: red" />
  </Screen>
</Facet>`,
          },
        ],
      }).code,
    ).toBe("example_markup_invalid");

    expect(
      rejected({
        examples: [
          {
            id: "expression",
            kind: "component",
            label: "Expression",
            markup: `<Facet entry="preview"><Screen name="preview"><Text value={name} /></Screen></Facet>`,
          },
        ],
      }).code,
    ).toBe("example_markup_invalid");
  });

  it("rejects duplicate example ids and excessive examples", () => {
    const example = {
      id: "promo-banner",
      kind: "component",
      label: "Promo banner",
      tags: ["PromoBanner"],
      markup: `<Facet entry="preview">
  <Screen name="preview">
    <PromoBanner title="Private beta is open" />
  </Screen>
</Facet>`,
    };

    expect(
      rejected({
        components: [PROMO_BANNER_SPEC],
        registry: { PromoBanner },
        examples: [example, example],
      }).code,
    ).toBe("duplicate_example_id");

    expect(
      rejected({
        examples: Array.from({ length: 65 }, (_, index) => ({
          id: `example-${String(index)}`,
          kind: "screen",
          label: "Example",
          markup: `<Facet entry="preview"><Screen name="preview" /></Facet>`,
        })),
      }).code,
    ).toBe("too_many_examples");
  });

  it("rejects duplicate note ids, excessive notes, and long display strings", () => {
    expect(
      rejected({
        notes: [
          { id: "voice", title: "Voice", body: "Keep copy concise." },
          { id: "voice", title: "Voice", body: "Keep copy concise." },
        ],
      }).code,
    ).toBe("duplicate_note_id");

    expect(
      rejected({
        notes: Array.from({ length: 33 }, (_, index) => ({
          id: `note-${String(index)}`,
          title: "Note",
          body: "Body",
        })),
      }).code,
    ).toBe("too_many_notes");

    expect(
      rejected({
        notes: [{ id: "voice", title: "V".repeat(501), body: "Body" }],
      }).code,
    ).toBe("design_string_too_long");
  });

  it("rejects client-fetch shaped overlay objects through the closed top-level form", () => {
    expect(
      rejected({
        fetch: () => null,
      }).code,
    ).toBe("unknown_overlay_key");
  });

  it("rejects inherited design fields instead of consuming prototype data", () => {
    const overlay = Object.create({
      theme: {
        semantic: {
          action: {
            primaryBg: "#123456",
          },
        },
      },
    }) as Record<string, unknown>;
    overlay["notes"] = [{ id: "voice", title: "Voice", body: "Keep copy concise." }];

    expect(rejected(overlay).code).toBe("overlay_not_an_object");
  });

  it("rejects cyclic overlay values deterministically", () => {
    const semantic: Record<string, unknown> = {};
    semantic["action"] = semantic;

    expect(
      rejected({
        theme: { semantic },
      }),
    ).toEqual({
      code: "overlay_cycle",
      at: "theme.semantic.action",
      detail: "Design values must be acyclic plain data.",
    });
  });

  it("rejects prototype keys inside nested design values", () => {
    const action = Object.create(null) as Record<string, unknown>;
    action["__proto__"] = "#123456";

    expect(
      rejected({
        theme: {
          semantic: {
            action,
          },
        },
      }),
    ).toEqual({
      code: "unsafe_design_key",
      at: "theme.semantic.action.__proto__",
      detail: "Design values may not use object prototype keys.",
    });
  });

  it("rejects throwing overlay getters deterministically", () => {
    const overlay: Record<string, unknown> = {};
    Object.defineProperty(overlay, "theme", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });

    expect(rejected(overlay)).toEqual({
      code: "overlay_read_failed",
      at: "",
      detail:
        "Reading the design module threw; it must be plain data plus callable registry entries.",
    });
  });
});
