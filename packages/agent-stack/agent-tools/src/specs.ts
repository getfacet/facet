import { BRICK_TYPES } from "@facet/core";
import type { FacetStageToolName, ToolSpec } from "./types.js";

export type FacetStageToolSpec = ToolSpec<FacetStageToolName>;

const BRICK_ROSTER = BRICK_TYPES.join(", ");

const NODE_SCHEMA = {
  type: "object",
  description: `One native Facet Brick (${BRICK_ROSTER}). Use get_brick_spec before authoring unfamiliar fields or styles. No raw HTML, JavaScript, or CSS.`,
} as const;

const TREE_SCHEMA = {
  type: "object",
  description:
    "A complete Facet document with root, nodes, and optional screens, entry, and data. Use get_brick_spec before authoring unfamiliar Bricks or styles.",
} as const;

const NAME_SCHEMA = {
  type: "string",
  description: "One exact name from the corresponding active index.",
} as const;

export const FACET_STAGE_TOOL_NAMES = [
  "render_page",
  "append_node",
  "set_node",
  "remove_node",
  "say",
  "get_brick_spec",
  "get_style_choices",
  "get_preset",
  "get_pattern",
  "inspect_stage",
  "inspect_node",
] as const satisfies readonly FacetStageToolName[];

export const FACET_STAGE_TOOL_SPECS = [
  {
    name: "render_page",
    description: "Replace the complete page after checking unfamiliar Brick details.",
    parameters: {
      type: "object",
      properties: { tree: TREE_SCHEMA },
      required: ["tree"],
      additionalProperties: false,
    },
  },
  {
    name: "append_node",
    description: "Append one Brick to an existing box parent.",
    parameters: {
      type: "object",
      properties: {
        parentId: { type: "string", description: "The id of an existing box container." },
        node: NODE_SCHEMA,
      },
      required: ["parentId", "node"],
      additionalProperties: false,
    },
  },
  {
    name: "set_node",
    description: "Insert or replace one Brick by its id.",
    parameters: {
      type: "object",
      properties: { node: NODE_SCHEMA },
      required: ["node"],
      additionalProperties: false,
    },
  },
  {
    name: "remove_node",
    description: "Delete one node from the page by id.",
    parameters: {
      type: "object",
      properties: { nodeId: { type: "string", description: "The node id to remove." } },
      required: ["nodeId"],
      additionalProperties: false,
    },
  },
  {
    name: "say",
    description: "Send a short chat message to the visitor.",
    parameters: {
      type: "object",
      properties: { text: { type: "string", description: "The chat text to send." } },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "get_brick_spec",
    description: "Read exact fields and compact local style paths for one unfamiliar Brick.",
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: BRICK_TYPES,
          description: "One exact Brick type from the Brick index.",
        },
      },
      required: ["type"],
      additionalProperties: false,
    },
  },
  {
    name: "get_style_choices",
    description:
      "Read allowed values for one exact Brick-owned style property when its choice is unfamiliar.",
    parameters: {
      type: "object",
      properties: {
        brick: { type: "string", enum: BRICK_TYPES, description: "The owning Brick type." },
        target: {
          type: "string",
          description: 'Exact "root" or Brick-owned target from get_brick_spec.',
        },
        property: {
          type: "string",
          description: "Exact local property from the selected target in get_brick_spec.",
        },
      },
      required: ["brick", "target", "property"],
      additionalProperties: false,
    },
  },
  {
    name: "get_preset",
    description: "Read one exact same-Brick Preset's metadata and unresolved style names.",
    parameters: {
      type: "object",
      properties: {
        brick: { type: "string", enum: BRICK_TYPES, description: "The Preset's Brick type." },
        name: NAME_SCHEMA,
      },
      required: ["brick", "name"],
      additionalProperties: false,
    },
  },
  {
    name: "get_pattern",
    description:
      "Read one exact compatible Pattern for reference, then adapt and author native Bricks separately.",
    parameters: {
      type: "object",
      properties: { name: NAME_SCHEMA },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "inspect_stage",
    description: "Inspect a bounded summary of the current local stage without changing it.",
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
    description: "Inspect one node and a bounded descendant slice without changing the stage.",
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
