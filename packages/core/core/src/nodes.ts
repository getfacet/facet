/**
 * The closed vocabulary an agent uses to build a stage. Primitive bricks
 * (`box`, `text`, `media`, `field`) remain the universal fallback; intrinsic
 * components provide safer common UI shapes without allowing raw HTML/JS/CSS.
 *
 * Primitive bricks stay the base and escape hatch; intrinsic components are
 * typed shortcuts for common, renderer-owned UI shapes. The agent can fall back
 * to primitives whenever a component is too specific, while every node remains a
 * typed, token-styled data value (never raw HTML/JS), so nothing can be injected
 * and nothing can render broken.
 *
 * The vocabulary grows only by adding typed node shapes here and matching
 * validation/rendering support on purpose.
 */
import type {
  Align,
  Appear,
  Columns,
  Color,
  Direction,
  FontFamily,
  FontSize,
  FontWeight,
  Gradient,
  ColorScheme,
  Highlight,
  Justify,
  Leading,
  MaxWidth,
  MinHeight,
  Radius,
  Ratio,
  Scrim,
  ScrollAxis,
  Shadow,
  Sizing,
  Space,
  TextAlign,
  Tracking,
} from "./tokens.js";
import type { ViewPredicate } from "./view.js";

/** Identifier for a node within a stage tree. */
export type NodeId = string;

/**
 * An action routed to the agent (a ClientEvent over the transport). `kind` is
 * OPTIONAL by design: a bare legacy `{name}` IS an agent action, so every
 * pre-union `onPress` literal keeps compiling and behaving. `validateTree`
 * stamps the canonical `kind: "agent"` when normalizing.
 */
export interface AgentAction {
  readonly kind?: "agent";
  /** Stable action name the agent listens for, e.g. "view_pricing". */
  readonly name: string;
  /** Optional structured payload carried back to the agent. */
  readonly payload?: Readonly<Record<string, string | number | boolean>>;
  /**
   * Node-id reference; at press time the browser snapshots visible field values
   * in that box's subtree into the event's fields.
   */
  readonly collect?: NodeId;
}

/**
 * Switches the visible screen instantly in the browser — no agent turn, no
 * transport traffic. `name?: undefined` keeps legacy `.name` probes on the
 * union compiling while truthfully reporting there is no agent action name.
 */
export interface NavigateAction {
  readonly kind: "navigate";
  /** Screen name to show (a key of `FacetTree.screens`). Unknown names no-op. */
  readonly to: string;
  readonly name?: undefined;
}

/**
 * Shows/hides the target node instantly in the browser (view-state only).
 * `name?: undefined` for the same source-compat reason as NavigateAction.
 */
export interface ToggleAction {
  readonly kind: "toggle";
  /** Node id whose visibility flips. Unknown ids no-op. */
  readonly target: NodeId;
  readonly name?: undefined;
}

/**
 * Fired when an interactive brick is used (a pressed box, a submitted field).
 * Narrow on `kind`: `"navigate"`/`"toggle"` are exact literals, and the
 * else-branch (absent or `"agent"`) is the agent-routed action.
 */
export type FacetAction = AgentAction | NavigateAction | ToggleAction;

export interface BoxStyle {
  readonly direction?: Direction;
  readonly gap?: Space;
  readonly pad?: Space;
  readonly align?: Align;
  readonly justify?: Justify;
  readonly wrap?: boolean;
  readonly bg?: Color;
  readonly radius?: Radius;
  readonly border?: boolean;
  readonly grow?: boolean;
  readonly width?: Sizing;
  /**
   * Enter animation, replayed on each mount/re-show of the node (first paint,
   * node re-add, toggle re-show, screen navigation). The renderer owns the
   * duration/curve as framework constants — this token names the motion only.
   */
  readonly appear?: Appear;
  /**
   * Bounded, internally-scrollable region. Legacy `true` normalizes to vertical
   * (`"y"`). Horizontal scroll remains bounded by the renderer.
   */
  readonly scroll?: ScrollAxis | true;
  /**
   * Flow-safe grid columns. When present, the renderer uses grid layout and
   * ignores direction/wrap because the grid owns the axis.
   */
  readonly columns?: Columns;
  readonly shadow?: Shadow;
  /** Bounded minimum height for landing-grade sections (theme-mapped length). */
  readonly minHeight?: MinHeight;
  /** Bounded max content width for readable columns (theme-mapped length). */
  readonly maxWidth?: MaxWidth;
  /**
   * Keeps the box stuck within its scroll container. The renderer owns the top
   * offset as a framework constant — flow-compatible, no author offset/z-index.
   */
  readonly sticky?: boolean;
  /** Named background gradient (theme maps the name to a concrete CSS gradient). */
  readonly gradient?: Gradient;
  /** Scrim overlay strength painted over this box's backdrop layer. */
  readonly backdropScrim?: Scrim;
  /**
   * Authored color scheme for this box's subtree (a dark/light section) — the
   * renderer swaps the color-token map read-only for the subtree (never leaks
   * upward). Unknown value → unchanged. `ColorScheme` is deliberately distinct
   * from view-state's report-only device `Scheme`.
   */
  readonly scheme?: ColorScheme;
}

export interface TextStyle {
  readonly family?: FontFamily;
  readonly size?: FontSize;
  readonly weight?: FontWeight;
  readonly color?: Color;
  readonly align?: TextAlign;
  /** Letter-spacing token (theme-mapped). */
  readonly tracking?: Tracking;
  /** Line-height token (theme-mapped). */
  readonly leading?: Leading;
  /** Highlight treatment behind the text run (theme-mapped decoration). */
  readonly highlight?: Highlight;
}

export interface MediaStyle {
  readonly radius?: Radius;
  readonly width?: Sizing;
  readonly ratio?: Ratio;
}

export interface FieldStyle {
  readonly width?: Sizing;
}

/**
 * The universal container and the only brick that holds children. Flow layout
 * only (row/col), so children stack or wrap — they cannot overlap or fall off
 * the page. A box with `onPress` IS the button primitive; a box with a border is
 * a card; nested boxes are any layout.
 */
export interface BoxNode {
  readonly id: NodeId;
  readonly type: "box";
  readonly variant?: string;
  readonly style?: BoxStyle;
  /** Makes the box pressable. Any box can be a button — or a clickable card. */
  readonly onPress?: FacetAction;
  /**
   * Secondary long-press gesture — the same action union as `onPress`. Advice:
   * hold is a secondary path; never make it the only way to critical content.
   */
  readonly onHold?: FacetAction;
  /**
   * Content-declared default visibility (server-written). The browser's toggle
   * override wins after first interaction; only literal `true` hides.
   */
  readonly hidden?: boolean;
  /**
   * Node-id reference to a standalone MEDIA node used as this box's background.
   * At render time the renderer resolves it READ-ONLY to a media node and paints
   * it as a bounded background layer (renderer-synthesized, `position:absolute`
   * confined to that layer); it never absolute-positions a flow child. A
   * dangling/non-media/unsafe reference paints no layer (fail-safe).
   */
  readonly backdrop?: NodeId;
  /**
   * Recipe name applied ONLY while `active` evaluates true (enabler B). The
   * renderer folds it over `variant` read-only via `resolveRecipe`; token-only
   * by construction. Prefer this over `activeStyle`.
   */
  readonly activeVariant?: string;
  /**
   * Extra style tokens applied ONLY while `active` evaluates true (enabler B).
   * Routed through the SAME `boxStyle()` token sanitizer as `style`, so it can
   * carry only tokens — never a raw-CSS bypass.
   */
  readonly activeStyle?: BoxStyle;
  /**
   * Closed view-state predicate selecting when the active look applies (enabler
   * B). Read-only, evaluated against the threaded snapshot view-state; an
   * unknown/dangling predicate degrades to the default look.
   */
  readonly active?: ViewPredicate;
  readonly children: readonly NodeId[];
}

export interface TextNode {
  readonly id: NodeId;
  readonly type: "text";
  readonly value: string;
  readonly variant?: string;
  readonly style?: TextStyle;
  /**
   * Optional binding: read `value` from a single cell of `FacetTree.data[from]`
   * (enabler A). Mirrors `MetricFields`; `from` wins over the inline `value`, a
   * dangling reference or absent column yields empty — never throws.
   */
  readonly from?: string;
  /** The dataset column supplying the cell value (used only with `from`). */
  readonly column?: string;
  /** The dataset row index (default 0) supplying the cell value (used only with `from`). */
  readonly row?: number;
  /**
   * Recipe name applied ONLY while `active` evaluates true (enabler B). Folded
   * over `variant` read-only via `resolveRecipe`; token-only. Prefer this over
   * `activeStyle`.
   */
  readonly activeVariant?: string;
  /**
   * Extra style tokens applied ONLY while `active` evaluates true (enabler B).
   * Routed through the SAME `textStyle()` token sanitizer as `style`.
   */
  readonly activeStyle?: TextStyle;
  /**
   * Closed view-state predicate selecting when the active look applies (enabler
   * B). Read-only; an unknown/dangling predicate degrades to the default look.
   */
  readonly active?: ViewPredicate;
}

export const MEDIA_KINDS = ["image", "video"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export interface MediaNode {
  readonly id: NodeId;
  readonly type: "media";
  readonly kind: MediaKind;
  readonly src: string;
  readonly variant?: string;
  readonly alt?: string;
  readonly poster?: string;
  readonly controls?: boolean;
  readonly style?: MediaStyle;
}

/** Allowed field input types — single source (validator derives its check from this). */
export const FIELD_INPUTS = [
  "text",
  "number",
  "email",
  "password",
  "search",
  "checkbox",
  "radio",
  "select",
  "switch",
] as const;
export type FieldInput = (typeof FIELD_INPUTS)[number];

/** The input primitive. */
export interface FieldNode {
  readonly id: NodeId;
  readonly type: "field";
  readonly name: string;
  readonly variant?: string;
  readonly input?: FieldInput;
  readonly options?: readonly string[];
  readonly label?: string;
  readonly placeholder?: string;
  readonly style?: FieldStyle;
}

export const PRIMITIVE_BRICK_TYPES = ["box", "text", "media", "field"] as const;
export type PrimitiveBrickType = (typeof PRIMITIVE_BRICK_TYPES)[number];
export type PrimitiveBrickNode = BoxNode | TextNode | MediaNode | FieldNode;

export * from "./component-nodes.js";
import type { CardNode, ComponentNode, FormNode, SectionNode } from "./component-nodes.js";

/** Any brick the agent may place on a stage. */
export type FacetNode = PrimitiveBrickNode | ComponentNode;

export type ContainerNode = BoxNode | SectionNode | CardNode | FormNode;

/** Narrows a node to the bricks that can hold children. */
export function isContainer(node: FacetNode): node is ContainerNode {
  return (
    node.type === "box" || node.type === "section" || node.type === "card" || node.type === "form"
  );
}
