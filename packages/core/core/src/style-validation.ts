import {
  BRICK_CONTRACT,
  type BrickStylePropertyContract,
  type BrickStyleTargetContract,
  type BrickType,
  type InputKind,
} from "./brick-contract.js";
import {
  FIXED_STYLE_VALUE_CONTRACT,
  TOKEN_STYLE_VALUE_CONTRACT,
  type StyleValue,
  type StyleValueDomain,
} from "./style-value-contract.js";
import type { BrickStyle } from "./style-types.js";
import { isPlainObject, printableKey, type IssueSink } from "./issues.js";
import { SLOT_NAME_RE } from "./slot-marker.js";

const TOKEN_DOMAINS: Readonly<Record<string, StyleValueDomain>> = TOKEN_STYLE_VALUE_CONTRACT;
const FIXED_DOMAINS: Readonly<Record<string, StyleValueDomain>> = FIXED_STYLE_VALUE_CONTRACT;

const ABSENT = Symbol("absent style property");
type SafeRead = unknown | typeof ABSENT;

export interface StyleSanitizeContext {
  readonly nodeId: string;
  readonly issues: IssueSink;
  /** Effective input kind; omit when validating Theme-owned styles for every kind. */
  readonly inputKind?: InputKind;
}

function issue(context: StyleSanitizeContext, path: string, reason: string): void {
  context.issues.push(
    `node "${printableKey(context.nodeId)}": ${reason} at style.${printableKey(path)} dropped`,
  );
}

function asReadableObject(
  value: unknown,
  context: StyleSanitizeContext,
  path: string,
): Record<string, unknown> | undefined {
  try {
    if (isPlainObject(value)) return value;
  } catch {
    // Revoked and otherwise hostile proxies are an unreadable fragment, not a
    // reason to lose the owning node or any sibling.
  }
  if (value !== undefined) issue(context, path, "unreadable style object");
  return undefined;
}

/** Read only an own, contract-named field; each hostile Proxy trap is isolated. */
function readOwn(
  object: Record<string, unknown>,
  key: string,
  context: StyleSanitizeContext,
  path: string,
): SafeRead {
  try {
    if (!Object.prototype.hasOwnProperty.call(object, key)) return ABSENT;
    return Reflect.get(object, key);
  } catch {
    issue(context, path, "unreadable style value");
    return ABSENT;
  }
}

function domainFor(property: BrickStylePropertyContract): StyleValueDomain | undefined {
  const domains = property.source === "token" ? TOKEN_DOMAINS : FIXED_DOMAINS;
  return domains[property.domain];
}

function isAllowedValue(
  propertyName: string,
  property: BrickStylePropertyContract,
  value: unknown,
): value is StyleValue {
  // `inherit` is a foreground choice only. Background, border, chart-series,
  // and other paint properties share the color domain but cannot inherit.
  if (value === "inherit" && propertyName !== "color") return false;
  return domainFor(property)?.values.some((candidate) => Object.is(candidate.name, value)) ?? false;
}

function sanitizeProperties(
  value: Record<string, unknown>,
  properties: Readonly<Record<string, BrickStylePropertyContract>>,
  names: readonly string[],
  context: StyleSanitizeContext,
  prefix: string,
): Record<string, StyleValue> {
  const result: Record<string, StyleValue> = {};
  for (const name of names) {
    const property = properties[name];
    if (property === undefined) continue;
    const path = prefix === "" ? name : `${prefix}.${name}`;
    const raw = readOwn(value, name, context, path);
    if (raw === ABSENT || raw === undefined) continue;
    if (isAllowedValue(name, property, raw)) {
      result[name] = raw;
    } else {
      issue(context, path, "invalid style value");
    }
  }
  return result;
}

function sanitizeTarget(
  value: unknown,
  target: BrickStyleTargetContract,
  context: StyleSanitizeContext,
  prefix: string,
  allowStates: boolean,
): Record<string, unknown> | undefined {
  const object = asReadableObject(value, context, prefix);
  if (object === undefined) return undefined;

  const result: Record<string, unknown> = sanitizeProperties(
    object,
    target.properties,
    Object.keys(target.properties),
    context,
    prefix,
  );

  if (allowStates) {
    for (const [state, propertyNames] of Object.entries(target.states ?? {})) {
      const path = prefix === "" ? state : `${prefix}.${state}`;
      const rawState = readOwn(object, state, context, path);
      if (rawState === ABSENT || rawState === undefined) continue;
      const stateObject = asReadableObject(rawState, context, path);
      if (stateObject === undefined) continue;
      const stateResult = sanitizeProperties(
        stateObject,
        target.properties,
        propertyNames,
        context,
        path,
      );
      if (Object.keys(stateResult).length > 0) result[state] = stateResult;
    }
  }

  return result;
}

function sanitizeLayer<B extends BrickType>(
  brick: B,
  value: unknown,
  context: StyleSanitizeContext,
  allowStates: boolean,
  allowActive: boolean,
): Record<string, unknown> | undefined {
  const object = asReadableObject(value, context, "root");
  if (object === undefined) return undefined;
  const contract = BRICK_CONTRACT[brick];
  const result = sanitizeTarget(object, contract.style.root, context, "", allowStates) ?? {};

  const preset = readOwn(object, "preset", context, "preset");
  if (preset !== ABSENT && preset !== undefined) {
    if (typeof preset === "string" && SLOT_NAME_RE.test(preset)) result.preset = preset;
    else issue(context, "preset", "malformed Preset name");
  }

  for (const [targetName, target] of Object.entries(contract.style.targets)) {
    const rawTarget = readOwn(object, targetName, context, targetName);
    if (rawTarget === ABSENT || rawTarget === undefined) continue;
    if (
      context.inputKind !== undefined &&
      target.applicableTo !== undefined &&
      !target.applicableTo.includes(context.inputKind)
    ) {
      issue(context, targetName, `target is unavailable for input kind ${context.inputKind}`);
      continue;
    }
    const targetResult = sanitizeTarget(rawTarget, target, context, targetName, allowStates);
    if (targetResult !== undefined && Object.keys(targetResult).length > 0) {
      result[targetName] = targetResult;
    }
  }

  if (allowActive && contract.supportsActiveWhen) {
    const active = readOwn(object, "active", context, "active");
    if (active !== ABSENT && active !== undefined) {
      const activeResult = sanitizeLayer(brick, active, context, false, false);
      if (activeResult !== undefined && Object.keys(activeResult).length > 0) {
        result.active = activeResult;
      }
    }
  }

  return result;
}

/**
 * Total, vocabulary-driven sanitizer for stale or bypassed Brick style data.
 * It reads only contract-owned paths and returns fresh data, so unknown keys,
 * raw CSS, cyclic tails, and hostile nested objects cannot escape or throw.
 */
export function sanitizeBrickStyle<B extends BrickType>(
  brick: B,
  value: unknown,
  context: StyleSanitizeContext,
): BrickStyle<B> | undefined {
  try {
    return sanitizeLayer(brick, value, context, true, true) as BrickStyle<B> | undefined;
  } catch {
    issue(context, "root", "unreadable style object");
    return undefined;
  }
}
