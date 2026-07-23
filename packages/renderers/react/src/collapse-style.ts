import { NARROW_BREAKPOINT_PX, isGridColumns } from "./layout-contract.js";

/**
 * CSS-only responsive `collapse` concern — package-internal, deliberately NOT
 * exported through the `@facet/react` barrel (no new public surface, RISK-PKG-2),
 * beside `appear.ts`/`motion.ts`/`interaction-style.ts`. A collapse row maps to a
 * class NAME only; the reflow is done by ONE static framework `@media` rule
 * below, with no tree/theme/node data ever interpolated into it. There is NO JS
 * resize listener, no `matchMedia` read, and no viewport-derived React state
 * (invariant #6, R6): the browser never becomes a second writer of layout.
 * `StageRenderer` owns the binding — it applies the class per node and renders
 * `<style>{COLLAPSE_CSS}</style>` once per stage iff the tree uses collapse.
 */

/** The marker on a collapsible row. Exact literal, mirroring
 * `INTERACTION_CLASS = "facet-interaction"`. WU-12's Lab journey selects the row
 * by this string and the constant is package-private, so its literal test pins it. */
export const COLLAPSE_CLASS = "facet-collapse";

/** The marker on a `basis`-carrying child of a collapse row: below the breakpoint
 * a stacked rail must stop treating its `basis` as a main-axis (now block) size. */
export const COLLAPSE_ITEM_CLASS = "facet-collapse-item";

/**
 * The one static collapse stylesheet (R8): below the single narrow breakpoint a
 * collapse row switches to `flex-direction:column` and its `basis`-carrying
 * children release their held width. `!important` is load-bearing — it overrides
 * the inline `flex-direction:row`/`flex-basis` that `boxStyle` otherwise emits.
 *
 * Safety rests on TWO independent bounds, not one:
 *  (a) the declaration list is closed and enumerated — only the two flex-item
 *      main-axis properties this feature emits (`flex-basis`, `flex-shrink`),
 *      never width, spacing, color, position, or z-index; and
 *  (b) the SELECTOR is marker-scoped `.facet-collapse > .facet-collapse-item`,
 *      NEVER a universal `> *`/`*` — which would strip renderer-owned
 *      `flex-shrink:0` from icon media roots (`renderer-media.tsx:84`) and
 *      indicator dots (`brick-style-data.ts:187`), real direct DOM children of a
 *      collapse row because children render through element-less Fragments
 *      (`renderer-render.tsx:252-270`).
 *
 * The breakpoint derives from `NARROW_BREAKPOINT_PX` so the CSS collapse and the
 * reported `view.viewport === "narrow"` can never disagree (R9).
 */
export const COLLAPSE_CSS = `@media (max-width: ${String(NARROW_BREAKPOINT_PX - 1)}px){ .${COLLAPSE_CLASS}{flex-direction:column!important} .${COLLAPSE_CLASS} > .${COLLAPSE_ITEM_CLASS}{flex-basis:auto!important;flex-shrink:1!important} }`;

/**
 * Classifies a resolved box style into the collapse marker — TOTAL on the raw
 * live path (which bypasses `validateTree` by design): the class is emitted ONLY
 * for a collapsible row (`collapse === "stack"` on a non-grid `direction === "row"`
 * box), and `undefined` for a column box, any grid, absent/`"none"` collapse,
 * non-objects, and junk tokens — never a throw (R7, DC-005). Per R9 a box
 * resolving `direction:"row"` AND `collapse:"stack"` still receives the class:
 * below the breakpoint collapse wins over the authored row by design.
 */
export function collapseClass(style: unknown): string | undefined {
  if (typeof style !== "object" || style === null) return undefined;
  const resolved = style as { collapse?: unknown; direction?: unknown; columns?: unknown };
  if (resolved.collapse !== "stack") return undefined;
  if (resolved.direction !== "row") return undefined;
  if (isGridColumns(resolved.columns)) return undefined;
  return COLLAPSE_CLASS;
}

/**
 * Classifies a resolved box style into the collapse-item marker — TOTAL like
 * `collapseClass`: the class is emitted ONLY when the style carries a `basis`
 * (`basis` is box-only in `BoxDirectStyle`, so the marker matches exactly the set
 * of nodes whose main-axis sizing this feature authored), and `undefined` for a
 * basis-less style, non-objects, and junk — never a throw (R8b). It is inert
 * outside a collapse row because the CSS requires the `.facet-collapse` parent.
 */
export function collapseItemClass(style: unknown): string | undefined {
  if (typeof style !== "object" || style === null) return undefined;
  const basis = (style as { basis?: unknown }).basis;
  if (basis === undefined) return undefined;
  return COLLAPSE_ITEM_CLASS;
}
