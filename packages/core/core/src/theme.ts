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
  FONT_FAMILIES,
  FONT_SIZES,
  FONT_WEIGHTS,
  RADII,
  RATIOS,
  SPACES,
  type Color,
  type FontFamily,
  type FontSize,
  type FontWeight,
  type Radius,
  type Ratio,
  type Space,
} from "./tokens.js";
import { SLOT_NAME_RE } from "./slot-marker.js";
import {
  boundedDescription,
  isForbiddenKey,
  isControlChar,
  isPlainObject,
  MAX_ISSUES,
  MAX_VALUE_LENGTH,
  nullMap,
  printableKey,
  ISSUES_SUPPRESSED,
} from "./issues.js";

/** A partial override document over the default theme. Every group is optional. */
export interface FacetTheme {
  readonly name: string;
  readonly description?: string;
  readonly color?: Readonly<Partial<Record<Color, string>>>;
  readonly space?: Readonly<Partial<Record<Space, string>>>;
  readonly fontFamily?: Readonly<Partial<Record<FontFamily, string>>>;
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

/**
 * True iff `name` is a valid theme name — a short, filename-safe identifier
 * (1–64 chars of `[a-zA-Z0-9_-]`, leading char alphanumeric). The single rule
 * both `validateTheme` (a theme document's own name) and `validateTree` (a
 * tree's `theme` reference) apply, so the two can never drift apart.
 */
export function isValidThemeName(name: string): boolean {
  return SLOT_NAME_RE.test(name);
}

const KNOWN_KEYS = new Set([
  "name",
  "description",
  "color",
  "space",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "radius",
  "ratio",
]);

/** Substrings that make a CSS value dangerous regardless of context. */
const DANGEROUS_SUBSTRINGS = ["url(", "var(", "expression(", "javascript:"];

/** Shared cap for a document's one-line `description` (a theme's and a stamp's). */
export const MAX_DESCRIPTION_LENGTH = 200;

/**
 * A bounded issue collector. Once `MAX_ISSUES` real entries are recorded,
 * further pushes are dropped after a single `ISSUES_SUPPRESSED` tail entry — so
 * a 100k-junk-key group cannot balloon the issues list (each junk key would
 * otherwise emit one issue object). `everError` is tracked BEFORE the cap check
 * so the whole-document-refusal decision (`hasError`) never misses an error
 * issue that the cap suppressed — a document with 64 warnings THEN an error must
 * still be refused (theme.ts contract "Present iff no error issue was raised").
 * `.list` is the plain array to return.
 */
class IssueList {
  private readonly items: ThemeIssue[] = [];
  private suppressed = false;
  private everError = false;
  push(issue: ThemeIssue): void {
    if (issue.severity === "error") this.everError = true;
    if (this.items.length >= MAX_ISSUES) {
      if (!this.suppressed) {
        this.items.push({ severity: "warning", message: ISSUES_SUPPRESSED });
        this.suppressed = true;
      }
      return;
    }
    this.items.push(issue);
  }
  /** True iff any `error` issue was raised — even one dropped past the cap. */
  get hasError(): boolean {
    return this.everError;
  }
  get list(): ThemeIssue[] {
    return this.items;
  }
}

/** Clamp bounds in px-equivalents (invariant #5: a theme cannot push content off-screen). */
const SPACE_PX_RANGE = { lo: 0, hi: 512 } as const;
const FONT_SIZE_PX_RANGE = { lo: 0, hi: 512 } as const;
const RADIUS_PX_RANGE = { lo: 0, hi: 9999 } as const;
const WEIGHT_RANGE = { lo: 1, hi: 1000 } as const;

/**
 * The canonical default palette — token NAMES → concrete hex — as the SINGLE
 * source of truth for the default colors. `@facet/react` (which depends on core)
 * builds its `COLOR`/`DEFAULT_THEME`/`resolveTheme` on this map, and the contrast
 * check below overlays a partial override on it so an EFFECTIVE (override ??
 * default) pair is measured, not just override-vs-override.
 */
export const DEFAULT_COLORS: Readonly<Record<Color, string>> = {
  fg: "#1a1d23",
  "fg-muted": "#6b7280",
  bg: "#ffffff",
  surface: "#f6f7f9",
  "surface-2": "#eceef1",
  accent: "#4f46e5",
  "accent-fg": "#ffffff",
  border: "#e2e5ea",
  success: "#16a34a",
  warning: "#d97706",
  danger: "#dc2626",
};

/**
 * WCAG contrast is measured for these pairs against the EFFECTIVE colors — each
 * member is the document's override if present, else the `DEFAULT_COLORS` value
 * it renders on — so a partial override (e.g. `bg` only) is still checked.
 */
const CONTRAST_PAIRS: readonly (readonly [Color, Color])[] = [
  ["fg", "bg"],
  ["fg-muted", "bg"],
  ["accent-fg", "accent"],
];
const MIN_CONTRAST = 4.5;

/**
 * Rejects a raw CSS string that is too long, contains a control/injection
 * character, or carries a dangerous CSS function. Whitespace is collapsed before
 * the substring check so `u r l (` cannot smuggle a `url(` past it.
 */
function unsafeValue(value: string): string | undefined {
  if (value.length > MAX_VALUE_LENGTH) return `value exceeds ${MAX_VALUE_LENGTH} characters`;
  for (let i = 0; i < value.length; i++) {
    if (isControlChar(value.charCodeAt(i))) return "value contains a control character";
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
  issues: IssueList,
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
    if (isForbiddenKey(key)) {
      issues.push({
        severity: "warning",
        message: `theme "${group}": forbidden key "${printableKey(key)}" dropped`,
      });
      continue;
    }
    if (!members.includes(key)) {
      issues.push({
        severity: "warning",
        message: `theme "${group}": unknown token "${printableKey(key)}" dropped`,
      });
      continue;
    }
    const result = handle(raw[key]);
    if ("error" in result) {
      issues.push({
        severity: "error",
        message: `theme "${group}" token "${printableKey(key)}": ${result.error}`,
      });
      continue;
    }
    if (result.warning !== undefined) {
      issues.push({
        severity: "warning",
        message: `theme "${group}" token "${printableKey(key)}": ${result.warning}`,
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

const FONT_FAMILY_RE = /^[A-Za-z0-9 _,'" -]+$/;

function handleFontFamily(value: unknown): Handled<string> {
  if (typeof value !== "string") return { error: "value is not a string" };
  const unsafe = unsafeValue(value);
  if (unsafe !== undefined) return { error: unsafe };
  if (!/[A-Za-z]/.test(value) || !FONT_FAMILY_RE.test(value)) {
    return { error: "not an allowed font-family value" };
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
 * override) plus issues, or issues only if any `error` was raised. Never throws —
 * a hostile input whose property accessor throws (a proxy/getter handed in by a
 * live in-process document) is caught by the `validateTheme` wrapper below and
 * refused with an error issue, keeping the header's "NEVER throws" contract true.
 */
function validateThemeInner(input: unknown): ThemeValidationResult {
  const issues = new IssueList();
  if (!isPlainObject(input)) {
    issues.push({ severity: "error", message: "theme document is not an object" });
    return { issues: issues.list };
  }

  const name = input.name;
  if (typeof name !== "string" || !isValidThemeName(name)) {
    issues.push({ severity: "error", message: "theme name is missing or malformed" });
    return { issues: issues.list };
  }

  const theme: {
    name: string;
    description?: string;
    color?: Record<string, string>;
    space?: Record<string, string>;
    fontFamily?: Record<string, string>;
    fontSize?: Record<string, string>;
    fontWeight?: Record<string, number>;
    radius?: Record<string, string>;
    ratio?: Record<string, string>;
  } = { name };

  if (input.description !== undefined) {
    const { description, warning } = boundedDescription(
      input.description,
      "theme",
      MAX_DESCRIPTION_LENGTH,
    );
    if (description !== undefined) theme.description = description;
    if (warning !== undefined) issues.push({ severity: "warning", message: warning });
  }

  for (const key of Object.keys(input)) {
    if (!KNOWN_KEYS.has(key)) {
      issues.push({
        severity: "warning",
        message: `unknown theme key "${printableKey(key)}" dropped`,
      });
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
  if (input.fontFamily !== undefined) {
    const group = validateGroup(
      input.fontFamily,
      FONT_FAMILIES,
      "fontFamily",
      handleFontFamily,
      issues,
    );
    if (group !== undefined) theme.fontFamily = group;
  }
  if (input.fontSize !== undefined) {
    const group = validateGroup(
      input.fontSize,
      FONT_SIZES,
      "fontSize",
      dimensionHandler(FONT_SIZE_PX_RANGE.lo, FONT_SIZE_PX_RANGE.hi),
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
  // Measured against EFFECTIVE colors (override ?? default): resolveTheme overlays
  // a partial document on the defaults, so a doc that overrides only ONE member of
  // a pair (the most common low-contrast mistake, e.g. bg #000 on default fg) must
  // still be checked — skip a pair only when NEITHER member is overridden.
  if (theme.color !== undefined) {
    for (const [a, b] of CONTRAST_PAIRS) {
      const oa = theme.color[a];
      const ob = theme.color[b];
      if (oa === undefined && ob === undefined) continue;
      const sa = parseSrgb(oa ?? DEFAULT_COLORS[a]);
      const sb = parseSrgb(ob ?? DEFAULT_COLORS[b]);
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

  // Gate on `hasError` (tracked before the cap) — NOT a scan of the retained
  // list, which the issue cap can trim an error out of. A document with ≥64
  // warnings before an error-bearing value must still be refused wholesale.
  if (issues.hasError) return { issues: issues.list };
  return { theme: theme as FacetTheme, issues: issues.list };
}

/**
 * Public boundary: runs `validateThemeInner` but catches any throw from a hostile
 * input (e.g. `{ get color() { throw } }`) so the documented "NEVER throws"
 * contract holds for a live in-process document, not just JSON-shaped input.
 */
export function validateTheme(input: unknown): ThemeValidationResult {
  try {
    return validateThemeInner(input);
  } catch {
    return { issues: [{ severity: "error", message: "theme document threw during validation" }] };
  }
}
