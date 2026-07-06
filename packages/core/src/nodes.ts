/**
 * The low-level brick palette — the entire vocabulary an agent uses to build a
 * stage. There are only four bricks: `box`, `text`, `media`, `field`.
 *
 * These are Lego bricks, not finished furniture. A "card" is a `box` with a
 * border; a "button" is a `box` with `onPress`; a "heading" is a big `text`. The
 * agent composes everything from these four, so the set of producible pages is
 * unbounded — while every brick stays a typed, token-styled data value (never
 * raw HTML/JS), so nothing can be injected and nothing can render broken.
 *
 * Higher-level shapes (card(), hero(), row()) live in an optional preset
 * package, not here — they are just functions that emit box compositions.
 */
import type {
  Align,
  Appear,
  Columns,
  Color,
  Direction,
  FontSize,
  FontWeight,
  Justify,
  Radius,
  Ratio,
  ScrollAxis,
  Sizing,
  Space,
  TextAlign,
} from "./tokens.js";

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
}

export interface TextStyle {
  readonly size?: FontSize;
  readonly weight?: FontWeight;
  readonly color?: Color;
  readonly align?: TextAlign;
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
  readonly children: readonly NodeId[];
}

export interface TextNode {
  readonly id: NodeId;
  readonly type: "text";
  readonly value: string;
  readonly style?: TextStyle;
}

export const MEDIA_KINDS = ["image", "video"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export interface MediaNode {
  readonly id: NodeId;
  readonly type: "media";
  readonly kind: MediaKind;
  readonly src: string;
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
  readonly input?: FieldInput;
  readonly options?: readonly string[];
  readonly label?: string;
  readonly placeholder?: string;
  readonly style?: FieldStyle;
}

/** Any brick the agent may place on a stage. */
export type FacetNode = BoxNode | TextNode | MediaNode | FieldNode;

/** Narrows a node to the one brick that can hold children. */
export function isContainer(node: FacetNode): node is BoxNode {
  return node.type === "box";
}
