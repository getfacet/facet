import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderMediaNode } from "./renderer-media.js";
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

  it("projects media style sizing and surface tokens", () => {
    const out = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        renderMediaNode(
          {
            id: "icon",
            type: "media",
            kind: "icon",
            icon: "check",
            alt: "Complete",
            style: {
              width: "fit",
              iconSize: "lg",
              padding: "sm",
              background: "successSurface",
              color: "success",
              borderColor: "success",
              borderWidth: "thin",
              borderRadius: "full",
            },
          },
          theme,
        ),
      ),
    );

    expect(out).toContain("width:fit-content");
    expect(out).toContain('width="20px"');
    expect(out).toContain('height="20px"');
    expect(out).toContain("padding:8px");
    expect(out).toContain(`background:${theme.color.successSurface}`);
    expect(out).toContain(`color:${theme.color.success}`);
    expect(out).toContain(`border-color:${theme.color.success}`);
    expect(out).toContain(`border-width:${theme.borderWidth.thin}`);
    expect(out).toContain(`border-radius:${theme.radius.full}`);
  });
});
