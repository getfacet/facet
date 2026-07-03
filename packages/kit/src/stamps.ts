import type { FacetStamp } from "@facet/core";
import { button, card, fragment, heading, hero, text, type Fragment } from "./kit.js";

/**
 * `KIT_STAMPS` — the default stamp library, each preset captured once via
 * `fragment()` into a validated `FacetStamp` (a named `{root, nodes}` subtree an
 * operator hands to the assets registry; the LLM copies it into ordinary
 * patches). Every stamp uses its own `name` as its id prefix, so the three
 * stamps are pairwise disjoint and none touches the reserved `"root"`. Quickstart
 * does NOT auto-inject these — they are data for hosts, not a kit→quickstart
 * dependency.
 */
function toStamp(name: string, description: string, frag: Fragment): FacetStamp {
  return { name, description, root: frag.root, nodes: frag.nodes };
}

export const KIT_STAMPS: readonly FacetStamp[] = [
  toStamp(
    "hero",
    "A centered hero banner: large title, optional subtitle, and a call-to-action button.",
    fragment(
      hero({
        title: "Your headline",
        subtitle: "A short supporting line.",
        cta: { label: "Get started", action: "start" },
      }),
      "hero",
    ),
  ),
  toStamp(
    "card",
    "A bordered, padded content card stacking a heading over body copy.",
    fragment(card([heading("Card title"), text("Card body copy.")]), "card"),
  ),
  toStamp(
    "cta-button",
    "A single accent call-to-action button that fires an agent action.",
    fragment(button("Get started", "start"), "cta-button"),
  ),
];
