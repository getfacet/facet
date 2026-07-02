import type { FacetTree } from "@facet/core";
import { page, text } from "@facet/kit";

/** The "blank page" face every live entry point opens with — one source. */
export function welcome(subtitle: string): FacetTree {
  return page(
    [
      text("What should this page be?", { size: "2xl", weight: "bold", align: "center" }),
      text(subtitle, { color: "fg-muted", align: "center" }),
    ],
    { gap: "md", pad: "2xl" },
  );
}
