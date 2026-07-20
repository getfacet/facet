import { describe, expect, it } from "vitest";
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
});
