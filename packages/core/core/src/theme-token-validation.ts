import { isControlChar, isForbiddenKey, isPlainObject, nullMap, printableKey } from "./issues.js";
import { isAllowedColor } from "./theme-color.js";
import { IssueList } from "./theme-issues.js";
import {
  parseThemeDecimal,
  THEME_SIGNED_DECIMAL_SOURCE,
  THEME_UNSIGNED_DECIMAL_SOURCE,
} from "./theme-number.js";
import { MAX_THEME_CSS_VALUE_BYTES } from "./theme-types.js";

const DANGEROUS = ["url(", "var(", "calc(", "expression(", "javascript:"];

export type ThemeValueResult<V> = { readonly value: V } | { readonly error: string };
export type ThemeValueHandler<V> = (value: unknown, token: string) => ThemeValueResult<V>;

function utf8Bytes(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return MAX_THEME_CSS_VALUE_BYTES + 1;
      bytes += 4;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return MAX_THEME_CSS_VALUE_BYTES + 1;
    else bytes += 3;
  }
  return bytes;
}

function safeCssString(value: unknown): ThemeValueResult<string> {
  if (typeof value !== "string") return { error: "value is not a string" };
  if (value.trim() !== value || value.length === 0) {
    return { error: "value is empty or has surrounding whitespace" };
  }
  if (utf8Bytes(value) > MAX_THEME_CSS_VALUE_BYTES) {
    return { error: `value exceeds ${MAX_THEME_CSS_VALUE_BYTES} bytes` };
  }
  for (let index = 0; index < value.length; index += 1) {
    if (isControlChar(value.charCodeAt(index)))
      return { error: "value contains a control character" };
  }
  if (/[;{}<>\\`]/.test(value)) return { error: "value contains a disallowed character" };
  const collapsed = value.replace(/\s+/g, "").toLowerCase();
  for (const danger of DANGEROUS) {
    if (collapsed.includes(danger)) return { error: `value contains "${danger}"` };
  }
  return { value };
}

interface UnitBounds {
  readonly min: number;
  readonly max: number;
}

export function lengthHandler(options: {
  readonly unitlessZero?: boolean;
  readonly px?: UnitBounds;
  readonly rem?: UnitBounds;
  readonly em?: UnitBounds;
  readonly ch?: UnitBounds;
  readonly svh?: UnitBounds;
  readonly keywords?: Readonly<Record<string, string>>;
}): ThemeValueHandler<string> {
  return (raw, token) => {
    const safe = safeCssString(raw);
    if ("error" in safe) return safe;
    const value = safe.value;
    const keyword = options.keywords?.[token];
    if (keyword !== undefined && value === keyword) return { value };
    if (options.unitlessZero === true && value === "0") return { value };
    const match = new RegExp(`^(${THEME_SIGNED_DECIMAL_SOURCE})(px|rem|em|ch|svh)$`).exec(value);
    if (match === null) return { error: "value has an invalid length grammar or unit" };
    const scalar = parseThemeDecimal(match[1]!, true);
    const bounds = options[match[2]! as "px" | "rem" | "em" | "ch" | "svh"];
    if (
      scalar === undefined ||
      bounds === undefined ||
      scalar < bounds.min ||
      scalar > bounds.max
    ) {
      return { error: "value is outside the allowed range" };
    }
    return { value };
  };
}

export const fontWeightHandler: ThemeValueHandler<number> = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return { error: "fontWeight is not a finite integer" };
  }
  return value >= 1 && value <= 1000 ? { value } : { error: "fontWeight is outside 1..1000" };
};

const FONT_FAMILY_RE = /^[A-Za-z0-9 ,'"_-]{1,200}$/;
export const fontFamilyHandler: ThemeValueHandler<string> = (raw) => {
  const safe = safeCssString(raw);
  if ("error" in safe) return safe;
  return FONT_FAMILY_RE.test(safe.value)
    ? safe
    : { error: "fontFamily must use 1..200 safe family-list characters" };
};

export const lineHeightHandler: ThemeValueHandler<string> = (raw) => {
  const safe = safeCssString(raw);
  if ("error" in safe) return safe;
  const value = parseThemeDecimal(safe.value);
  return value !== undefined && value >= 0.8 && value <= 3
    ? safe
    : { error: "lineHeight is outside 0.8..3" };
};

export const aspectRatioHandler: ThemeValueHandler<string> = (raw, token) => {
  const safe = safeCssString(raw);
  if ("error" in safe) return safe;
  if (token === "auto")
    return safe.value === "auto" ? safe : { error: "aspectRatio.auto must be auto" };
  const match = new RegExp(
    `^(${THEME_UNSIGNED_DECIMAL_SOURCE}) / (${THEME_UNSIGNED_DECIMAL_SOURCE})$`,
  ).exec(safe.value);
  if (match === null) return { error: "aspectRatio must be formatted as a / b" };
  const left = parseThemeDecimal(match[1]!);
  const right = parseThemeDecimal(match[2]!);
  return left !== undefined &&
    right !== undefined &&
    left >= 0.01 &&
    left <= 100 &&
    right >= 0.01 &&
    right <= 100
    ? safe
    : { error: "aspectRatio components are outside 0.01..100" };
};

function percent(raw: string): number | undefined {
  if (!raw.endsWith("%")) return undefined;
  const value = parseThemeDecimal(raw.slice(0, -1));
  return value !== undefined && value >= 0 && value <= 100 ? value : undefined;
}

function alpha(raw: string): number | undefined {
  const value = parseThemeDecimal(raw);
  return value !== undefined && value >= 0 && value <= 1 ? value : undefined;
}

function translucentColor(value: string): boolean {
  if (isAllowedColor(value)) return true;
  const rgba = /^rgba\((.*)\)$/.exec(value);
  if (rgba !== null) {
    const parts = rgba[1]!.split(",").map((part) => part.trim());
    if (parts.length !== 4 || alpha(parts[3]!) === undefined) return false;
    const percentages = parts.slice(0, 3).every((part) => part.endsWith("%"));
    if (percentages) return parts.slice(0, 3).every((part) => percent(part) !== undefined);
    if (parts.slice(0, 3).some((part) => part.endsWith("%"))) return false;
    return parts.slice(0, 3).every((part) => {
      const channel = parseThemeDecimal(part);
      return channel !== undefined && channel >= 0 && channel <= 255;
    });
  }
  const hsla = /^hsla\((.*)\)$/.exec(value);
  if (hsla === null) return false;
  const parts = hsla[1]!.split(",").map((part) => part.trim());
  return (
    parts.length === 4 &&
    parseThemeDecimal(parts[0]!, true) !== undefined &&
    percent(parts[1]!) !== undefined &&
    percent(parts[2]!) !== undefined &&
    alpha(parts[3]!) !== undefined
  );
}

export const colorHandler: ThemeValueHandler<string> = (raw, token) => {
  const safe = safeCssString(raw);
  if ("error" in safe) return safe;
  if (token === "inherit")
    return safe.value === "inherit" ? safe : { error: "color.inherit must be inherit" };
  return isAllowedColor(safe.value) ? safe : { error: "value is not an allowed opaque color" };
};

export const scrimHandler: ThemeValueHandler<string> = (raw, token) => {
  const safe = safeCssString(raw);
  if ("error" in safe) return safe;
  if (token === "none")
    return safe.value === "transparent" ? safe : { error: "scrim.none must be transparent" };
  return translucentColor(safe.value) ? safe : { error: "value is not an allowed scrim color" };
};

function splitTopLevel(value: string): string[] | undefined {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth < 0) return undefined;
    } else if (char === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (depth !== 0) return undefined;
  parts.push(value.slice(start).trim());
  return parts;
}

function gradientStop(value: string): number | undefined {
  const match = new RegExp(`^(.+) (${THEME_UNSIGNED_DECIMAL_SOURCE}%)$`).exec(value);
  if (match === null) return undefined;
  const color = match[1]!;
  const position = percent(match[2]!);
  return position !== undefined && (color === "transparent" || isAllowedColor(color))
    ? position
    : undefined;
}

export const gradientHandler: ThemeValueHandler<string> = (raw) => {
  const safe = safeCssString(raw);
  if ("error" in safe) return safe;
  if (safe.value === "none") return safe;
  let body: string;
  let headValid = false;
  if (safe.value.startsWith("linear-gradient(") && safe.value.endsWith(")")) {
    body = safe.value.slice("linear-gradient(".length, -1);
    const parts = splitTopLevel(body);
    if (parts === undefined || parts.length < 3 || parts.length > 9)
      return { error: "gradient must contain 2..8 stops" };
    const angleMatch = new RegExp(`^(${THEME_SIGNED_DECIMAL_SOURCE})deg$`).exec(parts.shift()!);
    const angle = angleMatch === null ? undefined : parseThemeDecimal(angleMatch[1]!, true);
    headValid = angle !== undefined && angle >= -360 && angle <= 360;
    body = parts.join(",");
  } else if (safe.value.startsWith("radial-gradient(") && safe.value.endsWith(")")) {
    body = safe.value.slice("radial-gradient(".length, -1);
    const parts = splitTopLevel(body);
    if (parts === undefined || parts.length < 3 || parts.length > 9)
      return { error: "gradient must contain 2..8 stops" };
    const position = new RegExp(
      `^circle at (${THEME_UNSIGNED_DECIMAL_SOURCE}%) (${THEME_UNSIGNED_DECIMAL_SOURCE}%)$`,
    ).exec(parts.shift()!);
    headValid =
      position !== null &&
      percent(position[1]!) !== undefined &&
      percent(position[2]!) !== undefined;
    body = parts.join(",");
  } else return { error: "value is not an allowed gradient" };
  if (!headValid) return { error: "gradient heading is outside the allowed range" };
  const stops = splitTopLevel(body);
  if (stops === undefined || stops.length < 2 || stops.length > 8)
    return { error: "gradient must contain 2..8 stops" };
  let previous = -1;
  for (const stop of stops) {
    const position = gradientStop(stop);
    if (position === undefined || position < previous)
      return { error: "gradient stops are invalid or decreasing" };
    previous = position;
  }
  return safe;
};

function shadowLength(value: string, negative: boolean): boolean {
  if (value === "0") return true;
  const match = new RegExp(
    `^(${negative ? THEME_SIGNED_DECIMAL_SOURCE : THEME_UNSIGNED_DECIMAL_SOURCE})(px|rem|em)$`,
  ).exec(value);
  if (match === null) return false;
  const scalar = parseThemeDecimal(match[1]!, negative);
  if (scalar === undefined) return false;
  const maximum = match[2] === "px" ? 256 : 16;
  return scalar >= (negative ? -maximum : 0) && scalar <= maximum;
}

function shadowLayer(value: string): boolean {
  let colorStart = value.lastIndexOf(" ");
  const functionStart = Math.max(value.lastIndexOf(" rgba("), value.lastIndexOf(" hsla("));
  if (functionStart >= 0) colorStart = functionStart;
  if (colorStart < 0) return false;
  const color = value.slice(colorStart + 1);
  const prefix = value.slice(0, colorStart).trim();
  if (!translucentColor(color)) return false;
  const terms = prefix.split(/\s+/);
  if (terms[0] === "inset") terms.shift();
  if (terms.length !== 3 && terms.length !== 4) return false;
  return (
    shadowLength(terms[0]!, true) &&
    shadowLength(terms[1]!, true) &&
    shadowLength(terms[2]!, false) &&
    (terms[3] === undefined || shadowLength(terms[3], true))
  );
}

export const shadowHandler: ThemeValueHandler<string> = (raw) => {
  const safe = safeCssString(raw);
  if ("error" in safe) return safe;
  if (safe.value === "none") return safe;
  const layers = splitTopLevel(safe.value);
  return layers !== undefined &&
    layers.length >= 1 &&
    layers.length <= 4 &&
    layers.every(shadowLayer)
    ? safe
    : { error: "value is not a 1..4 layer safe shadow" };
};

export function validateCompleteGroup<K extends string, V>(
  raw: unknown,
  members: readonly K[],
  group: string,
  handler: ThemeValueHandler<V>,
  issues: IssueList,
): Record<K, V> {
  const output = nullMap<V>() as Record<K, V>;
  if (!isPlainObject(raw)) {
    issues.push({
      severity: "error",
      message: `theme group "${group}" is missing or not an object`,
    });
    return output;
  }
  for (const key of Object.keys(raw)) {
    if (isForbiddenKey(key) || !(members as readonly string[]).includes(key)) {
      issues.push({
        severity: "error",
        message: `theme group "${group}" has unknown or forbidden token "${printableKey(key)}"`,
      });
    }
  }
  for (const key of members) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) {
      issues.push({
        severity: "error",
        message: `theme group "${group}" is missing token "${key}"`,
      });
      continue;
    }
    const result = handler(Reflect.get(raw, key), key);
    if ("error" in result) {
      issues.push({
        severity: "error",
        message: `theme "${group}" token "${key}": ${result.error}`,
      });
    } else output[key] = result.value;
  }
  return output;
}
