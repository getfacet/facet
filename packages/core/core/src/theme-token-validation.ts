import {
  isControlChar,
  isForbiddenKey,
  isPlainObject,
  MAX_VALUE_LENGTH,
  nullMap,
  printableKey,
} from "./issues.js";
import { isAllowedColor } from "./theme-color.js";
import { IssueList } from "./theme-issues.js";

const DANGEROUS_SUBSTRINGS = ["url(", "var(", "expression(", "javascript:"];
const SPACE_PX_RANGE = { lo: 0, hi: 512 } as const;
const FONT_SIZE_PX_RANGE = { lo: 0, hi: 512 } as const;
const RADIUS_PX_RANGE = { lo: 0, hi: 9999 } as const;
const WEIGHT_RANGE = { lo: 1, hi: 1000 } as const;
// Landing-grade dimension groups. Heights/widths span section-scale lengths;
// tracking (letter-spacing) is small and may be negative; leading (line-height)
// stays modest.
const MIN_HEIGHT_PX_RANGE = { lo: 0, hi: 9999 } as const;
const MAX_WIDTH_PX_RANGE = { lo: 0, hi: 9999 } as const;
const TRACKING_PX_RANGE = { lo: -64, hi: 64 } as const;
const LEADING_PX_RANGE = { lo: 0, hi: 512 } as const;

export {
  SPACE_PX_RANGE,
  FONT_SIZE_PX_RANGE,
  RADIUS_PX_RANGE,
  MIN_HEIGHT_PX_RANGE,
  MAX_WIDTH_PX_RANGE,
  TRACKING_PX_RANGE,
  LEADING_PX_RANGE,
};

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
export function validateGroup<V>(
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

export function handleColor(value: unknown): Handled<string> {
  if (typeof value !== "string") return { error: "value is not a string" };
  const unsafe = unsafeValue(value);
  if (unsafe !== undefined) return { error: unsafe };
  if (!isAllowedColor(value)) return { error: "not an allowed color value" };
  return { value };
}

export function dimensionHandler(lo: number, hi: number): (value: unknown) => Handled<string> {
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

export function handleWeight(value: unknown): Handled<number> {
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

export function handleFontFamily(value: unknown): Handled<string> {
  if (typeof value !== "string") return { error: "value is not a string" };
  const unsafe = unsafeValue(value);
  if (unsafe !== undefined) return { error: unsafe };
  if (!/[A-Za-z]/.test(value) || !FONT_FAMILY_RE.test(value)) {
    return { error: "not an allowed font-family value" };
  }
  return { value };
}

export function handleRatio(value: unknown): Handled<string> {
  if (typeof value !== "string") return { error: "value is not a string" };
  const unsafe = unsafeValue(value);
  if (unsafe !== undefined) return { error: unsafe };
  if (!isAllowedRatio(value)) return { error: "not a <n> / <m> ratio" };
  return { value };
}

/**
 * A non-empty, injection-free CSS value string (the same safe-value gate used
 * for shadows): rejects `url(`/`var(`/`expression(`/`javascript:` and the
 * `;{}<>\`` injection characters via `unsafeValue`, but allows the CSS function
 * shapes an operator legitimately needs (e.g. `linear-gradient(...)`,
 * `rgba(...)`). Reused for `gradient`/`scrim`/`highlight`.
 */
export function handleCssShape(value: unknown): Handled<string> {
  if (typeof value !== "string") return { error: "value is not a string" };
  const unsafe = unsafeValue(value);
  if (unsafe !== undefined) return { error: unsafe };
  if (value.trim() === "") return { error: "value is empty" };
  return { value };
}

export function handleShadow(value: unknown): Handled<string> {
  return handleCssShape(value);
}

export function tokenValue<T extends string | number>(
  raw: unknown,
  members: readonly T[],
  path: string,
  issues: IssueList,
): T | undefined {
  if ((members as readonly unknown[]).includes(raw)) return raw as T;
  issues.push({ severity: "warning", message: `${path}: invalid token dropped` });
  return undefined;
}

export function booleanValue(raw: unknown, path: string, issues: IssueList): boolean | undefined {
  if (typeof raw === "boolean") return raw;
  issues.push({ severity: "warning", message: `${path}: invalid boolean dropped` });
  return undefined;
}

export function recipeStyleObject(
  raw: unknown,
  path: string,
  issues: IssueList,
): Record<string, unknown> | undefined {
  if (!isPlainObject(raw)) {
    issues.push({ severity: "warning", message: `${path}: style is not an object; ignored` });
    return undefined;
  }
  return raw;
}

export function warnUnknownStyleKeys(
  raw: Record<string, unknown>,
  known: ReadonlySet<string>,
  path: string,
  issues: IssueList,
): void {
  for (const key of Object.keys(raw)) {
    if (isForbiddenKey(key)) {
      issues.push({
        severity: "warning",
        message: `${path}: forbidden key "${printableKey(key)}" dropped`,
      });
      continue;
    }
    if (!known.has(key)) {
      issues.push({
        severity: "warning",
        message: `${path}: unknown style key "${printableKey(key)}" dropped`,
      });
    }
  }
}
