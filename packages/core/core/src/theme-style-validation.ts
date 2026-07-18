import {
  BRICK_CONTRACT,
  type BrickStylePropertyContract,
  type BrickStyleTargetContract,
  type BrickType,
} from "./brick-contract.js";
import { isForbiddenKey, isPlainObject, nullMap, printableKey } from "./issues.js";
import { isStyleValueAllowedForProperty, type StyleValue } from "./style-value-contract.js";
import type { BrickStyleDefinition } from "./style-types.js";
import { IssueList } from "./theme-issues.js";

function styleError(issues: IssueList, path: string, message: string): void {
  issues.push({ severity: "error", message: `${path}: ${message}` });
}

function validatePropertySet(
  raw: Record<string, unknown>,
  properties: Readonly<Record<string, BrickStylePropertyContract>>,
  names: readonly string[],
  path: string,
  issues: IssueList,
): Record<string, StyleValue> {
  const output = nullMap<StyleValue>();
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(raw, name)) continue;
    const property = properties[name];
    let value: unknown;
    try {
      value = Reflect.get(raw, name);
    } catch {
      styleError(issues, `${path}.${name}`, "style value could not be read safely");
      continue;
    }
    if (property === undefined || !isStyleValueAllowedForProperty(name, property, value)) {
      styleError(issues, `${path}.${name}`, "invalid token or fixed style value");
      continue;
    }
    output[name] = value;
  }
  return output;
}

function validateStates(
  raw: Record<string, unknown>,
  target: BrickStyleTargetContract,
  path: string,
  issues: IssueList,
  output: Record<string, unknown>,
): void {
  for (const [state, propertyNames] of Object.entries(target.states ?? {})) {
    if (!Object.prototype.hasOwnProperty.call(raw, state)) continue;
    const rawState = Reflect.get(raw, state);
    if (!isPlainObject(rawState)) {
      styleError(issues, `${path}.${state}`, "state style is not an object");
      continue;
    }
    for (const key of Object.keys(rawState)) {
      if (isForbiddenKey(key) || !propertyNames.includes(key)) {
        styleError(
          issues,
          `${path}.${state}.${printableKey(key)}`,
          "unknown or forbidden state property",
        );
      }
    }
    output[state] = validatePropertySet(
      rawState,
      target.properties,
      propertyNames,
      `${path}.${state}`,
      issues,
    );
  }
}

function validateTarget(
  raw: unknown,
  target: BrickStyleTargetContract,
  path: string,
  issues: IssueList,
): Record<string, unknown> {
  const output = nullMap<unknown>();
  if (!isPlainObject(raw)) {
    styleError(issues, path, "style target is missing or not an object");
    return output;
  }
  const known = new Set([...Object.keys(target.properties), ...Object.keys(target.states ?? {})]);
  for (const key of Object.keys(raw)) {
    if (isForbiddenKey(key) || !known.has(key)) {
      styleError(issues, `${path}.${printableKey(key)}`, "unknown or forbidden style property");
    }
  }
  Object.assign(
    output,
    validatePropertySet(raw, target.properties, Object.keys(target.properties), path, issues),
  );
  validateStates(raw, target, path, issues, output);
  return output;
}

/** Strict Theme-owned style validation. Unlike renderer sanitation, nothing is dropped. */
export function validateThemeStyle<B extends BrickType>(
  raw: unknown,
  brick: B,
  requireEveryTarget: boolean,
  path: string,
  issues: IssueList,
): BrickStyleDefinition<B> {
  const output = nullMap<unknown>();
  if (!isPlainObject(raw)) {
    styleError(issues, path, "style is missing or not an object");
    return output as BrickStyleDefinition<B>;
  }
  const contract = BRICK_CONTRACT[brick];
  const root: BrickStyleTargetContract = contract.style.root;
  const known = new Set([
    ...Object.keys(root.properties),
    ...Object.keys(root.states ?? {}),
    ...Object.keys(contract.style.targets),
  ]);
  for (const key of Object.keys(raw)) {
    if (isForbiddenKey(key) || !known.has(key)) {
      styleError(issues, `${path}.${printableKey(key)}`, "unknown or forbidden style property");
    }
  }
  Object.assign(
    output,
    validatePropertySet(raw, root.properties, Object.keys(root.properties), path, issues),
  );
  validateStates(raw, root, path, issues, output);
  for (const [targetName, target] of Object.entries(contract.style.targets)) {
    if (!Object.prototype.hasOwnProperty.call(raw, targetName)) {
      if (requireEveryTarget)
        styleError(issues, `${path}.${targetName}`, "required style target is missing");
      continue;
    }
    output[targetName] = validateTarget(
      Reflect.get(raw, targetName),
      target,
      `${path}.${targetName}`,
      issues,
    );
  }
  return output as BrickStyleDefinition<B>;
}
