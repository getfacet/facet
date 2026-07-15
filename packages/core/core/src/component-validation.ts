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
import { BRICK_REGISTRY, type ComponentRole } from "./brick-registry.js";

export { MAX_COMPONENT_ARRAY_ITEMS } from "./component-validation-shared.js";

// The 4 role Sets, the ESTABLISHED set, and the role dispatch that used to live
// here are now the `role`/`established` fields of the brick registry. Routing to
// each role sanitizer stays a thin wrapper (the sanitizer BODIES are untouched);
// the wrapper only narrows the registry's `ComponentNodeType` to the sanitizer's
// role-specific type.
type RoleSanitizer = (
  id: string,
  raw: Record<string, unknown>,
  type: ComponentNodeType,
  issues: IssueSink,
) => ComponentNode | undefined;

const ROLE_SANITIZERS: Record<ComponentRole, RoleSanitizer> = {
  control: (id, raw, type, issues) =>
    sanitizeControlComponentNode(id, raw, type as ControlComponentType, issues),
  data: (id, raw, type, issues) =>
    sanitizeDataComponentNode(id, raw, type as DataComponentType, issues),
  feedback: (id, raw, type, issues) =>
    sanitizeFeedbackComponentNode(id, raw, type as FeedbackComponentType, issues),
};

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
  const entry = BRICK_REGISTRY[rawType];
  if (!entry.established) reportForbiddenFields(id, raw, issues);
  if (entry.role === undefined) return undefined;
  return ROLE_SANITIZERS[entry.role](id, raw, rawType, issues);
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
