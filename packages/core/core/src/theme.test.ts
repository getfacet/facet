import { describe, expect, it } from "vitest";
import { BRICK_CONTRACT, BRICK_TYPES, type BrickType } from "./brick-contract.js";
import { isAllowedColor } from "./theme-color.js";
import {
  ASPECT_RATIOS,
  BORDER_WIDTHS,
  CHART_THICKNESSES,
  COLORS,
  CONTROL_HEIGHTS,
  FONT_FAMILIES,
  FONT_SIZES,
  FONT_WEIGHTS,
  GRADIENTS,
  HIGHLIGHTS,
  INDICATOR_SIZES,
  LETTER_SPACINGS,
  LINE_HEIGHTS,
  MAX_WIDTHS,
  MIN_HEIGHTS,
  PROGRESS_THICKNESSES,
  RADII,
  SCRIMS,
  SHADOWS,
  SPACES,
} from "./tokens.js";
import { validateTheme } from "./index.js";

const map = <K extends string, V>(keys: readonly K[], value: (key: K) => V): Record<K, V> =>
  Object.fromEntries(keys.map((key) => [key, value(key)])) as Record<K, V>;

function completeTheme(): Record<string, unknown> {
  const defaults = Object.fromEntries(
    BRICK_TYPES.map((brick) => [
      brick,
      Object.fromEntries(
        Object.keys(BRICK_CONTRACT[brick].style.targets).map((target) => [target, {}]),
      ),
    ]),
  );
  const paint = {
    color: map(COLORS, (name) => (name === "inherit" ? "inherit" : "#123456")),
    shadow: map(SHADOWS, (name) => (name === "none" ? "none" : "0 1px 2px rgba(0, 0, 0, 0.25)")),
    gradient: map(GRADIENTS, (name) =>
      name === "none" ? "none" : "linear-gradient(90deg, #000000 0%, #ffffff 100%)",
    ),
    scrim: map(SCRIMS, (name) => (name === "none" ? "transparent" : "rgba(0, 0, 0, 0.5)")),
    highlight: map(HIGHLIGHTS, (name) =>
      name === "none" ? "none" : "linear-gradient(90deg, #ffff00 0%, #ffff00 100%)",
    ),
  };

  return {
    name: "complete",
    description: "A complete test Theme.",
    tokens: {
      space: map(SPACES, () => "16px"),
      fontSize: map(FONT_SIZES, () => "16px"),
      fontFamily: map(FONT_FAMILIES, () => "sans-serif"),
      fontWeight: map(FONT_WEIGHTS, () => 400),
      radius: map(RADII, () => "8px"),
      borderWidth: map(BORDER_WIDTHS, () => "1px"),
      aspectRatio: map(ASPECT_RATIOS, (name) => (name === "auto" ? "auto" : "1 / 1")),
      minHeight: map(MIN_HEIGHTS, (name) => (name === "auto" ? "auto" : "100px")),
      maxWidth: map(MAX_WIDTHS, (name) => (name === "none" ? "none" : "100px")),
      letterSpacing: map(LETTER_SPACINGS, () => "0"),
      lineHeight: map(LINE_HEIGHTS, () => "1.5"),
      controlHeight: map(CONTROL_HEIGHTS, () => "32px"),
      indicatorSize: map(INDICATOR_SIZES, () => "16px"),
      progressThickness: map(PROGRESS_THICKNESSES, () => "4px"),
      chartThickness: map(CHART_THICKNESSES, () => "2px"),
      paint: { light: structuredClone(paint), dark: structuredClone(paint) },
    },
    defaults,
  };
}

function setToken(theme: Record<string, unknown>, group: string, value: unknown): void {
  const tokens = theme.tokens as Record<string, Record<string, unknown>>;
  const target = tokens[group]!;
  target[Object.keys(target)[0]!] = value;
}

function preset(style: Record<string, unknown> = {}): Record<string, unknown> {
  return { description: "Reusable treatment.", useWhen: "Use for this visual role.", style };
}

function expectValid(theme: Record<string, unknown>): void {
  const result = validateTheme(theme);
  expect(result.theme, result.issues.map(({ message }) => message).join("\n")).toBeDefined();
  expect(result.issues.some(({ severity }) => severity === "error")).toBe(false);
}

function expectInvalid(theme: unknown): void {
  const result = validateTheme(theme);
  expect(result.theme).toBeUndefined();
  expect(result.issues.some(({ severity }) => severity === "error")).toBe(true);
}

describe("validateTheme", () => {
  it("keeps opaque background acceptance aligned with the canonical color parser", () => {
    const corpus = [
      "#fff",
      "#ffffffff",
      "#ffffff00",
      "rgb(0, 127.5, 255)",
      "rgb(0%, 50%, 100%)",
      "rgb(0%, 2, 3%)",
      "rgb(256, 0, 0)",
      "hsl(-360, 100%, 50%)",
      "hsl(0, 101%, 50%)",
      "orange",
      "transparent",
      "inherit",
      "var(--paint)",
    ];

    for (const value of corpus) {
      const theme = completeTheme();
      const tokens = theme.tokens as Record<string, unknown>;
      const paint = tokens.paint as Record<string, unknown>;
      const light = paint.light as Record<string, Record<string, unknown>>;
      light.color!.background = value;
      expect(validateTheme(theme).theme !== undefined, value).toBe(isAllowedColor(value));
    }
  });

  it("keeps specific structural issues when an incomplete Theme cannot be contrast-checked", () => {
    const result = validateTheme({ name: "incomplete", tokens: {}, defaults: {} });

    expect(result.theme).toBeUndefined();
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          message: expect.stringMatching(/tokens\.paint.*missing or not an object/i),
        }),
      ]),
    );
    expect(result.issues).not.toContainEqual(
      expect.objectContaining({ message: "theme document threw during validation" }),
    );
  });

  it("returns light and dark contrast warnings through the public validator", () => {
    const result = validateTheme(completeTheme());

    expect(result.theme).toBeDefined();
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          message: expect.stringMatching(/paint\.light.*foreground.*background.*4\.5/i),
        }),
        expect.objectContaining({
          severity: "warning",
          message: expect.stringMatching(/paint\.dark.*foreground.*background.*4\.5/i),
        }),
      ]),
    );
  });

  it("accepts only a complete Theme with bounded Presets", () => {
    const valid = completeTheme();
    valid.presets = {
      box: {
        panel: preset({
          gap: "md",
          background: "surface",
          hover: { background: "accentSurface" },
        }),
      },
    };
    expectValid(valid);

    const missingGroup = completeTheme();
    delete (missingGroup.tokens as Record<string, unknown>).space;
    expectInvalid(missingGroup);

    const missingToken = completeTheme();
    delete ((missingToken.tokens as Record<string, Record<string, unknown>>).space ?? {}).md;
    expectInvalid(missingToken);

    const missingBrick = completeTheme();
    delete (missingBrick.defaults as Record<string, unknown>).table;
    expectInvalid(missingBrick);

    const missingTarget = completeTheme();
    delete ((missingTarget.defaults as Record<string, Record<string, unknown>>).input ?? {})
      .control;
    expectInvalid(missingTarget);

    const sixteen = completeTheme();
    sixteen.presets = {
      box: Object.fromEntries(Array.from({ length: 16 }, (_, index) => [`p${index}`, preset()])),
    };
    expectValid(sixteen);

    const seventeen = completeTheme();
    seventeen.presets = {
      box: Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`p${index}`, preset()])),
    };
    expectInvalid(seventeen);

    const sixtyFour = completeTheme();
    sixtyFour.presets = Object.fromEntries(
      (["box", "text", "media", "input"] as const).map((brick) => [
        brick,
        Object.fromEntries(Array.from({ length: 16 }, (_, index) => [`p${index}`, preset()])),
      ]),
    );
    expectValid(sixtyFour);

    const sixtyFive = structuredClone(sixtyFour);
    (sixtyFive.presets as Record<string, Record<string, unknown>>).richtext = {
      extra: preset(),
    };
    expectInvalid(sixtyFive);
  });

  it("enforces every concrete grammar boundary without clamping", () => {
    const cases: readonly [string, readonly unknown[], readonly unknown[]][] = [
      ["space", ["0", "0px", "256px", "16rem", "16em"], ["-1px", "257px", "16.0001rem"]],
      [
        "fontSize",
        ["8px", "256px", "0.5rem", "16em"],
        ["7px", "257px", "0.4999rem", "16.0001em", "0"],
      ],
      ["radius", ["0", "9999px", "625rem", "625em"], ["-1px", "10000px", "625.0001rem"]],
      ["borderWidth", ["0", "16px", "1rem", "1em"], ["-1px", "17px", "1.0001rem"]],
      [
        "controlHeight",
        ["16px", "256px", "1rem", "16em"],
        ["15px", "257px", "0.9999rem", "16.0001em"],
      ],
      [
        "indicatorSize",
        ["4px", "128px", "0.25rem", "8em"],
        ["3px", "129px", "0.2499rem", "8.0001em"],
      ],
      [
        "progressThickness",
        ["1px", "64px", "0.0625rem", "4em"],
        ["0px", "65px", "0.0624rem", "4.0001em"],
      ],
      [
        "chartThickness",
        ["1px", "32px", "0.0625rem", "2em"],
        ["0px", "33px", "0.0624rem", "2.0001em"],
      ],
      [
        "letterSpacing",
        ["0", "-16px", "16px", "-1rem", "1em"],
        ["-17px", "17px", "-1.0001rem", "1.0001em"],
      ],
      ["lineHeight", ["0.8", "3"], ["0.7999", "3.0001", "1rem"]],
    ];
    for (const [group, accepted, rejected] of cases) {
      for (const value of accepted) {
        const theme = completeTheme();
        setToken(theme, group, value);
        expectValid(theme);
      }
      for (const value of rejected) {
        const theme = completeTheme();
        setToken(theme, group, value);
        expectInvalid(theme);
      }
    }

    for (const value of [1, 1000]) {
      const theme = completeTheme();
      setToken(theme, "fontWeight", value);
      expectValid(theme);
    }
    for (const value of [0, 1001, 400.5, Number.POSITIVE_INFINITY]) {
      const theme = completeTheme();
      setToken(theme, "fontWeight", value);
      expectInvalid(theme);
    }

    for (const value of ["auto", "0.01 / 100", "100 / 0.01"]) {
      const theme = completeTheme();
      const token = value === "auto" ? "auto" : "square";
      (theme.tokens as Record<string, Record<string, unknown>>).aspectRatio![token] = value;
      expectValid(theme);
    }
    for (const value of ["0 / 1", "0.0099 / 1", "100.0001 / 1", "1/1", "auto "]) {
      const theme = completeTheme();
      (theme.tokens as Record<string, Record<string, unknown>>).aspectRatio!.square = value;
      expectInvalid(theme);
    }

    const dimensions: readonly [string, readonly string[], readonly string[]][] = [
      [
        "minHeight",
        ["auto", "0", "2000px", "125rem", "100svh"],
        ["-1px", "2001px", "125.0001rem", "100.0001svh", "1ch"],
      ],
      [
        "maxWidth",
        ["none", "0", "4096px", "256rem", "256em", "256ch"],
        ["-1px", "4097px", "256.0001rem", "1svh"],
      ],
    ];
    for (const [group, accepted, rejected] of dimensions) {
      for (const value of accepted) {
        const theme = completeTheme();
        setToken(theme, group, value);
        expectValid(theme);
      }
      for (const value of rejected) {
        const theme = completeTheme();
        setToken(theme, group, value);
        expectInvalid(theme);
      }
    }
  });

  it("strictly validates font, paint, gradient, and shadow values", () => {
    for (const value of ["A", "system-ui, -apple-system, 'Open_Sans'", "x".repeat(200)]) {
      const theme = completeTheme();
      setToken(theme, "fontFamily", value);
      expectValid(theme);
    }
    for (const value of ["", "x".repeat(201), "url(font)", "sans-serif; color:red", "emoji🙂"]) {
      const theme = completeTheme();
      setToken(theme, "fontFamily", value);
      expectInvalid(theme);
    }

    const light = (theme: Record<string, unknown>) =>
      ((theme.tokens as Record<string, unknown>).paint as Record<string, unknown>).light as Record<
        string,
        Record<string, unknown>
      >;

    for (const value of [
      "#fff",
      "#ffffffff",
      "rgb(0, 127.5, 255)",
      "rgb(0%, 50%, 100%)",
      "hsl(-360, 100%, 50%)",
      "orange",
    ]) {
      const theme = completeTheme();
      light(theme).color!.background = value;
      expectValid(theme);
    }
    for (const value of [
      "#ffffff00",
      "rgba(0,0,0,.5)",
      "rgb(256,0,0)",
      "rgb(0%,2,3%)",
      "transparent",
      "inherit",
      "var(--paint)",
    ]) {
      const theme = completeTheme();
      light(theme).color!.background = value;
      expectInvalid(theme);
    }

    const inherited = completeTheme();
    light(inherited).color!.inherit = "inherit";
    expectValid(inherited);
    const wrongInherited = completeTheme();
    light(wrongInherited).color!.inherit = "#ffffff";
    expectInvalid(wrongInherited);

    for (const value of [
      "none",
      "linear-gradient(-360deg, #000000 0%, transparent 100%)",
      "radial-gradient(circle at 0% 100%, #000000 0%, #ffffff 100%)",
      `linear-gradient(360deg, ${Array.from(
        { length: 8 },
        (_, index) => `#000000 ${index * 10}%`,
      ).join(", ")})`,
    ]) {
      const theme = completeTheme();
      light(theme).gradient!.accent = value;
      expectValid(theme);
    }
    for (const value of [
      "linear-gradient(360.0001deg, #000 0%, #fff 100%)",
      "linear-gradient(0deg, #000 60%, #fff 50%)",
      "linear-gradient(0deg, #000 0%)",
      `linear-gradient(0deg, ${Array.from({ length: 9 }, (_, index) => `#000 ${index * 10}%`).join(", ")})`,
      "radial-gradient(circle at 100.0001% 0%, #000 0%, #fff 100%)",
    ]) {
      const theme = completeTheme();
      light(theme).gradient!.accent = value;
      expectInvalid(theme);
    }

    for (const value of [
      "none",
      "-256px 256px 0 rgba(0, 0, 0, 0)",
      "inset 16rem -16em 256px -256px hsla(0, 100%, 50%, 1)",
      Array.from({ length: 4 }, () => "0 0 0 #000000").join(", "),
    ]) {
      const theme = completeTheme();
      light(theme).shadow!.sm = value;
      expectValid(theme);
    }
    for (const value of [
      "257px 0 0 #000",
      "0 0 -1px #000",
      "0 0 0 0 0 #000",
      "0 0 0 url(evil)",
      Array.from({ length: 5 }, () => "0 0 0 #000").join(", "),
    ]) {
      const theme = completeTheme();
      light(theme).shadow!.sm = value;
      expectInvalid(theme);
    }

    for (const value of ["rgba(0, 0, 0, 0)", "rgba(100%, 100%, 100%, 1)"]) {
      const theme = completeTheme();
      light(theme).scrim!.soft = value;
      expectValid(theme);
    }
    for (const value of ["transparent", "rgba(0, 0, 0, 1.0001)", "rgba(0, 0, 0, -0.1)"]) {
      const theme = completeTheme();
      light(theme).scrim!.soft = value;
      expectInvalid(theme);
    }
  });

  it("rejects malformed styles, metadata, unknown keys, and prototype keys atomically", () => {
    const rawStyle = completeTheme();
    (rawStyle.defaults as Record<string, Record<string, unknown>>).box!.background = "#ffffff";
    expectInvalid(rawStyle);

    const unknownStyle = completeTheme();
    (unknownStyle.defaults as Record<string, Record<string, unknown>>).text!.margin = "md";
    expectInvalid(unknownStyle);

    const malformedPreset = completeTheme();
    malformedPreset.presets = { box: { panel: preset({ preset: "other" }) } };
    expectInvalid(malformedPreset);

    const missingMetadata = completeTheme();
    missingMetadata.presets = { box: { panel: { description: "Panel", style: {} } } };
    expectInvalid(missingMetadata);

    const unknownTheme = completeTheme();
    unknownTheme.recipe = {};
    expectInvalid(unknownTheme);

    const polluted = completeTheme();
    (polluted.tokens as Record<string, unknown>).space = JSON.parse(
      JSON.stringify((polluted.tokens as Record<string, unknown>).space).replace(
        /}$/,
        ',"__proto__":"1px"}',
      ),
    );
    expectInvalid(polluted);
  });

  it("never throws on cyclic or hostile operator input and never returns a partial Theme", () => {
    const cyclic = completeTheme();
    cyclic.loop = cyclic;
    expect(() => validateTheme(cyclic)).not.toThrow();
    expectInvalid(cyclic);

    const throwing = new Proxy(completeTheme(), {
      ownKeys() {
        throw new Error("hostile");
      },
    });
    expect(() => validateTheme(throwing)).not.toThrow();
    expectInvalid(throwing);

    const invalidLate = completeTheme();
    const tokens = invalidLate.tokens as Record<string, Record<string, unknown>>;
    tokens.space!.md = "24px";
    tokens.chartThickness!.lg = "999px";
    const result = validateTheme(invalidLate);
    expect(result.theme).toBeUndefined();
    expect(tokens.space!.md).toBe("24px");
    expect(tokens.chartThickness!.lg).toBe("999px");
  });

  it("reads each Theme style property once and rejects a throwing getter whole", () => {
    const changing = completeTheme();
    const box = (changing.defaults as Record<string, Record<string, unknown>>).box!;
    let changingReads = 0;
    Object.defineProperty(box, "gap", {
      enumerable: true,
      get() {
        changingReads += 1;
        return changingReads === 1
          ? "md"
          : new Proxy(
              {},
              {
                ownKeys: () => {
                  throw new Error("second read");
                },
              },
            );
      },
    });

    const accepted = validateTheme(changing);
    expect(accepted.theme, accepted.issues.map(({ message }) => message).join("\n")).toBeDefined();
    expect(accepted.theme?.defaults.box.gap).toBe("md");
    expect(changingReads).toBe(1);

    const throwing = completeTheme();
    const throwingBox = (throwing.defaults as Record<string, Record<string, unknown>>).box!;
    let throwingReads = 0;
    Object.defineProperty(throwingBox, "gap", {
      enumerable: true,
      get() {
        throwingReads += 1;
        throw new Error("untrusted style getter");
      },
    });

    let rejected: ReturnType<typeof validateTheme> | undefined;
    expect(() => {
      rejected = validateTheme(throwing);
    }).not.toThrow();
    expect(rejected?.theme).toBeUndefined();
    expect(rejected?.issues.some(({ severity }) => severity === "error")).toBe(true);
    expect(throwingReads).toBe(1);
  });

  it("returns fresh null-prototype maps instead of retaining operator objects", () => {
    const input = completeTheme();
    const result = validateTheme(input);
    expect(result.theme).toBeDefined();
    expect(result.theme).not.toBe(input);
    expect(Object.getPrototypeOf(result.theme!.tokens.space)).toBeNull();
    expect(Object.getPrototypeOf(result.theme!.defaults)).toBeNull();
    for (const brick of BRICK_TYPES as readonly BrickType[]) {
      expect(result.theme!.defaults[brick]).not.toBe(
        (input.defaults as Record<string, unknown>)[brick],
      );
    }
  });
});
