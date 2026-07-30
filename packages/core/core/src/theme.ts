/**
 * The theme token-name contract.
 *
 * Core owns the **names**; the theme owns the **values**. That split is what
 * keeps "declarative and tokens only" enforceable: a registered component styles
 * itself from a closed set of semantic token names it can neither invent nor
 * extend, and a host reskins Facet by supplying different values for the same
 * names. There is no raw CSS, no arbitrary style key, and no open value bag
 * anywhere in the path from the author's markup to the rendered page.
 *
 * The contract is **closed in both directions**. Every token name declared by
 * `FacetTheme` must be present, and a name outside it is rejected rather than
 * passed through — a token that silently reached the page unvalidated would be a
 * style escape hatch by another route.
 *
 * Token values are strings because a CSS custom property is a string; a numeric
 * weight is `"600"`, not `600`. Values are further restricted to text that
 * cannot terminate or reopen a declaration (no `;`, `{`, `}`, `<`, `>`,
 * backslash, or control characters), so projecting one into a stylesheet or an
 * inline style can only ever set the property it was written for.
 *
 * `validateTheme` is **total** — it never throws, for any input of any type —
 * and `themeToCssVars` is **pure and deterministic**: same theme in, byte-identical
 * variable map out, with no React, DOM, or ambient dependency of any kind.
 */

/**
 * One complete theme: the closed token-name contract a host fills.
 *
 * Every group is spelled out structurally rather than through a named alias so
 * that the emitted declaration states the whole contract and refers to nothing
 * outside the package surface.
 */
export interface FacetTheme {
  /** Semantic paint. One palette per theme; a dark theme is a different theme. */
  readonly color: Readonly<
    Record<
      | "background"
      | "surface"
      | "border"
      | "text"
      | "textMuted"
      | "accent"
      | "onAccent"
      | "success"
      | "warning"
      | "danger",
      string
    >
  >;
  /** The spacing scale: padding, gaps, and stack rhythm. */
  readonly space: Readonly<Record<"xs" | "sm" | "md" | "lg" | "xl", string>>;
  /** Corner rounding. */
  readonly radius: Readonly<Record<"sm" | "md" | "lg" | "full", string>>;
  /** Border thickness. */
  readonly borderWidth: Readonly<Record<"thin" | "thick", string>>;
  /** Elevation. */
  readonly shadow: Readonly<Record<"sm" | "md" | "lg", string>>;
  /** Type families. */
  readonly fontFamily: Readonly<Record<"sans" | "mono", string>>;
  /** The type scale. */
  readonly fontSize: Readonly<Record<"xs" | "sm" | "md" | "lg" | "xl", string>>;
  /** Type weight, as a CSS-ready string. */
  readonly fontWeight: Readonly<Record<"regular" | "medium" | "bold", string>>;
  /** Line height, as a CSS-ready string. */
  readonly lineHeight: Readonly<Record<"tight" | "normal" | "relaxed", string>>;
}

/**
 * What `validateTheme` answers: the frozen theme, or the first failure. The
 * rejection is part of the public contract — a host bootstrap has to be able to
 * name what it caught — so it is spelled out here rather than hidden behind a
 * private alias.
 */
export type ThemeValidationResult =
  | { readonly ok: true; readonly theme: FacetTheme }
  | {
      readonly ok: false;
      readonly code: string;
      readonly at: string;
      readonly detail: string;
    };

/**
 * The rejection branch, derived from the public result. Deriving it keeps the
 * private name out of every emitted signature.
 */
type ThemeRejection = Extract<ThemeValidationResult, { readonly ok: false }>;

/**
 * The token vocabulary at runtime, in projection order.
 *
 * `satisfies` pins every group and every name here to a real field of
 * `FacetTheme`, so nothing in this table can drift away from the type. The
 * opposite direction — a token declared by the type but missing here — is pinned
 * at runtime by the exhaustive-theme test: a complete `FacetTheme` literal would
 * fail validation for a token this table never asks for.
 */
const TOKEN_NAMES = {
  color: [
    "background",
    "surface",
    "border",
    "text",
    "textMuted",
    "accent",
    "onAccent",
    "success",
    "warning",
    "danger",
  ],
  space: ["xs", "sm", "md", "lg", "xl"],
  radius: ["sm", "md", "lg", "full"],
  borderWidth: ["thin", "thick"],
  shadow: ["sm", "md", "lg"],
  fontFamily: ["sans", "mono"],
  fontSize: ["xs", "sm", "md", "lg", "xl"],
  fontWeight: ["regular", "medium", "bold"],
  lineHeight: ["tight", "normal", "relaxed"],
} as const satisfies { readonly [G in keyof FacetTheme]: readonly (keyof FacetTheme[G])[] };

/**
 * The group names, in projection order. Derived from the table rather than
 * restated, so the group vocabulary lives in exactly one place; `satisfies`
 * above already ties those keys to `FacetTheme`.
 */
const TOKEN_GROUPS = Object.keys(TOKEN_NAMES) as readonly (keyof typeof TOKEN_NAMES)[];

/** The prefix every projected custom property carries. */
const CSS_VAR_PREFIX = "--facet";

/** Characters that could close or reopen a CSS declaration. */
const FORBIDDEN_VALUE_PATTERN = /[;{}<>\\]/;

const CONTROL_CHARACTER_CEILING = 0x20;
const DELETE_CHARACTER = 0x7f;

/**
 * Whether a value carries a control character. Checked by code point rather than
 * through a regular expression, so no control character has to appear in this
 * source for the rule to exist.
 */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < CONTROL_CHARACTER_CEILING || code === DELETE_CHARACTER) {
      return true;
    }
  }
  return false;
}

function reject(code: string, at: string, detail: string): ThemeRejection {
  return { ok: false, code, at, detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** camelCase to kebab-case. Every group and token name is ASCII camelCase. */
function toKebabCase(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** The custom property one token projects to, e.g. `color.textMuted` → `--facet-color-text-muted`. */
function cssVarName(group: string, token: string): string {
  return `${CSS_VAR_PREFIX}-${toKebabCase(group)}-${toKebabCase(token)}`;
}

/**
 * Reads one token from a candidate group without trusting it. `token` is always
 * a literal from the closed table above, `Object.hasOwn` keeps an inherited
 * value from standing in for a declared one, and a throwing accessor reads as
 * absent rather than propagating.
 */
function readToken(group: unknown, token: string): string | undefined {
  try {
    if (!isRecord(group) || !Object.hasOwn(group, token)) {
      return undefined;
    }
    const value = group[token];
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Validates a theme and returns it frozen.
 *
 * The whole theme is rejected on its first fault rather than partially accepted:
 * a half-filled token contract would leave components reading names that resolve
 * to nothing. The accepted theme is rebuilt from the closed table, so the value
 * that reaches the renderer holds the contract's tokens and nothing else, even
 * if the host handed over an object with stranger machinery attached.
 */
export function validateTheme(value: unknown): ThemeValidationResult {
  try {
    return validateThemeShape(value);
  } catch {
    return reject("theme_read_failed", "", "Reading the theme threw; it must be plain data.");
  }
}

function validateThemeShape(value: unknown): ThemeValidationResult {
  if (!isRecord(value)) {
    return reject("theme_not_an_object", "", "A theme must be a plain object.");
  }
  const groupNames: readonly string[] = TOKEN_GROUPS;
  const unknownGroup = Object.keys(value)
    .sort()
    .find((key) => !groupNames.includes(key));
  if (unknownGroup !== undefined) {
    return reject(
      "unknown_token_group",
      unknownGroup,
      "The token contract is closed; it has no group by this name.",
    );
  }

  const theme: Record<string, Readonly<Record<string, string>>> = {};
  for (const group of TOKEN_GROUPS) {
    const resolved = validateTokenGroup(value[group], group);
    if (!resolved.ok) {
      return resolved;
    }
    theme[group] = resolved.tokens;
  }
  // The loop above has just proven every declared group and token present, of
  // the declared type, and within the value grammar, which is what this
  // assertion stands on; the exhaustive-theme test re-proves it at run time.
  return { ok: true, theme: Object.freeze(theme) as unknown as FacetTheme };
}

/** What one group's validation answers: its frozen tokens, or the first failure. */
type TokenGroupResult =
  { readonly ok: true; readonly tokens: Readonly<Record<string, string>> } | ThemeRejection;

/**
 * Validates one token group against the closed name list, and returns it frozen
 * and rebuilt. Names are read in table order, so the first failure a host sees
 * for a given fault is always the same one.
 */
function validateTokenGroup(raw: unknown, group: keyof typeof TOKEN_NAMES): TokenGroupResult {
  if (!isRecord(raw)) {
    return reject("token_group_not_an_object", group, "A token group is a plain object.");
  }
  const tokens: readonly string[] = TOKEN_NAMES[group];
  const unknownToken = Object.keys(raw)
    .sort()
    .find((key) => !tokens.includes(key));
  if (unknownToken !== undefined) {
    return reject(
      "unknown_token_name",
      `${group}.${unknownToken}`,
      "The token contract is closed; it has no token by this name.",
    );
  }
  const resolved: Record<string, string> = {};
  for (const token of tokens) {
    const at = `${group}.${token}`;
    if (!Object.hasOwn(raw, token)) {
      return reject("missing_token", at, "The token contract requires this token.");
    }
    const candidate = raw[token];
    if (typeof candidate !== "string") {
      return reject("token_not_a_string", at, "A token value is a CSS-ready string.");
    }
    if (candidate.trim().length === 0) {
      return reject("token_empty", at, "A token value must resolve to something.");
    }
    if (FORBIDDEN_VALUE_PATTERN.test(candidate) || hasControlCharacter(candidate)) {
      return reject(
        "token_value_not_allowed",
        at,
        "A token value may not contain ; { } < > \\ or a control character.",
      );
    }
    resolved[token] = candidate;
  }
  return { ok: true, tokens: Object.freeze(resolved) };
}

/**
 * Projects a theme to the CSS custom properties trusted components read.
 *
 * Pure and deterministic: the projection walks the closed table in a fixed
 * order, so the same theme always yields the same variables in the same order,
 * and nothing is read from the environment. A token that is absent or not a
 * string is omitted rather than guessed at — `validateTheme` is the place that
 * turns an incomplete theme into a rejection.
 */
export function themeToCssVars(theme: FacetTheme): Readonly<Record<string, string>> {
  const vars: Record<string, string> = {};
  for (const group of TOKEN_GROUPS) {
    const groupValue = readGroup(theme, group);
    for (const token of TOKEN_NAMES[group]) {
      const value = readToken(groupValue, token);
      if (value !== undefined) {
        vars[cssVarName(group, token)] = value;
      }
    }
  }
  return Object.freeze(vars);
}

/** Reads one group off a candidate theme without trusting the object it came from. */
function readGroup(theme: unknown, group: string): unknown {
  try {
    if (!isRecord(theme) || !Object.hasOwn(theme, group)) {
      return undefined;
    }
    return theme[group];
  } catch {
    return undefined;
  }
}
