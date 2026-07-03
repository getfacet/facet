import { describe, expect, it } from "vitest";
import { isValidThemeName, validateTheme } from "./theme.js";
import type { FacetTheme } from "./theme.js";

/** Every issue carrying severity "error" refuses the whole document. */
function hasError(issues: readonly { severity: "error" | "warning" }[]): boolean {
  return issues.some((i) => i.severity === "error");
}

describe("isValidThemeName", () => {
  it("accepts short filename-safe identifiers and rejects the rest", () => {
    for (const ok of ["brand", "midnight-2", "A_b", "x", "x".repeat(64)]) {
      expect(isValidThemeName(ok)).toBe(true);
    }
    for (const bad of [
      "",
      "-lead",
      "has space",
      "brand\x00",
      "x".repeat(65),
      "a".repeat(100_000),
    ]) {
      expect(isValidThemeName(bad)).toBe(false);
    }
  });
});

describe("validateTheme", () => {
  it("rejects url and expression color values as errors", () => {
    const withUrl = validateTheme({ name: "x", color: { accent: "url(https://evil)" } });
    expect(withUrl.theme).toBeUndefined();
    expect(hasError(withUrl.issues)).toBe(true);

    const withExpression = validateTheme({ name: "x", color: { accent: "expression(alert(1))" } });
    expect(withExpression.theme).toBeUndefined();
    expect(hasError(withExpression.issues)).toBe(true);
  });

  it("refuses hostile CSS values (var/javascript:/injection chars) as errors", () => {
    const hostile: unknown[] = [
      { name: "x", color: { accent: "var(--x)" } },
      { name: "x", color: { accent: "#fff;background:red" } },
      { name: "x", space: { md: "16px}injected{" } },
      { name: "x", color: { fg: "javascript:alert(1)" } },
      { name: "x", color: { fg: "</style><script>" } },
      { name: "x", color: { fg: "#fff`" } },
      { name: "x", color: { fg: "expr\x00ession" } },
    ];
    for (const doc of hostile) {
      const result = validateTheme(doc);
      expect(result.theme, JSON.stringify(doc)).toBeUndefined();
      expect(hasError(result.issues), JSON.stringify(doc)).toBe(true);
    }
  });

  it("never resolves __proto__/constructor/prototype keys and returns null-proto maps", () => {
    // JSON.parse (the real operator-input path) makes __proto__ an OWN key,
    // unlike an object literal which would set the prototype.
    const input = JSON.parse(
      '{"name":"x","color":{"accent":"#123456","__proto__":"#000000","constructor":"#111111","prototype":"#222222"}}',
    );
    const { theme, issues } = validateTheme(input);
    expect(theme).toBeDefined();
    const color = (theme as FacetTheme).color!;
    expect(color.accent).toBe("#123456");
    expect(Object.getPrototypeOf(color)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(color, "__proto__")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(color, "constructor")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(color, "prototype")).toBe(false);
    // The forbidden keys were dropped, not silently absorbed.
    expect(hasError(issues)).toBe(false);
    // Global prototype was not polluted.
    expect(({} as Record<string, unknown>).accent).toBeUndefined();
  });

  it("clamps an over-large dimension with a warning but keeps the document", () => {
    const { theme, issues } = validateTheme({ name: "x", space: { md: "9999999px" } });
    expect(theme).toBeDefined();
    expect((theme as FacetTheme).space!.md).toBe("512px");
    expect(issues.some((i) => i.severity === "warning")).toBe(true);
    expect(hasError(issues)).toBe(false);
  });

  it("clamps an out-of-range fontWeight with a warning", () => {
    const { theme, issues } = validateTheme({ name: "x", fontWeight: { bold: 999999 } });
    expect(theme).toBeDefined();
    expect((theme as FacetTheme).fontWeight!.bold).toBe(1000);
    expect(issues.some((i) => i.severity === "warning")).toBe(true);
  });

  it("warns (never rejects) on a low-contrast pair, naming the pair and ratio", () => {
    const { theme, issues } = validateTheme({
      name: "x",
      color: { fg: "#777777", bg: "#888888" },
    });
    expect(theme).toBeDefined();
    const warning = issues.find(
      (i) =>
        i.severity === "warning" &&
        i.message.includes("fg") &&
        i.message.includes("bg") &&
        /\d\.\d\d/.test(i.message),
    );
    expect(warning).toBeDefined();
    expect(hasError(issues)).toBe(false);
  });

  it("warns on a partial override whose EFFECTIVE pair is low-contrast (dark bg only)", () => {
    // Overriding only `bg` to black leaves the default `fg` (#1a1d23) rendering
    // on it — an effective ratio far below 4.5. The check overlays the default
    // for the un-overridden member, so this must warn even though only one of the
    // pair is present in the document.
    const { theme, issues } = validateTheme({ name: "dark", color: { bg: "#000000" } });
    expect(theme).toBeDefined();
    const warning = issues.find(
      (i) =>
        i.severity === "warning" &&
        i.message.includes("fg") &&
        i.message.includes("bg") &&
        i.message.toLowerCase().includes("contrast"),
    );
    expect(warning).toBeDefined();
  });

  it("does not warn when every EFFECTIVE pair is high-contrast", () => {
    // All pair members are overridden to high-contrast values, so no pair — not
    // even one measured against a default partner — falls below the floor.
    const { theme, issues } = validateTheme({
      name: "x",
      color: {
        fg: "#ffffff",
        "fg-muted": "#cccccc",
        bg: "#000000",
        accent: "#000000",
        "accent-fg": "#ffffff",
      },
    });
    expect(theme).toBeDefined();
    expect(issues.some((i) => i.message.toLowerCase().includes("contrast"))).toBe(false);
  });

  it("drops unknown token and group keys with a warning but keeps the document", () => {
    const { theme, issues } = validateTheme({
      name: "x",
      color: { accent: "#abcdef", bogusToken: "#fff" },
      bogusGroup: { anything: 1 },
    });
    expect(theme).toBeDefined();
    expect((theme as FacetTheme).color!.accent).toBe("#abcdef");
    expect(Object.prototype.hasOwnProperty.call((theme as FacetTheme).color!, "bogusToken")).toBe(
      false,
    );
    expect(issues.filter((i) => i.severity === "warning").length).toBeGreaterThanOrEqual(2);
    expect(hasError(issues)).toBe(false);
  });

  it("never echoes an over-long group key into an issue string (caps it)", () => {
    const bigKey = "z".repeat(10_000_000);
    const { issues } = validateTheme({ name: "x", color: { [bigKey]: "#fff" } });
    expect(issues.some((i) => i.message.includes("<key too long>"))).toBe(true);
    // The raw 10MB key never reaches the issue text (would flood operator logs).
    expect(issues.some((i) => i.message.includes(bigKey))).toBe(false);
  });

  it("never echoes a control/escape-sequence group key into an issue string", () => {
    const escKey = "\x1b[31maccent";
    const { issues } = validateTheme({ name: "x", color: { [escKey]: "#fff" } });
    expect(issues.some((i) => i.message.includes("<unprintable key>"))).toBe(true);
    // The raw escape sequence never reaches operator terminals via the issue.
    expect(issues.some((i) => i.message.includes(escKey))).toBe(false);
  });

  it("caps the per-document issues array so a junk-key group cannot balloon it", () => {
    const group: Record<string, string> = {};
    for (let i = 0; i < 100_000; i++) group[`k${String(i)}`] = "#fff";
    const { issues } = validateTheme({ name: "x", color: group });
    // 64 real issues + a single suppression tail entry.
    expect(issues.length).toBeLessThanOrEqual(65);
    expect(issues[issues.length - 1]?.message).toContain("further issues suppressed");
  });

  it("rejects a missing or malformed name as an error", () => {
    for (const doc of [
      {},
      { name: 7 },
      { name: "" },
      { name: "has space" },
      { name: "a".repeat(65) },
    ]) {
      const result = validateTheme(doc);
      expect(result.theme, JSON.stringify(doc)).toBeUndefined();
      expect(hasError(result.issues)).toBe(true);
    }
  });

  it("never throws on junk input and reports an error", () => {
    for (const junk of [null, undefined, 42, "str", [], true, NaN]) {
      let result: ReturnType<typeof validateTheme> | undefined;
      expect(() => {
        result = validateTheme(junk);
      }).not.toThrow();
      expect(result!.theme).toBeUndefined();
      expect(hasError(result!.issues)).toBe(true);
    }
  });

  it("never throws on an object whose property accessor throws (hostile getter)", () => {
    // A live in-process document (MemoryAssets, a DB adapter) can hand in a
    // proxy/getter that throws on read — the "NEVER throws" contract must hold.
    const throwers: unknown[] = [
      {
        name: "x",
        get color() {
          throw new Error("boom");
        },
      },
      {
        get name() {
          throw new Error("boom");
        },
      },
    ];
    for (const doc of throwers) {
      let result: ReturnType<typeof validateTheme> | undefined;
      expect(() => {
        result = validateTheme(doc);
      }).not.toThrow();
      expect(result!.theme).toBeUndefined();
      expect(hasError(result!.issues)).toBe(true);
    }
  });

  it("round-trips a valid partial document", () => {
    const doc = {
      name: "midnight",
      description: "dark theme",
      color: { bg: "#000000", fg: "#ffffff", accent: "rgb(80, 70, 229)" },
      space: { md: "16px" },
      fontWeight: { bold: 700 },
      ratio: { wide: "16 / 9" },
    };
    const { theme, issues } = validateTheme(doc);
    expect(theme).toBeDefined();
    const t = theme as FacetTheme;
    expect(t.name).toBe("midnight");
    expect(t.description).toBe("dark theme");
    expect(t.color!.bg).toBe("#000000");
    expect(t.color!.accent).toBe("rgb(80, 70, 229)");
    expect(t.space!.md).toBe("16px");
    expect(t.fontWeight!.bold).toBe(700);
    expect(t.ratio!.wide).toBe("16 / 9");
    expect(hasError(issues)).toBe(false);
  });
});
