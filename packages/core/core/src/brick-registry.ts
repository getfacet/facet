import { isPlainObject } from "./issues.js";
import { PRIMITIVE_BRICK_TYPES, type PrimitiveBrickType, type TextNode } from "./nodes.js";
import {
  COMPONENT_NODE_TYPES,
  type ChartNode,
  type ChartSeries,
  type ComponentNodeType,
  type KeyValueItem,
  type KeyValueNode,
  type ListItem,
  type ListNode,
  type MetricNode,
  type StatNode,
  type TableNode,
} from "./component-nodes.js";
import type { DataWarehouse, TableRow } from "./data-types.js";
import type { PrimitiveValidator } from "./primitive-node-validation.js";
import {
  validateBox,
  validateInput,
  validateMedia,
  validateRichText,
  validateText,
} from "./primitive-node-validation.js";
import {
  resolveChart,
  resolveKeyValue,
  resolveList,
  resolveScalar,
  resolveTable,
} from "./data-binding.js";
import {
  fromChart,
  fromKeyValue,
  fromList,
  fromMetricStat,
  fromText,
  rendersAlways,
  rendersBox,
  rendersButton,
  rendersChart,
  rendersEmptyState,
  rendersField,
  rendersFilterBar,
  rendersForm,
  rendersKeyValue,
  rendersList,
  rendersMedia,
  rendersMetricStat,
  rendersProgress,
  rendersSectionCard,
  rendersTable,
  rendersTabsNav,
  rendersText,
} from "./tree.js";

/**
 * The per-brick registry — the single, exhaustive source that de-scatters the
 * former per-node-type `switch`/`Set` dispatchers across `@facet/core`. Each
 * canonical node type maps to a thin struct of the EXISTING core handlers +
 * classification flags (NOT a new framework): the handler BODIES stay in their
 * home modules; only the dispatch reads this table. Adding/removing a brick is
 * now a one-entry edit here, compiler-checked via `Record<CoreNodeType, …>`
 * (guarded further by the exhaustiveness test).
 *
 * NOTE: the `image` input alias (raw media) is intentionally NOT a key — it is
 * not a canonical node type. `sanitizeNode` maps it to the `media` entry, and
 * `nodeRendersItself` handles it as a fail-safe.
 */
export type CoreNodeType = PrimitiveBrickType | ComponentNodeType;

export const CORE_NODE_TYPES: readonly CoreNodeType[] = [
  ...PRIMITIVE_BRICK_TYPES,
  ...COMPONENT_NODE_TYPES,
];

/** Component role → routes to the matching role sanitizer (in component-validation). */
export type ComponentRole = "control" | "data" | "feedback" | "layout";

export type DataBearingNode =
  TableNode | ChartNode | ListNode | KeyValueNode | MetricNode | StatNode | TextNode;

export type NodeDataResolver = (
  node: DataBearingNode,
  warehouse: DataWarehouse | undefined,
) =>
  | readonly TableRow[]
  | readonly ChartSeries[]
  | readonly ListItem[]
  | readonly KeyValueItem[]
  | string;

/** Content predicate over a raw (possibly unsanitized) node. */
export type RendersPredicate = (
  node: Record<string, unknown>,
  warehouse: DataWarehouse | undefined,
) => boolean;

export interface BrickEntry {
  readonly kind: "primitive" | "component";
  /** Component role tag (undefined for primitives). */
  readonly role?: ComponentRole;
  /** Established shapes skip the forbidden-field diagnostic. */
  readonly established: boolean;
  /** Primitive validate handler (undefined for components — they use `role`). */
  readonly validate?: PrimitiveValidator;
  /** `from`-binding projection (data-bearing bricks only). */
  readonly resolve?: NodeDataResolver;
  /** Content predicate applied when a `from` binding is present (data-bearing, minus table). */
  readonly resolveFromContent?: RendersPredicate;
  /** Content predicate for a node without a `from` binding. */
  readonly rendersSelf: RendersPredicate;
}

/**
 * richtext content predicate (over the RAW node, mirroring the other renders*
 * predicates): renders when ≥1 block carries ≥1 run with NON-EMPTY string text.
 * Used for tree content detection — an all-empty-run richtext emits only
 * invisible elements, so it must count as no-content.
 * (This matches the renderer's own `richTextHasVisibleRun` visibility test; motion
 * participation is decided there, not here.)
 */
function rendersRichText(node: Record<string, unknown>): boolean {
  const blocks = node.blocks;
  if (!Array.isArray(blocks)) return false;
  return blocks.some(
    (block) =>
      isPlainObject(block) &&
      Array.isArray(block.runs) &&
      block.runs.some(
        (run) => isPlainObject(run) && typeof run.text === "string" && run.text.length > 0,
      ),
  );
}

export const BRICK_REGISTRY: Record<CoreNodeType, BrickEntry> = {
  // ---- Primitive bricks -------------------------------------------------
  box: {
    kind: "primitive",
    established: false,
    validate: validateBox,
    rendersSelf: rendersBox,
  },
  text: {
    kind: "primitive",
    established: false,
    validate: validateText,
    resolve: (node, warehouse) => resolveScalar(node as TextNode, warehouse),
    resolveFromContent: fromText,
    rendersSelf: rendersText,
  },
  media: {
    kind: "primitive",
    established: false,
    validate: validateMedia,
    rendersSelf: rendersMedia,
  },
  input: {
    kind: "primitive",
    established: false,
    validate: validateInput,
    rendersSelf: rendersField,
  },
  richtext: {
    kind: "primitive",
    established: false,
    validate: validateRichText,
    // richtext is a LEAF and NOT `from`-bound (no resolve/resolveFromContent).
    rendersSelf: rendersRichText,
  },
  // ---- Control components -----------------------------------------------
  button: {
    kind: "component",
    role: "control",
    established: true,
    rendersSelf: rendersButton,
  },
  tabs: {
    kind: "component",
    role: "control",
    established: true,
    rendersSelf: rendersTabsNav,
  },
  nav: {
    kind: "component",
    role: "control",
    established: false,
    rendersSelf: rendersTabsNav,
  },
  form: {
    kind: "component",
    role: "control",
    established: false,
    rendersSelf: rendersForm,
  },
  filterBar: {
    kind: "component",
    role: "control",
    established: false,
    rendersSelf: rendersFilterBar,
  },
  // ---- Data components --------------------------------------------------
  table: {
    kind: "component",
    role: "data",
    established: true,
    resolve: (node, warehouse) => resolveTable(node as TableNode, warehouse),
    rendersSelf: rendersTable,
  },
  chart: {
    kind: "component",
    role: "data",
    established: true,
    resolve: (node, warehouse) => resolveChart(node as ChartNode, warehouse),
    resolveFromContent: fromChart,
    rendersSelf: rendersChart,
  },
  list: {
    kind: "component",
    role: "data",
    established: true,
    resolve: (node, warehouse) => resolveList(node as ListNode, warehouse),
    resolveFromContent: fromList,
    rendersSelf: rendersList,
  },
  keyValue: {
    kind: "component",
    role: "data",
    established: false,
    resolve: (node, warehouse) => resolveKeyValue(node as KeyValueNode, warehouse),
    resolveFromContent: fromKeyValue,
    rendersSelf: rendersKeyValue,
  },
  metric: {
    kind: "component",
    role: "data",
    established: false,
    resolve: (node, warehouse) => resolveScalar(node as MetricNode | StatNode, warehouse),
    resolveFromContent: fromMetricStat,
    rendersSelf: rendersMetricStat,
  },
  stat: {
    kind: "component",
    role: "data",
    established: true,
    resolve: (node, warehouse) => resolveScalar(node as MetricNode | StatNode, warehouse),
    resolveFromContent: fromMetricStat,
    rendersSelf: rendersMetricStat,
  },
  // ---- Feedback components ----------------------------------------------
  progress: {
    kind: "component",
    role: "feedback",
    established: true,
    rendersSelf: rendersProgress,
  },
  emptyState: {
    kind: "component",
    role: "feedback",
    established: false,
    rendersSelf: rendersEmptyState,
  },
  loading: {
    kind: "component",
    role: "feedback",
    established: false,
    rendersSelf: rendersAlways,
  },
  // ---- Layout components ------------------------------------------------
  section: {
    kind: "component",
    role: "layout",
    established: true,
    rendersSelf: rendersSectionCard,
  },
  card: {
    kind: "component",
    role: "layout",
    established: true,
    rendersSelf: rendersSectionCard,
  },
};
