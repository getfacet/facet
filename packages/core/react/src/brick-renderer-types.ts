import type { CSSProperties, ReactNode } from "react";
import type { DataWarehouse, NodeId } from "@facet/core";
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
  readonly renderPressable: (args: PressableRenderArgs<Press>) => ReactNode;
}
