import type { TextAlign } from "./tokens.js";
import type { FacetAction, FieldInput, NodeId } from "./nodes.js";

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
  readonly sortable?: boolean;
}

export type TableCell = string | number | boolean;
export type TableRow = Readonly<Record<string, TableCell>>;

/**
 * The per-tree data warehouse (`FacetTree.data`). A closed, declarative section
 * of agent-authored data — the same trust tier as inline `rows`, just relocated
 * to a named section so many nodes can bind to one source (`node.from`). A
 * `DataCell` is a scalar only (no nested objects/arrays); a `DataRow` is a flat
 * scalar record; a `Dataset` is an array of rows; a `DataWarehouse` maps a
 * bounded dataset NAME to a dataset. There is no URL/source/resolver — `from` is
 * only a name (see `sanitizeDataWarehouse`/`resolveNodeData` in `data-binding.ts`).
 */
export type DataCell = string | number | boolean;
export type DataRow = Readonly<Record<string, DataCell>>;
export type Dataset = readonly DataRow[];
export type DataWarehouse = Readonly<Record<string, Dataset>>;

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
  /** Optional binding: project one item per row from `FacetTree.data[from]`. */
  readonly from?: string;
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
