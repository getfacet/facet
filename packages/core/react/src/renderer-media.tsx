import type { CSSProperties, ReactNode } from "react";
import { isSafeMediaSrc, MAX_NODE_LABEL_CHARS } from "@facet/core";
import { backdropLayerStyle } from "./layout-contract.js";
import { mediaStyle, resolveRecipe } from "./theme.js";
import type { ResolvedTheme } from "./theme.js";
import { cappedString, styleOf } from "./renderer-safe.js";

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
  const rawMedia = raw as {
    readonly type?: unknown;
    readonly kind?: unknown;
    readonly src?: unknown;
    readonly alt?: unknown;
    readonly poster?: unknown;
    readonly controls?: unknown;
    readonly variant?: unknown;
    readonly style?: object;
  };
  // Fail-safe/security: never put an unsafe URL scheme (javascript:, …) in the DOM.
  if (typeof rawMedia.src !== "string" || !isSafeMediaSrc(rawMedia.src)) {
    return null;
  }
  const kind =
    rawMedia.type === "image" ? "image" : rawMedia.kind === undefined ? "image" : rawMedia.kind;
  if (kind !== "image" && kind !== "video") {
    return null;
  }
  // COVER mode ignores the authored/recipe media style: it is a renderer-owned
  // background layer (the ONLY place `position:absolute` is introduced), always
  // aria-hidden and non-interactive so it never intercepts a flow-child press.
  const recipe = cover ? undefined : resolveRecipe(theme, "media", rawMedia.variant);
  const baseStyle = cover
    ? { ...backdropLayerStyle(), pointerEvents: "none" as const }
    : mediaStyle({ ...(recipe?.media ?? {}), ...(styleOf(rawMedia.style) ?? {}) }, theme);
  const style: CSSProperties =
    !cover && inert ? { ...baseStyle, pointerEvents: "none" } : baseStyle;
  const ariaHidden = cover || inert ? true : undefined;
  if (kind === "video") {
    const poster =
      typeof rawMedia.poster === "string" && isSafeMediaSrc(rawMedia.poster)
        ? rawMedia.poster
        : undefined;
    return (
      <video
        src={rawMedia.src}
        poster={poster}
        controls={!cover && !inert && rawMedia.controls === true ? true : undefined}
        className={className}
        aria-hidden={ariaHidden}
        style={style}
      />
    );
  }
  return (
    <img
      src={rawMedia.src}
      alt={cover ? "" : (cappedString(rawMedia.alt, MAX_NODE_LABEL_CHARS) ?? "")}
      className={className}
      aria-hidden={ariaHidden}
      style={style}
    />
  );
}
