import { describe, expect, it } from "vitest";
import { DEFAULT_THEME } from "@facet/assets";
import { resolveInputStylePresentation } from "./brick-style-input.js";
import { tableRootTargetStyle } from "./brick-style-layout.js";
import { boxStyle, fieldStyle, mediaStyle, resolveTheme } from "./theme.js";
import { projectWidthStyle } from "./width-style.js";

describe("projectWidthStyle", () => {
  it("projects width fit to bounded intrinsic normal-flow sizing", () => {
    expect(projectWidthStyle("fit")).toEqual({
      width: "fit-content",
      maxWidth: "100%",
    });
  });

  it("preserves width auto as the default flow width", () => {
    expect(projectWidthStyle("auto")).toEqual({});
    expect(projectWidthStyle(undefined)).toEqual({});
  });

  it("projects width full to the parent width", () => {
    expect(projectWidthStyle("full")).toEqual({ width: "100%" });
  });

  it("applies width fit wherever renderer roots accept width", () => {
    const theme = resolveTheme();
    const fitWidth = { width: "fit-content", maxWidth: "100%" };

    expect(boxStyle({ width: "fit" }, theme)).toMatchObject(fitWidth);
    expect(mediaStyle({ width: "fit" }, theme)).toMatchObject(fitWidth);
    expect(fieldStyle({ width: "fit" }, theme)).toMatchObject(fitWidth);
    expect(tableRootTargetStyle({ width: "fit" }, theme)).toMatchObject(fitWidth);
    expect(resolveInputStylePresentation(theme, { width: "fit" }, "text").root).toMatchObject(
      fitWidth,
    );
  });

  it("ignores invalid boolean input layout overrides before applying checkbox defaults", () => {
    const theme = resolveTheme();

    expect(
      resolveInputStylePresentation(
        theme,
        { direction: "sideways", alignItems: "banana" },
        "checkbox",
      ).root,
    ).toMatchObject({
      flexDirection: "row",
      alignItems: "center",
    });
    expect(
      resolveInputStylePresentation(theme, { direction: "column", alignItems: "stretch" }, "switch")
        .root,
    ).toMatchObject({
      flexDirection: "column",
      alignItems: "stretch",
    });
    expect(
      resolveInputStylePresentation(theme, { preset: "standard" }, "checkbox").root,
    ).toMatchObject({
      flexDirection: "row",
      alignItems: "center",
    });

    const customDefaultTheme = resolveTheme({
      ...DEFAULT_THEME,
      name: "boolean-default-layout-test",
      defaults: {
        ...DEFAULT_THEME.defaults,
        input: {
          ...DEFAULT_THEME.defaults.input,
          direction: "column",
          alignItems: "stretch",
        },
      },
    });
    expect(resolveInputStylePresentation(customDefaultTheme, {}, "checkbox").root).toMatchObject({
      flexDirection: "column",
      alignItems: "stretch",
    });

    const customTheme = resolveTheme({
      ...DEFAULT_THEME,
      name: "boolean-layout-test",
      presets: {
        ...(DEFAULT_THEME.presets ?? {}),
        input: {
          ...(DEFAULT_THEME.presets?.input ?? {}),
          stackedBoolean: {
            description: "Deliberately stacked boolean input preset.",
            useWhen: "Test fixture.",
            style: { direction: "column", alignItems: "stretch" },
          },
        },
      },
    });
    expect(
      resolveInputStylePresentation(customTheme, { preset: "stackedBoolean" }, "checkbox").root,
    ).toMatchObject({
      flexDirection: "column",
      alignItems: "stretch",
    });
  });

  it("keeps boolean input style presence checks fail-safe for hostile style objects", () => {
    const theme = resolveTheme();
    const hostileStyle = new Proxy(
      {},
      {
        has() {
          throw new Error("hostile has trap");
        },
        getOwnPropertyDescriptor() {
          throw new Error("hostile descriptor trap");
        },
        get() {
          throw new Error("hostile get trap");
        },
      },
    );

    expect(() => resolveInputStylePresentation(theme, hostileStyle, "checkbox")).not.toThrow();
    expect(resolveInputStylePresentation(theme, hostileStyle, "checkbox").root).toMatchObject({
      flexDirection: "row",
      alignItems: "center",
    });
  });
});
