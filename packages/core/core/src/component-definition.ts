import { isComponentNodeType, isPrimitiveBrickType } from "./component-validation.js";
import {
  BoundedIssues,
  isPlainObject,
  printableKey,
  printableValue,
  type IssueSink,
} from "./issues.js";
import type { FacetNode, NodeId } from "./nodes.js";
import { validateStamp, type FacetStamp } from "./validate.js";

const LEGACY_MEDIA_NODE_TYPES = ["image"] as const;

const FORBIDDEN_COMPONENT_DEFINITION_FIELDS = [
  "html",
  "rawHtml",
  "innerHTML",
  "script",
  "javascript",
  "js",
  "css",
  "fetch",
  "fetchUrl",
  "endpoint",
  "url",
  "dataSource",
  "dataBinding",
  "binding",
  "bindings",
  "query",
  "queryExpr",
  "expression",
  "resolver",
] as const;

export interface FacetComponentDefinition {
  readonly name: string;
  readonly description?: string;
  readonly metadata?: FacetStamp["metadata"];
  readonly slots?: Readonly<Record<string, string>>;
  readonly root: NodeId;
  readonly nodes: Readonly<Record<NodeId, FacetNode>>;
}

export interface ComponentDefinitionValidationResult {
  readonly definition?: FacetComponentDefinition;
  readonly issues: readonly string[];
}

export function validateComponentDefinition(
  input: unknown,
): ComponentDefinitionValidationResult {
  const issues = new BoundedIssues();
  try {
    return validateComponentDefinitionUnsafe(input, issues);
  } catch {
    issues.push("component definition could not be read safely; refused");
    return { issues: issues.list };
  }
}

function validateComponentDefinitionUnsafe(
  input: unknown,
  issues: BoundedIssues,
): ComponentDefinitionValidationResult {
  if (!isPlainObject(input) || !isPlainObject(input.nodes)) {
    issues.push("component definition is not an object with a nodes map");
    return { issues: issues.list };
  }

  if (!inspectComponentDefinitionNodes(input.nodes, issues)) {
    return { issues: issues.list };
  }

  const result = validateStamp(input);
  for (const issue of result.issues) issues.push(issue);
  if (result.stamp === undefined) return { issues: issues.list };

  return { definition: fromStamp(result.stamp), issues: issues.list };
}

function fromStamp(stamp: FacetStamp): FacetComponentDefinition {
  const definition: {
    name: string;
    description?: string;
    metadata?: FacetStamp["metadata"];
    slots?: Readonly<Record<string, string>>;
    root: NodeId;
    nodes: Readonly<Record<NodeId, FacetNode>>;
  } = {
    name: stamp.name,
    root: stamp.root,
    nodes: stamp.nodes,
  };
  if (stamp.description !== undefined) definition.description = stamp.description;
  if (stamp.metadata !== undefined) definition.metadata = stamp.metadata;
  if (stamp.slots !== undefined) definition.slots = stamp.slots;
  return definition;
}

function inspectComponentDefinitionNodes(
  rawNodes: Record<string, unknown>,
  issues: IssueSink,
): boolean {
  let safe = true;
  for (const [id, raw] of Object.entries(rawNodes)) {
    if (!isPlainObject(raw)) continue;
    if (!isAllowedTemplateNodeType(raw.type)) {
      issues.push(
        `node "${printableKey(id)}": unknown component type ${printableValue(raw.type)} in component definition`,
      );
      safe = false;
    }
    for (const field of FORBIDDEN_COMPONENT_DEFINITION_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(raw, field)) {
        issues.push(
          `node "${printableKey(id)}": ${field} is not allowed in component definitions; refused`,
        );
        safe = false;
      }
    }
  }
  return safe;
}

function isAllowedTemplateNodeType(value: unknown): boolean {
  return (
    isPrimitiveBrickType(value) ||
    isComponentNodeType(value) ||
    (typeof value === "string" && (LEGACY_MEDIA_NODE_TYPES as readonly string[]).includes(value))
  );
}
