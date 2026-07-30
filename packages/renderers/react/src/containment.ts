/**
 * Stacking containment — the residual guarantee that survives arbitrary host
 * React — and the one renderer-owned way out of it.
 *
 * Facet's authored vocabulary has no coordinates: no positioning, no z-index,
 * no escape hatch. But the components that mount are the **host's** trusted
 * React, and trusted is not the same as well-behaved. A registered component
 * that paints itself at `z-index: 99999` would, on its own, cover a screen it
 * knows nothing about. So every mounted subtree is wrapped in a renderer-owned
 * element carrying `isolation: isolate`, which forms a stacking context: a
 * descendant's z-index is resolved **inside** that context and cannot be
 * compared against anything outside it. The escape then reaches exactly as far
 * as the subtree it was written in, which is the honest bound — Facet does not
 * claim a registered component cannot draw over its own siblings, only that it
 * cannot draw over the rest of the page.
 *
 * **That guarantee is also what would break overlap, so the resolution is here
 * too.** A `Modal` is one of the catalog's tags, so a modal node mounts *inside*
 * the containment elements — and a frame that positioned itself in place would
 * be confined to its ancestor's stacking context and paint **below** any later
 * sibling subtree, defeating the only sanctioned overlap mechanism there is.
 * `OverlayRootProvider` is the specified way out (D-13): a renderer-owned
 * `<div data-facet-overlay-root>` that `StageRenderer` mounts as a **sibling
 * of, never inside, any containment element**, and that `ModalFrame` renders
 * into with a React portal. The modal node's own mount point, props, bindings
 * and subtree boundary are unchanged; only the frame's painted output moves.
 *
 * **One opt-out, and it is not the author's.** The portal target is the single
 * containment exception, it is created only by this module, it carries the
 * closed z band, and it is reachable from no authored markup — there is no
 * prop, no token and no reference that names it. It is also **private**: this
 * module is not barrel-exported, because exporting it would hand every host the
 * one sanctioned escape hatch.
 *
 * **A missing provider is an error, not a fallback.** `useOverlayRoot` outside
 * `OverlayRootProvider` throws, in the same shape `useDataModel` uses for the
 * same reason. Falling back to rendering in place would put an overlay inside
 * the containment it exists to escape, and would do it invisibly — the failure
 * would surface as a modal that paints under a card, days later, with nothing
 * naming the cause.
 *
 * The module is JSX-free so the private renderer modules stay uniform; the two
 * components it declares are built with `createElement`.
 */

import { createContext, createElement, useContext, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

/**
 * The marker every containment element carries.
 *
 * It names the renderer's own element so a test — and a person reading a DOM —
 * can tell Facet's wrapper from anything a registered component rendered. It
 * carries no node id, no tag and no cause.
 */
export const CONTAINMENT_ATTRIBUTE = "data-facet-containment";

/** The marker the renderer-owned portal target carries. */
export const OVERLAY_ROOT_ATTRIBUTE = "data-facet-overlay-root";

/**
 * The whole of the containment element's style.
 *
 * One declaration, deliberately. `isolation: isolate` forms a stacking context
 * without changing layout, paint order among siblings, or the box model, which
 * is what lets the wrapper sit between every parent and every child without
 * becoming a layout participant with opinions of its own. Anything else here —
 * a `position`, an `overflow`, a `contain` — would be the renderer quietly
 * restyling a host's component.
 */
export const CONTAINMENT_STYLE: Readonly<CSSProperties> = Object.freeze({
  isolation: "isolate",
});

/**
 * The closed z band. Renderer-only: no authored value reaches it, and no
 * catalog prop names it.
 *
 * The band is declared once, here, because the two halves of the overlap
 * contract have to agree — the portal target establishes the context the frame
 * paints in, and the frame's scrim and surface order themselves inside it. Two
 * modules each picking a number is how a scrim ends up over its own dialog.
 */
export const OVERLAY_Z_BAND = Object.freeze({
  /** The band's base: the overlay root, above every document subtree. */
  root: 2_147_400_000,
  /** The scrim, at the bottom of the band. */
  scrim: 0,
  /** The frame, directly above its own scrim. */
  frame: 1,
});

/**
 * The overlay root's own style.
 *
 * `position: relative` with the band's base is what makes the element a
 * stacking context of its own, so everything portalled into it paints above
 * every document subtree regardless of how those subtrees are ordered. The
 * element is otherwise empty and takes no space, so an overlay root with no
 * modal open covers nothing and intercepts nothing.
 */
export const OVERLAY_ROOT_STYLE: Readonly<CSSProperties> = Object.freeze({
  position: "relative",
  zIndex: OVERLAY_Z_BAND.root,
});

/**
 * Wraps one mounted subtree in the renderer's containment element.
 *
 * It renders a plain element and adds exactly one declaration. It is not a
 * layout primitive and must not become one: every prop it grew would be a
 * renderer opinion about how a host's component should sit.
 */
export function Containment(props: { readonly children?: ReactNode }): ReactNode {
  return createElement(
    "div",
    { [CONTAINMENT_ATTRIBUTE]: "", style: CONTAINMENT_STYLE },
    props.children,
  );
}

/**
 * The absent-provider sentinel.
 *
 * A missing provider is a renderer composition fault, and it must not be
 * confused with a provider whose element has not been attached yet: the first
 * is a mistake in how the renderer was composed, the second is one commit of an
 * ordinary mount. Distinguishing them is what lets the first throw and the
 * second answer `null`.
 */
const NO_OVERLAY_ROOT = Symbol("facet.noOverlayRoot");

const OverlayRootContext = createContext<HTMLElement | null | typeof NO_OVERLAY_ROOT>(
  NO_OVERLAY_ROOT,
);

/**
 * Publishes the renderer-owned portal target to everything beneath it, and
 * renders that target as a **sibling** of its children.
 *
 * The sibling relationship is the entire point and is structural rather than
 * conventional: the provider renders the target itself, in its own fragment,
 * and the only containment elements that exist are the ones mounting creates
 * *inside* the children. So a target this provider rendered cannot have a
 * containment ancestor unless a caller wrapped the provider in one — which is
 * why `StageRenderer` mounts the provider at the top, and why the property is
 * asserted by an ancestor walk rather than assumed.
 *
 * The target reaches consumers through state set by the element's ref, so it is
 * `null` for the first commit and the element from then on. A portal consumer
 * renders nothing for that one commit rather than rendering in place, because
 * "in place" is exactly the position the portal exists to leave.
 */
export function OverlayRootProvider(props: { readonly children?: ReactNode }): ReactNode {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  return createElement(
    OverlayRootContext.Provider,
    { value: target },
    props.children,
    createElement("div", {
      ref: setTarget,
      [OVERLAY_ROOT_ATTRIBUTE]: "",
      style: OVERLAY_ROOT_STYLE,
    }),
  );
}

/**
 * The renderer-owned portal target in force, or `null` while it is attaching.
 *
 * A determinate error when no provider is above: see the module docblock for
 * why an in-tree fallback is the one answer this must never give.
 */
export function useOverlayRoot(): HTMLElement | null {
  const target = useContext(OverlayRootContext);
  if (target === NO_OVERLAY_ROOT) {
    throw new Error("Facet renderer: no overlay root is mounted above this component.");
  }
  return target;
}
