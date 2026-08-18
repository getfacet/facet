import type { UiPattern, UiPatternSet } from "@facet/core";

export const UI_PATTERN_RESOURCE_BOUNDS = Object.freeze({
  indexChars: 32_000,
  bodyChars: 24_000,
} as const);

export interface UiPatternSummary {
  readonly id: string;
  readonly title: string;
  readonly whenToUse: string;
}

export type RenderUiPatternResult =
  | { readonly ok: true; readonly body: string }
  | { readonly ok: false; readonly code: "ui-pattern-body-too-large" };

export function projectUiPatternIndex(set: UiPatternSet): readonly UiPatternSummary[] {
  const index = Object.freeze(
    set.patterns.map(({ id, title, whenToUse }) => Object.freeze({ id, title, whenToUse })),
  );
  if (JSON.stringify(index).length > UI_PATTERN_RESOURCE_BOUNDS.indexChars) {
    return Object.freeze([]);
  }
  return index;
}

export function findUiPattern(set: UiPatternSet, id: string): UiPattern | null {
  return set.patterns.find((pattern) => pattern.id === id) ?? null;
}

function bullets(values: readonly string[]): string {
  return values.map((value) => `- ${value}`).join("\n");
}

/** Renders one already-validated pattern as bounded agent authoring guidance. */
export function renderUiPatternForAgent(pattern: UiPattern): RenderUiPatternResult {
  const regions = pattern.regions
    .map((region) => `- ${region.id}: ${region.purpose}\n  Relationship: ${region.relationship}`)
    .join("\n");
  const componentChoices = pattern.componentChoices
    .map(
      (choice) =>
        `- When: ${choice.whenToUse}\n  Candidates: ${choice.tags.join(", ")}\n  Why: ${choice.rationale}`,
    )
    .join("\n");
  const variants = pattern.variants
    .map(
      (variant) =>
        `Variant ${variant.id}:\nUse when: ${variant.whenToUse}\nComposition: ${variant.composition}\nExample Facet tree:\n${variant.exampleMarkup}`,
    )
    .join("\n\n");
  const body = [
    `UI Pattern: ${pattern.title} (${pattern.id})`,
    `Use when:\n- ${pattern.whenToUse}`,
    `Avoid when:\n${bullets(pattern.avoidWhen)}`,
    `Information order:\n${bullets(pattern.informationOrder)}`,
    `Regions:\n${regions}`,
    `Component choices:\n${componentChoices}`,
    `Variants:\n${variants}`,
    `Avoid:\n${bullets(pattern.avoid)}`,
    "Adapt the pattern to the current UI Brief, verified data, and available catalog. The examples are alternative references, not fixed templates. Read each selected component's full active spec before authoring it.",
  ].join("\n\n");
  if (body.length > UI_PATTERN_RESOURCE_BOUNDS.bodyChars) {
    return { ok: false, code: "ui-pattern-body-too-large" };
  }
  return { ok: true, body };
}
