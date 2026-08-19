import { describe, expect, it } from "vitest";

import { validateCatalog } from "@facet/core";
import type {
  AuthorValidationResult,
  ComponentDocument,
  DataModel,
  FacetCatalog,
  FacetTargetedMutationInput,
  FacetTargetedMutationResult,
  PayloadEvaluation,
} from "@facet/core";

import { buildTurnObservation, formatCatalogIndex } from "./observation.js";
import type { FacetToolSession } from "./types.js";

function component(
  tag: string,
  whenToUse = `Use ${tag} when it fits.`,
  content: Record<string, unknown> = { mode: "none" },
): Record<string, unknown> {
  return {
    tag,
    whenToUse,
    props: {
      value: {
        type: "string",
        guidance: `DO_NOT_LEAK_PROP_SCHEMA_FOR_${tag}`,
      },
    },
    content,
  };
}

function screenSpec(): Record<string, unknown> {
  return {
    tag: "Screen",
    whenToUse: "Root screen container.",
    props: {
      name: {
        type: "string",
        required: true,
        guidance: "Screen name.",
      },
    },
    content: { mode: "children" },
  };
}

function catalog(extraComponents: readonly Record<string, unknown>[] = []): FacetCatalog {
  const result = validateCatalog({
    components: [screenSpec(), component("Text"), ...extraComponents],
  });
  if (!result.ok) {
    throw new Error(`expected catalog acceptance, got ${result.code} at ${result.at}`);
  }
  return result.catalog;
}

function scalar(value: string): { readonly kind: "scalar"; readonly value: string } {
  return Object.freeze({ kind: "scalar" as const, value });
}

function document(hiddenText = "Hidden"): ComponentDocument {
  return Object.freeze({
    entry: "home",
    screens: Object.freeze(["s-home", "s-hidden"]),
    nodes: Object.freeze({
      "s-home": Object.freeze({
        tag: "Screen",
        props: Object.freeze({ name: scalar("home") }),
        children: Object.freeze(["n-visible"]),
      }),
      "n-visible": Object.freeze({
        tag: "Text",
        props: Object.freeze({ value: scalar("Visible") }),
        children: Object.freeze([]),
      }),
      "s-hidden": Object.freeze({
        tag: "Screen",
        props: Object.freeze({ name: scalar("hidden") }),
        children: Object.freeze(["n-hidden"]),
      }),
      "n-hidden": Object.freeze({
        tag: "Text",
        props: Object.freeze({ value: scalar(hiddenText) }),
        children: Object.freeze([]),
      }),
    }),
  });
}

function session(
  input: {
    readonly catalog?: FacetCatalog;
    readonly document?: ComponentDocument | null;
    readonly data?: DataModel;
    readonly stageRevision?: number;
  } = {},
): FacetToolSession {
  return {
    catalog: input.catalog ?? catalog(),
    document: input.document === undefined ? document() : input.document,
    data: input.data ?? {},
    stageRevision: input.stageRevision ?? 7,
    applyAuthorMutation: async (): Promise<AuthorValidationResult> => ({
      ok: false,
      error: {
        code: "invalid-source",
        location: { line: 1, column: 1, offset: 0 },
        cause: "not used",
        repair: "not used",
      },
    }),
    applyTargetedMutation: async (
      _input: FacetTargetedMutationInput,
    ): Promise<FacetTargetedMutationResult> => ({
      ok: false,
      code: "not_used",
      at: "kind",
      detail: "not used",
    }),
    publishData: async (): Promise<PayloadEvaluation> => ({ ok: true, chars: 0 }),
  };
}

function renderedLength(value: unknown): number {
  return JSON.stringify(value).length;
}

describe("buildTurnObservation", () => {
  it("returns a deterministic current-screen observation with no prop schemas or values in summaries", () => {
    const observation = buildTurnObservation(
      session({ data: { rows: [{ name: "Ada", secret: "do-not-include" }] } }),
    );

    expect(observation).toMatchObject({
      stageRevision: 7,
      screens: ["home", "hidden"],
      components: [
        { tag: "Screen", whenToUse: "Root screen container.", contentClass: "Container" },
        { tag: "Text", whenToUse: "Use Text when it fits.", contentClass: "Leaf" },
      ],
      data: [{ path: "rows", shape: "array", fields: ["name", "secret"], count: 1 }],
      issues: [],
    });
    expect(observation.currentScreen?.name).toBe("home");
    expect(observation.currentScreen?.markup).toContain('<Text value="Visible" id="n-visible" />');
    expect(JSON.stringify(observation)).not.toContain("DO_NOT_LEAK_PROP_SCHEMA");
    expect(JSON.stringify(observation)).not.toContain("Ada");
    expect(JSON.stringify(observation)).not.toContain("do-not-include");
  });

  it("derives leaf, container, and structured classes from the content contract", () => {
    const observation = buildTurnObservation(
      session({
        catalog: catalog([
          component("Stack", "Arrange a vertical flow.", { mode: "children" }),
          component("ItemCard", "Arrange named item regions.", {
            mode: "slots",
            slots: {
              content: {
                guidance: "Primary item content.",
                minChildren: 1,
                maxChildren: 4,
                allowedTags: ["Text"],
              },
            },
          }),
        ]),
      }),
    );

    expect(observation.components).toEqual([
      { tag: "Screen", whenToUse: "Root screen container.", contentClass: "Container" },
      { tag: "Text", whenToUse: "Use Text when it fits.", contentClass: "Leaf" },
      { tag: "Stack", whenToUse: "Arrange a vertical flow.", contentClass: "Container" },
      { tag: "ItemCard", whenToUse: "Arrange named item regions.", contentClass: "Structured" },
    ]);
  });

  it("measures unused component scaling in characters and omits detailed contracts", () => {
    const one = buildTurnObservation(session({ catalog: catalog([component("Card")]) }));
    const many = buildTurnObservation(
      session({
        catalog: catalog(
          Array.from({ length: 100 }, (_, index) =>
            component(`Unused${index}`, `Use component ${index}.`),
          ),
        ),
      }),
    );
    const delta = renderedLength(many) - renderedLength(one);

    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThan(8_000);
    expect(JSON.stringify(many)).not.toContain("props");
    expect(JSON.stringify(many)).not.toContain('content":');
    expect(JSON.stringify(many)).not.toContain("DO_NOT_LEAK_PROP_SCHEMA");
  });

  it("does not grow when non-current screen content grows", () => {
    const shortHidden = buildTurnObservation(session({ document: document("x") }));
    const largeHidden = buildTurnObservation(session({ document: document("x".repeat(100)) }));

    expect(renderedLength(largeHidden) - renderedLength(shortHidden)).toBe(0);
    expect(JSON.stringify(largeHidden)).not.toContain("xxxxxxxxxx");
  });

  it("does not grow when published row volume grows", () => {
    const one = buildTurnObservation(session({ data: { rows: [{ name: "Ada" }] } }));
    const many = buildTurnObservation(
      session({
        data: {
          rows: Array.from({ length: 100 }, (_, index) => ({ name: `Name ${index}` })),
        },
      }),
    );

    expect(renderedLength(many) - renderedLength(one)).toBe(0);
    expect(JSON.stringify(many)).not.toContain("Name 99");
  });

  it("returns an explicit no-screen observation", () => {
    expect(buildTurnObservation(session({ document: null }))).toMatchObject({
      currentScreen: null,
      screens: [],
      issues: ["no_current_screen"],
    });
  });
});

describe("formatCatalogIndex", () => {
  it("groups discovery by derived content class in a stable order", () => {
    expect(
      formatCatalogIndex([
        { tag: "Button", whenToUse: "Trigger an action.", contentClass: "Leaf" },
        { tag: "ItemCard", whenToUse: "Arrange named regions.", contentClass: "Structured" },
        { tag: "Text", whenToUse: "Show copy.", contentClass: "Leaf" },
        { tag: "Custom", whenToUse: "Host-specific component.", contentClass: "Leaf" },
        { tag: "Grid", whenToUse: "Arrange a grid.", contentClass: "Container" },
        { tag: "Screen", whenToUse: "Root screen.", contentClass: "Container" },
      ]),
    ).toBe(
      [
        "Leaf:",
        "- Button: Trigger an action.",
        "- Text: Show copy.",
        "- Custom: Host-specific component.",
        "Container:",
        "- Grid: Arrange a grid.",
        "- Screen: Root screen.",
        "Structured:",
        "- ItemCard: Arrange named regions.",
      ].join("\n"),
    );
  });

  it("formats an empty catalog explicitly", () => {
    expect(formatCatalogIndex([])).toBe("- (none)");
  });
});
