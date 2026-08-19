import { readFileSync } from "node:fs";

import { BOUNDS, validateComponentSpec } from "@facet/core";
import type { ComponentSpec } from "@facet/core";
import { describe, expect, it } from "vitest";

import {
  AVATAR_SPEC,
  BADGE_SPEC,
  CHART_SPEC,
  CONTENT_SPECS,
  ICON_SPEC,
  IMAGE_SPEC,
  LIST_SPEC,
  METRIC_GROUP_SPEC,
  METRIC_SPEC,
  PROGRESS_SPEC,
  TABLE_SPEC,
  TEXT_SPEC,
  TIMELINE_SPEC,
} from "./specs-content.js";

const CONTENT_TAGS = [
  "Text",
  "Avatar",
  "Icon",
  "Image",
  "Badge",
  "Metric",
  "MetricGroup",
  "Table",
  "Chart",
  "Progress",
  "Timeline",
  "List",
] as const;

const EXPECTED_PROPS = {
  Text: {
    value: { type: "string", required: true, bindable: true },
    variant: { type: "string", enum: ["title", "heading", "body", "caption"], default: "body" },
    tone: { type: "string", enum: ["default", "muted"], default: "default" },
  },
  Avatar: {
    label: { type: "string", required: true },
    initials: { type: "string" },
    size: { type: "string", enum: ["sm", "md", "lg"], default: "md" },
    tone: { type: "string", enum: ["neutral", "accent", "warm", "cool"], default: "accent" },
  },
  Icon: {
    name: { type: "string", required: true },
    label: { type: "string" },
    size: { type: "string", enum: ["sm", "md", "lg"], default: "md" },
    tone: { type: "string", enum: ["default", "muted", "accent"], default: "default" },
  },
  Image: {
    asset: { type: "string", required: true, assetKind: "image" },
    alt: { type: "string", required: true },
    aspect: {
      type: "string",
      enum: ["auto", "square", "portrait", "landscape", "wide"],
      default: "auto",
    },
    fit: { type: "string", enum: ["cover", "contain"], default: "cover" },
  },
  Badge: {
    label: { type: "string", required: true, bindable: true },
    tone: {
      type: "string",
      enum: ["neutral", "positive", "warning", "danger"],
      default: "neutral",
    },
  },
  Metric: {
    label: { type: "string", required: true },
    value: { type: "number", required: true, bindable: true },
    unit: { type: "string" },
  },
  MetricGroup: {
    title: { type: "string" },
    columns: { type: "number", minimum: 1, maximum: 4, default: 3 },
    tone: { type: "string", enum: ["neutral", "accent"], default: "neutral" },
  },
  Table: {
    rows: { type: "array", required: true, bindable: true },
    caption: { type: "string" },
  },
  Chart: {
    data: { type: "array", required: true, bindable: true },
    xKey: { type: "string", required: true },
    yKey: { type: "string", required: true },
    type: { type: "string", enum: ["bar", "line", "area"], default: "bar" },
    title: { type: "string" },
  },
  Progress: {
    label: { type: "string", required: true },
    value: { type: "number", required: true, bindable: true, minimum: 0, maximum: 100 },
    tone: {
      type: "string",
      enum: ["neutral", "accent", "success", "warning"],
      default: "accent",
    },
  },
  Timeline: {
    title: { type: "string" },
    tone: { type: "string", enum: ["neutral", "accent"], default: "neutral" },
  },
  List: {
    title: { type: "string" },
    marker: { type: "string", enum: ["bullet", "number", "none"], default: "bullet" },
    density: {
      type: "string",
      enum: ["compact", "comfortable"],
      default: "comfortable",
    },
  },
} as const;

const EXPECTED_CONTENT = {
  Text: { mode: "none" },
  Avatar: { mode: "none" },
  Icon: { mode: "none" },
  Image: { mode: "none" },
  Badge: { mode: "none" },
  Metric: { mode: "none" },
  MetricGroup: { mode: "children" },
  Table: { mode: "none" },
  Chart: { mode: "none" },
  Progress: { mode: "none" },
  Timeline: { mode: "children" },
  List: { mode: "children" },
} as const;

const SOURCE = readFileSync(new URL("./specs-content.ts", import.meta.url), "utf8");

function contract(spec: ComponentSpec): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(spec.props).map(([name, schema]) => {
      const declaration: Record<string, unknown> = { ...schema };
      delete declaration["guidance"];
      return [name, declaration];
    }),
  );
}

describe("content/media/data component specs", () => {
  it("registers exactly the locked 12 tags in catalog order", () => {
    expect(CONTENT_SPECS.map((spec) => spec.tag)).toEqual(CONTENT_TAGS);
    expect(CONTENT_SPECS).toEqual([
      TEXT_SPEC,
      AVATAR_SPEC,
      ICON_SPEC,
      IMAGE_SPEC,
      BADGE_SPEC,
      METRIC_SPEC,
      METRIC_GROUP_SPEC,
      TABLE_SPEC,
      CHART_SPEC,
      PROGRESS_SPEC,
      TIMELINE_SPEC,
      LIST_SPEC,
    ]);
  });

  it("pins every prop declaration independently of guidance prose", () => {
    expect(Object.fromEntries(CONTENT_SPECS.map((spec) => [spec.tag, contract(spec)]))).toEqual(
      EXPECTED_PROPS,
    );
  });

  it("derives the locked leaf and container classes from content", () => {
    expect(Object.fromEntries(CONTENT_SPECS.map((spec) => [spec.tag, spec.content]))).toEqual(
      EXPECTED_CONTENT,
    );
  });

  it("declares Image.asset as a host-pinned image asset only", () => {
    expect(contract(IMAGE_SPEC)["asset"]).toEqual({
      type: "string",
      required: true,
      assetKind: "image",
    });
  });

  it("keeps Table.rows and Chart.data open record arrays", () => {
    expect(contract(TABLE_SPEC)["rows"]).toEqual({
      type: "array",
      required: true,
      bindable: true,
    });
    expect(contract(CHART_SPEC)["data"]).toEqual({
      type: "array",
      required: true,
      bindable: true,
    });
  });

  it("stays within catalog metadata bounds and validates through Core", () => {
    for (const spec of CONTENT_SPECS) {
      const result = validateComponentSpec(spec);
      expect(result.ok ? "accepted" : `${result.code} at ${result.at}`, spec.tag).toBe("accepted");
      expect(spec.whenToUse.length).toBeLessThanOrEqual(BOUNDS.componentWhenToUseChars);
      expect(Object.keys(spec.props).length).toBeLessThanOrEqual(BOUNDS.propsPerComponentSpec);
      for (const schema of Object.values(spec.props)) {
        expect(schema.guidance.length).toBeGreaterThan(0);
        expect(schema.guidance.length).toBeLessThanOrEqual(BOUNDS.propGuidanceChars);
      }
    }
  });

  it("contains no retired tags or retired component-spec fields", () => {
    expect(CONTENT_SPECS.map((spec) => spec.tag)).toEqual(CONTENT_TAGS);
    for (const field of [
      ["authoring", "Role"],
      ["accepts", "Children"],
    ]) {
      expect(SOURCE).not.toContain(field.join(""));
    }
  });
});
