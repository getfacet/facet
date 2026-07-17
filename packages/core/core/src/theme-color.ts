import type { Color } from "./tokens.js";
import { MAX_THEME_CSS_VALUE_BYTES } from "./theme-types.js";

export const CONTRAST_PAIRS: readonly (readonly [Color, Color])[] = [
  ["foreground", "background"],
  ["foreground", "surface"],
  ["foreground", "mutedSurface"],
  ["mutedForeground", "background"],
  ["mutedForeground", "surface"],
  ["accentForeground", "accent"],
  ["successForeground", "successSurface"],
  ["warningForeground", "warningSurface"],
  ["dangerForeground", "dangerSurface"],
  ["infoForeground", "infoSurface"],
];
export const MIN_CONTRAST = 4.5;

const UNSIGNED_DECIMAL_RE = /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/;
const SIGNED_DECIMAL_RE = /^-?(?:0|[1-9]\d*)(?:\.\d{1,4})?$/;
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const NAMED_COLORS: Readonly<Record<string, readonly [number, number, number]>> = {
  aqua: [0, 255, 255],
  black: [0, 0, 0],
  blue: [0, 0, 255],
  cyan: [0, 255, 255],
  fuchsia: [255, 0, 255],
  gray: [128, 128, 128],
  green: [0, 128, 0],
  grey: [128, 128, 128],
  lime: [0, 255, 0],
  magenta: [255, 0, 255],
  maroon: [128, 0, 0],
  navy: [0, 0, 128],
  olive: [128, 128, 0],
  orange: [255, 165, 0],
  purple: [128, 0, 128],
  red: [255, 0, 0],
  silver: [192, 192, 192],
  teal: [0, 128, 128],
  white: [255, 255, 255],
  yellow: [255, 255, 0],
};

export function isAllowedColor(value: string): boolean {
  return parseSrgb(value) !== undefined;
}

export function parseSrgb(value: string): readonly [number, number, number] | undefined {
  if (
    value.length === 0 ||
    value.length > MAX_THEME_CSS_VALUE_BYTES ||
    value.trim() !== value ||
    /[^\x20-\x7e]/.test(value)
  ) {
    return undefined;
  }

  if (value.startsWith("#")) return parseHex(value);

  const lower = value.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(NAMED_COLORS, lower)) {
    return NAMED_COLORS[lower];
  }

  return value.startsWith("rgb(") ? parseRgb(value) : parseHsl(value);
}

function parseHex(value: string): readonly [number, number, number] | undefined {
  const match = HEX_RE.exec(value);
  if (match === null) return undefined;
  const digits = match[1]!;
  if (digits.length === 4 && digits[3]!.toLowerCase() !== "f") return undefined;
  if (digits.length === 8 && digits.slice(6).toLowerCase() !== "ff") return undefined;
  const opaque =
    digits.length === 4 ? digits.slice(0, 3) : digits.length === 8 ? digits.slice(0, 6) : digits;
  const hex =
    opaque.length === 3
      ? opaque
          .split("")
          .map((character) => character + character)
          .join("")
      : opaque;
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

function parseRgb(value: string): readonly [number, number, number] | undefined {
  const rgb = /^rgb\((.*)\)$/.exec(value);
  if (rgb === null) return undefined;
  const parts = rgb[1]!.split(",").map((part) => part.trim());
  if (parts.length !== 3) return undefined;
  const percentages = parts.every((part) => part.endsWith("%"));
  if (!percentages && parts.some((part) => part.endsWith("%"))) return undefined;
  const channel = (raw: string): number | undefined => {
    const parsed = percentages ? parsePercent(raw) : parseDecimal(raw, false);
    if (parsed === undefined) return undefined;
    if (percentages) return parsed * 255;
    return parsed >= 0 && parsed <= 255 ? parsed : undefined;
  };
  const [r, g, b] = [channel(parts[0]!), channel(parts[1]!), channel(parts[2]!)];
  return r === undefined || g === undefined || b === undefined ? undefined : [r, g, b];
}

function parseHsl(value: string): readonly [number, number, number] | undefined {
  const hsl = /^hsl\((.*)\)$/.exec(value);
  if (hsl === null) return undefined;
  const parts = hsl[1]!.split(",").map((part) => part.trim());
  if (parts.length !== 3) return undefined;
  const hue = parseDecimal(parts[0]!, true);
  const saturation = parsePercent(parts[1]!);
  const lightness = parsePercent(parts[2]!);
  if (hue === undefined || saturation === undefined || lightness === undefined) return undefined;
  return hslToSrgb(((hue % 360) + 360) % 360, saturation, lightness);
}

function parseDecimal(raw: string, signed: boolean): number | undefined {
  if (!(signed ? SIGNED_DECIMAL_RE : UNSIGNED_DECIMAL_RE).test(raw)) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function parsePercent(raw: string): number | undefined {
  if (!raw.endsWith("%")) return undefined;
  const value = parseDecimal(raw.slice(0, -1), false);
  if (value === undefined || value < 0 || value > 100) return undefined;
  return value / 100;
}

function hslToSrgb(
  hue: number,
  saturation: number,
  lightness: number,
): readonly [number, number, number] {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const h = hue / 60;
  const x = chroma * (1 - Math.abs((h % 2) - 1));
  const [r1, g1, b1] =
    h < 1
      ? [chroma, x, 0]
      : h < 2
        ? [x, chroma, 0]
        : h < 3
          ? [0, chroma, x]
          : h < 4
            ? [0, x, chroma]
            : h < 5
              ? [x, 0, chroma]
              : [chroma, 0, x];
  const m = lightness - chroma / 2;
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}

function relativeLuminance([r, g, b]: readonly [number, number, number]): number {
  const linear = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function contrastRatio(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}
