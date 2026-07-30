/**
 * The style primitives the trusted default React implementations share.
 *
 * Two jobs, and nothing else. The first is **naming**: a trusted component
 * styles itself out of the theme's closed token vocabulary, so it needs the CSS
 * custom property one token projects to — `token("color", "textMuted")` rather
 * than a hand-written `--facet-color-text-muted` that no compiler checks. The
 * lookup is typed against `FacetTheme` itself, so a group or token the contract
 * does not declare is a type error here rather than a variable that silently
 * resolves to nothing in a browser. That the names produced match the ones
 * `themeToCssVars` actually projects is proved at run time in
 * `layout.test.tsx`, against the real default theme.
 *
 * The second is **containment**. `FlowStyle` is `CSSProperties` with every
 * positioning and stacking declaration removed, and it is the only style type
 * the helpers below accept. Authored layout stays flow-contained, and overlap
 * belongs to the framework's Modal frame alone, so a trusted component that
 * reached for `position` or `zIndex` would be reopening the one hole the
 * architecture does not have. Making that a *type* keeps the rule where it
 * cannot be forgotten: a component cannot express the violation, and the DOM
 * sweep in `layout.test.tsx` catches anything that bypasses these helpers.
 *
 * Reads of the mount payload are **total**. Props arrive already checked
 * against the declared schema, but a resolved value may still come from a data
 * binding, and a component that threw on a surprising one would take its
 * subtree's error boundary with it. Every reader below answers the declared
 * default instead.
 *
 * **Visibility: private.** This module is not a package entry point and is not
 * barrel-exported; nothing outside `@facet/assets` may import it.
 */

import type { ComponentMountProps, FacetTheme } from "@facet/core";
import type { CSSProperties } from "react";

/** The prefix every projected theme custom property carries. */
const CSS_VAR_PREFIX = "--facet";

/** The resolved prop record one mounted component receives. */
export type ResolvedProps = ComponentMountProps["props"];

/**
 * A style object that cannot take its element out of the flow.
 *
 * Everything a component needs to describe size, spacing, colour and reading
 * order survives; everything that would let it overlap a sibling, escape its
 * parent's box, or choose what paints in front of what is gone.
 */
export type FlowStyle = Omit<
  CSSProperties,
  | "position"
  | "zIndex"
  | "top"
  | "right"
  | "bottom"
  | "left"
  | "inset"
  | "insetBlock"
  | "insetBlockStart"
  | "insetBlockEnd"
  | "insetInline"
  | "insetInlineStart"
  | "insetInlineEnd"
  | "float"
>;

/** camelCase to kebab-case. Every group and token name is ASCII camelCase. */
function toKebabCase(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/**
 * The `var()` reference for one theme token, checked against the token
 * contract: `token("color", "textMuted")` is `var(--facet-color-text-muted)`,
 * and `token("color", "brand")` does not compile.
 */
export function token<Group extends keyof FacetTheme>(
  group: Group,
  name: keyof FacetTheme[Group] & string,
): string {
  return `var(${CSS_VAR_PREFIX}-${toKebabCase(group)}-${toKebabCase(name)})`;
}

/**
 * The space scale as authored props name it. `none` is a real zero rather than
 * a token, because "no space" is not a value a host reskins.
 */
const SPACE_VALUES = {
  none: "0",
  xs: token("space", "xs"),
  sm: token("space", "sm"),
  md: token("space", "md"),
  lg: token("space", "lg"),
  xl: token("space", "xl"),
} as const satisfies Readonly<Record<string, string>>;

/** Every space name an authored prop may carry. */
export type SpaceName = keyof typeof SPACE_VALUES;

/** The length one authored space name resolves to. */
export function space(name: SpaceName): string {
  return SPACE_VALUES[name];
}

/**
 * The style a component puts on its root: the active theme's custom properties,
 * then its own flow declarations.
 *
 * Every mount is handed the theme's variables, and every root carries them, so
 * a trusted component renders correctly wherever it is mounted — including the
 * Modal frame's portal, which sits outside the screen subtree entirely. The
 * values are identical everywhere they are re-declared, so the cascade is
 * unchanged by the repetition.
 */
export function mountStyle(
  themeVars: Readonly<Record<string, string>>,
  style: FlowStyle,
): CSSProperties {
  return { ...themeVars, ...style };
}

/** A style for an element inside a component, which inherits the root's variables. */
export function flowStyle(style: FlowStyle): CSSProperties {
  return style;
}

/** Reads one prop without trusting the record it came from. */
function readValue(props: ResolvedProps, name: string): unknown {
  try {
    return Object.hasOwn(props, name) ? props[name] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads a prop declared with an `enum` domain, answering the spec's default for
 * anything outside it.
 */
export function enumProp<Value extends string>(
  props: ResolvedProps,
  name: string,
  domain: readonly Value[],
  fallback: Value,
): Value {
  const value = readValue(props, name);
  if (typeof value !== "string") {
    return fallback;
  }
  return domain.find((candidate) => candidate === value) ?? fallback;
}

/** Reads a free-text prop, treating an empty or absent one as nothing to render. */
export function textProp(props: ResolvedProps, name: string): string | undefined {
  const value = readValue(props, name);
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/** Reads a boolean prop, answering the spec's default for anything else. */
export function flagProp(props: ResolvedProps, name: string, fallback: boolean): boolean {
  const value = readValue(props, name);
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Reads a bounded whole-number prop and keeps it inside the declared bounds. A
 * value outside them is clamped rather than refused: the schema has already
 * rejected the authored case, so anything arriving here came from a binding and
 * still has to render something coherent.
 */
export function countProp(
  props: ResolvedProps,
  name: string,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  const value = readValue(props, name);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}
