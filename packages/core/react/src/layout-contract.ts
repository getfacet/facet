import type { CSSProperties } from "react";

export type RendererScrollAxis = "x" | "y";

const SCROLL_MAX_HEIGHT = "20rem";

export function rootContainmentStyle(style: CSSProperties = {}): CSSProperties {
  return {
    ...style,
    boxSizing: "border-box",
    minWidth: style.minWidth ?? 0,
    maxWidth: style.maxWidth ?? "100%",
    overflowWrap: style.overflowWrap ?? "anywhere",
  };
}

export function scrollContainmentStyle(axis: RendererScrollAxis): CSSProperties {
  return axis === "x"
    ? {
        overflowX: "auto",
        overflowY: "hidden",
        maxWidth: "100%",
        minWidth: 0,
      }
    : {
        overflowY: "auto",
        overflowX: "hidden",
        maxHeight: SCROLL_MAX_HEIGHT,
        minHeight: 0,
        maxWidth: "100%",
        minWidth: 0,
      };
}
