import type { CSSProperties, ReactNode } from "react";
import { isSafeMediaSrc, MAX_NODE_LABEL_CHARS } from "@facet/core";
import { mediaStyle, resolveRecipe } from "./theme.js";
import type { ResolvedTheme } from "./theme.js";
import { cappedString, styleOf } from "./renderer-safe.js";

export function renderMediaNode(
  raw: unknown,
  theme: ResolvedTheme,
  className?: string,
  inert = false,
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
  const recipe = resolveRecipe(theme, "media", rawMedia.variant);
  const baseStyle = mediaStyle(
    { ...(recipe.media ?? {}), ...(styleOf(rawMedia.style) ?? {}) },
    theme,
  );
  const style: CSSProperties = inert ? { ...baseStyle, pointerEvents: "none" } : baseStyle;
  if (kind === "video") {
    const poster =
      typeof rawMedia.poster === "string" && isSafeMediaSrc(rawMedia.poster)
        ? rawMedia.poster
        : undefined;
    return (
      <video
        src={rawMedia.src}
        poster={poster}
        controls={!inert && rawMedia.controls === true ? true : undefined}
        className={className}
        aria-hidden={inert ? true : undefined}
        style={style}
      />
    );
  }
  return (
    <img
      src={rawMedia.src}
      alt={cappedString(rawMedia.alt, MAX_NODE_LABEL_CHARS) ?? ""}
      className={className}
      aria-hidden={inert ? true : undefined}
      style={style}
    />
  );
}
