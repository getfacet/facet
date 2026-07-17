import type { CSSProperties } from "react";
import {
  INPUT_KINDS,
  MAX_FIELD_OPTIONS,
  MAX_FIELD_VALUE_CHARS,
  MAX_TABLE_CELL_CHARS,
} from "@facet/core";
import { rootContainmentStyle } from "./layout-contract.js";

export const MAX_INTRINSIC_ITEMS = 32;

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  try {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
}

export function safeOwnValue(record: unknown, key: string): unknown {
  if (!isObjectRecord(record)) return undefined;
  try {
    if (!Object.prototype.hasOwnProperty.call(record, key)) return undefined;
    return record[key];
  } catch {
    return undefined;
  }
}

export function cappedArray(value: unknown, max: number): readonly unknown[] {
  if (!Array.isArray(value)) return [];
  try {
    return value.slice(0, max);
  } catch {
    return [];
  }
}

export function styleOf<T extends object>(style: unknown): T | undefined {
  if (!isObjectRecord(style)) return undefined;
  try {
    return { ...style } as T;
  } catch {
    return undefined;
  }
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function cappedString(value: unknown, max: number): string | undefined {
  const text = stringValue(value);
  return text === undefined ? undefined : text.slice(0, max);
}

export function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function isFieldInput(input: unknown): input is (typeof INPUT_KINDS)[number] {
  return typeof input === "string" && (INPUT_KINDS as readonly string[]).includes(input);
}

export function optionsOf(options: unknown): readonly string[] {
  const kept: string[] = [];
  for (const option of cappedArray(options, MAX_FIELD_OPTIONS)) {
    if (typeof option === "string") {
      kept.push(option.slice(0, MAX_FIELD_VALUE_CHARS));
    }
  }
  return kept;
}

export function tableCellText(value: unknown): string {
  const text =
    typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : "";
  return text.slice(0, MAX_TABLE_CELL_CHARS);
}

export function textAlignStyle(align: unknown): CSSProperties["textAlign"] | undefined {
  switch (align) {
    case "start":
      return "left";
    case "center":
      return "center";
    case "end":
      return "right";
    default:
      return undefined;
  }
}

export function clampProgress(value: unknown): number {
  const numeric = finiteNumber(value);
  if (numeric === undefined) return 0;
  return Math.min(100, Math.max(0, numeric));
}

export function withInert(style: CSSProperties, inert: boolean): CSSProperties {
  return inert ? { ...style, pointerEvents: "none" } : style;
}

export function intrinsicBoxStyle(style: CSSProperties | undefined): CSSProperties {
  if (style === undefined) return {};
  const css: CSSProperties = { ...style };
  delete css.display;
  delete css.flexDirection;
  delete css.flexWrap;
  delete css.gap;
  delete css.alignItems;
  delete css.justifyContent;
  delete css.flexGrow;
  delete css.width;
  delete css.minWidth;
  delete css.maxWidth;
  delete css.overflowX;
  delete css.overflowY;
  delete css.maxHeight;
  delete css.minHeight;
  return rootContainmentStyle(css);
}
