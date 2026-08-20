import { parseAuthoredNumber } from "./author-scalar.js";
import type { ComponentSpec, PropSchema } from "./component-spec.js";
import { authorError, truncate, type AuthorError, type SourceLocation } from "./markup-errors.js";
import type { MarkupNode } from "./markup-parser.js";

type MarkupProp = MarkupNode["props"][number];

const LOCAL_SCHEME_PREFIX = ["local", ":"].join("");
const BOOLEAN_LITERALS: readonly string[] = ["true", "false"];
const EXCERPT_CHARS = 40;

function excerpt(text: string): string {
  return truncate(text.trim().replace(/\\s+/g, " "), EXCERPT_CHARS);
}

function looksStructured(text: string): boolean {
  const lead = text.trimStart();
  return lead.startsWith("[") || lead.startsWith("{");
}

export function checkScalar(
  text: string,
  prop: MarkupNode["props"][number],
  schema: PropSchema,
  spec: ComponentSpec,
  location: SourceLocation,
): AuthorError | null {
  if (text.startsWith(LOCAL_SCHEME_PREFIX)) {
    return authorError({
      code: "unknown-scheme",
      location,
      cause: `\`${excerpt(text)}\` uses the \`${LOCAL_SCHEME_PREFIX}\` scheme. The vocabulary is \`nav:\` and \`agent:\` only.`,
      repair:
        "Move the visitor with `nav:<screen>`, or send the interaction to the agent with `agent:<event>`.",
    });
  }
  if (looksStructured(text)) {
    return authorError({
      code: "inline-structure",
      location,
      cause: `\`${excerpt(text)}\` is inline structured JSON. A prop takes one scalar, not a payload.`,
      repair: "Publish the structure as data and bind it with a `data:` reference.",
    });
  }
  switch (schema.type) {
    case "array":
    case "object":
      return authorError({
        code: "invalid-value",
        location,
        cause: `\`${spec.tag}.${prop.name}\` is declared ${schema.type}, which only a \`data:\` reference can fill.`,
        repair: `Publish the ${schema.type} and write \`${prop.name}="data:<path>"\`.`,
      });
    case "boolean":
      return BOOLEAN_LITERALS.includes(text)
        ? null
        : authorError({
            code: "invalid-value",
            location,
            cause: `\`${spec.tag}.${prop.name}\` is a boolean; \`${excerpt(text)}\` is not \`true\` or \`false\`.`,
            repair: `Write \`${prop.name}="true"\` or \`${prop.name}="false"\`.`,
          });
    case "number":
      return checkNumber(text, prop, schema, spec, location);
    case "string":
      if (schema.action === true) {
        return authorError({
          code: "invalid-value",
          location,
          cause: `\`${spec.tag}.${prop.name}\` accepts an action reference, not literal text.`,
          repair: "Write one literal nav:<screen> or agent:<event> reference.",
        });
      }
      if (schema.assetKind === "image") {
        return authorError({
          code: "invalid-value",
          location,
          cause: `\`${spec.tag}.${prop.name}\` accepts a host-pinned image asset, not a URL or literal string.`,
          repair: `Write \`${prop.name}="asset:<key>"\` using a key from this session's asset registry.`,
        });
      }
      return schema.enum === undefined || schema.enum.includes(text)
        ? null
        : authorError({
            code: "invalid-value",
            location,
            cause: `\`${excerpt(text)}\` is not a value \`${spec.tag}.${prop.name}\` admits.`,
            repair: `Use one of: ${excerpt(schema.enum.join(", "))}.`,
            repairContext: {
              kind: "prop_value",
              componentTag: spec.tag,
              propName: prop.name,
              allowedValues: schema.enum,
            },
          });
  }
}

function checkNumber(
  text: string,
  prop: MarkupProp,
  schema: Extract<PropSchema, { readonly type: "number" }>,
  spec: ComponentSpec,
  location: SourceLocation,
): AuthorError | null {
  const invalid = (cause: string, repair: string): AuthorError =>
    authorError({ code: "invalid-value", location, cause, repair });
  const amount = parseAuthoredNumber(text);
  if (amount === null) {
    return invalid(
      `\`${spec.tag}.${prop.name}\` is a number; \`${excerpt(text)}\` is not one.`,
      `Write a plain decimal, such as \`${prop.name}="42"\`.`,
    );
  }
  if (schema.enum !== undefined && !schema.enum.includes(amount)) {
    return authorError({
      code: "invalid-value",
      location,
      cause: `\`${excerpt(text)}\` is not a value \`${spec.tag}.${prop.name}\` admits.`,
      repair: `Use one of: ${excerpt(schema.enum.join(", "))}.`,
      repairContext: {
        kind: "prop_value",
        componentTag: spec.tag,
        propName: prop.name,
        allowedValues: schema.enum,
      },
    });
  }
  if (schema.minimum !== undefined && amount < schema.minimum) {
    return invalid(
      `\`${spec.tag}.${prop.name}\` starts at ${schema.minimum}; \`${excerpt(text)}\` is below it.`,
      `Write a value of at least ${schema.minimum}.`,
    );
  }
  if (schema.maximum !== undefined && amount > schema.maximum) {
    return invalid(
      `\`${spec.tag}.${prop.name}\` stops at ${schema.maximum}; \`${excerpt(text)}\` is above it.`,
      `Write a value of at most ${schema.maximum}.`,
    );
  }
  return null;
}
