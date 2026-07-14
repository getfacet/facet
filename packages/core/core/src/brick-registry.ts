import { isPlainObject, type IssueSink } from "./issues.js";
import {
  PRIMITIVE_BRICK_TYPES,
  type FacetNode,
  type PrimitiveBrickType,
  type TextNode,
} from "./nodes.js";
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
  rendersAlert,
  rendersAlways,
  rendersBadge,
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
  rendersSearch,
  rendersSectionCard,
  rendersTable,
  rendersTabsNav,
  rendersText,
} from "./tree.js";
import {
  fillAlert,
  fillBadge,
  fillBox,
  fillButton,
  fillCard,
  fillChart,
  fillDivider,
  fillEmptyState,
  fillField,
  fillFilterBar,
  fillForm,
  fillKeyValue,
  fillList,
  fillLoading,
  fillMedia,
  fillMetricStat,
  fillProgress,
  fillSearch,
  fillSection,
  fillTable,
  fillTabsNav,
  fillText,
  leavesAlert,
  leavesBadge,
  leavesBox,
  leavesButton,
  leavesCard,
  leavesChart,
  leavesDivider,
  leavesEmptyState,
  leavesField,
  leavesFilterBar,
  leavesForm,
  leavesKeyValue,
  leavesList,
  leavesLoading,
  leavesMedia,
  leavesMetricStat,
  leavesProgress,
  leavesSearch,
  leavesSection,
  leavesTable,
  leavesTabsNav,
  leavesText,
} from "./expand-composition-fill.js";

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

export type NodeFiller = (
  node: FacetNode,
  defaults: Readonly<Record<string, string>>,
  params: Readonly<Record<string, unknown>>,
  issues: IssueSink,
) => FacetNode;

export type NodeStringLeaves = (node: FacetNode) => readonly string[];

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
  /** Composition slot fill. */
  readonly fill: NodeFiller;
  /** Composition slot-source string leaves. */
  readonly stringLeaves: NodeStringLeaves;
}

/**
 * richtext content predicate (over the RAW node, mirroring the other renders*
 * predicates): renders when ≥1 block carries ≥1 run with NON-EMPTY string text.
 * Used for composition emptyState fallback — an all-empty-run richtext emits only
 * invisible elements, so it must count as no-content and let the fallback show.
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
    fill: fillBox,
    stringLeaves: leavesBox,
  },
  text: {
    kind: "primitive",
    established: false,
    validate: validateText,
    resolve: (node, warehouse) => resolveScalar(node as TextNode, warehouse),
    resolveFromContent: fromText,
    rendersSelf: rendersText,
    fill: fillText,
    stringLeaves: leavesText,
  },
  media: {
    kind: "primitive",
    established: false,
    validate: validateMedia,
    rendersSelf: rendersMedia,
    fill: fillMedia,
    stringLeaves: leavesMedia,
  },
  input: {
    kind: "primitive",
    established: false,
    validate: validateInput,
    rendersSelf: rendersField,
    fill: fillField,
    stringLeaves: leavesField,
  },
  richtext: {
    kind: "primitive",
    established: false,
    validate: validateRichText,
    // richtext is a LEAF and NOT `from`-bound (no resolve/resolveFromContent).
    rendersSelf: rendersRichText,
    // Not composition-slot-filled and not a slot source in v1, so `fill` is a
    // passthrough (reusing fillBox) and `stringLeaves` is empty (leavesBox).
    fill: fillBox,
    stringLeaves: leavesBox,
  },
  // ---- Control components -----------------------------------------------
  button: {
    kind: "component",
    role: "control",
    established: true,
    rendersSelf: rendersButton,
    fill: fillButton,
    stringLeaves: leavesButton,
  },
  tabs: {
    kind: "component",
    role: "control",
    established: true,
    rendersSelf: rendersTabsNav,
    fill: fillTabsNav,
    stringLeaves: leavesTabsNav,
  },
  nav: {
    kind: "component",
    role: "control",
    established: false,
    rendersSelf: rendersTabsNav,
    fill: fillTabsNav,
    stringLeaves: leavesTabsNav,
  },
  form: {
    kind: "component",
    role: "control",
    established: false,
    rendersSelf: rendersForm,
    fill: fillForm,
    stringLeaves: leavesForm,
  },
  search: {
    kind: "component",
    role: "control",
    established: false,
    rendersSelf: rendersSearch,
    fill: fillSearch,
    stringLeaves: leavesSearch,
  },
  filterBar: {
    kind: "component",
    role: "control",
    established: false,
    rendersSelf: rendersFilterBar,
    fill: fillFilterBar,
    stringLeaves: leavesFilterBar,
  },
  // ---- Data components --------------------------------------------------
  table: {
    kind: "component",
    role: "data",
    established: true,
    resolve: (node, warehouse) => resolveTable(node as TableNode, warehouse),
    rendersSelf: rendersTable,
    fill: fillTable,
    stringLeaves: leavesTable,
  },
  chart: {
    kind: "component",
    role: "data",
    established: true,
    resolve: (node, warehouse) => resolveChart(node as ChartNode, warehouse),
    resolveFromContent: fromChart,
    rendersSelf: rendersChart,
    fill: fillChart,
    stringLeaves: leavesChart,
  },
  list: {
    kind: "component",
    role: "data",
    established: true,
    resolve: (node, warehouse) => resolveList(node as ListNode, warehouse),
    resolveFromContent: fromList,
    rendersSelf: rendersList,
    fill: fillList,
    stringLeaves: leavesList,
  },
  keyValue: {
    kind: "component",
    role: "data",
    established: false,
    resolve: (node, warehouse) => resolveKeyValue(node as KeyValueNode, warehouse),
    resolveFromContent: fromKeyValue,
    rendersSelf: rendersKeyValue,
    fill: fillKeyValue,
    stringLeaves: leavesKeyValue,
  },
  metric: {
    kind: "component",
    role: "data",
    established: false,
    resolve: (node, warehouse) => resolveScalar(node as MetricNode | StatNode, warehouse),
    resolveFromContent: fromMetricStat,
    rendersSelf: rendersMetricStat,
    fill: fillMetricStat,
    stringLeaves: leavesMetricStat,
  },
  stat: {
    kind: "component",
    role: "data",
    established: true,
    resolve: (node, warehouse) => resolveScalar(node as MetricNode | StatNode, warehouse),
    resolveFromContent: fromMetricStat,
    rendersSelf: rendersMetricStat,
    fill: fillMetricStat,
    stringLeaves: leavesMetricStat,
  },
  // ---- Feedback components ----------------------------------------------
  badge: {
    kind: "component",
    role: "feedback",
    established: true,
    rendersSelf: rendersBadge,
    fill: fillBadge,
    stringLeaves: leavesBadge,
  },
  progress: {
    kind: "component",
    role: "feedback",
    established: true,
    rendersSelf: rendersProgress,
    fill: fillProgress,
    stringLeaves: leavesProgress,
  },
  alert: {
    kind: "component",
    role: "feedback",
    established: true,
    rendersSelf: rendersAlert,
    fill: fillAlert,
    stringLeaves: leavesAlert,
  },
  emptyState: {
    kind: "component",
    role: "feedback",
    established: false,
    rendersSelf: rendersEmptyState,
    fill: fillEmptyState,
    stringLeaves: leavesEmptyState,
  },
  loading: {
    kind: "component",
    role: "feedback",
    established: false,
    rendersSelf: rendersAlways,
    fill: fillLoading,
    stringLeaves: leavesLoading,
  },
  // ---- Layout components ------------------------------------------------
  section: {
    kind: "component",
    role: "layout",
    established: true,
    rendersSelf: rendersSectionCard,
    fill: fillSection,
    stringLeaves: leavesSection,
  },
  card: {
    kind: "component",
    role: "layout",
    established: true,
    rendersSelf: rendersSectionCard,
    fill: fillCard,
    stringLeaves: leavesCard,
  },
  divider: {
    kind: "component",
    role: "layout",
    established: true,
    rendersSelf: rendersAlways,
    fill: fillDivider,
    stringLeaves: leavesDivider,
  },
};
