import type { CSSProperties } from "react";
import type { Width } from "@facet/core";

export function projectWidthStyle(width: Width | undefined): CSSProperties {
  if (width === "full") return { width: "100%" };
  if (width === "fit") return { width: "fit-content", maxWidth: "100%" };
  return {};
}
