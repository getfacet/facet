import {
  validateChart,
  validateKeyValue,
  validateList,
  validateLoading,
  validateProgress,
  validateTable,
} from "./brick-validation.js";
import {
  resolveChart,
  resolveKeyValue,
  resolveList,
  resolveScalar,
  resolveTable,
} from "./data-binding.js";
import { isPlainObject } from "./issues.js";
import {
  BRICK_TYPES,
  type BrickType,
  type ChartNode,
  type ChartSeries,
  type KeyValueItem,
  type KeyValueNode,
  type ListItem,
  type ListNode,
  type TableNode,
  type TextNode,
} from "./nodes.js";
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
  fromChart,
  fromKeyValue,
  fromList,
  fromText,
  rendersAlways,
  rendersBox,
  rendersChart,
  rendersField,
  rendersKeyValue,
  rendersList,
  rendersMedia,
  rendersProgress,
  rendersTable,
  rendersText,
} from "./tree.js";

/** The final closed brick type used by the core registry. */
export type CoreNodeType = BrickType;

export const CORE_NODE_TYPES: readonly CoreNodeType[] = BRICK_TYPES;

export type DataBearingNode = TableNode | ChartNode | ListNode | KeyValueNode | TextNode;

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
  readonly validate: PrimitiveValidator;
  /** `from`-binding projection for data-bearing bricks. */
  readonly resolve?: NodeDataResolver;
  /** Content predicate applied when a `from` binding is present. */
  readonly resolveFromContent?: RendersPredicate;
  /** Content predicate for a node without a `from` binding. */
  readonly rendersSelf: RendersPredicate;
}

/** True when rich text contains at least one non-empty run. */
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

/** One direct validator and behavior entry for every final brick. */
export const BRICK_REGISTRY = {
  box: {
    validate: validateBox,
    rendersSelf: rendersBox,
  },
  text: {
    validate: validateText,
    resolve: (node, warehouse) => resolveScalar(node as TextNode, warehouse),
    resolveFromContent: fromText,
    rendersSelf: rendersText,
  },
  media: {
    validate: validateMedia,
    rendersSelf: rendersMedia,
  },
  input: {
    validate: validateInput,
    rendersSelf: rendersField,
  },
  richtext: {
    validate: validateRichText,
    rendersSelf: rendersRichText,
  },
  table: {
    validate: validateTable,
    resolve: (node, warehouse) => resolveTable(node as TableNode, warehouse),
    rendersSelf: rendersTable,
  },
  chart: {
    validate: validateChart,
    resolve: (node, warehouse) => resolveChart(node as ChartNode, warehouse),
    resolveFromContent: fromChart,
    rendersSelf: rendersChart,
  },
  list: {
    validate: validateList,
    resolve: (node, warehouse) => resolveList(node as ListNode, warehouse),
    resolveFromContent: fromList,
    rendersSelf: rendersList,
  },
  keyValue: {
    validate: validateKeyValue,
    resolve: (node, warehouse) => resolveKeyValue(node as KeyValueNode, warehouse),
    resolveFromContent: fromKeyValue,
    rendersSelf: rendersKeyValue,
  },
  progress: {
    validate: validateProgress,
    rendersSelf: rendersProgress,
  },
  loading: {
    validate: validateLoading,
    rendersSelf: rendersAlways,
  },
} satisfies Record<CoreNodeType, BrickEntry>;
