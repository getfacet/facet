export type FacetToolName = (typeof FACET_TOOL_NAMES)[number];

type StringSchema = Readonly<{
  type: "string";
  description: string;
}>;

type UnknownSchema = Readonly<{
  description: string;
}>;

type ToolSchema = Readonly<{
  type: "object";
  properties: Readonly<Record<string, StringSchema | UnknownSchema>>;
  required: readonly string[];
  additionalProperties: false;
}>;

export interface FacetToolSpec {
  readonly name: FacetToolName;
  readonly description: string;
  readonly inputSchema: ToolSchema;
  readonly mutatesStage: boolean;
  readonly producesConversation: false;
}

export const FACET_TOOL_NAMES = Object.freeze([
  "render_page",
  "insert_subtree",
  "replace_subtree",
  "update_node",
  "remove_subtree",
  "read_component_spec",
  "read_screen",
  "read_data",
  "publish_data",
] as const);

function stringSchema(description: string): StringSchema {
  return Object.freeze({ type: "string" as const, description });
}

function valueSchema(description: string): UnknownSchema {
  return Object.freeze({ description });
}

function objectSchema(
  properties: Readonly<Record<string, StringSchema | UnknownSchema>>,
  required: readonly string[],
): ToolSchema {
  return Object.freeze({
    type: "object" as const,
    properties: Object.freeze({ ...properties }),
    required: Object.freeze([...required]),
    additionalProperties: false as const,
  });
}

function spec(
  name: FacetToolName,
  description: string,
  inputSchema: ToolSchema,
  mutatesStage: boolean,
): FacetToolSpec {
  return Object.freeze({
    name,
    description,
    inputSchema,
    mutatesStage,
    producesConversation: false as const,
  });
}

export const FACET_TOOL_SPECS: readonly FacetToolSpec[] = Object.freeze([
  spec(
    "render_page",
    "Author a complete Facet page from declarative markup.",
    objectSchema({ markup: stringSchema("Complete Facet component markup for the page.") }, [
      "markup",
    ]),
    true,
  ),
  spec(
    "insert_subtree",
    "Insert a declarative component subtree relative to an existing node.",
    objectSchema(
      {
        targetId: stringSchema("Existing generated node id that receives the subtree."),
        markup: stringSchema("Declarative component markup for the subtree."),
      },
      ["targetId", "markup"],
    ),
    true,
  ),
  spec(
    "replace_subtree",
    "Replace one existing component subtree with declarative markup.",
    objectSchema(
      {
        targetId: stringSchema("Existing generated node id to replace."),
        markup: stringSchema("Declarative component markup for the replacement subtree."),
      },
      ["targetId", "markup"],
    ),
    true,
  ),
  spec(
    "update_node",
    "Update one existing node from declarative markup.",
    objectSchema(
      {
        targetId: stringSchema("Existing generated node id to update."),
        markup: stringSchema("Declarative component markup for the updated node."),
      },
      ["targetId", "markup"],
    ),
    true,
  ),
  spec(
    "remove_subtree",
    "Remove one existing component subtree.",
    objectSchema({ targetId: stringSchema("Existing generated node id to remove.") }, ["targetId"]),
    true,
  ),
  spec(
    "read_component_spec",
    "Read the full active catalog metadata for one registered component.",
    objectSchema({ tag: stringSchema("Registered component tag.") }, ["tag"]),
    false,
  ),
  spec(
    "read_screen",
    "Read one declared screen as bounded serialized Facet markup.",
    objectSchema({ screen: stringSchema("Declared screen name.") }, ["screen"]),
    false,
  ),
  spec(
    "read_data",
    "Read a bounded projection of the data model at a named-key path.",
    objectSchema({ path: stringSchema("Dotted data path using named keys only.") }, ["path"]),
    false,
  ),
  spec(
    "publish_data",
    "Publish one bounded JSON value through the runtime data lane.",
    objectSchema(
      {
        path: stringSchema("Parsed data path represented as dot-separated named keys."),
        value: valueSchema("JSON value to publish at the path."),
      },
      ["path", "value"],
    ),
    true,
  ),
]);
