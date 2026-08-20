import { readFileSync } from "node:fs";

import { BOUNDS, validateComponentSpec } from "@facet/core";
import type { ComponentSpec } from "@facet/core";
import { describe, expect, it } from "vitest";

import {
  ALERT_SPEC,
  BOARD_COLUMN_SPEC,
  BOARD_SPEC,
  CALENDAR_SPEC,
  COLLECTION_SPEC,
  DETAIL_SPEC,
  EMPTY_SPEC,
  EXPRESSION_SPECS,
  HEADER_SPEC,
  ITEM_CARD_SPEC,
  PROPERTY_LIST_SPEC,
  PROPERTY_SPEC,
  RESULT_SPEC,
} from "./specs-expression.js";

const TASK_TAGS = [
  "Header",
  "Collection",
  "ItemCard",
  "Detail",
  "PropertyList",
  "Property",
  "Board",
  "BoardColumn",
  "Calendar",
  "Result",
  "Empty",
  "Alert",
] as const;

const EXPECTED_PROPS = {
  Header: {
    title: { type: "string", required: true },
    description: { type: "string" },
    eyebrow: { type: "string" },
    align: { type: "string", enum: ["start", "center"], default: "start" },
    tone: { type: "string", enum: ["neutral", "accent", "inverse"], default: "neutral" },
  },
  Collection: {
    title: { type: "string" },
    description: { type: "string" },
    layout: { type: "string", enum: ["grid", "list"], default: "grid" },
    columns: { type: "number", minimum: 1, maximum: 4, default: 3 },
  },
  ItemCard: {
    title: { type: "string", required: true },
    description: { type: "string" },
    eyebrow: { type: "string" },
    meta: { type: "string" },
    tone: { type: "string", enum: ["neutral", "accent"], default: "neutral" },
  },
  Detail: {
    title: { type: "string", required: true },
    description: { type: "string" },
    eyebrow: { type: "string" },
    meta: { type: "string" },
    tone: { type: "string", enum: ["neutral", "accent"], default: "neutral" },
  },
  PropertyList: {
    title: { type: "string" },
    columns: { type: "number", minimum: 1, maximum: 3, default: 1 },
  },
  Property: {
    label: { type: "string", required: true },
    value: { type: "string", required: true, bindable: true },
    tone: { type: "string", enum: ["default", "muted"], default: "default" },
  },
  Board: { title: { type: "string" } },
  BoardColumn: {
    title: { type: "string", required: true },
    description: { type: "string" },
    tone: { type: "string", enum: ["neutral", "accent"], default: "neutral" },
  },
  Calendar: {
    name: { type: "string", required: true },
    title: { type: "string" },
    events: {
      type: "array",
      required: true,
      bindable: true,
      shape: {
        fields: {
          id: { type: "string", required: true },
          title: { type: "string", required: true },
          start: { type: "string", required: true },
          end: { type: "string" },
          tone: { type: "string" },
        },
      },
    },
    view: { type: "string", enum: ["month", "agenda"], default: "month" },
    value: { type: "string", default: "" },
  },
  Result: {
    title: { type: "string", required: true },
    description: { type: "string" },
    tone: {
      type: "string",
      enum: ["neutral", "success", "warning", "danger"],
      default: "neutral",
    },
  },
  Empty: {
    title: { type: "string", required: true },
    description: { type: "string" },
  },
  Alert: {
    title: { type: "string", required: true },
    description: { type: "string" },
    tone: {
      type: "string",
      enum: ["info", "success", "warning", "danger"],
      default: "info",
    },
  },
} as const;

const EXPECTED_CONTENT = {
  Header: {
    mode: "slots",
    slots: {
      leading: { minChildren: 0, maxChildren: 1 },
      meta: { minChildren: 0, maxChildren: 6 },
      actions: { minChildren: 0, maxChildren: 4 },
      media: { minChildren: 0, maxChildren: 1 },
    },
  },
  Collection: {
    mode: "slots",
    slots: {
      controls: { minChildren: 0, maxChildren: 8 },
      items: { minChildren: 1, maxChildren: 24 },
      actions: { minChildren: 0, maxChildren: 4 },
    },
  },
  ItemCard: {
    mode: "slots",
    slots: {
      media: { minChildren: 0, maxChildren: 1 },
      content: { minChildren: 0, maxChildren: 8 },
      actions: { minChildren: 0, maxChildren: 3 },
    },
  },
  Detail: {
    mode: "slots",
    slots: {
      media: { minChildren: 0, maxChildren: 1 },
      summary: { minChildren: 0, maxChildren: 8 },
      details: { minChildren: 0, maxChildren: 16 },
      actions: { minChildren: 0, maxChildren: 4 },
    },
  },
  PropertyList: {
    mode: "slots",
    slots: { items: { minChildren: 1, maxChildren: 32 } },
  },
  Property: { mode: "none" },
  Board: {
    mode: "slots",
    slots: { columns: { minChildren: 1, maxChildren: 8 } },
  },
  BoardColumn: { mode: "children" },
  Calendar: { mode: "none" },
  Result: {
    mode: "slots",
    slots: {
      summary: { minChildren: 0, maxChildren: 8 },
      details: { minChildren: 0, maxChildren: 16 },
      actions: { minChildren: 0, maxChildren: 4 },
    },
  },
  Empty: {
    mode: "slots",
    slots: {
      body: { minChildren: 0, maxChildren: 4 },
      actions: { minChildren: 0, maxChildren: 2 },
    },
  },
  Alert: {
    mode: "slots",
    slots: {
      body: { minChildren: 0, maxChildren: 4 },
      actions: { minChildren: 0, maxChildren: 2 },
    },
  },
} as const;

const SOURCE = readFileSync(new URL("./specs-expression.ts", import.meta.url), "utf8");

function propContract(spec: ComponentSpec): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(spec.props).map(([name, schema]) => {
      const declaration: Record<string, unknown> = { ...schema };
      delete declaration["guidance"];
      if (!("shape" in declaration)) return [name, declaration];
      const shape = declaration.shape as { readonly fields: Readonly<Record<string, unknown>> };
      return [
        name,
        {
          ...declaration,
          shape: {
            fields: Object.fromEntries(
              Object.entries(shape.fields).map(([field, value]) => {
                const fieldDeclaration = { ...(value as Record<string, unknown>) };
                delete fieldDeclaration["guidance"];
                return [field, fieldDeclaration];
              }),
            ),
          },
        },
      ];
    }),
  );
}

function contentContract(spec: ComponentSpec): unknown {
  if (spec.content.mode !== "slots") return spec.content;
  return {
    mode: "slots",
    slots: Object.fromEntries(
      Object.entries(spec.content.slots).map(([name, slot]) => {
        const declaration: Record<string, unknown> = { ...slot };
        delete declaration["guidance"];
        return [name, declaration];
      }),
    ),
  };
}

describe("task-surface component specs", () => {
  it("registers exactly the locked 12 tags in catalog order", () => {
    expect(EXPRESSION_SPECS.map((spec) => spec.tag)).toEqual(TASK_TAGS);
    expect(EXPRESSION_SPECS).toEqual([
      HEADER_SPEC,
      COLLECTION_SPEC,
      ITEM_CARD_SPEC,
      DETAIL_SPEC,
      PROPERTY_LIST_SPEC,
      PROPERTY_SPEC,
      BOARD_SPEC,
      BOARD_COLUMN_SPEC,
      CALENDAR_SPEC,
      RESULT_SPEC,
      EMPTY_SPEC,
      ALERT_SPEC,
    ]);
  });

  it("pins every prop declaration independently of guidance prose", () => {
    expect(
      Object.fromEntries(EXPRESSION_SPECS.map((spec) => [spec.tag, propContract(spec)])),
    ).toEqual(EXPECTED_PROPS);
  });

  it("pins the approved task subset of the 17-component slot table", () => {
    expect(
      Object.fromEntries(EXPRESSION_SPECS.map((spec) => [spec.tag, contentContract(spec)])),
    ).toEqual(EXPECTED_CONTENT);
  });

  it("declares the fixed calendar event shape", () => {
    expect(propContract(CALENDAR_SPEC)["events"]).toEqual(EXPECTED_PROPS.Calendar.events);
    expect(CALENDAR_SPEC.collect).toEqual({
      collectable: true,
      valueProp: "value",
      valueKind: "string",
    });
  });

  it("stays within catalog metadata bounds and validates through Core", () => {
    for (const spec of EXPRESSION_SPECS) {
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
    expect(EXPRESSION_SPECS.map((spec) => spec.tag)).toEqual(TASK_TAGS);
    for (const field of [
      ["authoring", "Role"],
      ["accepts", "Children"],
    ]) {
      expect(SOURCE).not.toContain(field.join(""));
    }
  });
});
