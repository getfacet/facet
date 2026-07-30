import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { BOUNDS } from "./bounds.js";
import { themeToCssVars, validateTheme } from "./theme.js";
import type { FacetTheme, ThemeValidationResult } from "./theme.js";

/**
 * One exhaustive theme, written out by hand and typed as `FacetTheme`.
 *
 * This literal is the **bidirectional pin** between the type's token-name unions
 * and the runtime token table inside `theme.ts`, and it closes both directions
 * at run time rather than only under `tsc`:
 *
 * - a token the *type* declares but the table omits ends up here (the type
 *   requires it) and `validateTheme` rejects it as an unknown token name; and
 * - a token the *table* requires but the type omits cannot be written here (the
 *   type forbids it) and `validateTheme` rejects the theme as missing a token.
 *
 * Either way the acceptance test below fails, so the two statements of the
 * vocabulary cannot drift apart.
 */
const SAMPLE_THEME: FacetTheme = {
  color: {
    background: "#ffffff",
    surface: "#f7f7f8",
    border: "#e4e4e7",
    text: "#18181b",
    textMuted: "#71717a",
    accent: "#2563eb",
    onAccent: "#ffffff",
    success: "#15803d",
    warning: "#b45309",
    danger: "#b91c1c",
  },
  space: { xs: "0.25rem", sm: "0.5rem", md: "1rem", lg: "1.5rem", xl: "2.5rem" },
  radius: { sm: "0.25rem", md: "0.5rem", lg: "1rem", full: "9999px" },
  borderWidth: { thin: "1px", thick: "2px" },
  shadow: {
    sm: "0 1px 2px rgba(0, 0, 0, 0.06)",
    md: "0 4px 12px rgba(0, 0, 0, 0.08)",
    lg: "0 12px 32px rgba(0, 0, 0, 0.12)",
  },
  fontFamily: { sans: "'Inter', system-ui, sans-serif", mono: "'JetBrains Mono', monospace" },
  fontSize: { xs: "0.75rem", sm: "0.875rem", md: "1rem", lg: "1.25rem", xl: "2rem" },
  fontWeight: { regular: "400", medium: "500", bold: "700" },
  lineHeight: { tight: "1.2", normal: "1.5", relaxed: "1.7" },
};

/**
 * The complete CSS custom-property projection, in order. Every row is written
 * out rather than derived, so a renamed token, a changed prefix, or a different
 * camelCase-to-kebab-case rule fails exactly one row of a readable table.
 */
const PROJECTION_TABLE: ReadonlyArray<readonly [string, string]> = [
  ["--facet-color-background", "#ffffff"],
  ["--facet-color-surface", "#f7f7f8"],
  ["--facet-color-border", "#e4e4e7"],
  ["--facet-color-text", "#18181b"],
  ["--facet-color-text-muted", "#71717a"],
  ["--facet-color-accent", "#2563eb"],
  ["--facet-color-on-accent", "#ffffff"],
  ["--facet-color-success", "#15803d"],
  ["--facet-color-warning", "#b45309"],
  ["--facet-color-danger", "#b91c1c"],
  ["--facet-space-xs", "0.25rem"],
  ["--facet-space-sm", "0.5rem"],
  ["--facet-space-md", "1rem"],
  ["--facet-space-lg", "1.5rem"],
  ["--facet-space-xl", "2.5rem"],
  ["--facet-radius-sm", "0.25rem"],
  ["--facet-radius-md", "0.5rem"],
  ["--facet-radius-lg", "1rem"],
  ["--facet-radius-full", "9999px"],
  ["--facet-border-width-thin", "1px"],
  ["--facet-border-width-thick", "2px"],
  ["--facet-shadow-sm", "0 1px 2px rgba(0, 0, 0, 0.06)"],
  ["--facet-shadow-md", "0 4px 12px rgba(0, 0, 0, 0.08)"],
  ["--facet-shadow-lg", "0 12px 32px rgba(0, 0, 0, 0.12)"],
  ["--facet-font-family-sans", "'Inter', system-ui, sans-serif"],
  ["--facet-font-family-mono", "'JetBrains Mono', monospace"],
  ["--facet-font-size-xs", "0.75rem"],
  ["--facet-font-size-sm", "0.875rem"],
  ["--facet-font-size-md", "1rem"],
  ["--facet-font-size-lg", "1.25rem"],
  ["--facet-font-size-xl", "2rem"],
  ["--facet-font-weight-regular", "400"],
  ["--facet-font-weight-medium", "500"],
  ["--facet-font-weight-bold", "700"],
  ["--facet-line-height-tight", "1.2"],
  ["--facet-line-height-normal", "1.5"],
  ["--facet-line-height-relaxed", "1.7"],
];

/**
 * A mutable copy of the sample, one loose record per group, so a test can plant
 * exactly one fault. Written group by group so that adding a group to
 * `FacetTheme` without extending this helper is a compile error.
 */
type ThemeDraft = { -readonly [G in keyof FacetTheme]: Record<string, unknown> };

function themeDraft(): ThemeDraft {
  return {
    color: { ...SAMPLE_THEME.color },
    space: { ...SAMPLE_THEME.space },
    radius: { ...SAMPLE_THEME.radius },
    borderWidth: { ...SAMPLE_THEME.borderWidth },
    shadow: { ...SAMPLE_THEME.shadow },
    fontFamily: { ...SAMPLE_THEME.fontFamily },
    fontSize: { ...SAMPLE_THEME.fontSize },
    fontWeight: { ...SAMPLE_THEME.fontWeight },
    lineHeight: { ...SAMPLE_THEME.lineHeight },
  };
}

/** Unwraps an accepted result and pins the success branch's exact key set. */
function accepted(result: ThemeValidationResult): FacetTheme {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error("expected an accepted theme");
  }
  expect(Object.keys(result).sort()).toEqual(["ok", "theme"]);
  return result.theme;
}

/**
 * Pins a rejection: one structured error, never an aggregated list. The detail
 * is framework copy, so it is bounded by `B-24` like every other such string.
 */
function rejected(result: ThemeValidationResult, code: string, at: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("expected a rejection");
  }
  expect(Object.keys(result).sort()).toEqual(["at", "code", "detail", "ok"]);
  expect(result.code).toBe(code);
  expect(result.at).toBe(at);
  expect(result.detail.length).toBeGreaterThan(0);
  expect(result.detail.length).toBeLessThanOrEqual(BOUNDS.frameworkCopyChars);
}

describe("the token-name contract is closed", () => {
  it("accepts a theme that fills exactly the declared token names", () => {
    // The bidirectional pin: see SAMPLE_THEME's note. A drift in either
    // direction between the type and the runtime table fails right here.
    expect(accepted(validateTheme(SAMPLE_THEME))).toEqual(SAMPLE_THEME);
  });

  it("declares nine token groups and thirty-seven token names", () => {
    expect(Object.keys(SAMPLE_THEME)).toEqual([
      "color",
      "space",
      "radius",
      "borderWidth",
      "shadow",
      "fontFamily",
      "fontSize",
      "fontWeight",
      "lineHeight",
    ]);
    expect(PROJECTION_TABLE).toHaveLength(37);
  });

  it("REJECTS an unknown token name rather than passing it through", () => {
    const draft = themeDraft();
    draft.color["brandPurple"] = "#7c3aed";
    rejected(validateTheme(draft), "unknown_token_name", "color.brandPurple");
  });

  it("REJECTS an unknown token group rather than passing it through", () => {
    const draft: Record<string, unknown> = { ...themeDraft(), motion: { fast: "120ms" } };
    rejected(validateTheme(draft), "unknown_token_group", "motion");
  });

  it("rejects a theme that omits a declared token", () => {
    const draft = themeDraft();
    delete draft.space["md"];
    rejected(validateTheme(draft), "missing_token", "space.md");
  });

  it("rejects a group that is not a plain object", () => {
    const draft: Record<string, unknown> = { ...themeDraft(), radius: "0.5rem" };
    rejected(validateTheme(draft), "token_group_not_an_object", "radius");
  });

  it("reports the sorted-first unknown name, so the failure never depends on key order", () => {
    const draft = themeDraft();
    draft.color["zeta"] = "#000000";
    draft.color["alpha"] = "#000000";
    rejected(validateTheme(draft), "unknown_token_name", "color.alpha");
  });

  it("rebuilds the accepted theme, so a getter cannot re-answer later", () => {
    const draft = themeDraft();
    Object.defineProperty(draft.color, "accent", {
      get: () => "#2563eb",
      enumerable: true,
      configurable: true,
    });
    const theme = accepted(validateTheme(draft));
    expect(theme.color.accent).toBe("#2563eb");
    expect(Object.getOwnPropertyDescriptor(theme.color, "accent")?.get).toBeUndefined();
    expect(Object.isFrozen(theme)).toBe(true);
    expect(Object.isFrozen(theme.color)).toBe(true);
  });
});

describe("token values are closed too", () => {
  it("rejects a non-string token value", () => {
    const draft = themeDraft();
    draft.fontWeight["bold"] = 700;
    rejected(validateTheme(draft), "token_not_a_string", "fontWeight.bold");
  });

  it("rejects an empty or whitespace-only token value", () => {
    const empty = themeDraft();
    empty.space["md"] = "";
    rejected(validateTheme(empty), "token_empty", "space.md");

    const blank = themeDraft();
    blank.space["md"] = "   ";
    rejected(validateTheme(blank), "token_empty", "space.md");
  });

  const forbidden: ReadonlyArray<{ readonly what: string; readonly value: string }> = [
    { what: "a declaration terminator", value: "red; display: none" },
    { what: "an opening brace", value: "red } body {" },
    { what: "a closing brace", value: "red}" },
    { what: "a tag opener", value: "red</style>" },
    { what: "a tag closer", value: "red>" },
    { what: "a backslash escape", value: "\\3c script" },
    { what: "a NUL", value: "red\u0000" },
    { what: "a newline", value: "red\n; display: none" },
    { what: "a delete control character", value: "red\u007f" },
  ];

  it.each(forbidden)("rejects a value carrying $what", ({ value }) => {
    const draft = themeDraft();
    draft.color["accent"] = value;
    rejected(validateTheme(draft), "token_value_not_allowed", "color.accent");
  });

  it("accepts the ordinary CSS a real theme needs", () => {
    const theme = accepted(validateTheme(SAMPLE_THEME));
    expect(theme.shadow.md).toBe("0 4px 12px rgba(0, 0, 0, 0.08)");
    expect(theme.fontFamily.sans).toBe("'Inter', system-ui, sans-serif");
  });
});

describe("validateTheme is total", () => {
  const hostile: ReadonlyArray<{ readonly what: string; readonly value: unknown }> = [
    { what: "null", value: null },
    { what: "undefined", value: undefined },
    { what: "a number", value: 42 },
    { what: "a string", value: "theme" },
    { what: "a boolean", value: false },
    { what: "an array", value: [] },
    { what: "a function", value: () => SAMPLE_THEME },
    { what: "a symbol", value: Symbol("theme") },
  ];

  it.each(hostile)("rejects $what without throwing", ({ value }) => {
    expect(() => validateTheme(value)).not.toThrow();
    rejected(validateTheme(value), "theme_not_an_object", "");
  });

  it("rejects a throwing group accessor without throwing", () => {
    const throwing = {
      get color(): unknown {
        throw new Error("hostile getter");
      },
    };
    expect(() => validateTheme(throwing)).not.toThrow();
    rejected(validateTheme(throwing), "theme_read_failed", "");
  });

  it("rejects a throwing token accessor without throwing", () => {
    const draft = themeDraft();
    Object.defineProperty(draft.color, "background", {
      get: () => {
        throw new Error("hostile getter");
      },
      enumerable: true,
      configurable: true,
    });
    expect(() => validateTheme(draft)).not.toThrow();
    rejected(validateTheme(draft), "theme_read_failed", "");
  });

  it("accepts a null-prototype theme built from the same tokens", () => {
    const bare = Object.assign(Object.create(null) as Record<string, unknown>, themeDraft());
    expect(accepted(validateTheme(bare))).toEqual(SAMPLE_THEME);
  });
});

describe("themeToCssVars projects the theme to custom properties", () => {
  it("emits the complete projection table, in order", () => {
    expect(Object.entries(themeToCssVars(SAMPLE_THEME))).toEqual(PROJECTION_TABLE);
  });

  it("emits one variable per declared token and nothing else", () => {
    const vars = themeToCssVars(SAMPLE_THEME);
    expect(Object.keys(vars)).toHaveLength(37);
    for (const name of Object.keys(vars)) {
      expect(name).toMatch(/^--facet(?:-[a-z0-9]+)+$/);
    }
  });

  it("is deterministic — byte-identical output across repeat runs", () => {
    const first = JSON.stringify(themeToCssVars(SAMPLE_THEME));
    const second = JSON.stringify(themeToCssVars(SAMPLE_THEME));
    const third = JSON.stringify(themeToCssVars(accepted(validateTheme(SAMPLE_THEME))));
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("is pure — it neither mutates its input nor hands back a mutable map", () => {
    const before = JSON.stringify(SAMPLE_THEME);
    const vars = themeToCssVars(SAMPLE_THEME);
    expect(JSON.stringify(SAMPLE_THEME)).toBe(before);
    expect(Object.isFrozen(vars)).toBe(true);
  });

  it("omits a token that is absent or not a string rather than guessing at one", () => {
    const draft = themeDraft();
    delete draft.radius["full"];
    draft.shadow["lg"] = 12;
    const vars = themeToCssVars(draft as unknown as FacetTheme);
    expect(vars["--facet-radius-full"]).toBeUndefined();
    expect(vars["--facet-shadow-lg"]).toBeUndefined();
    expect(vars["--facet-radius-lg"]).toBe("1rem");
  });

  it("never throws, even on input that never passed validation", () => {
    const throwing = {
      get color(): unknown {
        throw new Error("hostile getter");
      },
    };
    expect(() => themeToCssVars(throwing as unknown as FacetTheme)).not.toThrow();
    expect(() => themeToCssVars(null as unknown as FacetTheme)).not.toThrow();
    expect(themeToCssVars(null as unknown as FacetTheme)).toEqual({});
  });
});

describe("the module carries no React and no DOM", () => {
  const source = readFileSync(new URL("./theme.ts", import.meta.url), "utf8");

  it("imports nothing at all, so it can carry no dependency of any kind", () => {
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toMatch(/\bfrom\s+["']/);
  });

  it("touches no DOM global and no nondeterministic source", () => {
    expect(source).not.toMatch(/\b(?:document|window|navigator|globalThis)\s*[.[]/);
    expect(source).not.toMatch(/\bMath\.random\b|\bDate\.now\b|\bnew Date\b/);
  });
});
