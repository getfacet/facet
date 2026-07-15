import {
  CHART_KINDS,
  MEDIA_KINDS,
  isSafeMediaSrc,
  resolveNodeData,
  type DataWarehouse,
  type FacetNode,
} from "@facet/core";

/**
 * The per-brick registry for `@facet/agent-tools` — the single, exhaustive
 * source that de-scatters the former per-node-type `switch` dispatchers in the
 * executor (`executor-input` `asNode`, `executor-inspect` `describeNode`,
 * `executor-policy` component-vs-brick split). Each canonical node type maps to
 * a thin struct of the EXISTING per-type logic (bodies unchanged) plus its
 * policy classification — NOT a new framework.
 *
 * The registry is typed as an exhaustive map over `FacetNode["type"]` (the core
 * node-type union, identical to core's `CoreNodeType`), so a node type added to
 * the vocabulary without an entry is a COMPILE error. This preserves — and
 * moves to the type level — the completeness guard that used to live as the
 * `const exhaustive: never = facetNode` line at the end of `describeNode`.
 */

const MAX_TEXT_PREVIEW_CHARS = 80;
const CHART_KIND_SET = new Set<string>(CHART_KINDS);
const CHART_KINDS_TEXT = CHART_KINDS.map((kind) => `"${kind}"`).join(", ");

type AsNodeResult =
  { readonly facetNode: FacetNode } | { readonly error: string; readonly nextAction: string };

/** Raw (pre-validation) node record → validated node or an actionable error. */
type AsNodeHandler = (value: Record<string, unknown>) => AsNodeResult;

/** The specific node member for a given canonical type. */
type NodeByType<K extends FacetNode["type"]> = Extract<FacetNode, { type: K }>;

interface ExecutorBrickEntry<K extends FacetNode["type"]> {
  /** `append_node`/`set_node` per-type shape validation. */
  readonly asNode: AsNodeHandler;
  /** `inspect_stage`/`inspect_node` one-line description. */
  readonly describe: (node: NodeByType<K>, warehouse: DataWarehouse | undefined) => string;
  /** Catalog policy classification (component-vs-brick split). */
  readonly policy: { readonly kind: "primitive" | "component" };
}

type ExecutorRegistry = { [K in FacetNode["type"]]: ExecutorBrickEntry<K> };

// --- shared helpers (relocated verbatim from executor-input / executor-inspect) ---

export function parseContainerChildren(
  value: unknown,
  nodeType: "form",
):
  | { readonly children: readonly string[] }
  | { readonly error: string; readonly nextAction: string } {
  if (
    value !== undefined &&
    (!Array.isArray(value) || !value.every((child): child is string => typeof child === "string"))
  ) {
    return {
      error: `a "${nodeType}" node needs "children" as an array of string ids`,
      nextAction: 'Use "children": [] or an array of existing child node ids.',
    };
  }
  return { children: value ?? [] };
}

export function nodeVariant(node: FacetNode): string | undefined {
  return "variant" in node && typeof node.variant === "string" ? node.variant : undefined;
}

function variantSuffix(node: FacetNode): string {
  const variant = nodeVariant(node);
  return variant === undefined ? "" : ` variant=${variant}`;
}

function preview(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_TEXT_PREVIEW_CHARS
    ? `${collapsed.slice(0, MAX_TEXT_PREVIEW_CHARS)}...`
    : collapsed;
}

// --- shared asNode handlers (metric/stat and passthrough collapse cases) ---

const asNodeMetricStat: AsNodeHandler = (value) => {
  if (typeof value["label"] !== "string" || typeof value["value"] !== "string") {
    return {
      error: `a "${value["type"]}" node needs string "label" and "value"`,
      nextAction: `Pass string "label" and "value" for ${String(value["type"])} nodes.`,
    };
  }
  return { facetNode: value as unknown as FacetNode };
};

const asNodePassthrough: AsNodeHandler = (value) => ({
  facetNode: value as unknown as FacetNode,
});

export const EXECUTOR_REGISTRY: ExecutorRegistry = {
  // ---- Primitive bricks -------------------------------------------------
  box: {
    policy: { kind: "primitive" },
    asNode: (value) => {
      if (
        value["children"] !== undefined &&
        (!Array.isArray(value["children"]) ||
          !value["children"].every((child): child is string => typeof child === "string"))
      ) {
        return {
          error: 'a "box" node needs "children" as an array of string ids',
          nextAction: 'Use "children": [] or an array of existing child node ids.',
        };
      }
      return {
        facetNode: {
          ...value,
          id: value["id"],
          type: "box",
          children: value["children"] ?? [],
        } as unknown as FacetNode,
      };
    },
    describe: (facetNode) =>
      `${facetNode.id} box children=${String(facetNode.children.length)}${facetNode.hidden === true ? " hidden" : ""}`,
  },
  text: {
    policy: { kind: "primitive" },
    asNode: (value) => {
      if (typeof value["value"] !== "string") {
        return {
          error: 'a "text" node needs a string "value"',
          nextAction: 'Pass a string "value" for text nodes.',
        };
      }
      return { facetNode: value as unknown as FacetNode };
    },
    describe: (facetNode, warehouse) =>
      `${facetNode.id} text value="${preview(resolveNodeData(facetNode, warehouse))}"`,
  },
  media: {
    policy: { kind: "primitive" },
    asNode: (value) => {
      if (typeof value["src"] !== "string") {
        return {
          error: 'a "media" node needs string "src"',
          nextAction: 'Pass a safe static string "src" for media nodes.',
        };
      }
      if (!isSafeMediaSrc(value["src"])) {
        return {
          error: 'a "media" node needs a safe static "src"',
          nextAction: "Use a safe static media src.",
        };
      }
      if (
        value["kind"] !== undefined &&
        (typeof value["kind"] !== "string" ||
          !(MEDIA_KINDS as readonly string[]).includes(value["kind"]))
      ) {
        return {
          error: 'a "media" node kind must be "image" or "video"',
          nextAction: 'Use kind "image" or "video".',
        };
      }
      return {
        facetNode: {
          ...value,
          kind: value["kind"] ?? "image",
        } as unknown as FacetNode,
      };
    },
    describe: (facetNode) =>
      `${facetNode.id} media kind=${facetNode.kind} src="${preview(facetNode.src)}"`,
  },
  input: {
    policy: { kind: "primitive" },
    asNode: (value) => {
      if (typeof value["name"] !== "string") {
        return {
          error: 'an "input" node needs a string "name"',
          nextAction: 'Pass a string "name" for input nodes.',
        };
      }
      return { facetNode: value as unknown as FacetNode };
    },
    describe: (facetNode) => `${facetNode.id} input name="${preview(facetNode.name)}"`,
  },
  richtext: {
    // RISK-API-2: a PRIMITIVE brick, so it is accepted under the catalog's
    // primitive-fallback gate and never mis-routed as a component. asNode is a
    // light shape gate — the deep clamp/sanitize (levels, depth, unknown marks,
    // link targets) lives in core's `validateRichText` inside `validateTree`.
    policy: { kind: "primitive" },
    asNode: (value) => {
      if (value["blocks"] !== undefined && !Array.isArray(value["blocks"])) {
        return {
          error: 'a "richtext" node needs "blocks" as an array',
          nextAction: 'Pass "blocks": [] or an array of richtext blocks.',
        };
      }
      return {
        facetNode: {
          ...value,
          id: value["id"],
          type: "richtext",
          blocks: value["blocks"] ?? [],
        } as unknown as FacetNode,
      };
    },
    describe: (facetNode) => `${facetNode.id} richtext blocks=${String(facetNode.blocks.length)}`,
  },
  // ---- Components -------------------------------------------------------
  button: {
    policy: { kind: "component" },
    asNode: (value) => {
      if (typeof value["label"] !== "string") {
        return {
          error: 'a "button" node needs a string "label"',
          nextAction: 'Pass a string "label" for button nodes.',
        };
      }
      return { facetNode: value as unknown as FacetNode };
    },
    describe: (facetNode) =>
      `${facetNode.id} button label="${preview(facetNode.label)}"${variantSuffix(facetNode)}`,
  },
  tabs: {
    policy: { kind: "component" },
    asNode: (value) => {
      if (!Array.isArray(value["items"])) {
        return {
          error: 'a "tabs" node needs "items" as an array',
          nextAction: 'Pass "items": [] or an array of tab items.',
        };
      }
      return { facetNode: value as unknown as FacetNode };
    },
    describe: (facetNode) =>
      `${facetNode.id} tabs items=${String(facetNode.items.length)}${variantSuffix(facetNode)}`,
  },
  nav: {
    policy: { kind: "component" },
    asNode: (value) => {
      if (!Array.isArray(value["items"])) {
        return {
          error: 'a "nav" node needs "items" as an array',
          nextAction: 'Pass "items": [] or an array of nav items.',
        };
      }
      return { facetNode: value as unknown as FacetNode };
    },
    describe: (facetNode) =>
      `${facetNode.id} nav items=${String(facetNode.items.length)}${variantSuffix(facetNode)}`,
  },
  table: {
    policy: { kind: "component" },
    asNode: (value) => {
      if (value["columns"] !== undefined && !Array.isArray(value["columns"])) {
        return {
          error: 'a "table" node needs "columns" as an array',
          nextAction: 'Pass "columns": [] or an array of table columns.',
        };
      }
      if (value["rows"] !== undefined && !Array.isArray(value["rows"])) {
        return {
          error: 'a "table" node needs "rows" as an array',
          nextAction: 'Pass "rows": [] or an array of table rows.',
        };
      }
      return {
        facetNode: {
          ...value,
          id: value["id"],
          type: "table",
          columns: value["columns"] ?? [],
          rows: value["rows"] ?? [],
        } as unknown as FacetNode,
      };
    },
    describe: (facetNode, warehouse) =>
      `${facetNode.id} table columns=${String(facetNode.columns.length)} rows=${String(resolveNodeData(facetNode, warehouse).length)}${variantSuffix(facetNode)}`,
  },
  chart: {
    policy: { kind: "component" },
    asNode: (value) => {
      if (
        value["kind"] !== undefined &&
        (typeof value["kind"] !== "string" || !CHART_KIND_SET.has(value["kind"]))
      ) {
        return {
          error: `a "chart" node kind must be one of ${CHART_KINDS_TEXT}`,
          nextAction: `Use one of the core chart kinds: ${CHART_KINDS_TEXT}.`,
        };
      }
      if (value["series"] !== undefined && !Array.isArray(value["series"])) {
        return {
          error: 'a "chart" node needs "series" as an array',
          nextAction: 'Pass "series": [] or an array of chart series.',
        };
      }
      return {
        facetNode: {
          ...value,
          id: value["id"],
          type: "chart",
          kind: value["kind"] ?? "bar",
          series: value["series"] ?? [],
        } as unknown as FacetNode,
      };
    },
    describe: (facetNode, warehouse) =>
      `${facetNode.id} chart kind=${facetNode.kind} series=${String(resolveNodeData(facetNode, warehouse).length)}${variantSuffix(facetNode)}`,
  },
  metric: {
    policy: { kind: "component" },
    asNode: asNodeMetricStat,
    describe: (facetNode, warehouse) =>
      `${facetNode.id} metric label="${preview(facetNode.label)}" value="${preview(resolveNodeData(facetNode, warehouse))}"${variantSuffix(facetNode)}`,
  },
  stat: {
    policy: { kind: "component" },
    asNode: asNodeMetricStat,
    describe: (facetNode, warehouse) =>
      `${facetNode.id} stat label="${preview(facetNode.label)}" value="${preview(resolveNodeData(facetNode, warehouse))}"${variantSuffix(facetNode)}`,
  },
  keyValue: {
    policy: { kind: "component" },
    asNode: (value) => {
      if (!Array.isArray(value["items"])) {
        return {
          error: 'a "keyValue" node needs "items" as an array',
          nextAction: 'Pass "items": [] or an array of key/value items.',
        };
      }
      return { facetNode: value as unknown as FacetNode };
    },
    describe: (facetNode, warehouse) =>
      `${facetNode.id} keyValue items=${String(resolveNodeData(facetNode, warehouse).length)}${variantSuffix(facetNode)}`,
  },
  progress: {
    policy: { kind: "component" },
    asNode: (value) => {
      if (typeof value["value"] !== "number" || !Number.isFinite(value["value"])) {
        return {
          error: 'a "progress" node needs a finite number "value"',
          nextAction: 'Pass a finite number "value" from 0 to 100 for progress nodes.',
        };
      }
      return { facetNode: value as unknown as FacetNode };
    },
    describe: (facetNode) =>
      `${facetNode.id} progress value=${String(facetNode.value)}${variantSuffix(facetNode)}`,
  },
  list: {
    policy: { kind: "component" },
    asNode: (value) => {
      if (!Array.isArray(value["items"])) {
        return {
          error: 'a "list" node needs "items" as an array',
          nextAction: 'Pass "items": [] or an array of list items.',
        };
      }
      return { facetNode: value as unknown as FacetNode };
    },
    describe: (facetNode, warehouse) =>
      `${facetNode.id} list items=${String(resolveNodeData(facetNode, warehouse).length)}${variantSuffix(facetNode)}`,
  },
  form: {
    policy: { kind: "component" },
    asNode: (value) => {
      const children = parseContainerChildren(value["children"], "form");
      if ("error" in children) return children;
      return {
        facetNode: {
          ...value,
          id: value["id"],
          type: "form",
          children: children.children,
        } as unknown as FacetNode,
      };
    },
    describe: (facetNode) =>
      `${facetNode.id} form children=${String(facetNode.children.length)}${facetNode.title === undefined ? "" : ` title="${preview(facetNode.title)}"`}${variantSuffix(facetNode)}`,
  },
  filterBar: {
    policy: { kind: "component" },
    asNode: (value) => {
      if (!Array.isArray(value["filters"])) {
        return {
          error: 'a "filterBar" node needs "filters" as an array',
          nextAction: 'Pass "filters": [] or an array of filter controls.',
        };
      }
      return { facetNode: value as unknown as FacetNode };
    },
    describe: (facetNode) =>
      `${facetNode.id} filterBar filters=${String(facetNode.filters.length)}${variantSuffix(facetNode)}`,
  },
  loading: {
    policy: { kind: "component" },
    asNode: asNodePassthrough,
    describe: (facetNode) =>
      `${facetNode.id} loading${facetNode.label === undefined ? "" : ` label="${preview(facetNode.label)}"`}${variantSuffix(facetNode)}`,
  },
};

/**
 * `describeNode` dispatch. `facetNode.type` indexes the exhaustive registry, so
 * completeness is compiler-guaranteed (the former `never` guard, now enforced by
 * `ExecutorRegistry`'s mapped type). The single `as never` reconciles the
 * correlated union of per-type `describe` signatures at this one dispatch site;
 * at runtime the concrete entry receives its own node type.
 */
export function describeNode(facetNode: FacetNode, warehouse: DataWarehouse | undefined): string {
  // `facetNode` comes from the local shadow, which `isTreeShaped` accepts without
  // validating node types — so `.type` may at runtime be a junk/prototype name.
  // Own-property check: a bare `EXECUTOR_REGISTRY[type]` returns an inherited
  // `Object.prototype` member for "constructor"/"toString", and `.describe` on it
  // throws. The former `switch` degraded (its `never` guard returned, never threw).
  const type = facetNode.type;
  if (!Object.hasOwn(EXECUTOR_REGISTRY, type)) return `type=${String(type)}`;
  return EXECUTOR_REGISTRY[facetNode.type].describe(facetNode as never, warehouse);
}

/** Catalog-policy component-vs-brick split, derived from the one registry. */
export const PRIMITIVE_NODE_TYPES: ReadonlySet<FacetNode["type"]> = new Set(
  (Object.keys(EXECUTOR_REGISTRY) as FacetNode["type"][]).filter(
    (type) => EXECUTOR_REGISTRY[type].policy.kind === "primitive",
  ),
);

export const COMPONENT_NODE_TYPE_SET: ReadonlySet<FacetNode["type"]> = new Set(
  (Object.keys(EXECUTOR_REGISTRY) as FacetNode["type"][]).filter(
    (type) => EXECUTOR_REGISTRY[type].policy.kind === "component",
  ),
);
