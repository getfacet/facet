import {
  BRICK_CONTRACT,
  FIXED_STYLE_VALUE_CONTRACT,
  TOKEN_STYLE_VALUE_CONTRACT,
} from "@facet/core";
import type {
  BrickStyle,
  BrickStyleDefinition,
  BrickStylePropertyContract,
  BrickStyleTargetContract,
  BrickType,
  InputKind,
  StyleValue,
  StyleValueDomain,
} from "@facet/core";
import type { ResolvedTheme } from "./theme.js";

const ABSENT = Symbol("absent style value");
type SafeValue = unknown | typeof ABSENT;

const TOKEN_DOMAINS: Readonly<Record<string, StyleValueDomain>> = TOKEN_STYLE_VALUE_CONTRACT;
const FIXED_DOMAINS: Readonly<Record<string, StyleValueDomain>> = FIXED_STYLE_VALUE_CONTRACT;

export interface ResolveBrickStyleOptions {
  /** Whether this node's already-evaluated activeWhen predicate currently matches. */
  readonly active?: boolean;
  /** Effective input kind used to omit targets that cannot render for that kind. */
  readonly inputKind?: InputKind;
}

function readableObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function readOwn(value: unknown, key: string): SafeValue {
  const object = readableObject(value);
  if (object === undefined) return ABSENT;
  try {
    if (!Object.prototype.hasOwnProperty.call(object, key)) return ABSENT;
    return Reflect.get(object, key);
  } catch {
    return ABSENT;
  }
}

function allowedDomain(property: BrickStylePropertyContract): StyleValueDomain | undefined {
  return property.source === "token"
    ? TOKEN_DOMAINS[property.domain]
    : FIXED_DOMAINS[property.domain];
}

function allowedValue(
  propertyName: string,
  property: BrickStylePropertyContract,
  value: unknown,
): value is StyleValue {
  if (value === "inherit" && propertyName !== "color") return false;
  return (
    allowedDomain(property)?.values.some((candidate) => Object.is(candidate.name, value)) ?? false
  );
}

function mutableChild(output: Record<string, unknown>, key: string): Record<string, unknown> {
  const current = output[key];
  if (typeof current === "object" && current !== null) return current as Record<string, unknown>;
  const child: Record<string, unknown> = {};
  output[key] = child;
  return child;
}

function applyProperties(
  output: Record<string, unknown>,
  raw: unknown,
  properties: Readonly<Record<string, BrickStylePropertyContract>>,
  names: readonly string[],
): void {
  for (const name of names) {
    const property = properties[name];
    if (property === undefined) continue;
    const value = readOwn(raw, name);
    if (value !== ABSENT && allowedValue(name, property, value)) output[name] = value;
  }
}

function applyTarget(
  output: Record<string, unknown>,
  raw: unknown,
  target: BrickStyleTargetContract,
  allowStates: boolean,
): void {
  if (readableObject(raw) === undefined) return;
  applyProperties(output, raw, target.properties, Object.keys(target.properties));
  if (!allowStates) return;
  for (const [state, propertyNames] of Object.entries(target.states ?? {})) {
    const rawState = readOwn(raw, state);
    if (rawState === ABSENT || readableObject(rawState) === undefined) continue;
    applyProperties(mutableChild(output, state), rawState, target.properties, propertyNames);
  }
}

function applyLayer<B extends BrickType>(
  output: Record<string, unknown>,
  brick: B,
  raw: unknown,
  options: ResolveBrickStyleOptions,
  allowStates: boolean,
): void {
  if (readableObject(raw) === undefined) return;
  const contract = BRICK_CONTRACT[brick];
  applyTarget(output, raw, contract.style.root, allowStates);
  for (const [targetName, target] of Object.entries(contract.style.targets)) {
    if (
      options.inputKind !== undefined &&
      target.applicableTo !== undefined &&
      !target.applicableTo.includes(options.inputKind)
    ) {
      continue;
    }
    const rawTarget = readOwn(raw, targetName);
    if (rawTarget === ABSENT || readableObject(rawTarget) === undefined) continue;
    applyTarget(mutableChild(output, targetName), rawTarget, target, allowStates);
  }
}

function presetStyle<B extends BrickType>(theme: ResolvedTheme, brick: B, layer: unknown): unknown {
  const name = readOwn(layer, "preset");
  if (typeof name !== "string") return undefined;
  const brickPresets = readOwn(theme.presets, brick);
  if (brickPresets === ABSENT) return undefined;
  const preset = readOwn(brickPresets, name);
  if (preset === ABSENT) return undefined;
  const style = readOwn(preset, "style");
  return style === ABSENT ? undefined : style;
}

/**
 * Resolve one Brick's token/fixed-name style layers without ever copying an
 * unknown property. Ephemeral state blocks stay attached to their owning
 * target; renderer-owned selectors apply them after the resolved base look.
 */
export function resolveBrickStyle<B extends BrickType>(
  theme: ResolvedTheme,
  brick: B,
  authoredStyle?: BrickStyle<B> | unknown,
  options: ResolveBrickStyleOptions = {},
): BrickStyleDefinition<B> {
  const output: Record<string, unknown> = {};

  applyLayer(output, brick, theme.defaults[brick], options, true);
  applyLayer(output, brick, presetStyle(theme, brick, authoredStyle), options, true);
  applyLayer(output, brick, authoredStyle, options, true);

  if (options.active === true && BRICK_CONTRACT[brick].supportsActiveWhen) {
    const active = readOwn(authoredStyle, "active");
    if (active !== ABSENT) {
      // A normal Preset may carry state definitions; active direct data cannot.
      applyLayer(output, brick, presetStyle(theme, brick, active), options, true);
      applyLayer(output, brick, active, options, false);
    }
  }

  return output as BrickStyleDefinition<B>;
}
