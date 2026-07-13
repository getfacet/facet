import { isPlainObject, printableKey, printableValue, type IssueSink } from "./issues.js";
import type { FacetAction } from "./nodes.js";

function isPrimitive(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/**
 * Filtering form of the action-payload rule. A plain object keeps only its
 * primitive-valued entries; anything else yields `undefined`.
 */
export function sanitizeActionPayload(
  value: unknown,
): Record<string, string | number | boolean> | undefined {
  if (!isPlainObject(value)) return undefined;
  const payload: Record<string, string | number | boolean> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (isPrimitive(raw)) payload[key] = raw;
  }
  return payload;
}

/** Rejecting form of the action-payload rule. */
export function isPrimitiveRecord(value: unknown): boolean {
  return isPlainObject(value) && Object.values(value).every(isPrimitive);
}

/**
 * Canonical fail-safe action normalization shared by every component family.
 * Malformed actions are removed with bounded diagnostics.
 */
export function normalizeFacetAction(
  value: unknown,
  nodeId: string,
  field: string,
  issues: IssueSink,
): FacetAction | undefined {
  const node = printableKey(nodeId);
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    issues.push(`node "${node}": ${field} is not an action object`);
    return undefined;
  }

  const kind = value.kind;
  if (kind === undefined || kind === "agent") {
    if (typeof value.name !== "string") {
      issues.push(`node "${node}": ${field} agent action has no string name`);
      return undefined;
    }
    const action: {
      kind: "agent";
      name: string;
      payload?: Record<string, string | number | boolean>;
      collect?: string;
    } = { kind: "agent", name: value.name };
    const payload = sanitizeActionPayload(value.payload);
    if (payload !== undefined) action.payload = payload;
    if (typeof value.collect === "string") {
      action.collect = value.collect;
    } else if (value.collect !== undefined) {
      issues.push(`node "${node}": ${field} collect is not a string; dropped`);
    }
    return action;
  }

  if (kind === "navigate") {
    if (typeof value.to !== "string") {
      issues.push(`node "${node}": ${field} navigate action needs a string "to"`);
      return undefined;
    }
    return { kind: "navigate", to: value.to };
  }

  if (kind === "toggle") {
    if (typeof value.target !== "string") {
      issues.push(`node "${node}": ${field} toggle action needs a string "target"`);
      return undefined;
    }
    return { kind: "toggle", target: value.target };
  }

  issues.push(`node "${node}": unknown ${field} kind ${printableValue(kind)} dropped`);
  return undefined;
}
