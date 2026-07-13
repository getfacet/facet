import type { CSSProperties, ReactNode } from "react";
import { MAX_NODE_LABEL_CHARS } from "@facet/core";
import { backdropLayerStyle } from "./layout-contract.js";
import { mediaStyle, resolveRecipe } from "./theme.js";
import type { ResolvedTheme } from "./theme.js";
import { cappedString, readRenderableMedia, styleOf } from "./renderer-safe.js";

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
  // COVER mode ignores the authored/recipe media style: it is a renderer-owned
  // background layer (the ONLY place `position:absolute` is introduced), always
  // aria-hidden and non-interactive so it never intercepts a flow-child press.
  const recipe = cover ? undefined : resolveRecipe(theme, "media", media.variant);
  const baseStyle = cover
    ? { ...backdropLayerStyle(), pointerEvents: "none" as const }
    : mediaStyle({ ...(recipe?.media ?? {}), ...(styleOf(media.style) ?? {}) }, theme);
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
