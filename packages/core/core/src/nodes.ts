/**
 * The closed vocabulary an agent uses to build a stage. Primitive bricks
 * (`box`, `text`, `media`, `field`) remain the universal fallback; intrinsic
 * components provide safer common UI shapes without allowing raw HTML/JS/CSS.
 *
 * These are Lego bricks, not finished furniture. A "card" is a `box` with a
 * border; a "button" is a `box` with `onPress`; a "heading" is a big `text`. The
 * agent composes everything from these four, so the set of producible pages is
 * unbounded — while every brick stays a typed, token-styled data value (never
 * raw HTML/JS), so nothing can be injected and nothing can render broken.
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
  Justify,
  Radius,
  Ratio,
  ScrollAxis,
  Shadow,
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
  readonly shadow?: Shadow;
}

export interface TextStyle {
  readonly family?: FontFamily;
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
  readonly children: readonly NodeId[];
}

export interface TextNode {
  readonly id: NodeId;
  readonly type: "text";
  readonly value: string;
  readonly variant?: string;
  readonly style?: TextStyle;
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

export const INTRINSIC_COMPONENT_TYPES = [
  "button",
  "section",
  "card",
  "tabs",
  "nav",
  "table",
  "chart",
  "metric",
  "keyValue",
  "badge",
  "progress",
  "alert",
  "list",
  "divider",
  "form",
  "search",
  "filterBar",
  "emptyState",
  "loading",
] as const;
export type IntrinsicComponentType = (typeof INTRINSIC_COMPONENT_TYPES)[number];

export const LEGACY_COMPONENT_TYPES = ["stat"] as const;
export type LegacyComponentType = (typeof LEGACY_COMPONENT_TYPES)[number];

export const COMPONENT_NODE_TYPES = [
  ...INTRINSIC_COMPONENT_TYPES,
  ...LEGACY_COMPONENT_TYPES,
] as const;
export type ComponentNodeType = (typeof COMPONENT_NODE_TYPES)[number];

export const HIGH_LEVEL_NODE_TYPES = [
  "button",
  "section",
  "card",
  "tabs",
  "table",
  "chart",
  "stat",
  "badge",
  "progress",
  "alert",
  "list",
  "divider",
] as const satisfies readonly ComponentNodeType[];
export type HighLevelNodeType = (typeof HIGH_LEVEL_NODE_TYPES)[number];

export const TONES = ["neutral", "accent", "info", "success", "warning", "danger"] as const;
export type Tone = (typeof TONES)[number];

export interface ButtonNode {
  readonly id: NodeId;
  readonly type: "button";
  readonly label: string;
  readonly variant?: string;
  readonly tone?: Tone;
  readonly disabled?: boolean;
  readonly onPress?: FacetAction;
  readonly onHold?: FacetAction;
}

export interface SectionNode {
  readonly id: NodeId;
  readonly type: "section";
  readonly title?: string;
  readonly eyebrow?: string;
  readonly body?: string;
  readonly variant?: string;
  readonly children: readonly NodeId[];
}

export interface CardNode {
  readonly id: NodeId;
  readonly type: "card";
  readonly title?: string;
  readonly body?: string;
  readonly variant?: string;
  readonly tone?: Tone;
  readonly onPress?: FacetAction;
  readonly onHold?: FacetAction;
  readonly children: readonly NodeId[];
}

export interface TabItem {
  readonly label: string;
  readonly to: string;
}

export interface TabsNode {
  readonly id: NodeId;
  readonly type: "tabs";
  readonly items: readonly TabItem[];
  readonly variant?: string;
}

export interface NavItem {
  readonly label: string;
  readonly to: string;
}

export interface NavNode {
  readonly id: NodeId;
  readonly type: "nav";
  readonly items: readonly NavItem[];
  readonly variant?: string;
}

export interface TableColumn {
  readonly key: string;
  readonly label: string;
  readonly align?: TextAlign;
}

export type TableCell = string | number | boolean;
export type TableRow = Readonly<Record<string, TableCell>>;

export interface TableNode {
  readonly id: NodeId;
  readonly type: "table";
  readonly columns: readonly TableColumn[];
  readonly rows: readonly TableRow[];
  readonly caption?: string;
  readonly variant?: string;
}

export const CHART_KINDS = ["bar", "line", "donut"] as const;
export type ChartKind = (typeof CHART_KINDS)[number];

export interface ChartSeries {
  readonly label: string;
  readonly values: readonly number[];
}

export interface ChartNode {
  readonly id: NodeId;
  readonly type: "chart";
  readonly kind: ChartKind;
  readonly series: readonly ChartSeries[];
  readonly labels?: readonly string[];
  readonly title?: string;
  readonly variant?: string;
}

interface MetricFields {
  readonly id: NodeId;
  readonly label: string;
  readonly value: string;
  readonly delta?: string;
  readonly tone?: Tone;
  readonly variant?: string;
}

export interface MetricNode extends MetricFields {
  readonly type: "metric";
}

export interface StatNode extends MetricFields {
  readonly type: "stat";
}

export interface KeyValueItem {
  readonly key?: string;
  readonly label: string;
  readonly value: string;
  readonly tone?: Tone;
}

export interface KeyValueNode {
  readonly id: NodeId;
  readonly type: "keyValue";
  readonly items: readonly KeyValueItem[];
  readonly variant?: string;
}

export interface BadgeNode {
  readonly id: NodeId;
  readonly type: "badge";
  readonly label: string;
  readonly tone?: Tone;
  readonly variant?: string;
}

export interface ProgressNode {
  readonly id: NodeId;
  readonly type: "progress";
  readonly value: number;
  readonly label?: string;
  readonly tone?: Tone;
  readonly variant?: string;
}

export interface AlertNode {
  readonly id: NodeId;
  readonly type: "alert";
  readonly title?: string;
  readonly body: string;
  readonly tone?: Tone;
  readonly variant?: string;
}

export interface ListItem {
  readonly title: string;
  readonly body?: string;
}

export interface ListNode {
  readonly id: NodeId;
  readonly type: "list";
  readonly items: readonly ListItem[];
  readonly variant?: string;
}

export interface DividerNode {
  readonly id: NodeId;
  readonly type: "divider";
  readonly label?: string;
  readonly variant?: string;
}

export interface FormNode {
  readonly id: NodeId;
  readonly type: "form";
  readonly title?: string;
  readonly body?: string;
  readonly submitLabel?: string;
  readonly variant?: string;
  readonly onSubmit?: FacetAction;
  readonly children: readonly NodeId[];
}

export interface SearchNode {
  readonly id: NodeId;
  readonly type: "search";
  readonly name: string;
  readonly label?: string;
  readonly placeholder?: string;
  readonly value?: string;
  readonly submitLabel?: string;
  readonly variant?: string;
  readonly onSubmit?: FacetAction;
}

export interface FilterBarFilter {
  readonly name: string;
  readonly label: string;
  readonly input?: FieldInput;
  readonly options?: readonly string[];
  readonly value?: string | number | boolean;
}

export interface FilterBarNode {
  readonly id: NodeId;
  readonly type: "filterBar";
  readonly filters: readonly FilterBarFilter[];
  readonly variant?: string;
  readonly onChange?: FacetAction;
}

export interface EmptyStateNode {
  readonly id: NodeId;
  readonly type: "emptyState";
  readonly title?: string;
  readonly body?: string;
  readonly actionLabel?: string;
  readonly variant?: string;
  readonly onPress?: FacetAction;
}

export interface LoadingNode {
  readonly id: NodeId;
  readonly type: "loading";
  readonly label?: string;
  readonly variant?: string;
}

export type IntrinsicComponentNode =
  | ButtonNode
  | SectionNode
  | CardNode
  | TabsNode
  | NavNode
  | TableNode
  | ChartNode
  | MetricNode
  | KeyValueNode
  | BadgeNode
  | ProgressNode
  | AlertNode
  | ListNode
  | DividerNode
  | FormNode
  | SearchNode
  | FilterBarNode
  | EmptyStateNode
  | LoadingNode;

export type LegacyComponentNode = StatNode;
export type ComponentNode = IntrinsicComponentNode | LegacyComponentNode;

/** Any brick the agent may place on a stage. */
export type FacetNode = PrimitiveBrickNode | ComponentNode;

export type ContainerNode = BoxNode | SectionNode | CardNode | FormNode;

/** Narrows a node to the bricks that can hold children. */
export function isContainer(node: FacetNode): node is ContainerNode {
  return (
    node.type === "box" || node.type === "section" || node.type === "card" || node.type === "form"
  );
}
