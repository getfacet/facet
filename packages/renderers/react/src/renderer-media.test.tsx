// @vitest-environment jsdom
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderMediaNode } from "./renderer-media.js";
import { readRenderableMedia } from "./renderer-safe.js";
import { resolveTheme } from "./theme.js";

function renderMedia(raw: unknown): string {
  return renderToStaticMarkup(createElement(Fragment, null, renderMediaNode(raw, resolveTheme())));
}

describe("renderer media", () => {
  it("renders safe media icons and avatar sizing", () => {
    expect(
      readRenderableMedia({
        id: "search",
        type: "media",
        kind: "icon",
        icon: "search",
        alt: "Search",
      }),
    ).toMatchObject({ kind: "icon", icon: "search" });

    const icon = renderMedia({
      id: "search",
      type: "media",
      kind: "icon",
      icon: "search",
      alt: "Search",
      path: "EVIL_AUTHOR_PATH",
      svg: "<svg>EVIL_AUTHOR_SVG</svg>",
      style: {
        width: "fit",
        iconSize: "lg",
        padding: "sm",
        background: "accentSurface",
        color: "accent",
        borderColor: "accent",
        borderWidth: "thin",
        borderRadius: "full",
      },
    });

    expect(icon).toContain('role="img"');
    expect(icon).toContain('aria-label="Search"');
    expect(icon).toContain("<svg");
    expect(icon).toContain('width="20px"');
    expect(icon).toContain('height="20px"');
    expect(icon).toContain("display:inline-flex");
    expect(icon).toContain("width:fit-content");
    expect(icon).toContain("padding:8px");
    expect(icon).toContain("background:#eef2ff");
    expect(icon).toContain("color:#4f46e5");
    expect(icon).toContain("border-color:#4f46e5");
    expect(icon).toContain("border-width:1px");
    expect(icon).toContain("border-radius:9999px");
    expect(icon).not.toContain("EVIL_AUTHOR_PATH");
    expect(icon).not.toContain("EVIL_AUTHOR_SVG");

    const avatar = renderMedia({
      id: "avatar",
      type: "media",
      kind: "image",
      src: "https://example.com/avatar.png",
      alt: "Avatar",
      style: {
        iconSize: "lg",
        padding: "xs",
        background: "mutedSurface",
        borderColor: "border",
        borderWidth: "thin",
        borderRadius: "full",
      },
    });

    expect(avatar).toContain("<img");
    expect(avatar).toContain('src="https://example.com/avatar.png"');
    expect(avatar).toContain("width:20px");
    expect(avatar).toContain("height:20px");
    expect(avatar).toContain("padding:4px");
    expect(avatar).toContain("border-width:1px");
    expect(avatar).toContain("border-radius:9999px");
  });

  it("fails safe for unknown icons and unsafe sourced media", () => {
    expect(
      readRenderableMedia({ id: "bad", type: "media", kind: "icon", icon: "sparkles" }),
    ).toBeUndefined();
    expect(renderMedia({ id: "bad", type: "media", kind: "icon", icon: "sparkles" })).toBe("");
    expect(readRenderableMedia({ id: "img", type: "media", kind: "image" })).toBeUndefined();
    expect(
      readRenderableMedia({
        id: "video",
        type: "media",
        kind: "video",
        src: "javascript:alert(1)",
      }),
    ).toBeUndefined();
  });
});
