import type { CSSProperties, ReactNode } from "react";
import { MAX_NODE_LABEL_CHARS, type BrickStyleDefinition } from "@facet/core";
import { layoutMediaTargetStyle } from "./brick-style-layout.js";
import { backdropLayerStyle, rootContainmentStyle } from "./layout-contract.js";
import { MediaIconSvg } from "./media-icons.js";
import type { ResolvedTheme } from "./theme.js";
import { cappedString, readRenderableMedia, safeOwnValue } from "./renderer-safe.js";
import { resolveBrickStyle } from "./style-resolver.js";
import { projectWidthStyle } from "./width-style.js";

type MediaDefinition = BrickStyleDefinition<"media">;

function mediaChromeStyle(style: MediaDefinition, theme: ResolvedTheme): CSSProperties {
  const css: CSSProperties = {};
  if (style.padding !== undefined) css.padding = theme.space[style.padding];
  if (style.background !== undefined) css.background = theme.color[style.background];
  if (style.color !== undefined) css.color = theme.color[style.color];
  if (style.borderColor !== undefined) css.borderColor = theme.color[style.borderColor];
  if (style.borderWidth !== undefined) {
    css.borderStyle = "solid";
    css.borderWidth = theme.borderWidth[style.borderWidth];
  }
  if (style.borderRadius !== undefined) css.borderRadius = theme.radius[style.borderRadius];
  return css;
}

function directResolvedIconSize(
  directStyle: object | undefined,
  resolvedStyle: MediaDefinition,
  theme: ResolvedTheme,
): MediaDefinition["iconSize"] {
  const directValue = safeOwnValue(directStyle, "iconSize");
  if (directValue === resolvedStyle.iconSize) return resolvedStyle.iconSize;
  return resolvedStyle.iconSize !== undefined &&
    resolvedStyle.iconSize !== theme.defaults.media.iconSize
    ? resolvedStyle.iconSize
    : undefined;
}

function directResolvedWidth(
  directStyle: object | undefined,
  resolvedStyle: MediaDefinition,
  theme: ResolvedTheme,
): MediaDefinition["width"] {
  const directValue = safeOwnValue(directStyle, "width");
  if (directValue === resolvedStyle.width) return resolvedStyle.width;
  return resolvedStyle.width !== undefined && resolvedStyle.width !== theme.defaults.media.width
    ? resolvedStyle.width
    : undefined;
}

function flowMediaStyle(
  style: MediaDefinition,
  directStyle: object | undefined,
  theme: ResolvedTheme,
): CSSProperties {
  const css: CSSProperties = {
    ...layoutMediaTargetStyle(style, theme),
    ...mediaChromeStyle(style, theme),
  };
  const avatarSize = directResolvedIconSize(directStyle, style, theme);
  if (avatarSize !== undefined) {
    const size = theme.indicatorSize[avatarSize];
    css.width = size;
    css.height = size;
    css.aspectRatio = "1 / 1";
  }
  return css;
}

function iconFrameStyle(
  style: MediaDefinition,
  directStyle: object | undefined,
  theme: ResolvedTheme,
): CSSProperties {
  return rootContainmentStyle({
    ...projectWidthStyle(directResolvedWidth(directStyle, style, theme)),
    ...mediaChromeStyle(style, theme),
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    verticalAlign: "middle",
    lineHeight: 0,
    flexShrink: 0,
  });
}

function iconGlyphSize(style: MediaDefinition, theme: ResolvedTheme): string {
  return style.iconSize === undefined
    ? theme.indicatorSize.md
    : theme.indicatorSize[style.iconSize];
}

export function renderMediaNode(
  raw: unknown,
  theme: ResolvedTheme,
  className?: string,
  inert = false,
  /**
   * COVER fill mode: paint this media as a renderer-owned backdrop cover layer
   * (absolute inset-0, object-fit cover, aria-hidden, non-interactive). The
   * SAME `isSafeMediaSrc` gate below still applies — an unsafe/blank src paints
   * nothing. The default mode (flow media) is unchanged.
   */
  cover = false,
): ReactNode {
  const media = readRenderableMedia(raw);
  if (media === undefined) return null;
  const resolvedStyle = resolveBrickStyle(theme, "media", media.style);
  if (media.kind === "icon") {
    if (cover) return null;
    const label = cappedString(media.alt, MAX_NODE_LABEL_CHARS) ?? "";
    const exposeIcon = !inert && label.length > 0;
    return (
      <span
        role={exposeIcon ? "img" : undefined}
        aria-label={exposeIcon ? label : undefined}
        className={className}
        aria-hidden={exposeIcon ? undefined : true}
        style={
          inert
            ? { ...iconFrameStyle(resolvedStyle, media.style, theme), pointerEvents: "none" }
            : iconFrameStyle(resolvedStyle, media.style, theme)
        }
      >
        <MediaIconSvg name={media.icon} size={iconGlyphSize(resolvedStyle, theme)} />
      </span>
    );
  }
  // COVER mode ignores the authored media style: it is a renderer-owned
  // background layer (the ONLY place `position:absolute` is introduced), always
  // aria-hidden and non-interactive so it never intercepts a flow-child press.
  const baseStyle = cover
    ? { ...backdropLayerStyle(), pointerEvents: "none" as const }
    : flowMediaStyle(resolvedStyle, media.style, theme);
  const style: CSSProperties =
    !cover && inert ? { ...baseStyle, pointerEvents: "none" } : baseStyle;
  const ariaHidden = cover || inert ? true : undefined;
  if (media.kind === "video") {
    return (
      <video
        src={media.src}
        poster={media.poster}
        controls={!cover && !inert && media.controls ? true : undefined}
        className={className}
        aria-hidden={ariaHidden}
        style={style}
      />
    );
  }
  return (
    <img
      src={media.src}
      alt={cover ? "" : (cappedString(media.alt, MAX_NODE_LABEL_CHARS) ?? "")}
      className={className}
      aria-hidden={ariaHidden}
      style={style}
    />
  );
}
