import { describe, expect, it } from "vitest";
import { projectSurface, projectTypography } from "./style-projection.js";
import { resolveTheme } from "./theme.js";

describe("style projections", () => {
  const theme = resolveTheme();

  it("projects every shared typography token and fixed choice", () => {
    expect(
      projectTypography(
        {
          fontFamily: "mono",
          fontSize: "lg",
          fontWeight: "bold",
          fontStyle: "italic",
          color: "accent",
          textAlign: "end",
          letterSpacing: "wide",
          lineHeight: "relaxed",
          highlight: "accent",
        },
        theme,
      ),
    ).toEqual({
      fontFamily: theme.fontFamily.mono,
      fontSize: theme.fontSize.lg,
      fontWeight: theme.fontWeight.bold,
      fontStyle: "italic",
      color: theme.color.accent,
      textAlign: "right",
      letterSpacing: theme.letterSpacing.wide,
      lineHeight: theme.lineHeight.relaxed,
      backgroundImage: theme.highlight.accent,
    });
  });

  it("projects every shared surface token", () => {
    expect(
      projectSurface(
        {
          background: "surface",
          color: "foreground",
          borderColor: "border",
          borderWidth: "thin",
          borderRadius: "md",
          shadow: "sm",
        },
        theme,
      ),
    ).toEqual({
      background: theme.color.surface,
      color: theme.color.foreground,
      borderColor: theme.color.border,
      borderStyle: "solid",
      borderWidth: theme.borderWidth.thin,
      borderRadius: theme.radius.md,
      boxShadow: theme.shadow.sm,
    });
  });
});
