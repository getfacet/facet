import type { ReactNode } from "react";
import type { BrickType, FacetNode } from "@facet/core";
import { renderChart } from "./brick-renderer-chart.js";
import {
  renderKeyValue,
  renderList,
  renderLoading,
  renderProgress,
} from "./brick-renderer-data.js";
import { renderTable } from "./brick-renderer-layout.js";
import { renderInput } from "./brick-renderer-inputs.js";
import type { BrickRenderContext } from "./brick-renderer-types.js";

/**
 * The final bricks dispatched through `renderBrickNode`. `box`, `text`,
 * `media`, and `richtext` are intentionally absent because renderer-render owns
 * their bespoke paths.
 */
export type BrickRendererType = Exclude<BrickType, "box" | "text" | "media" | "richtext">;

/**
 * The uniform brick-renderer signature — every `renderX` shares it, so the
 * registry holds function references directly (no per-type wrappers).
 */
export type BrickRenderer = <Press>(
  node: FacetNode,
  context: BrickRenderContext<Press>,
) => ReactNode;

export interface BrickRendererEntry {
  /** The brick's renderer fn — dispatched by `renderBrickNode`. */
  readonly render: BrickRenderer;
  /**
   * Participates unconditionally in the motion visibility snapshot — the
   * `renderer-motion` leaf fallthrough. `input` has its own snapshot case.
   */
  readonly motionSnapshot: boolean;
}

/**
 * The single react-local brick-renderer registry: core node-type identifier →
 * its EXISTING renderer fn plus the two dispatch flags the render/motion passes
 * read. A thin struct of references — the renderer bodies stay in their home
 * modules. `Record<BrickRendererType, …>` makes a missing entry a compile
 * error, and `brick-render-registry.test.ts` guards it against the core vocab.
 */
export const BRICK_RENDERERS: Record<BrickRendererType, BrickRendererEntry> = {
  table: { render: renderTable, motionSnapshot: true },
  chart: { render: renderChart, motionSnapshot: true },
  list: { render: renderList, motionSnapshot: true },
  keyValue: { render: renderKeyValue, motionSnapshot: true },
  progress: { render: renderProgress, motionSnapshot: true },
  loading: { render: renderLoading, motionSnapshot: true },
  input: { render: renderInput, motionSnapshot: false },
};

/** Total lookup over an UNTRUSTED node type — `undefined` for bespoke/junk. */
export function brickRendererEntry(type: unknown): BrickRendererEntry | undefined {
  // Own-property check: a bare `BRICK_RENDERERS[type]` would return an inherited
  // `Object.prototype` member (a function) for a junk type like "constructor" /
  // "toString", which the callers would then dereference and throw on. The former
  // `switch` sent such names to its `default` (rendered nothing) — preserve that.
  if (typeof type !== "string" || !Object.hasOwn(BRICK_RENDERERS, type)) {
    return undefined;
  }
  return (BRICK_RENDERERS as Record<string, BrickRendererEntry | undefined>)[type];
}

/** True when a node type participates unconditionally in the motion snapshot. */
export function participatesInMotionSnapshot(type: unknown): boolean {
  return brickRendererEntry(type)?.motionSnapshot === true;
}
