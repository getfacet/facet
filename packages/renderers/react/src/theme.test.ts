/**
 * The proof that a session's theme comes from the host and from nowhere else.
 *
 * One claim carries this file: **a missing theme is a bootstrap error, not a
 * silent default.** The retired renderer answered an omitted theme with
 * `@facet/assets`'s `DEFAULT_THEME`, which made "the host owns the theme" a
 * convention rather than a rule — a page whose theme never arrived rendered
 * anyway, in someone else's palette, with nothing naming the omission
 * (RISK-API-7). So absence is tested from the outside: the refusal is asserted
 * to carry **no `theme` key at all**, which is the only assertion a fallback
 * cannot pass, and the absent code is asserted to be *different* from the code
 * `validateTheme` gives an unusable object, so "you sent nothing" and "you sent
 * something wrong" stay tellable apart.
 *
 * The second claim is narrower and just as easy to lose: `resolveTheme` **relays
 * the token contract rather than restating it**. Every rejection below is
 * asserted against a literal code and location written in this file — not
 * against a second call to `validateTheme`, which would agree with any
 * re-implementation as readily as with a relay.
 *
 * Two themes are used throughout rather than one. A function that returned a
 * constant satisfies every assertion made under a single theme, so the accepted
 * value is checked against two complete, disjoint token sets.
 *
 * The suite reads `node:fs` for a source scan, the same exception
 * `containment.test.ts` and `modal-frame.test.tsx` take. The scan states two
 * things a rendered value cannot: that this module names `@facet/assets`
 * nowhere, and that its one parameter carries **no default value** — a
 * defaulted parameter would swallow the very absence this file is about, and
 * every behavioural assertion here would still pass.
 */

import { themeToCssVars } from "@facet/core";
import type { FacetTheme } from "@facet/core";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { resolveTheme } from "./theme.js";

const LIGHT: FacetTheme = {
  color: {
    background: "#f7f7f7",
    surface: "#ffffff",
    border: "#dcdcdc",
    text: "#101010",
    textMuted: "#6b6b6b",
    accent: "#1d4ed8",
    onAccent: "#ffffff",
    success: "#15803d",
    warning: "#b45309",
    danger: "#b91c1c",
  },
  space: { xs: "0.25rem", sm: "0.5rem", md: "0.75rem", lg: "1rem", xl: "1.5rem" },
  radius: { sm: "2px", md: "6px", lg: "12px", full: "9999px" },
  borderWidth: { thin: "1px", thick: "2px" },
  shadow: {
    sm: "0 1px 2px rgba(0, 0, 0, 0.08)",
    md: "0 4px 8px rgba(0, 0, 0, 0.1)",
    lg: "0 12px 32px rgba(0, 0, 0, 0.2)",
  },
  fontFamily: { sans: "Inter, sans-serif", mono: "Menlo, monospace" },
  fontSize: { xs: "0.75rem", sm: "0.875rem", md: "1rem", lg: "1.25rem", xl: "1.75rem" },
  fontWeight: { regular: "400", medium: "500", bold: "700" },
  lineHeight: { tight: "1.2", normal: "1.5", relaxed: "1.7" },
};

const DARK: FacetTheme = {
  color: {
    background: "#0b0b0f",
    surface: "#17171d",
    border: "#33333d",
    text: "#f2f2f5",
    textMuted: "#9a9aa6",
    accent: "#7dd3fc",
    onAccent: "#04121b",
    success: "#4ade80",
    warning: "#fbbf24",
    danger: "#f87171",
  },
  space: { xs: "0.2rem", sm: "0.45rem", md: "0.7rem", lg: "1.1rem", xl: "1.6rem" },
  radius: { sm: "3px", md: "7px", lg: "14px", full: "8888px" },
  borderWidth: { thin: "2px", thick: "4px" },
  shadow: {
    sm: "0 1px 3px rgba(0, 0, 0, 0.5)",
    md: "0 5px 9px rgba(0, 0, 0, 0.6)",
    lg: "0 14px 36px rgba(0, 0, 0, 0.7)",
  },
  fontFamily: { sans: "Iosevka Aile, sans-serif", mono: "Iosevka, monospace" },
  fontSize: { xs: "0.7rem", sm: "0.8rem", md: "0.95rem", lg: "1.2rem", xl: "1.7rem" },
  fontWeight: { regular: "350", medium: "550", bold: "750" },
  lineHeight: { tight: "1.1", normal: "1.45", relaxed: "1.8" },
};

/** A theme with one token removed, built without mutating the fixture. */
function withoutAccent(): unknown {
  const color = Object.fromEntries(
    Object.entries(LIGHT.color).filter(([token]) => token !== "accent"),
  );
  return { ...LIGHT, color };
}

/** The rejection's keys, so a stray `theme` on the refusal branch is visible. */
function keysOf(value: object): readonly string[] {
  return Object.keys(value).sort();
}

function sourceOf(file: string): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), file), "utf8");
}

/**
 * Every module specifier a source imports, however the import is spelled.
 *
 * The dependency edge is what D-09 is about, so the scan reads the import
 * surface rather than the whole file: naming `@facet/assets` in a docblock —
 * which this module does, to say what it no longer reaches for — is not an edge.
 */
function importedModules(source: string): readonly string[] {
  return [...source.matchAll(/(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g)].map(
    (match) => match[1] ?? "",
  );
}

describe("a theme the host never supplied", () => {
  it("is refused with a code of its own and hands back nothing to render with", () => {
    const result = resolveTheme(undefined);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("an absent theme was accepted");
    }
    expect(result.code).toBe("missing_bootstrap_theme");
    expect(result.at).toBe("");
    expect(result.detail.length).toBeGreaterThan(0);
    // The assertion a fallback cannot pass. `toEqual` would ignore a `theme`
    // key whose value happened to be `undefined`, so the key set is read.
    expect(keysOf(result)).toEqual(["at", "code", "detail", "ok"]);
    expect("theme" in result).toBe(false);
  });

  it("refuses null the same way, since neither spelling of absence is a theme", () => {
    const result = resolveTheme(null);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("a null theme was accepted");
    }
    expect(result.code).toBe("missing_bootstrap_theme");
    expect("theme" in result).toBe(false);
  });

  it("says something different from what an unusable theme says", () => {
    // "You sent nothing" and "you sent something wrong" are different faults a
    // host fixes differently, so one code may not stand in for the other.
    const absent = resolveTheme(undefined);
    const unusable = resolveTheme("a theme, allegedly");

    expect(absent.ok).toBe(false);
    expect(unusable.ok).toBe(false);
    if (absent.ok || unusable.ok) {
      throw new Error("a fault was accepted");
    }
    expect(unusable.code).toBe("theme_not_an_object");
    expect(absent.code).not.toBe(unusable.code);
  });
});

describe("a complete theme", () => {
  it("is accepted, frozen, and rebuilt rather than borrowed", () => {
    const result = resolveTheme(LIGHT);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`a complete theme was refused: ${result.code}`);
    }
    expect(result.theme).toEqual(LIGHT);
    expect(Object.isFrozen(result.theme)).toBe(true);
    // The host keeps its own object; the session holds the contract's rebuild,
    // so a later mutation of the host's literal cannot reach the page.
    expect(result.theme).not.toBe(LIGHT);
  });

  it("answers with the theme it was handed, under two disjoint token sets", () => {
    // A constant satisfies every assertion made under a single theme.
    const light = resolveTheme(LIGHT);
    const dark = resolveTheme(DARK);

    expect(light.ok).toBe(true);
    expect(dark.ok).toBe(true);
    if (!light.ok || !dark.ok) {
      throw new Error("a complete theme was refused");
    }
    expect(light.theme.color.surface).toBe("#ffffff");
    expect(dark.theme.color.surface).toBe("#17171d");
    expect(themeToCssVars(light.theme)).not.toEqual(themeToCssVars(dark.theme));
    expect(themeToCssVars(dark.theme)["--facet-color-surface"]).toBe("#17171d");
  });
});

describe("an unusable theme", () => {
  it("carries the token contract's own code and location for a missing token", () => {
    const result = resolveTheme(withoutAccent());

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("an incomplete theme was accepted");
    }
    // Pinned literally rather than compared with a second `validateTheme` call:
    // a re-implementation would agree with that comparison as readily as a
    // relay does.
    expect(result.code).toBe("missing_token");
    expect(result.at).toBe("color.accent");
  });

  it("carries them for an unknown group, an unknown token, and a hostile value", () => {
    const unknownGroup = resolveTheme({ ...LIGHT, spacing: {} });
    const unknownToken = resolveTheme({ ...LIGHT, color: { ...LIGHT.color, brand: "#000000" } });
    const hostileValue = resolveTheme({
      ...LIGHT,
      color: { ...LIGHT.color, text: "red; position: fixed" },
    });

    expect(unknownGroup).toMatchObject({ ok: false, code: "unknown_token_group", at: "spacing" });
    expect(unknownToken).toMatchObject({
      ok: false,
      code: "unknown_token_name",
      at: "color.brand",
    });
    expect(hostileValue).toMatchObject({
      ok: false,
      code: "token_value_not_allowed",
      at: "color.text",
    });
    for (const result of [unknownGroup, unknownToken, hostileValue]) {
      expect("theme" in result).toBe(false);
    }
  });

  it("never throws, whatever the host handed over", () => {
    const throwing = {
      get color(): never {
        throw new Error("hostile theme");
      },
    };
    const revocable = Proxy.revocable({}, {});
    revocable.revoke();

    for (const candidate of [throwing, revocable.proxy, 42, [], true, Symbol("theme")]) {
      const result = resolveTheme(candidate);
      expect(result.ok).toBe(false);
      expect("theme" in result).toBe(false);
    }
    expect(resolveTheme(throwing)).toMatchObject({ ok: false, code: "theme_read_failed" });
  });
});

describe("what the module is written not to reach for", () => {
  it("imports nothing from @facet/assets and holds no default theme of its own", () => {
    const source = sourceOf("theme.ts");
    const imported = importedModules(source);

    // The positive control: the reader really does find this module's imports,
    // so the absence below is an absence rather than a regex that matches
    // nothing.
    expect(imported).toContain("@facet/core");
    for (const specifier of imported) {
      expect(specifier.startsWith("@facet/assets")).toBe(false);
    }
    expect(source).not.toContain("DEFAULT_THEME");
  });

  it("declares its one parameter with no default value", () => {
    // A defaulted parameter would swallow the absence this whole file is about,
    // and every behavioural assertion above would still pass.
    const source = sourceOf("theme.ts");
    const signature = /export function resolveTheme\(([^)]*)\)/.exec(source);

    expect(signature).not.toBeNull();
    expect(signature?.[1]).toBe("bootstrapTheme: unknown");
    expect(signature?.[1]).not.toContain("=");
  });

  it("relays rather than restates: it declares no token names of its own", () => {
    // The closed token vocabulary is `@facet/core`'s. A second copy here is how
    // a theme comes to be accepted by one reader and refused by the other.
    const source = sourceOf("theme.ts");
    const groups = Object.keys(LIGHT);

    for (const group of groups) {
      expect(source).not.toContain(`"${group}"`);
    }
    expect(source).toContain("validateTheme");
  });
});
