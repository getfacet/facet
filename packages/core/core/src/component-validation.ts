import {
  FORBIDDEN_DATA_KEYS,
  isPlainObject,
  printableKey,
  printableValue,
  type IssueSink,
} from "./issues.js";
import {
  COMPONENT_NODE_TYPES,
  INTRINSIC_COMPONENT_TYPES,
  PRIMITIVE_BRICK_TYPES,
  type ComponentNode,
  type ComponentNodeType,
  type IntrinsicComponentType,
  type PrimitiveBrickType,
} from "./nodes.js";
import {
  sanitizeControlComponentNode,
  type ControlComponentType,
} from "./component-validation-control.js";
import { sanitizeDataComponentNode, type DataComponentType } from "./component-validation-data.js";
import {
  sanitizeFeedbackComponentNode,
  type FeedbackComponentType,
} from "./component-validation-feedback.js";
import {
  sanitizeLayoutComponentNode,
  type LayoutComponentType,
} from "./component-validation-layout.js";

export { MAX_COMPONENT_ARRAY_ITEMS } from "./component-validation-shared.js";

const CONTROL_TYPES = new Set<ComponentNodeType>([
  "button",
  "tabs",
  "nav",
  "form",
  "search",
  "filterBar",
]);
const DATA_TYPES = new Set<ComponentNodeType>([
  "table",
  "chart",
  "stat",
  "metric",
  "keyValue",
  "list",
]);
const FEEDBACK_TYPES = new Set<ComponentNodeType>([
  "badge",
  "progress",
  "alert",
  "emptyState",
  "loading",
]);
const LAYOUT_TYPES = new Set<ComponentNodeType>(["section", "card", "divider"]);

// These established component shapes predate the forbidden-field diagnostic;
// preserve their exact validation output while routing them through role modules.
const ESTABLISHED_COMPONENT_TYPES = new Set<ComponentNodeType>([
  "button",
  "section",
  "card",
  "tabs",
  "table",
  "chart",
  "stat",
  "badge",
  "progress",
  "alert",
  "list",
  "divider",
]);

export function isPrimitiveBrickType(value: unknown): value is PrimitiveBrickType {
  return typeof value === "string" && (PRIMITIVE_BRICK_TYPES as readonly string[]).includes(value);
}

export function isIntrinsicComponentType(value: unknown): value is IntrinsicComponentType {
  return (
    typeof value === "string" && (INTRINSIC_COMPONENT_TYPES as readonly string[]).includes(value)
  );
}

export function isComponentNodeType(value: unknown): value is ComponentNodeType {
  return typeof value === "string" && (COMPONENT_NODE_TYPES as readonly string[]).includes(value);
}

export function canonicalComponentType(value: unknown): IntrinsicComponentType | undefined {
  if (value === "stat") return "metric";
  return isIntrinsicComponentType(value) ? value : undefined;
}

export function sanitizeComponentNode(
  id: string,
  raw: unknown,
  issues: IssueSink,
  capturedType?: ComponentNodeType,
): ComponentNode | undefined {
  if (!isPlainObject(raw)) {
    issues.push(`node "${printableKey(id)}": component is not an object`);
    return undefined;
  }
  const rawType = capturedType ?? raw.type;
  if (!isComponentNodeType(rawType)) {
    issues.push(
      `node "${printableKey(id)}": unknown component type ${printableValue(rawType)} dropped`,
    );
    return undefined;
  }
  if (!ESTABLISHED_COMPONENT_TYPES.has(rawType)) reportForbiddenFields(id, raw, issues);

  if (CONTROL_TYPES.has(rawType)) {
    return sanitizeControlComponentNode(id, raw, rawType as ControlComponentType, issues);
  }
  if (DATA_TYPES.has(rawType)) {
    return sanitizeDataComponentNode(id, raw, rawType as DataComponentType, issues);
  }
  if (FEEDBACK_TYPES.has(rawType)) {
    return sanitizeFeedbackComponentNode(id, raw, rawType as FeedbackComponentType, issues);
  }
  if (LAYOUT_TYPES.has(rawType)) {
    return sanitizeLayoutComponentNode(id, raw, rawType as LayoutComponentType, issues);
  }
  return undefined;
}

function reportForbiddenFields(id: string, raw: Record<string, unknown>, issues: IssueSink): void {
  for (const field of FORBIDDEN_DATA_KEYS) {
    if (Object.prototype.hasOwnProperty.call(raw, field)) {
      issues.push(
        `node "${printableKey(id)}": ${field} is not allowed on component nodes; dropped`,
      );
    }
  }
}
