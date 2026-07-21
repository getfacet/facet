import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  BRICK_CONTRACT,
  BRICK_TYPES,
  type BrickStylePropertyContract,
  type BrickStyleTargetContract,
  type BrickType,
} from "./brick-contract.js";
import type {
  BoxStyle,
  BrickActiveStyle,
  BrickStyle,
  BrickStyleByType,
  BrickStyleDefinition,
  ChartStyle,
  InputStyle,
  KeyValueStyle,
  ListStyle,
  LoadingStyle,
  MediaStyle,
  ProgressStyle,
  RichTextStyle,
  TableStyle,
  TextStyle,
} from "./style-types.js";

const FINAL_BRICKS = [
  "box",
  "text",
  "media",
  "input",
  "richtext",
  "table",
  "chart",
  "list",
  "keyValue",
  "progress",
  "loading",
] as const;

const EXPECTED_FIELDS = {
  box: [
    "id",
    "type",
    "children",
    "onPress",
    "onHold",
    "hidden",
    "backdrop",
    "overlay",
    "activeWhen",
  ],
  text: ["id", "type", "value", "from", "column", "row", "activeWhen"],
  media: ["id", "type", "kind", "src", "icon", "alt", "poster", "controls"],
  input: ["id", "type", "name", "input", "options", "label", "placeholder"],
  richtext: ["id", "type", "blocks"],
  table: ["id", "type", "columns", "rows", "caption", "from"],
  chart: ["id", "type", "kind", "series", "labels", "title", "from"],
  list: ["id", "type", "items", "from"],
  keyValue: ["id", "type", "items", "from"],
  progress: ["id", "type", "value", "label"],
  loading: ["id", "type", "label"],
} as const satisfies Record<BrickType, readonly string[]>;

type Domain = `token:${string}` | `fixed:${string}`;

const typography = {
  fontFamily: "token:fontFamily",
  fontSize: "token:fontSize",
  fontWeight: "token:fontWeight",
  fontStyle: "fixed:fontStyle",
  color: "token:color",
  textAlign: "fixed:textAlign",
  letterSpacing: "token:letterSpacing",
  lineHeight: "token:lineHeight",
} as const;

const textFlow = {
  textWrap: "fixed:textWrap",
  lineClamp: "fixed:lineClamp",
} as const;

const flowTypography = {
  ...typography,
  ...textFlow,
} as const;

const EXPECTED_STYLE_PATHS = {
  box: {
    direction: "fixed:direction",
    gap: "token:space",
    padding: "token:space",
    alignItems: "fixed:alignment",
    justifyContent: "fixed:justification",
    wrap: "fixed:boolean",
    columns: "fixed:columns",
    grow: "fixed:boolean",
    width: "fixed:width",
    minHeight: "token:minHeight",
    maxWidth: "token:maxWidth",
    scroll: "fixed:scroll",
    sticky: "fixed:boolean",
    background: "token:color",
    color: "token:color",
    backgroundGradient: "token:gradient",
    borderColor: "token:color",
    borderWidth: "token:borderWidth",
    borderRadius: "token:radius",
    shadow: "token:shadow",
    backdropScrim: "token:scrim",
    enterAnimation: "fixed:enterAnimation",
  },
  text: { ...flowTypography, highlight: "token:highlight" },
  media: {
    width: "fixed:width",
    aspectRatio: "token:aspectRatio",
    objectFit: "fixed:objectFit",
    objectPosition: "fixed:objectPosition",
    iconSize: "token:indicatorSize",
    padding: "token:space",
    background: "token:color",
    color: "token:color",
    borderColor: "token:color",
    borderWidth: "token:borderWidth",
    borderRadius: "token:radius",
  },
  input: {
    width: "fixed:width",
    direction: "fixed:direction",
    gap: "token:space",
    alignItems: "fixed:alignment",
    "label.fontFamily": "token:fontFamily",
    "label.fontSize": "token:fontSize",
    "label.fontWeight": "token:fontWeight",
    "label.fontStyle": "fixed:fontStyle",
    "label.color": "token:color",
    "label.textAlign": "fixed:textAlign",
    "label.letterSpacing": "token:letterSpacing",
    "label.lineHeight": "token:lineHeight",
    "control.fontFamily": "token:fontFamily",
    "control.fontSize": "token:fontSize",
    "control.fontWeight": "token:fontWeight",
    "control.fontStyle": "fixed:fontStyle",
    "control.color": "token:color",
    "control.textAlign": "fixed:textAlign",
    "control.letterSpacing": "token:letterSpacing",
    "control.lineHeight": "token:lineHeight",
    "control.padding": "token:space",
    "control.controlHeight": "token:controlHeight",
    "control.background": "token:color",
    "control.borderColor": "token:color",
    "control.borderWidth": "token:borderWidth",
    "control.borderRadius": "token:radius",
    "control.shadow": "token:shadow",
    "placeholder.color": "token:color",
    "placeholder.fontStyle": "fixed:fontStyle",
    "indicator.color": "token:color",
    "indicator.background": "token:color",
    "indicator.borderColor": "token:color",
    "indicator.borderWidth": "token:borderWidth",
    "indicator.borderRadius": "token:radius",
    "indicator.indicatorSize": "token:indicatorSize",
    "option.gap": "token:space",
    "option.fontFamily": "token:fontFamily",
    "option.fontSize": "token:fontSize",
    "option.fontWeight": "token:fontWeight",
    "option.fontStyle": "fixed:fontStyle",
    "option.color": "token:color",
    "option.textAlign": "fixed:textAlign",
    "option.letterSpacing": "token:letterSpacing",
    "option.lineHeight": "token:lineHeight",
  },
  richtext: {
    ...flowTypography,
    blockGap: "token:space",
    ...Object.fromEntries(
      ["heading1", "heading2", "heading3"].flatMap((target) =>
        Object.entries(typography).map(([property, domain]) => [`${target}.${property}`, domain]),
      ),
    ),
    "quote.fontFamily": "token:fontFamily",
    "quote.fontSize": "token:fontSize",
    "quote.fontWeight": "token:fontWeight",
    "quote.fontStyle": "fixed:fontStyle",
    "quote.color": "token:color",
    "quote.textAlign": "fixed:textAlign",
    "quote.letterSpacing": "token:letterSpacing",
    "quote.lineHeight": "token:lineHeight",
    "quote.background": "token:color",
    "quote.padding": "token:space",
    "quote.borderColor": "token:color",
    "quote.borderWidth": "token:borderWidth",
    "code.fontFamily": "token:fontFamily",
    "code.fontSize": "token:fontSize",
    "code.fontWeight": "token:fontWeight",
    "code.fontStyle": "fixed:fontStyle",
    "code.color": "token:color",
    "code.textAlign": "fixed:textAlign",
    "code.letterSpacing": "token:letterSpacing",
    "code.lineHeight": "token:lineHeight",
    "code.background": "token:color",
    "code.padding": "token:space",
    "code.borderRadius": "token:radius",
    "link.fontFamily": "token:fontFamily",
    "link.fontSize": "token:fontSize",
    "link.fontWeight": "token:fontWeight",
    "link.fontStyle": "fixed:fontStyle",
    "link.color": "token:color",
    "link.textAlign": "fixed:textAlign",
    "link.letterSpacing": "token:letterSpacing",
    "link.lineHeight": "token:lineHeight",
    "link.highlight": "token:highlight",
    "listMarker.color": "token:color",
    "listMarker.fontSize": "token:fontSize",
    "listMarker.fontWeight": "token:fontWeight",
  },
  table: {
    width: "fixed:width",
    background: "token:color",
    color: "token:color",
    borderColor: "token:color",
    borderWidth: "token:borderWidth",
    borderRadius: "token:radius",
    shadow: "token:shadow",
    ...Object.fromEntries(Object.entries(flowTypography).map(([p, d]) => [`caption.${p}`, d])),
    "caption.padding": "token:space",
    "caption.background": "token:color",
    ...Object.fromEntries(Object.entries(flowTypography).map(([p, d]) => [`header.${p}`, d])),
    "header.padding": "token:space",
    "header.background": "token:color",
    "header.borderColor": "token:color",
    "header.borderWidth": "token:borderWidth",
    "row.background": "token:color",
    "row.color": "token:color",
    "row.borderColor": "token:color",
    "row.borderWidth": "token:borderWidth",
    ...Object.fromEntries(Object.entries(flowTypography).map(([p, d]) => [`cell.${p}`, d])),
    "cell.padding": "token:space",
    "cell.borderColor": "token:color",
    "cell.borderWidth": "token:borderWidth",
  },
  chart: {
    width: "fixed:width",
    gap: "token:space",
    padding: "token:space",
    background: "token:color",
    borderColor: "token:color",
    borderWidth: "token:borderWidth",
    borderRadius: "token:radius",
    shadow: "token:shadow",
    ...Object.fromEntries(Object.entries(typography).map(([p, d]) => [`title.${p}`, d])),
    "plot.background": "token:color",
    "plot.borderColor": "token:color",
    "plot.borderWidth": "token:borderWidth",
    "plot.borderRadius": "token:radius",
    "plot.axisColor": "token:color",
    "plot.gridColor": "token:color",
    "plot.labelColor": "token:color",
    "series.color1": "token:color",
    "series.color2": "token:color",
    "series.color3": "token:color",
    "series.color4": "token:color",
    "series.color5": "token:color",
    "series.color6": "token:color",
    "series.thickness": "token:chartThickness",
  },
  list: {
    gap: "token:space",
    padding: "token:space",
    background: "token:color",
    color: "token:color",
    borderColor: "token:color",
    borderWidth: "token:borderWidth",
    borderRadius: "token:radius",
    "item.gap": "token:space",
    "item.padding": "token:space",
    "item.background": "token:color",
    "item.borderColor": "token:color",
    "item.borderWidth": "token:borderWidth",
    "item.borderRadius": "token:radius",
    ...Object.fromEntries(
      ["title", "body"].flatMap((target) =>
        Object.entries(flowTypography).map(([p, d]) => [`${target}.${p}`, d]),
      ),
    ),
    "marker.color": "token:color",
    "marker.fontSize": "token:fontSize",
    "marker.fontWeight": "token:fontWeight",
  },
  keyValue: {
    gap: "token:space",
    padding: "token:space",
    background: "token:color",
    color: "token:color",
    borderColor: "token:color",
    borderWidth: "token:borderWidth",
    borderRadius: "token:radius",
    "item.gap": "token:space",
    "item.padding": "token:space",
    "item.background": "token:color",
    "item.borderColor": "token:color",
    "item.borderWidth": "token:borderWidth",
    ...Object.fromEntries(
      ["label", "value"].flatMap((target) =>
        Object.entries(typography).map(([p, d]) => [`${target}.${p}`, d]),
      ),
    ),
  },
  progress: {
    width: "fixed:width",
    gap: "token:space",
    ...Object.fromEntries(Object.entries(typography).map(([p, d]) => [`label.${p}`, d])),
    "track.background": "token:color",
    "track.height": "token:progressThickness",
    "track.borderColor": "token:color",
    "track.borderWidth": "token:borderWidth",
    "track.borderRadius": "token:radius",
    "fill.background": "token:color",
    "fill.backgroundGradient": "token:gradient",
    "fill.borderRadius": "token:radius",
  },
  loading: {
    direction: "fixed:direction",
    gap: "token:space",
    alignItems: "fixed:alignment",
    "indicator.size": "token:indicatorSize",
    "indicator.color": "token:color",
    "indicator.animation": "fixed:animation",
    ...Object.fromEntries(Object.entries(typography).map(([p, d]) => [`label.${p}`, d])),
  },
} as const satisfies Record<BrickType, Record<string, Domain>>;

function flattenedStylePaths(brick: BrickType): Record<string, Domain> {
  const { root, targets } = BRICK_CONTRACT[brick].style;
  return Object.fromEntries([
    ...Object.entries(root.properties).map(([name, value]) => [
      name,
      `${value.source}:${value.domain}`,
    ]),
    ...(Object.entries(targets) as [string, BrickStyleTargetContract][]).flatMap(
      ([target, contract]) =>
        (Object.entries(contract.properties) as [string, BrickStylePropertyContract][]).map(
          ([name, value]) => [`${target}.${name}`, `${value.source}:${value.domain}`],
        ),
    ),
  ]) as Record<string, Domain>;
}

describe("Core Brick contract", () => {
  it("locks Brick discovery fields and every owned style path", () => {
    expect(BRICK_TYPES).toEqual(FINAL_BRICKS);
    expect(Object.keys(BRICK_CONTRACT)).toEqual(FINAL_BRICKS);
    expectTypeOf<BrickType>().toEqualTypeOf<(typeof FINAL_BRICKS)[number]>();

    for (const brick of BRICK_TYPES) {
      const contract = BRICK_CONTRACT[brick];
      expect(contract.name).toBe(brick);
      expect(contract.description.length).toBeGreaterThan(12);
      expect(contract.useWhen.length).toBeGreaterThan(12);
      expect(Object.keys(contract.fields)).toEqual(EXPECTED_FIELDS[brick]);
      expect(flattenedStylePaths(brick)).toEqual(EXPECTED_STYLE_PATHS[brick]);
      const targets = [
        contract.style.root,
        ...(Object.values(contract.style.targets) as BrickStyleTargetContract[]),
      ];
      for (const target of targets) {
        for (const property of Object.values(target.properties) as BrickStylePropertyContract[]) {
          expect(property.description.length).toBeGreaterThan(8);
          expect(property.useWhen.length).toBeGreaterThan(8);
        }
      }
    }

    expect(BRICK_CONTRACT.box.supportsActiveWhen).toBe(true);
    expect(BRICK_CONTRACT.text.supportsActiveWhen).toBe(true);
    for (const brick of BRICK_TYPES.filter((name) => name !== "box" && name !== "text")) {
      expect(BRICK_CONTRACT[brick].supportsActiveWhen).toBe(false);
    }

    expect(BRICK_CONTRACT.input.style.targets.indicator.applicableTo).toEqual([
      "checkbox",
      "radio",
      "switch",
    ]);
    expect(BRICK_CONTRACT.input.style.targets.option.applicableTo).toEqual(["radio", "select"]);
    expect(BRICK_CONTRACT.input.style.targets.placeholder.applicableTo).toEqual([
      "text",
      "number",
      "email",
      "password",
      "search",
      "select",
    ]);
  });

  it("keeps target/state ownership local and excludes escape hatches", () => {
    const serialized = JSON.stringify(BRICK_CONTRACT);
    expect(() => JSON.parse(serialized)).not.toThrow();
    const authoredPaths = BRICK_TYPES.flatMap((brick) =>
      Object.keys(flattenedStylePaths(brick)).map((path) => path.split(".").at(-1)),
    );
    for (const forbidden of [
      "position",
      "inset",
      "zIndex",
      "margin",
      "transform",
      "opacity",
      "selector",
      "css",
    ]) {
      expect(authoredPaths).not.toContain(forbidden);
    }
    expect(BRICK_CONTRACT.box.style.root.states).toEqual({
      hover: ["background", "color", "borderColor", "shadow"],
      pressed: ["background", "color", "borderColor", "shadow"],
      focus: ["borderColor", "borderWidth", "shadow"],
    });
    expect(BRICK_CONTRACT.table.style.targets.header.states).toEqual({
      hover: ["background", "color", "borderColor"],
      pressed: ["background", "color", "borderColor"],
      focus: ["borderColor", "borderWidth"],
      sorted: ["background", "color", "fontWeight"],
    });
    expect(BRICK_CONTRACT.table.style.targets.row.states).toEqual({
      alternate: ["background", "color", "borderColor", "borderWidth"],
      hover: ["background", "color", "borderColor", "borderWidth"],
    });

    const source = readFileSync(new URL("./brick-contract.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/^import\b/m);
    expect(source).not.toContain('from "./nodes.js"');
    expect(source).not.toContain('from "./index.js"');
  });

  it("exports parity-checked style roles without recursive active state", () => {
    expectTypeOf<BrickStyleByType>().toMatchTypeOf<Record<BrickType, object>>();
    expectTypeOf<BrickStyle<"box">>().toEqualTypeOf<BoxStyle>();
    expectTypeOf<BrickStyle<"text">>().toEqualTypeOf<TextStyle>();
    expectTypeOf<BrickStyle<"media">>().toEqualTypeOf<MediaStyle>();
    expectTypeOf<BrickStyle<"input">>().toEqualTypeOf<InputStyle>();
    expectTypeOf<BrickStyle<"richtext">>().toEqualTypeOf<RichTextStyle>();
    expectTypeOf<BrickStyle<"table">>().toEqualTypeOf<TableStyle>();
    expectTypeOf<BrickStyle<"chart">>().toEqualTypeOf<ChartStyle>();
    expectTypeOf<BrickStyle<"list">>().toEqualTypeOf<ListStyle>();
    expectTypeOf<BrickStyle<"keyValue">>().toEqualTypeOf<KeyValueStyle>();
    expectTypeOf<BrickStyle<"progress">>().toEqualTypeOf<ProgressStyle>();
    expectTypeOf<BrickStyle<"loading">>().toEqualTypeOf<LoadingStyle>();
    expectTypeOf<keyof BrickActiveStyle<"box">>().not.toEqualTypeOf<keyof BoxStyle>();
    expectTypeOf<BrickStyleDefinition<"box">>().not.toHaveProperty("preset");
    expectTypeOf<BrickActiveStyle<"box">>().not.toHaveProperty("active");
    expectTypeOf<BrickActiveStyle<"box">>().not.toHaveProperty("hover");
  });

  it("supports Preset-only, direct, and Preset-plus-direct styles for all eleven Bricks", () => {
    const presetOnly: BrickStyleByType = {
      box: { preset: "boxPreset" },
      text: { preset: "textPreset" },
      media: { preset: "mediaPreset" },
      input: { preset: "inputPreset" },
      richtext: { preset: "richtextPreset" },
      table: { preset: "tablePreset" },
      chart: { preset: "chartPreset" },
      list: { preset: "listPreset" },
      keyValue: { preset: "keyValuePreset" },
      progress: { preset: "progressPreset" },
      loading: { preset: "loadingPreset" },
    };
    const direct: BrickStyleByType = {
      box: { gap: "md" },
      text: { fontSize: "md" },
      media: { width: "full" },
      input: { gap: "sm" },
      richtext: { blockGap: "md" },
      table: { width: "full" },
      chart: { gap: "md" },
      list: { gap: "md" },
      keyValue: { gap: "md" },
      progress: { gap: "sm" },
      loading: { gap: "sm" },
    };
    const combined: BrickStyleByType = {
      box: { preset: "boxPreset", gap: "md" },
      text: { preset: "textPreset", fontSize: "md" },
      media: { preset: "mediaPreset", width: "full" },
      input: { preset: "inputPreset", gap: "sm" },
      richtext: { preset: "richtextPreset", blockGap: "md" },
      table: { preset: "tablePreset", width: "full" },
      chart: { preset: "chartPreset", gap: "md" },
      list: { preset: "listPreset", gap: "md" },
      keyValue: { preset: "keyValuePreset", gap: "md" },
      progress: { preset: "progressPreset", gap: "sm" },
      loading: { preset: "loadingPreset", gap: "sm" },
    };

    expect(Object.keys(presetOnly)).toEqual(FINAL_BRICKS);
    expect(Object.keys(direct)).toEqual(FINAL_BRICKS);
    expect(Object.keys(combined)).toEqual(FINAL_BRICKS);
  });
});
