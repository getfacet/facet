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

import { completeThemeInput, validTestTheme } from "../../../../test-support/theme-fixture.js";
import { resolveTheme } from "./theme.js";

const LIGHT: FacetTheme = validTestTheme({
  semantic: {
    action: { primaryBg: "#1d4ed8" },
    surface: { default: "#ffffff" },
    text: { default: "#101010", muted: "#6b6b6b" },
  },
});

const DARK: FacetTheme = validTestTheme({
  semantic: {
    action: { primaryBg: "#7dd3fc" },
    surface: { default: "#17171d" },
    text: { default: "#f2f2f5", muted: "#9a9aa6" },
  },
});

/** A theme with one token removed, built without mutating the fixture. */
function withoutAccent(): unknown {
  const theme = completeThemeInput();
  const semantic = theme["semantic"] as Record<string, Record<string, unknown>>;
  delete semantic["action"]?.["primaryBg"];
  return theme;
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
    expect(light.theme.semantic.surface.default).toBe("#ffffff");
    expect(dark.theme.semantic.surface.default).toBe("#17171d");
    expect(themeToCssVars(light.theme)).not.toEqual(themeToCssVars(dark.theme));
    expect(themeToCssVars(dark.theme)["--facet-semantic-surface-default"]).toBe("#17171d");
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
    expect(result.at).toBe("semantic.action.primaryBg");
  });

  it("carries them for an unknown group, an unknown token, and a hostile value", () => {
    const unknownGroup = resolveTheme({ ...LIGHT, spacing: {} });
    const unknownToken = resolveTheme({
      ...LIGHT,
      semantic: { ...LIGHT.semantic, text: { ...LIGHT.semantic.text, brand: "#000000" } },
    });
    const hostileValue = resolveTheme({
      ...LIGHT,
      semantic: {
        ...LIGHT.semantic,
        text: { ...LIGHT.semantic.text, default: "red; position: fixed" },
      },
    });

    expect(unknownGroup).toMatchObject({ ok: false, code: "unknown_token_group", at: "spacing" });
    expect(unknownToken).toMatchObject({
      ok: false,
      code: "unknown_token_name",
      at: "semantic.text.brand",
    });
    expect(hostileValue).toMatchObject({
      ok: false,
      code: "token_value_not_allowed",
      at: "semantic.text.default",
    });
    for (const result of [unknownGroup, unknownToken, hostileValue]) {
      expect("theme" in result).toBe(false);
    }
  });

  it("never throws, whatever the host handed over", () => {
    const throwing = {
      get foundation(): never {
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
    const firstParameter = signature?.[1]?.split(",")[0]?.trim();
    expect(firstParameter).toBe("bootstrapTheme: unknown");
    expect(firstParameter).not.toContain("=");
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
