import type { Color } from "./tokens.js";

export const CONTRAST_PAIRS: readonly (readonly [Color, Color])[] = [
  ["fg", "bg"],
  ["fg-muted", "bg"],
  ["accent-fg", "accent"],
];
export const MIN_CONTRAST = 4.5;

const HEX_RE = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
// Argument chars are constrained to digits/dot/comma/percent/whitespace and the
// letters of "deg" — anything else (e.g. a smuggled keyword) fails the match.
const RGB_HSL_RE = /^(rgb|rgba|hsl|hsla)\(([0-9.,%\sdeg]+)\)$/i;
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
  if (value.startsWith("#")) {
    if (!HEX_RE.test(value)) return undefined;
    let hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      if (hex.length === 4 && parseInt(`${hex[3]}${hex[3]}`, 16) !== 255) return undefined;
      hex = hex
        .slice(0, 3)
        .split("")
        .map((c) => c + c)
        .join("");
    } else if (hex.length === 8) {
      if (parseInt(hex.slice(6, 8), 16) !== 255) return undefined;
      hex = hex.slice(0, 6);
    } else if (hex.length !== 6) {
      return undefined;
    }
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return [r, g, b];
  }
  const lower = value.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(NAMED_COLORS, lower)) {
    return NAMED_COLORS[lower];
  }

  const match = RGB_HSL_RE.exec(value);
  if (match === null) return undefined;
  const fn = match[1]!.toLowerCase();
  const rawArgs = match[2]!;
  const commaSeparated = rawArgs.includes(",");
  const parts = (commaSeparated ? rawArgs.split(",") : rawArgs.trim().split(/\s+/)).map((p) =>
    p.trim(),
  );
  const alphaAllowed = fn === "rgba" || fn === "hsla";
  if (alphaAllowed && !commaSeparated) return undefined;
  if (parts.length !== 3 && !(alphaAllowed && parts.length === 4)) return undefined;
  if (parts.length === 4 && !isOpaqueAlpha(parts[3]!)) return undefined;

  if (fn === "rgb" || fn === "rgba") {
    const channel = (raw: string): number | undefined => {
      if (raw === "") return undefined;
      const scalar = raw.endsWith("%") ? raw.slice(0, -1) : raw;
      if (scalar === "") return undefined;
      const value = raw.endsWith("%") ? (Number(scalar) / 100) * 255 : Number(scalar);
      if (!Number.isFinite(value) || value < 0 || value > 255) return undefined;
      return value;
    };
    const [r, g, b] = [channel(parts[0]!), channel(parts[1]!), channel(parts[2]!)];
    if (r === undefined || g === undefined || b === undefined) return undefined;
    return [r, g, b];
  }

  const hue = parseHue(parts[0]!);
  const saturation = parsePercent(parts[1]!);
  const lightness = parsePercent(parts[2]!);
  if (hue === undefined || saturation === undefined || lightness === undefined) return undefined;
  return hslToSrgb(hue, saturation, lightness);
}

function parseHue(raw: string): number | undefined {
  const value = raw.toLowerCase().endsWith("deg") ? raw.slice(0, -3) : raw;
  if (value === "") return undefined;
  const hue = Number(value);
  if (!Number.isFinite(hue)) return undefined;
  return ((hue % 360) + 360) % 360;
}

function parsePercent(raw: string): number | undefined {
  if (!raw.endsWith("%")) return undefined;
  const scalar = raw.slice(0, -1);
  if (scalar === "") return undefined;
  const value = Number(scalar);
  if (!Number.isFinite(value) || value < 0 || value > 100) return undefined;
  return value / 100;
}

function isOpaqueAlpha(raw: string): boolean {
  const scalar = raw.endsWith("%") ? raw.slice(0, -1) : raw;
  if (scalar === "") return false;
  const value = raw.endsWith("%") ? Number(scalar) / 100 : Number(scalar);
  return Number.isFinite(value) && value === 1;
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
