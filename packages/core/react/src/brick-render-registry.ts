import type { ReactNode } from "react";
import type { ComponentNodeType, FacetNode } from "@facet/core";
import { renderChart } from "./brick-renderer-chart.js";
import {
  renderEmptyState,
  renderKeyValue,
  renderList,
  renderLoading,
  renderMetric,
  renderProgress,
  renderStat,
} from "./brick-renderer-data.js";
import {
  renderButton,
  renderCard,
  renderNav,
  renderSection,
  renderTable,
  renderTabs,
} from "./brick-renderer-layout.js";
import { renderFilterBar, renderForm, renderInput } from "./brick-renderer-inputs.js";
import type { BrickRenderContext } from "./brick-renderer-types.js";

/**
 * The core node types dispatched through `renderBrickNode` — every component
 * type plus the `input` primitive. `box`/`text`/`media` are intentionally
 * ABSENT: they are drawn by bespoke inline paths in `renderer-render.tsx`
 * (box's backdrop/scheme host, text's `<p>`, media via `renderMediaNode`), and
 * the raw `image` alias is handled before the type switch. Keying only the
 * `renderBrick` set keeps this registry a thin table of the existing renderer
 * fns, not a re-home of the bespoke primitives.
 */
export type BrickRendererType = ComponentNodeType | "input";

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
   * Container bricks render their children first and pass them into `render`
   * (renderer-render's `renderBrick(children)` path); leaf bricks call
   * `renderBrick()` with no children. `box` is also a container but is drawn by
   * the bespoke box path, so it is not a registry key.
   */
  readonly container: boolean;
  /**
   * Participates unconditionally in the motion visibility snapshot — the
   * `renderer-motion` leaf fallthrough. Containers are already captured by
   * `isContainer` upstream, and `input`/`text`/`media` have their own snapshot
   * cases, so those entries are `false`.
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
  // ---- Layout containers (render children, then renderBrick(children)) ----
  section: { render: renderSection, container: true, motionSnapshot: false },
  card: { render: renderCard, container: true, motionSnapshot: false },
  form: { render: renderForm, container: true, motionSnapshot: false },
  // ---- Leaf bricks (renderBrick(), participate in the motion snapshot) ----
  button: { render: renderButton, container: false, motionSnapshot: true },
  tabs: { render: renderTabs, container: false, motionSnapshot: true },
  nav: { render: renderNav, container: false, motionSnapshot: true },
  table: { render: renderTable, container: false, motionSnapshot: true },
  chart: { render: renderChart, container: false, motionSnapshot: true },
  metric: { render: renderMetric, container: false, motionSnapshot: true },
  stat: { render: renderStat, container: false, motionSnapshot: true },
  keyValue: { render: renderKeyValue, container: false, motionSnapshot: true },
  progress: { render: renderProgress, container: false, motionSnapshot: true },
  list: { render: renderList, container: false, motionSnapshot: true },
  filterBar: { render: renderFilterBar, container: false, motionSnapshot: true },
  emptyState: { render: renderEmptyState, container: false, motionSnapshot: true },
  loading: { render: renderLoading, container: false, motionSnapshot: true },
  // ---- Input primitive (renderBrick(); its own motion-snapshot case) ------
  input: { render: renderInput, container: false, motionSnapshot: false },
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
