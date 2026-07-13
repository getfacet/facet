import type { FacetStageToolName, ToolSpec } from "./types.js";

export type FacetStageToolSpec = ToolSpec<FacetStageToolName>;

const NODE_SCHEMA = {
  type: "object",
  description:
    "A Facet stage node from the component or primitive layer of the catalog-guided composition -> component -> primitive fallback model. Primitive bricks are box, text, media, field. Intrinsic components are button, section, card, tabs, nav, table, chart, metric, keyValue, badge, progress, alert, list, divider, form, search, filterBar, emptyState, loading. Legacy stat remains accepted as metric compatibility; prefer metric. Only box, section, card, and form are containers. No raw HTML/JS/CSS, client-side fetch, external resolver, expression, or formula. Data binding is limited to named top-level tree.data datasets referenced by a node's from field. Variant names must be allowed by the active catalog policy.",
} as const;

const TREE_SCHEMA = {
  type: "object",
  description:
    "The full Facet stage tree: { root, nodes, screens?, entry?, theme? }. Every node and theme must pass the active catalog policy before patches are emitted.",
} as const;

const STRING_MAP_SCHEMA = {
  type: "object",
  description: "String slot values keyed by slot name.",
  additionalProperties: { type: "string" },
} as const;

export const FACET_STAGE_TOOL_NAMES = [
  "render_page",
  "append_node",
  "use_composition",
  "set_node",
  "remove_node",
  "say",
  "set_theme",
  "inspect_stage",
  "inspect_node",
] as const satisfies readonly FacetStageToolName[];

export const FACET_STAGE_TOOL_SPECS = [
  {
    name: "render_page",
    description:
      "Replace the entire page with a new Facet stage tree. Use for the first paint or a large restructure. The executor rejects catalog policy violations before emitting patches.",
    parameters: {
      type: "object",
      properties: {
        tree: TREE_SCHEMA,
      },
      required: ["tree"],
      additionalProperties: false,
    },
  },
  {
    name: "append_node",
    description:
      "Add one primitive brick or component node as the last child of the existing box, section, card, or form parentId. Use for small incremental page additions. Catalog policy controls allowed node types and variants.",
    parameters: {
      type: "object",
      properties: {
        parentId: {
          type: "string",
          description: "The id of an existing container node: box, section, card, or form.",
        },
        ["node"]: NODE_SCHEMA,
      },
      required: ["parentId", "node"],
      additionalProperties: false,
    },
  },
  {
    name: "use_composition",
    description:
      "Expand a reusable composition asset by name under at.parent. Pass string params for slots; the executor mints fresh ids. Catalog policy may restrict names and the expanded validated nodes.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "A composition name from the offered COMPOSITIONS list.",
        },
        params: STRING_MAP_SCHEMA,
        at: {
          type: "object",
          properties: {
            parent: {
              type: "string",
              description: "The id of an existing container node: box, section, card, or form.",
            },
          },
          required: ["parent"],
          additionalProperties: false,
        },
      },
      required: ["name", "params", "at"],
      additionalProperties: false,
    },
  },
  {
    name: "set_node",
    description:
      "Insert or replace one primitive brick or component node by id. Reuse an existing id to update that node in place. Catalog policy controls allowed node types and variants.",
    parameters: {
      type: "object",
      properties: {
        ["node"]: NODE_SCHEMA,
      },
      required: ["node"],
      additionalProperties: false,
    },
  },
  {
    name: "remove_node",
    description: "Delete one node from the page by id.",
    parameters: {
      type: "object",
      properties: {
        nodeId: { type: "string", description: "The node id to remove." },
      },
      required: ["nodeId"],
      additionalProperties: false,
    },
  },
  {
    name: "say",
    description: "Send a short chat message to the visitor.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "The chat text to send." },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "set_theme",
    description:
      "Restyle the whole page by selecting a theme by name only. Never pass CSS values or colors. A locked catalog policy rejects theme switches.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "A theme name from the offered THEMES list." },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "inspect_stage",
    description:
      "Inspect a bounded summary of the current local stage shadow without emitting a patch.",
    parameters: {
      type: "object",
      properties: {
        maxNodes: {
          type: "integer",
          minimum: 1,
          maximum: 200,
          description: "Maximum number of node summaries to return.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "inspect_node",
    description:
      "Inspect one node and a bounded descendant slice from the current local stage shadow without emitting a patch.",
    parameters: {
      type: "object",
      properties: {
        nodeId: { type: "string", description: "The node id to inspect." },
        depth: {
          type: "integer",
          minimum: 0,
          maximum: 5,
          description: "Maximum descendant depth to include.",
        },
      },
      required: ["nodeId"],
      additionalProperties: false,
    },
  },
] as const satisfies readonly FacetStageToolSpec[];

export const TOOLS: readonly FacetStageToolSpec[] = FACET_STAGE_TOOL_SPECS;

export function getStageToolSpec(name: FacetStageToolName): FacetStageToolSpec | undefined {
  return FACET_STAGE_TOOL_SPECS.find((tool) => tool.name === name);
}
