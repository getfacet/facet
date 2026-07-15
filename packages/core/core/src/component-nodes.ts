import type { FacetAction, InputKind, NodeId } from "./nodes.js";
import type { TableColumn, TableRow } from "./data-types.js";

export * from "./data-types.js";

export const INTRINSIC_COMPONENT_TYPES = [
  "button",
  "tabs",
  "nav",
  "table",
  "chart",
  "metric",
  "keyValue",
  "progress",
  "list",
  "form",
  "filterBar",
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

export interface TableNode {
  readonly id: NodeId;
  readonly type: "table";
  readonly columns: readonly TableColumn[];
  readonly rows: readonly TableRow[];
  readonly caption?: string;
  readonly variant?: string;
  /** Optional binding: project rows from `FacetTree.data[from]` instead of inline `rows`. */
  readonly from?: string;
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
  /** Optional binding: derive one series per numeric column of `FacetTree.data[from]`. */
  readonly from?: string;
}

interface MetricFields {
  readonly id: NodeId;
  readonly label: string;
  readonly value: string;
  readonly delta?: string;
  readonly tone?: Tone;
  readonly variant?: string;
  /** Optional binding: read `value` from a single cell of `FacetTree.data[from]`. */
  readonly from?: string;
  /** The dataset column supplying the cell value (used only with `from`). */
  readonly column?: string;
  /** The dataset row index (default 0) supplying the cell value (used only with `from`). */
  readonly row?: number;
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
  /** Optional binding: project `{label, value}` per row from `FacetTree.data[from]`. */
  readonly from?: string;
}

export interface ProgressNode {
  readonly id: NodeId;
  readonly type: "progress";
  readonly value: number;
  readonly label?: string;
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
  /** Optional binding: project one item per row from `FacetTree.data[from]`. */
  readonly from?: string;
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

export interface FilterBarFilter {
  readonly name: string;
  readonly label: string;
  readonly input?: InputKind;
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

export interface LoadingNode {
  readonly id: NodeId;
  readonly type: "loading";
  readonly label?: string;
  readonly variant?: string;
}

export type IntrinsicComponentNode =
  | ButtonNode
  | TabsNode
  | NavNode
  | TableNode
  | ChartNode
  | MetricNode
  | KeyValueNode
  | ProgressNode
  | ListNode
  | FormNode
  | FilterBarNode
  | LoadingNode;

export type LegacyComponentNode = StatNode;
export type ComponentNode = IntrinsicComponentNode | LegacyComponentNode;
