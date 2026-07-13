import type { CSSProperties, ReactNode } from "react";
import type { DataWarehouse, NodeId, SortDirection } from "@facet/core";
import type { ResolvedTheme } from "./theme.js";

export interface PressableRenderArgs<Press> {
  readonly press: Press | null;
  readonly hold: Press | null;
  readonly dispatch: (press: Press) => void;
  readonly style: CSSProperties;
  readonly className: string | undefined;
  readonly inert?: boolean;
  readonly disabled?: boolean;
  readonly buttonRole?: boolean;
  readonly children: ReactNode;
}

export interface BrickRenderContext<Press> {
  readonly theme: ResolvedTheme;
  readonly className: string | undefined;
  readonly inert: boolean;
  readonly nodeId: NodeId;
  readonly activeScreen: string | null;
  /**
   * The browser-private RAW toggle override map (node id → shown/hidden),
   * threaded straight through exactly like `activeScreen`. READ-ONLY: a
   * `{ toggled }` active-look predicate reads `get(id) === true` directly
   * (never-toggled ⇒ false), so it stays byte-coherent with the reported
   * `view.toggled` (invariant #6). On the inert exit/previous-screen clone this
   * carries the SNAPSHOT's overrides, keeping that clone's look snapshot-coherent.
   */
  readonly visibilityOverrides: ReadonlyMap<NodeId, boolean>;
  /**
   * The validated per-tree data warehouse (`FacetTree.data`), threaded straight
   * through from the tree so a node's `from` binding resolves at render time via
   * the ONE core `resolveNodeData`. READ-ONLY: resolution is a pure function of
   * (node, this) — the renderer never writes/caches projected data (invariant #6,
   * the A2UI dual-writer hazard). Optional so existing ctx consumers compile.
   */
  readonly data?: DataWarehouse | undefined;
  readonly children?: ReactNode;
  readonly classifyPress: (value: unknown) => Press | null;
  readonly dispatch: (press: Press) => void;
  readonly navigate: (to: string) => void;
  /**
   * The browser-private sort view-state for THIS node (`nodeId`), or `undefined`
   * when the visitor has not sorted it. READ-ONLY: `renderTable` applies it to
   * the freshly-resolved rows as a pure reorder; it never mutates `data`/`rows`
   * (invariant #6, server stays sole writer). Absent on the inert clone so a
   * mid-transition previous screen shows natural order.
   */
  readonly sort?: { readonly column: string; readonly direction: SortDirection } | undefined;
  /**
   * Cycles this table's sort for a column (asc → desc → unsorted), threaded from
   * `StageRenderer` exactly like `navigate`. VIEW-STATE ONLY — it fires no
   * `onRecord`/`onAction`/transport; the sort rides only the `view` snapshot.
   * `undefined` on the inert clone so it never writes sort state.
   */
  readonly onHeaderSort?: ((column: string) => void) | undefined;
  readonly renderPressable: (args: PressableRenderArgs<Press>) => ReactNode;
}
