import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validatePattern, type FacetPattern } from "@facet/core";
import { DEFAULT_THEME } from "./theme.js";

const moduleUrl = new URL("./patterns.ts", import.meta.url);
const sourceUrls = [
  moduleUrl,
  new URL("./pattern-marketing.ts", import.meta.url),
  new URL("./pattern-product.ts", import.meta.url),
  new URL("./pattern-controls.ts", import.meta.url),
  new URL("./pattern-containers.ts", import.meta.url),
  new URL("./pattern-chart-table.ts", import.meta.url),
];

const EXPECTED_NAMES = [
  "hero",
  "card",
  "section",
  "cta-button",
  "form",
  "fixed-filter",
  "metric",
  "tabs",
  "nav",
  "pricing-section",
  "faq-section",
  "dashboard-summary",
  "settings-panel",
  "feature-grid",
  "empty-state",
  "support-triage",
  "chart-table-view",
] as const;

const RETIRED_STYLE_KEYS = new Set([
  ["active", "Style"].join(""),
  ["active", "Variant"].join(""),
  "align",
  "bg",
  "border",
  "pad",
  "radius",
  "size",
  "variant",
  "weight",
]);

const ACTION_BOX_PRESETS = ["primaryAction", "secondaryAction"] as const;
const ACTIVE_LAYER_KEY = "active";

type ActionBoxPreset = (typeof ACTION_BOX_PRESETS)[number];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isActionBoxPreset = (value: unknown): value is ActionBoxPreset =>
  typeof value === "string" && ACTION_BOX_PRESETS.includes(value as ActionBoxPreset);

const actionPresetFromStyle = (style: unknown): ActionBoxPreset | undefined => {
  if (!isRecord(style)) return undefined;
  if (isActionBoxPreset(style.preset)) return style.preset;

  const activeLayer = style[ACTIVE_LAYER_KEY];
  if (isRecord(activeLayer) && isActionBoxPreset(activeLayer.preset)) return activeLayer.preset;
  return undefined;
};

const collectKeys = (value: unknown): readonly string[] => {
  if (Array.isArray(value)) return value.flatMap((entry) => collectKeys(entry));
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, entry]) => [key, ...collectKeys(entry)]);
};

async function loadDefaults(): Promise<readonly FacetPattern[]> {
  expect(existsSync(fileURLToPath(moduleUrl)), "patterns.ts must exist").toBe(true);
  const { DEFAULT_PATTERNS } = await import("./patterns.js");
  return DEFAULT_PATTERNS;
}

describe("DEFAULT_PATTERNS", () => {
  it("ships styled compatible Patterns", async () => {
    const patterns = await loadDefaults();
    expect(patterns.map((pattern) => pattern.name)).toEqual(EXPECTED_NAMES);

    for (const pattern of patterns) {
      const result = validatePattern(pattern, DEFAULT_THEME);
      expect(result.issues, pattern.name).toEqual([]);
      expect(result.pattern, pattern.name).toEqual(pattern);
      expect(pattern.description.trim(), pattern.name).not.toBe("");
      expect(pattern.useWhen.trim(), pattern.name).not.toBe("");

      const nodeIds = Object.keys(pattern.nodes);
      expect(nodeIds.length, pattern.name).toBeGreaterThan(0);
      expect(
        nodeIds.every((id) => id.startsWith(pattern.name)),
        pattern.name,
      ).toBe(true);
      expect(pattern.root.startsWith(pattern.name), pattern.name).toBe(true);

      const keys = collectKeys(pattern.nodes);
      for (const retired of RETIRED_STYLE_KEYS) {
        expect(keys, `${pattern.name}:${retired}`).not.toContain(retired);
      }
    }
  });

  it("keeps repeatable Brick roles in Presets and direct style limited to structure", async () => {
    const patterns = new Map((await loadDefaults()).map((pattern) => [pattern.name, pattern]));

    expect(patterns.get("hero")?.nodes["hero.root"]?.style).toMatchObject({
      gap: "md",
      padding: "lg",
      width: "full",
    });
    expect(patterns.get("hero")?.nodes["hero.title"]?.style).toEqual({ preset: "heading" });
    expect(patterns.get("hero")?.nodes["hero.cta"]?.style).toEqual({
      preset: "primaryAction",
    });

    expect(patterns.get("pricing-section")?.nodes["pricing-section.starter"]?.style).toEqual({
      preset: "panel",
    });
    expect(patterns.get("dashboard-summary")?.nodes["dashboard-summary.badge"]?.style).toEqual({
      preset: "successBadge",
    });
    expect(patterns.get("settings-panel")?.nodes["settings-panel.email"]?.style).toEqual({
      preset: "standard",
    });
  });

  it("keeps full-width Pattern actions explicit", async () => {
    const patterns = await loadDefaults();
    const implicitFullWidthActions: string[] = [];
    const actionIds: string[] = [];

    for (const pattern of patterns) {
      for (const node of Object.values(pattern.nodes)) {
        if (node.type !== "box") continue;

        const style = node.style;
        const preset = actionPresetFromStyle(style);
        if (!preset) continue;

        actionIds.push(`${pattern.name}:${node.id}`);
        if (isRecord(style) && style.width === "full") continue;
        if (DEFAULT_THEME.presets?.box?.[preset]?.style.width === "full") {
          implicitFullWidthActions.push(`${pattern.name}:${node.id}`);
        }
      }
    }

    expect(actionIds.length).toBeGreaterThan(0);
    expect(implicitFullWidthActions).toEqual([]);
  });

  it("keeps examples illustrative and explicitly tells agents to adapt them", async () => {
    const patterns = await loadDefaults();
    for (const name of [
      "hero",
      "pricing-section",
      "faq-section",
      "dashboard-summary",
      "settings-panel",
      "feature-grid",
      "support-triage",
    ]) {
      const pattern = patterns.find((candidate) => candidate.name === name);
      expect(pattern, name).toBeDefined();
      expect(`${pattern?.description} ${pattern?.useWhen} ${pattern?.avoidWhen}`).toMatch(/adapt/i);
    }

    expect(patterns.find((pattern) => pattern.name === "hero")?.nodes["hero.title"]).toMatchObject({
      type: "text",
      value: "Ship polished interfaces in minutes",
    });
    expect(
      patterns.find((pattern) => pattern.name === "pricing-section")?.nodes[
        "pricing-section.starter-price-value"
      ],
    ).toMatchObject({ type: "text", value: "$19" });
    expect(
      patterns.find((pattern) => pattern.name === "support-triage")?.nodes["support-triage.submit"],
    ).toMatchObject({
      type: "box",
      onPress: { kind: "agent", name: "submit_support", collect: "support-triage.root" },
    });
  });

  it("uses only data-only Pattern modules and no tone-only Pattern variants", async () => {
    const patterns = await loadDefaults();
    const names = patterns.map((pattern) => pattern.name);
    expect(names.some((name) => name.startsWith("badge"))).toBe(false);
    expect(names.some((name) => name.startsWith("alert"))).toBe(false);

    const source = sourceUrls.map((url) => readFileSync(url, "utf8")).join("\n");
    expect(source).not.toMatch(/\bfrom\s+["'](?:node:|@facet\/(react|runtime|server|client))\b/);
    expect(source).not.toContain("{{");
  });
});
