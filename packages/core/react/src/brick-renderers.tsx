import type { ReactNode } from "react";
import type { FacetNode } from "@facet/core";
import { brickRendererEntry } from "./brick-render-registry.js";
import type { BrickRenderContext } from "./brick-renderer-types.js";

export type { BrickRenderContext, PressableRenderArgs } from "./brick-renderer-types.js";

export function renderBrickNode<Press>(
  node: FacetNode,
  context: BrickRenderContext<Press>,
): ReactNode {
  // Registry dispatch replaces the former per-type switch: the drawable-via-
  // renderBrick set (every component + `field`) maps to its renderer fn. An
  // unknown/bespoke type (box/text/media or raw junk) has no entry and renders
  // nothing — the same fail-safe as the old `default: return null`.
  const entry = brickRendererEntry(node.type);
  return entry === undefined ? null : entry.render(node, context);
}
