import {
  ASPECT_RATIOS,
  BORDER_WIDTHS,
  BRICK_CONTRACT,
  BRICK_TYPES,
  CHART_THICKNESSES,
  COLORS,
  CONTROL_HEIGHTS,
  FONT_FAMILIES,
  FONT_SIZES,
  FONT_WEIGHTS,
  GRADIENTS,
  HIGHLIGHTS,
  INDICATOR_SIZES,
  LAYOUT_WIDTHS,
  LETTER_SPACINGS,
  LINE_HEIGHTS,
  MAX_HEIGHTS,
  MAX_PATTERNS,
  MAX_WIDTHS,
  MIN_HEIGHTS,
  PROGRESS_THICKNESSES,
  RADII,
  SCRIMS,
  SHADOWS,
  SPACES,
  validateTheme,
  type FacetPattern,
  type FacetTheme,
} from "@facet/core";
import { describe, expect, it } from "vitest";
import { createStageToolAssetSnapshot } from "./asset-snapshot.js";

const map = <K extends string, V>(keys: readonly K[], value: (key: K) => V): Record<K, V> =>
  Object.fromEntries(keys.map((key) => [key, value(key)])) as Record<K, V>;

function testTheme(): FacetTheme {
  const defaults = Object.fromEntries(
    BRICK_TYPES.map((brick) => [
      brick,
      Object.fromEntries(
        Object.keys(BRICK_CONTRACT[brick].style.targets).map((target) => [target, {}]),
      ),
    ]),
  );
  const paint = {
    color: map(COLORS, (name) => (name === "inherit" ? "inherit" : "#123456")),
    shadow: map(SHADOWS, (name) => (name === "none" ? "none" : "0 1px 2px rgba(0, 0, 0, 0.25)")),
    gradient: map(GRADIENTS, (name) =>
      name === "none" ? "none" : "linear-gradient(90deg, #000000 0%, #ffffff 100%)",
    ),
    scrim: map(SCRIMS, (name) => (name === "none" ? "transparent" : "rgba(0, 0, 0, 0.5)")),
    highlight: map(HIGHLIGHTS, (name) =>
      name === "none" ? "none" : "linear-gradient(90deg, #ffff00 0%, #ffff00 100%)",
    ),
  };
  return {
    name: "complete",
    description: "A complete test Theme.",
    tokens: {
      space: map(SPACES, () => "16px"),
      fontSize: map(FONT_SIZES, () => "16px"),
      fontFamily: map(FONT_FAMILIES, () => "sans-serif"),
      fontWeight: map(FONT_WEIGHTS, () => 400),
      radius: map(RADII, () => "8px"),
      borderWidth: map(BORDER_WIDTHS, () => "1px"),
      aspectRatio: map(ASPECT_RATIOS, (name) => (name === "auto" ? "auto" : "1 / 1")),
      minHeight: map(MIN_HEIGHTS, (name) => (name === "auto" ? "auto" : "100px")),
      maxWidth: map(MAX_WIDTHS, (name) => (name === "none" ? "none" : "100px")),
      layoutWidth: map(LAYOUT_WIDTHS, () => "100px"),
      maxHeight: map(MAX_HEIGHTS, (name) => (name === "none" ? "none" : "100px")),
      letterSpacing: map(LETTER_SPACINGS, () => "0"),
      lineHeight: map(LINE_HEIGHTS, () => "1.5"),
      controlHeight: map(CONTROL_HEIGHTS, () => "32px"),
      indicatorSize: map(INDICATOR_SIZES, () => "16px"),
      progressThickness: map(PROGRESS_THICKNESSES, () => "4px"),
      chartThickness: map(CHART_THICKNESSES, () => "2px"),
      paint: { light: structuredClone(paint), dark: structuredClone(paint) },
    },
    defaults: defaults as unknown as FacetTheme["defaults"],
    presets: {
      box: {
        panel: {
          description: "Reusable panel treatment.",
          useWhen: "Use for a distinct content surface.",
          style: { gap: "md", background: "surface" },
        },
      },
      text: {
        heading: {
          description: "Readable heading treatment.",
          useWhen: "Use for a section heading.",
          style: { fontSize: "xl", fontWeight: "bold" },
        },
      },
    },
  };
}

function pattern(name = "notice"): FacetPattern {
  return {
    name,
    description: "A compact notice with a heading and body.",
    useWhen: "Use when one concise status needs emphasis.",
    avoidWhen: "Avoid for dense multi-section content.",
    root: "root",
    nodes: {
      root: {
        id: "root",
        type: "box",
        style: { preset: "panel" },
        children: ["title"],
      },
      title: {
        id: "title",
        type: "text",
        value: "Ready",
        style: { preset: "heading" },
      },
    },
  };
}

function expectDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value)) expectDeepFrozen(nested, seen);
}

describe("complete theme fixture", () => {
  it("validates with no error issues after the required layout token groups widened", () => {
    const { theme, issues } = validateTheme(testTheme());
    expect(theme).toBeDefined();
    expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });
});

describe("createStageToolAssetSnapshot", () => {
  it("freezes one exact Theme Preset Pattern snapshot", () => {
    const theme = testTheme();
    const sourcePattern = pattern();
    const originalAccent = theme.tokens.paint.light.color.accent;

    const snapshot = createStageToolAssetSnapshot({ theme, patterns: [sourcePattern] });

    expect(snapshot.theme).toEqual(testTheme());
    expect(snapshot.theme).not.toBe(theme);
    expect(snapshot.patterns).toEqual([sourcePattern]);
    expect(snapshot.patterns[0]).not.toBe(sourcePattern);
    expect(snapshot.brickIndex.map(({ type }) => type)).toEqual(BRICK_TYPES);
    expect(snapshot.patternIndex).toEqual([
      {
        name: "notice",
        description: sourcePattern.description,
        useWhen: sourcePattern.useWhen,
      },
    ]);
    expect(snapshot.presetIndex).toContainEqual({
      brick: "box",
      name: "panel",
      description: testTheme().presets?.box?.panel?.description,
      useWhen: testTheme().presets?.box?.panel?.useWhen,
    });
    expectDeepFrozen(snapshot);

    (theme.tokens.paint.light.color as Record<string, string>).accent = "#ffffff";
    (sourcePattern.nodes.title as { value: string }).value = "mutated";
    expect(snapshot.theme.tokens.paint.light.color.accent).toBe(originalAccent);
    expect(snapshot.patterns[0]?.nodes.title).toMatchObject({ value: "Ready" });

    const agentVisible = JSON.stringify({
      bricks: snapshot.brickIndex,
      presets: snapshot.presetIndex,
      patterns: snapshot.patternIndex,
    });
    expect(agentVisible).not.toContain(originalAccent);
    expect(agentVisible).not.toMatch(/(?:px|rem|#[0-9a-f]{3,8}|rgba?\()/i);
  });

  it("derives exact bounded indexes from the effective Theme and compatible Patterns", () => {
    const incompatible = structuredClone(pattern("hidden")) as unknown as {
      nodes: { root: { style?: { preset: string } } };
    };
    incompatible.nodes.root.style = { preset: "missing" };
    const duplicate = pattern("notice");

    const snapshot = createStageToolAssetSnapshot({
      theme: testTheme(),
      patterns: [pattern(), incompatible as unknown as FacetPattern, duplicate],
    });

    expect(snapshot.patterns.map(({ name }) => name)).toEqual(["notice"]);
    expect(snapshot.patternIndex.map(({ name }) => name)).toEqual(["notice"]);
    expect(new Set(snapshot.presetIndex.map(({ brick, name }) => `${brick}:${name}`)).size).toBe(
      snapshot.presetIndex.length,
    );
  });

  it("rejects an invalid Theme and exposes no over-cap Pattern tail", () => {
    const invalidTheme = testTheme();
    delete (invalidTheme.tokens as unknown as Record<string, unknown>)["space"];

    expect(() => createStageToolAssetSnapshot({ theme: invalidTheme, patterns: [] })).toThrowError(
      /Theme/i,
    );

    const overCap = Array.from({ length: MAX_PATTERNS + 1 }, (_, index) =>
      pattern(`notice-${String(index)}`),
    );
    const snapshot = createStageToolAssetSnapshot({ theme: testTheme(), patterns: overCap });
    expect(snapshot.patterns).toEqual([]);
    expect(snapshot.patternIndex).toEqual([]);
  });
});
