import { Fragment } from "react";
import type { ReactNode } from "react";
import {
  MAX_DEPTH,
  MAX_NODE_BODY_CHARS,
  MAX_RENDER_NODES,
  type FacetTree,
  type NodeId,
  type SortDirection,
} from "@facet/core";
import { appearClass } from "./appear.js";
import { renderBrickNode, type PressableRenderArgs } from "./brick-renderers.js";
import { brickRendererEntry } from "./brick-render-registry.js";
import { MOTION_CLASS_NAMES, composeMotionClassName } from "./motion.js";
import { backdropHostStyle, scrimStyle } from "./layout-contract.js";
import { boxStyle, resolveRecipe, textStyle } from "./theme.js";
import type { ResolvedTheme } from "./theme.js";
import { BoxElement } from "./renderer-hold.js";
import { renderMediaNode } from "./renderer-media.js";
import type { ExitRecord, RenderMode } from "./renderer-motion.js";
import { classifyPress, type ClassifiedPress } from "./renderer-press.js";
import {
  EMPTY_ANCESTORS,
  RENDER_BUDGET,
  cappedString,
  childIdsOf,
  isHiddenByDefault,
  isRenderableMedia,
  styleOf,
} from "./renderer-safe.js";

const EMPTY_EXIT_RECORDS_BY_PARENT: ReadonlyMap<NodeId, readonly ExitRecord[]> = new Map<
  NodeId,
  readonly ExitRecord[]
>();

/**
 * The browser-private table-sort view-state, threaded from `StageRenderer`
 * exactly like `visibilityOverrides` (the read map) and `onPress` (a StageRenderer
 * setter passed down). `overrides` maps a table node id to its active
 * column/direction; `onSort` cycles a table's sort (asc → desc → unsorted). It is
 * VIEW-STATE only — `onSort` fires no transport/agent event (RISK-INV-2). Omitted
 * on inert render paths (exit records / the previous-screen clone) so those never
 * read or write sort state.
 */
interface SortControl {
  readonly overrides: ReadonlyMap<
    NodeId,
    { readonly column: string; readonly direction: SortDirection }
  >;
  readonly onSort: (nodeId: NodeId, column: string) => void;
}

interface RenderArgs {
  readonly tree: FacetTree;
  readonly id: NodeId;
  /**
   * StageRenderer's `handlePress` — receives the classified press AND the
   * pressed box's node id (`sourceId`), so a locally-resolved navigate/toggle
   * can be recorded with its source `target`. Bound to this node's id at the
   * `BoxElement` call site below.
   */
  readonly onPress: (press: ClassifiedPress, sourceId: NodeId) => void;
  readonly visibilityOverrides: ReadonlyMap<NodeId, boolean>;
  /** The resolved theme threaded from StageRenderer to every style call site. */
  readonly theme: ResolvedTheme;
  /** Ids on the path from the root to here — used to break cycles fail-safe. */
  readonly ancestors?: ReadonlySet<NodeId> | undefined;
  /**
   * Per-render-pass node budget — bounds total renders (invariant #2). `warned`
   * latches the one-time console.warn when the budget first trips.
   */
  readonly budget: { left: number; refsLeft: number; warned?: boolean };
  /**
   * Set to `true` the moment a REACHABLE box renders with an appear class, so
   * the caller can gate the one-per-stage `<style>` on the same budget-bounded
   * walk that renders the tree — never a separate unbounded scan of the whole
   * `tree.nodes` map (which the raw live path can grow to arbitrary size with
   * unreachable/dangling entries). Reachable-only is also MORE correct: an
   * appear token on an unrendered node no longer forces a useless stylesheet.
   */
  readonly appearSeen: { used: boolean };
  readonly depth: number;
  readonly renderMode: RenderMode;
  readonly motionClassById: ReadonlyMap<NodeId, string>;
  readonly exitRecordsByParent: ReadonlyMap<NodeId, readonly ExitRecord[]>;
  readonly activeScreen: string | null;
  /**
   * Browser-private table-sort view-state (read map + cycle setter). Optional so
   * the inert exit/previous-screen paths can omit it — a `renderTable` then reads
   * no sort and renders natural order.
   */
  readonly sortControl?: SortControl | undefined;
}

interface ExitRenderArgs {
  readonly record: ExitRecord;
  readonly onPress: RenderArgs["onPress"];
  readonly appearSeen: { used: boolean };
}

interface ContainerChildrenRenderArgs {
  readonly tree: FacetTree;
  readonly parentId: NodeId;
  readonly childIds: readonly NodeId[];
  readonly onPress: RenderArgs["onPress"];
  readonly visibilityOverrides: ReadonlyMap<NodeId, boolean>;
  readonly theme: ResolvedTheme;
  readonly ancestors?: ReadonlySet<NodeId> | undefined;
  readonly budget: RenderArgs["budget"];
  readonly appearSeen: { used: boolean };
  readonly depth: number;
  readonly renderMode: RenderMode;
  readonly motionClassById: ReadonlyMap<NodeId, string>;
  readonly exitRecordsByParent: ReadonlyMap<NodeId, readonly ExitRecord[]>;
  readonly activeScreen: string | null;
  readonly sortControl?: SortControl | undefined;
}

function renderContainerChildren({
  tree,
  parentId,
  childIds,
  onPress,
  visibilityOverrides,
  theme,
  ancestors,
  budget,
  appearSeen,
  depth,
  renderMode,
  motionClassById,
  exitRecordsByParent,
  activeScreen,
  sortControl,
}: ContainerChildrenRenderArgs): ReactNode[] {
  // Fail-safe (invariant #2): skip a child that points back to an ancestor so
  // a cyclic tree (which never passes through validateTree on the live path)
  // can't infinitely recurse and crash the render.
  const seen = ancestors ?? EMPTY_ANCESTORS;
  const childAncestors = new Set(seen).add(parentId);
  // One linear pass skips ancestors (cycle break) and dedupes sibling ids
  // (raw path can repeat one; validateTree dedupes too) — first occurrence
  // wins so React keys stay unique.
  const emitted = new Set<NodeId>(childAncestors);
  const uniqueChildIds: NodeId[] = [];
  for (const childId of childIds) {
    if (--budget.refsLeft < 0) {
      if (budget.warned !== true) {
        budget.warned = true;
        console.warn(
          `[facet] render budget of ${MAX_RENDER_NODES} nodes exceeded; the excess is truncated`,
        );
      }
      break;
    }
    if (emitted.has(childId)) {
      continue;
    }
    emitted.add(childId);
    uniqueChildIds.push(childId);
  }
  const exitsBySlot = new Map<number, readonly ExitRecord[]>();
  if (renderMode === "live") {
    const parentExitRecords = exitRecordsByParent.get(parentId) ?? [];
    for (const record of parentExitRecords) {
      let slot = uniqueChildIds.length;
      for (const [index, childId] of uniqueChildIds.entries()) {
        const previousIndex = record.snapshot.visible.nodes.get(childId)?.index;
        if (previousIndex === undefined || previousIndex > record.index) {
          slot = index;
          break;
        }
      }
      const records = exitsBySlot.get(slot);
      if (records === undefined) {
        exitsBySlot.set(slot, [record]);
      } else {
        exitsBySlot.set(slot, [...records, record]);
      }
    }
  }
  const children: ReactNode[] = [];
  for (let index = 0; index <= uniqueChildIds.length; index += 1) {
    for (const record of exitsBySlot.get(index) ?? []) {
      children.push(
        <Fragment key={`exit:${record.id}`}>
          {renderExitRecord({ record, onPress, appearSeen })}
        </Fragment>,
      );
    }
    const childId = uniqueChildIds[index];
    if (childId === undefined) {
      continue;
    }
    // Each child is rendered by a direct recursive call; a keyed Fragment
    // carries the React list key without adding a DOM node (flow layout and the
    // byte-identical output are unchanged — a Fragment emits no markup).
    children.push(
      <Fragment key={`live:${childId}`}>
        {renderNode({
          tree,
          id: childId,
          onPress,
          visibilityOverrides,
          theme,
          ancestors: childAncestors,
          budget,
          appearSeen,
          depth: depth + 1,
          renderMode,
          motionClassById,
          exitRecordsByParent,
          activeScreen,
          sortControl,
        })}
      </Fragment>,
    );
  }
  return children;
}

export function renderExitRecord({ record, onPress, appearSeen }: ExitRenderArgs): ReactNode {
  return renderNode({
    tree: record.snapshot.tree,
    id: record.id,
    onPress,
    visibilityOverrides: record.snapshot.visibilityOverrides,
    theme: record.snapshot.theme,
    ancestors: record.ancestors,
    budget: { left: RENDER_BUDGET, refsLeft: RENDER_BUDGET },
    appearSeen,
    depth: record.depth,
    renderMode: "inert",
    motionClassById: new Map<NodeId, string>([[record.id, MOTION_CLASS_NAMES.brickExit]]),
    exitRecordsByParent: EMPTY_EXIT_RECORDS_BY_PARENT,
    activeScreen: record.snapshot.activeScreen,
  });
}

/**
 * Renders one node to a `ReactNode`, recursing into box children. A PLAIN
 * function (not a React component) invoked from StageRenderer's body: the mutable
 * `budget` it decrements is therefore local to a single StageRenderer render and
 * never shared across separate component invocations, so React StrictMode's
 * double-invoke can't silently halve the effective cap (it re-runs StageRenderer,
 * which makes a fresh budget each time).
 */
export function renderNode({
  tree,
  id,
  onPress,
  visibilityOverrides,
  theme,
  ancestors,
  budget,
  appearSeen,
  depth,
  renderMode,
  motionClassById,
  exitRecordsByParent,
  activeScreen,
  sortControl,
}: RenderArgs): ReactNode {
  const node = tree.nodes[id];
  // == null also skips a node a patch replaced with JSON null (not just missing
  // ids), and short-circuits BEFORE the budget decrement so a skipped id doesn't
  // spend budget.
  if (node == null || depth > MAX_DEPTH) {
    return null;
  }
  // The budget guard bounds a shared-child DAG's exponential path count the same
  // way depth bounds nesting — decremented only for a node we'd actually render.
  // Warn ONCE when the budget trips so a truncated render isn't silent (the
  // validator emits the matching node-count issue at store time).
  if (--budget.left < 0) {
    if (budget.warned !== true) {
      budget.warned = true;
      console.warn(
        `[facet] render budget of ${MAX_RENDER_NODES} nodes exceeded; the excess is truncated`,
      );
    }
    return null;
  }
  // Effective visibility = browser override ?? content default. A hidden node
  // is skipped (never thrown on), same as an unresolvable id.
  const visible = visibilityOverrides.get(id) ?? !isHiddenByDefault(node);
  if (!visible) {
    return null;
  }
  const inert = renderMode === "inert";
  const motionClassName = motionClassById.get(id);
  if ((node as { readonly type?: unknown }).type === "image") {
    return renderMediaNode(node, theme, motionClassName, inert);
  }
  const renderPressable = (args: PressableRenderArgs<ClassifiedPress>): ReactNode => (
    <BoxElement {...args} />
  );
  const dispatchBrickPress = (classified: ClassifiedPress): void => onPress(classified, id);
  // Sort view-state for THIS node: the inert clone reads/writes none (undefined),
  // so a mid-transition previous screen shows natural order and never becomes a
  // second sort writer (RISK-INV-5). `onHeaderSort` fires no transport (RISK-INV-2).
  const sortForNode =
    inert || sortControl === undefined ? undefined : sortControl.overrides.get(id);
  const onHeaderSort =
    inert || sortControl === undefined
      ? undefined
      : (column: string): void => sortControl.onSort(id, column);
  const renderBrick = (children?: ReactNode): ReactNode =>
    renderBrickNode(node, {
      theme,
      className: motionClassName,
      inert,
      nodeId: id,
      activeScreen,
      data: tree.data,
      children,
      classifyPress,
      dispatch: dispatchBrickPress,
      navigate: (to: string): void => onPress({ kind: "navigate", to }, id),
      sort: sortForNode,
      onHeaderSort,
      renderPressable,
    });

  switch (node.type) {
    case "box": {
      const boxStyleValue = styleOf(node.style) as
        { readonly scheme?: unknown; readonly backdropScrim?: unknown } | undefined;
      // `scheme` (pinned): a bounded, READ-ONLY per-subtree color-map swap.
      // Children render with the light/dark palette this box selects; it writes
      // no stage state, cannot leak upward, and a nested `scheme:"light"` island
      // restores the light map. An unknown/absent scheme leaves the map
      // unchanged (light default).
      const scheme = boxStyleValue?.scheme;
      const childTheme: ResolvedTheme =
        scheme === "dark"
          ? { ...theme, color: theme.colorDark }
          : scheme === "light"
            ? { ...theme, color: theme.colorLight }
            : theme;
      const children = renderContainerChildren({
        tree,
        parentId: id,
        childIds: childIdsOf(node),
        onPress,
        visibilityOverrides,
        theme: childTheme,
        ancestors,
        budget,
        appearSeen,
        depth,
        renderMode,
        motionClassById,
        exitRecordsByParent,
        activeScreen,
        sortControl,
      });
      // `backdrop` (RISK-INV-2/3/4): resolve a STANDALONE media node id READ-ONLY
      // to a background COVER layer. It resolves to a MEDIA node ONLY — a
      // dangling id, a non-media/container node (never recursed into, so a
      // backdrop→box or self-cycle cannot loop), or an unsafe/blank src paints
      // NOTHING and never throws. The resolved node DECREMENTS the render budget
      // so it can't escape MAX_RENDER_NODES. Node-consumption is render-both (no
      // de-dupe): an id also present in `children` renders in BOTH places.
      let backdropLayers: ReactNode = null;
      const backdropId = (node as { readonly backdrop?: unknown }).backdrop;
      if (typeof backdropId === "string") {
        const backdropNode = tree.nodes[backdropId];
        if (backdropNode != null && isRenderableMedia(backdropNode)) {
          // The backdrop is a followed reference AND a rendered node: count it
          // against both budgets; the paint decision gates on the render budget
          // (`left`) so the layer can never exceed MAX_RENDER_NODES.
          budget.refsLeft -= 1;
          if (--budget.left < 0) {
            if (budget.warned !== true) {
              budget.warned = true;
              console.warn(
                `[facet] render budget of ${MAX_RENDER_NODES} nodes exceeded; the excess is truncated`,
              );
            }
          } else {
            const scrimToken = boxStyleValue?.backdropScrim;
            const scrimKey = scrimToken === "light" || scrimToken === "dark" ? scrimToken : "none";
            // Exactly two renderer-synthesized layers: the media cover layer
            // (the ONLY `position:absolute`, via `renderMediaNode` COVER) and the
            // scrim tint sibling. Both aria-hidden; flow children render on top.
            backdropLayers = (
              <>
                {renderMediaNode(backdropNode, theme, undefined, false, true)}
                <div aria-hidden={true} style={scrimStyle(theme.scrim[scrimKey])} />
              </>
            );
          }
        }
      }
      // onPress is untrusted on the raw path — an unclassifiable action renders
      // a plain non-pressable box instead of a dead or dangerous button.
      const press = classifyPress(node.onPress);
      // onHold is untrusted the same way, classified by the SAME classifier
      // (one classifier, one switch — RISK-INV-1): junk (`onHold: 42`)
      // classifies null and the box renders today's exact press-only or plain
      // markup (byte-identical DOM). Only a classifiable onHold attaches the
      // gesture-detecting pointer handlers.
      const hold = classifyPress(node.onHold);
      // appearClass is TOTAL on raw-path junk: only "fade"/"slide" yield a
      // class; undefined adds no attribute, keeping token-free output
      // byte-identical.
      const appear = appearClass(styleOf(node.style));
      // Record appear use during the budget-bounded walk (review r7): the
      // one-per-stage <style> is gated on this flag, never a separate O(N) scan
      // of the whole node map.
      if (appear !== undefined) {
        appearSeen.used = true;
      }
      const variant = (node as { readonly variant?: unknown }).variant;
      const recipe = resolveRecipe(theme, "box", variant);
      // Resolve the box's OWN style against `childTheme` too, so a `scheme:"dark"`
      // box paints its own `bg`/`border` from the dark palette — a "dark band"
      // must be dark itself, not just its descendants (else near-white bg + dark
      // text = illegible). `childTheme` aliases `theme` when no scheme is set.
      const boxCss = boxStyle(
        { ...(recipe.box ?? {}), ...(styleOf(node.style) ?? {}) },
        childTheme,
      );
      // ONE element type for every box (review r6): a live patch that adds or
      // removes onPress/onHold changes only BoxElement's props, never the
      // element type at this position — so React updates in place instead of
      // remounting the subtree (which would wipe visitor-typed field text and
      // scroll offsets).
      // Bind the pressed box's id so press AND hold (both route through the ONE
      // dispatch) record a local navigate/toggle with this box as `target`.
      const dispatch = (classified: ClassifiedPress): void => onPress(classified, id);
      // Only a resolved backdrop wraps the box in the `position:relative` host;
      // a box with no (or an unresolved) backdrop renders byte-identically to
      // today's output (`backdropLayers` is null ⇒ no extra element, no host
      // style). This keeps DC-006 back-compat.
      return (
        <BoxElement
          press={inert ? null : press}
          hold={inert ? null : hold}
          dispatch={dispatch}
          className={composeMotionClassName(appear, motionClassName)}
          style={backdropLayers === null ? boxCss : backdropHostStyle(boxCss)}
          inert={inert}
        >
          {backdropLayers}
          {children}
        </BoxElement>
      );
    }
    case "text": {
      // A non-string value (an object would make React itself throw) is skipped.
      // No appear class here: appear is BoxStyle-only (Decision 2) — validateTree
      // strips it from non-box styles, so the raw path must render it as absent.
      const value = cappedString(node.value, MAX_NODE_BODY_CHARS);
      if (value === undefined) return null;
      const variant = (node as { readonly variant?: unknown }).variant;
      const recipe = resolveRecipe(theme, "text", variant);
      const textCss = textStyle({ ...(recipe.text ?? {}), ...(styleOf(node.style) ?? {}) }, theme);
      return (
        <p
          className={motionClassName}
          aria-hidden={inert ? true : undefined}
          style={inert ? { ...textCss, pointerEvents: "none" } : textCss}
        >
          {value}
        </p>
      );
    }
    case "media":
      return renderMediaNode(node, theme, motionClassName, inert);
    case "field":
      return renderBrick();
    default: {
      // Registry dispatch for the renderBrick set (every component). A container
      // brick (section/card/form) renders its children first and passes them in;
      // every other brick is a leaf and calls renderBrick() with none. box/text/
      // media/field keep their bespoke cases above. An unknown/junk type has no
      // entry and renders nothing — the same no-default fail-safe degrade as
      // before (the switch previously fell through to `undefined`).
      const entry = brickRendererEntry(node.type);
      if (entry === undefined) {
        return null;
      }
      if (entry.container) {
        return renderBrick(
          renderContainerChildren({
            tree,
            parentId: id,
            childIds: childIdsOf(node),
            onPress,
            visibilityOverrides,
            theme,
            ancestors,
            budget,
            appearSeen,
            depth,
            renderMode,
            motionClassById,
            exitRecordsByParent,
            activeScreen,
            sortControl,
          }),
        );
      }
      return renderBrick();
    }
  }
}
