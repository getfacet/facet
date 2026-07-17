import type { ReactNode } from "react";
import type { FacetNode } from "@facet/core";
import { brickRendererEntry } from "./brick-render-registry.js";
import type { BrickRenderContext } from "./brick-renderer-types.js";

export type { BrickRenderContext, PressableRenderArgs } from "./brick-renderer-types.js";

export function renderBrickNode<Press>(
  node: FacetNode,
  context: BrickRenderContext<Press>,
): ReactNode {
  // The own-property lookup rejects bespoke types and raw prototype names as
  // non-entries, preserving the renderer's fail-safe null degradation.
  const entry = brickRendererEntry(node.type);
  return entry === undefined ? null : entry.render(node, context);
}
