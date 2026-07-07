import type { FacetStageToolName, ToolSpec } from "./types.js";

export type FacetStageToolSpec = ToolSpec<FacetStageToolName>;

const NODE_SCHEMA = {
  type: "object",
  description: "A Facet brick node (box | text | media | field) - see the stage format.",
} as const;

const TREE_SCHEMA = {
  type: "object",
  description: "The full Facet stage tree: { root, nodes, screens?, entry?, theme? }.",
} as const;

const STRING_MAP_SCHEMA = {
  type: "object",
  description: "String slot values keyed by slot name.",
  additionalProperties: { type: "string" },
} as const;

export const FACET_STAGE_TOOL_NAMES = [
  "render_page",
  "append_node",
  "use_stamp",
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
      "Replace the entire page with a new Facet stage tree. Use for the first paint or a large restructure.",
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
      "Add one node as the last child of the existing box parentId. Use for small incremental page additions.",
    parameters: {
      type: "object",
      properties: {
        parentId: { type: "string", description: "The id of an existing box node." },
        ["node"]: NODE_SCHEMA,
      },
      required: ["parentId", "node"],
      additionalProperties: false,
    },
  },
  {
    name: "use_stamp",
    description:
      "Expand a reusable stamp by name under at.parent. Pass string params for stamp slots; the executor mints fresh ids.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "A stamp name from the offered STAMPS list." },
        params: STRING_MAP_SCHEMA,
        at: {
          type: "object",
          properties: {
            parent: { type: "string", description: "The id of an existing box node." },
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
      "Insert or replace one node by id. Reuse an existing id to update that node in place.",
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
      "Restyle the whole page by selecting a theme by name only. Never pass CSS values or colors.",
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
