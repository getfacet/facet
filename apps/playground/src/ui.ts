import type { FacetTree } from "@facet/core";
import { page, text } from "./bricks.js";

/** The "blank page" face every live entry point opens with — one source. */
export function welcome(subtitle: string): FacetTree {
  return page(
    [
      text("What should this page be?", {
        fontSize: "2xl",
        fontWeight: "bold",
        textAlign: "center",
      }),
      text(subtitle, { color: "mutedForeground", textAlign: "center" }),
    ],
    { gap: "md", padding: "2xl" },
  );
}
