/**
 * Theme documents — the ONE place raw CSS values enter Facet, as OPERATOR data
 * (never tree content, never model output). A `FacetTheme` is a PARTIAL override
 * over the default theme: token NAMES (the same `tokens.ts` vocabulary the agent
 * styles with) mapped to concrete CSS values. `validateTheme` is the single
 * safety boundary for that untrusted operator input.
 *
 * The validator is pure and dependency-free (no `node:*`, no color library —
 * WCAG contrast is plain arithmetic) so it runs identically on server and in the
 * browser. It NEVER throws: any input, however hostile or malformed, comes back
 * as `{ theme?, issues }`. A single `severity: "error"` issue refuses the whole
 * document (`theme` undefined); warnings keep the document but flag a clamp,
 * a dropped key, or a low-contrast pair.
 */
import {
  COLORS,
  FONT_SIZES,
  FONT_WEIGHTS,
  RADII,
  RATIOS,
  SPACES,
  type Color,
  type FontSize,
  type FontWeight,
  type Radius,
  type Ratio,
  type Space,
} from "./tokens.js";

/** A partial override document over the default theme. Every group is optional. */
export interface FacetTheme {
  readonly name: string;
  readonly description?: string;
  readonly color?: Readonly<Partial<Record<Color, string>>>;
  readonly space?: Readonly<Partial<Record<Space, string>>>;
  readonly fontSize?: Readonly<Partial<Record<FontSize, string>>>;
  readonly fontWeight?: Readonly<Partial<Record<FontWeight, number>>>;
  readonly radius?: Readonly<Partial<Record<Radius, string>>>;
  readonly ratio?: Readonly<Partial<Record<Ratio, string>>>;
}

export interface ThemeIssue {
  readonly severity: "error" | "warning";
  readonly message: string;
}

export interface ThemeValidationResult {
  /** Present iff no `error` issue was raised. */
  readonly theme?: FacetTheme;
  readonly issues: readonly ThemeIssue[];
}

/** A theme name must be a short, filename-safe identifier. */
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

/**
 * Keys that would poison a normal object (assign its [[Prototype]] or shadow a
 * built-in) are dropped outright — mirrors `validate.ts`'s forbidden node ids.
 * Output maps are ALSO built on `Object.create(null)`, so even a key that slips
 * through resolves to `undefined` rather than an inherited value.
 */
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

const KNOWN_KEYS = new Set([
  "name",
  "description",
  "color",
  "space",
  "fontSize",
  "fontWeight",
  "radius",
  "ratio",
]);

/** Substrings that make a CSS value dangerous regardless of context. */
const DANGEROUS_SUBSTRINGS = ["url(", "var(", "expression(", "javascript:"];

const MAX_VALUE_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 200;

/** Clamp bounds in px-equivalents (invariant #5: a theme cannot push content off-screen). */
const SPACE_PX_RANGE = { lo: 0, hi: 512 } as const;
const RADIUS_PX_RANGE = { lo: 0, hi: 9999 } as const;
const WEIGHT_RANGE = { lo: 1, hi: 1000 } as const;

/** WCAG contrast is measured for these pairs when both members are present sRGB. */
const CONTRAST_PAIRS: readonly (readonly [Color, Color])[] = [
  ["fg", "bg"],
  ["fg-muted", "bg"],
  ["accent-fg", "accent"],
];
const MIN_CONTRAST = 4.5;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullMap<V>(): Record<string, V> {
  return Object.create(null) as Record<string, V>;
}

/**
 * Rejects a raw CSS string that is too long, contains a control/injection
 * character, or carries a dangerous CSS function. Whitespace is collapsed before
 * the substring check so `u r l (` cannot smuggle a `url(` past it.
 */
function unsafeValue(value: string): string | undefined {
  if (value.length > MAX_VALUE_LENGTH) return `value exceeds ${MAX_VALUE_LENGTH} characters`;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return "value contains a control character";
  }
  if (/[;{}<>\\`]/.test(value)) return "value contains a disallowed character";
  const collapsed = value.replace(/\s+/g, "").toLowerCase();
  for (const bad of DANGEROUS_SUBSTRINGS) {
    if (collapsed.includes(bad)) return `value contains "${bad}"`;
  }
  return undefined;
}

const HEX_RE = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
// Argument chars are constrained to digits/dot/comma/percent/whitespace and the
// letters of "deg" — anything else (e.g. a smuggled keyword) fails the match.
const RGB_HSL_RE = /^(rgb|rgba|hsl|hsla)\(([0-9.,%\sdeg]+)\)$/i;
const KEYWORD_RE = /^[a-zA-Z]{1,32}$/;

function isAllowedColor(value: string): boolean {
  return HEX_RE.test(value) || KEYWORD_RE.test(value) || RGB_HSL_RE.test(value);
}

const DIMENSION_RE = /^(-?\d*\.?\d+)(px|rem|em)$/;

/** px-equivalent of a dimension (`0` or `<number>px/rem/em`), or undefined if malformed. */
function dimensionPx(value: string): number | undefined {
  if (value === "0") return 0;
  const match = DIMENSION_RE.exec(value);
  if (match === null) return undefined;
  const scalar = Number(match[1]);
  if (!Number.isFinite(scalar)) return undefined;
  return match[2] === "px" ? scalar : scalar * 16;
}

const RATIO_RE = /^(\d*\.?\d+)\s*\/\s*(\d*\.?\d+)$/;

function isAllowedRatio(value: string): boolean {
  const match = RATIO_RE.exec(value);
  if (match === null) return false;
  const a = Number(match[1]);
  const b = Number(match[2]);
  return Number.isFinite(a) && a > 0 && Number.isFinite(b) && b > 0;
}

type Handled<V> = { readonly value: V; readonly warning?: string } | { readonly error: string };

/**
 * Validates one token group: iterates the raw map's OWN keys, dropping forbidden
 * and unknown-token keys with a warning, running `handle` on each surviving
 * value. A value `error` is surfaced (and refuses the whole document); a `value`
 * (with an optional clamp `warning`) is written to a null-proto output map.
 * Returns the map only if it has at least one entry.
 */
function validateGroup<V>(
  raw: unknown,
  members: readonly string[],
  group: string,
  handle: (value: unknown) => Handled<V>,
  issues: ThemeIssue[],
): Record<string, V> | undefined {
  if (!isPlainObject(raw)) {
    issues.push({
      severity: "warning",
      message: `theme group "${group}" is not an object; ignored`,
    });
    return undefined;
  }
  const out = nullMap<V>();
  for (const key of Object.keys(raw)) {
    if (FORBIDDEN_KEYS.has(key)) {
      issues.push({
        severity: "warning",
        message: `theme "${group}": forbidden key "${key}" dropped`,
      });
      continue;
    }
    if (!members.includes(key)) {
      issues.push({
        severity: "warning",
        message: `theme "${group}": unknown token "${key}" dropped`,
      });
      continue;
    }
    const result = handle(raw[key]);
    if ("error" in result) {
      issues.push({
        severity: "error",
        message: `theme "${group}" token "${key}": ${result.error}`,
      });
      continue;
    }
    if (result.warning !== undefined) {
      issues.push({
        severity: "warning",
        message: `theme "${group}" token "${key}": ${result.warning}`,
      });
    }
    out[key] = result.value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function handleColor(value: unknown): Handled<string> {
  if (typeof value !== "string") return { error: "value is not a string" };
  const unsafe = unsafeValue(value);
  if (unsafe !== undefined) return { error: unsafe };
  if (!isAllowedColor(value)) return { error: "not an allowed color value" };
  return { value };
}

function dimensionHandler(lo: number, hi: number): (value: unknown) => Handled<string> {
  return (value) => {
    if (typeof value !== "string") return { error: "value is not a string" };
    const unsafe = unsafeValue(value);
    if (unsafe !== undefined) return { error: unsafe };
    const px = dimensionPx(value);
    if (px === undefined) return { error: "not 0 or a <number>px/rem/em dimension" };
    if (px < lo || px > hi) {
      const clamped = Math.min(hi, Math.max(lo, px));
      return { value: `${clamped}px`, warning: `dimension "${value}" clamped to ${clamped}px` };
    }
    return { value };
  };
}

function handleWeight(value: unknown): Handled<number> {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { error: "fontWeight is not a finite number" };
  }
  if (value < WEIGHT_RANGE.lo || value > WEIGHT_RANGE.hi) {
    const clamped = Math.min(WEIGHT_RANGE.hi, Math.max(WEIGHT_RANGE.lo, value));
    return { value: clamped, warning: `fontWeight ${value} clamped to ${clamped}` };
  }
  return { value };
}

function handleRatio(value: unknown): Handled<string> {
  if (typeof value !== "string") return { error: "value is not a string" };
  const unsafe = unsafeValue(value);
  if (unsafe !== undefined) return { error: unsafe };
  if (!isAllowedRatio(value)) return { error: "not a <n> / <m> ratio" };
  return { value };
}

/** Parse a hex or numeric `rgb()/rgba()` value to sRGB channels [0,255]; else undefined. */
function parseSrgb(value: string): readonly [number, number, number] | undefined {
  if (value.startsWith("#")) {
    let hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = hex
        .slice(0, 3)
        .split("")
        .map((c) => c + c)
        .join("");
    } else if (hex.length === 8) {
      hex = hex.slice(0, 6);
    } else if (hex.length !== 6) {
      return undefined;
    }
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return [r, g, b];
  }
  const match = /^rgba?\(([^)]+)\)$/i.exec(value);
  if (match === null) return undefined;
  const parts = match[1]!.split(",").map((p) => p.trim());
  if (parts.length < 3) return undefined;
  const channel = (raw: string): number =>
    raw.endsWith("%") ? (Number(raw.slice(0, -1)) / 100) * 255 : Number(raw);
  const [r, g, b] = [channel(parts[0]!), channel(parts[1]!), channel(parts[2]!)];
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return undefined;
  return [r, g, b];
}

function relativeLuminance([r, g, b]: readonly [number, number, number]): number {
  const linear = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrastRatio(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Validate an untrusted operator theme document. Returns a `FacetTheme` (partial
 * override) plus issues, or issues only if any `error` was raised. Never throws.
 */
export function validateTheme(input: unknown): ThemeValidationResult {
  const issues: ThemeIssue[] = [];
  if (!isPlainObject(input)) {
    issues.push({ severity: "error", message: "theme document is not an object" });
    return { issues };
  }

  const name = input.name;
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    issues.push({ severity: "error", message: "theme name is missing or malformed" });
    return { issues };
  }

  const theme: {
    name: string;
    description?: string;
    color?: Record<string, string>;
    space?: Record<string, string>;
    fontSize?: Record<string, string>;
    fontWeight?: Record<string, number>;
    radius?: Record<string, string>;
    ratio?: Record<string, string>;
  } = { name };

  if (input.description !== undefined) {
    if (typeof input.description !== "string") {
      issues.push({ severity: "warning", message: "theme description is not a string; ignored" });
    } else if (input.description.length > MAX_DESCRIPTION_LENGTH) {
      theme.description = input.description.slice(0, MAX_DESCRIPTION_LENGTH);
      issues.push({
        severity: "warning",
        message: `theme description truncated to ${MAX_DESCRIPTION_LENGTH} characters`,
      });
    } else {
      theme.description = input.description;
    }
  }

  for (const key of Object.keys(input)) {
    if (!KNOWN_KEYS.has(key)) {
      issues.push({ severity: "warning", message: `unknown theme key "${key}" dropped` });
    }
  }

  if (input.color !== undefined) {
    const group = validateGroup(input.color, COLORS, "color", handleColor, issues);
    if (group !== undefined) theme.color = group;
  }
  if (input.space !== undefined) {
    const group = validateGroup(
      input.space,
      SPACES,
      "space",
      dimensionHandler(SPACE_PX_RANGE.lo, SPACE_PX_RANGE.hi),
      issues,
    );
    if (group !== undefined) theme.space = group;
  }
  if (input.fontSize !== undefined) {
    const group = validateGroup(
      input.fontSize,
      FONT_SIZES,
      "fontSize",
      dimensionHandler(SPACE_PX_RANGE.lo, SPACE_PX_RANGE.hi),
      issues,
    );
    if (group !== undefined) theme.fontSize = group;
  }
  if (input.fontWeight !== undefined) {
    const group = validateGroup(input.fontWeight, FONT_WEIGHTS, "fontWeight", handleWeight, issues);
    if (group !== undefined) theme.fontWeight = group;
  }
  if (input.radius !== undefined) {
    const group = validateGroup(
      input.radius,
      RADII,
      "radius",
      dimensionHandler(RADIUS_PX_RANGE.lo, RADIUS_PX_RANGE.hi),
      issues,
    );
    if (group !== undefined) theme.radius = group;
  }
  if (input.ratio !== undefined) {
    const group = validateGroup(input.ratio, RATIOS, "ratio", handleRatio, issues);
    if (group !== undefined) theme.ratio = group;
  }

  // Contrast is MEASURED, never enforced: a low ratio is a warning, not a refusal.
  if (theme.color !== undefined) {
    for (const [a, b] of CONTRAST_PAIRS) {
      const ca = theme.color[a];
      const cb = theme.color[b];
      if (ca === undefined || cb === undefined) continue;
      const sa = parseSrgb(ca);
      const sb = parseSrgb(cb);
      if (sa === undefined || sb === undefined) continue;
      const ratio = contrastRatio(sa, sb);
      if (ratio < MIN_CONTRAST) {
        issues.push({
          severity: "warning",
          message: `low contrast for (${a}, ${b}): ratio ${ratio.toFixed(2)} is below ${MIN_CONTRAST}`,
        });
      }
    }
  }

  if (issues.some((issue) => issue.severity === "error")) return { issues };
  return { theme: theme as FacetTheme, issues };
}
