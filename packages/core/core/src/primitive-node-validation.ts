import {
  ALIGNS,
  APPEARS,
  COLUMNS,
  COLORS,
  DIRECTIONS,
  FONT_FAMILIES,
  FONT_SIZES,
  FONT_WEIGHTS,
  GRADIENTS,
  HIGHLIGHTS,
  JUSTIFIES,
  LEADINGS,
  MAX_WIDTHS,
  MIN_HEIGHTS,
  RADII,
  RATIOS,
  COLOR_SCHEMES,
  SCRIMS,
  SCROLL_AXES,
  SHADOWS,
  SIZINGS,
  SPACES,
  TEXT_ALIGNS,
  TRACKINGS,
} from "./tokens.js";
import {
  FIELD_INPUTS,
  MEDIA_KINDS,
  type BoxStyle,
  type FacetAction,
  type FacetNode,
  type FieldInput,
  type FieldStyle,
  type MediaKind,
  type MediaStyle,
  type TextStyle,
} from "./nodes.js";
import { isComponentNodeType, sanitizeComponentNode } from "./component-validation.js";
import { setColumnRow, setFrom } from "./component-validation-shared.js";
import { sanitizeViewPredicate, type ViewPredicate } from "./view.js";
import { BRICK_REGISTRY, type BrickEntry } from "./brick-registry.js";
import { MAX_FIELD_OPTIONS, MAX_FIELD_VALUE_CHARS } from "./protocol.js";
import {
  isPlainObject as isObject,
  printableKey,
  printableValue,
  type IssueSink,
} from "./issues.js";
import { SLOT_MARKER_RE, SLOT_NAME_RE } from "./slot-marker.js";
import { normalizeFacetAction } from "./action-validation.js";
export { isPrimitiveRecord, sanitizeActionPayload } from "./action-validation.js";

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asBool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asToken<T extends string>(value: unknown, allowed: readonly string[]): T | undefined {
  return typeof value === "string" && allowed.includes(value) ? (value as T) : undefined;
}

function asNumberToken<T extends number>(value: unknown, allowed: readonly T[]): T | undefined {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(numeric) && allowed.includes(numeric as T) ? (numeric as T) : undefined;
}

function isValidSlotName(name: string): boolean {
  return SLOT_NAME_RE.test(name);
}

function isSlotMarker(value: string): boolean {
  return SLOT_MARKER_RE.test(value);
}

/** Only render media from safe URL schemes — never `javascript:`, `data:text/html`, etc. */
export function isSafeMediaSrc(src: string): boolean {
  const s = src.trim().toLowerCase();
  return (
    s.startsWith("https://") ||
    s.startsWith("http://") ||
    s.startsWith("//") ||
    s.startsWith("data:image/") ||
    (s.startsWith("/") && !s.startsWith("//"))
  );
}

function boxStyle(value: unknown, nodeId: string, issues: IssueSink): BoxStyle {
  const style: Record<string, unknown> = {};
  if (isObject(value)) {
    const set = <T extends string>(key: string, allowed: readonly string[]): void => {
      const token = asToken<T>(value[key], allowed);
      if (token !== undefined) style[key] = token;
    };
    set("direction", DIRECTIONS);
    set("gap", SPACES);
    set("pad", SPACES);
    set("align", ALIGNS);
    set("justify", JUSTIFIES);
    set("bg", COLORS);
    set("radius", RADII);
    set("width", SIZINGS);
    set("shadow", SHADOWS);
    // appear/scroll junk is stripped WITH an issue (unlike the legacy tokens
    // above): the words are new, so a wrong value is a teachable agent mistake,
    // not pre-existing content. Echoes are bounded (printableValue/printableKey)
    // — never a raw untrusted value in an issue string.
    const appear = asToken(value.appear, APPEARS);
    if (appear !== undefined) {
      style.appear = appear;
    } else if (value.appear !== undefined) {
      issues.push(
        `node "${printableKey(nodeId)}": unknown appear token ${printableValue(value.appear)} dropped`,
      );
    }
    const scroll = asToken(value.scroll, SCROLL_AXES);
    if (scroll !== undefined) {
      style.scroll = scroll;
    } else if (value.scroll === true) {
      style.scroll = "y";
    } else if (value.scroll !== undefined) {
      issues.push(
        `node "${printableKey(nodeId)}": unknown scroll axis ${printableValue(value.scroll)} dropped`,
      );
    }
    const columns = asNumberToken(value.columns, COLUMNS);
    if (columns !== undefined) {
      style.columns = columns;
    } else if (value.columns !== undefined) {
      issues.push(
        `node "${printableKey(nodeId)}": unknown columns token ${printableValue(value.columns)} dropped`,
      );
    }
    const wrap = asBool(value.wrap);
    if (wrap !== undefined) style.wrap = wrap;
    const border = asBool(value.border);
    if (border !== undefined) style.border = border;
    const grow = asBool(value.grow);
    if (grow !== undefined) style.grow = grow;
    // Landing-grade tokens: like appear/scroll above, a wrong value is a
    // teachable agent mistake, so unknowns drop WITH a (bounded) issue.
    const setStrict = (key: string, allowed: readonly string[]): void => {
      const token = asToken(value[key], allowed);
      if (token !== undefined) {
        style[key] = token;
      } else if (value[key] !== undefined) {
        issues.push(
          `node "${printableKey(nodeId)}": unknown ${key} token ${printableValue(value[key])} dropped`,
        );
      }
    };
    setStrict("minHeight", MIN_HEIGHTS);
    setStrict("maxWidth", MAX_WIDTHS);
    setStrict("gradient", GRADIENTS);
    setStrict("backdropScrim", SCRIMS);
    setStrict("scheme", COLOR_SCHEMES);
    const sticky = asBool(value.sticky);
    if (sticky !== undefined) {
      style.sticky = sticky;
    } else if (value.sticky !== undefined) {
      issues.push(
        `node "${printableKey(nodeId)}": unknown sticky flag ${printableValue(value.sticky)} dropped`,
      );
    }
  }
  return style as BoxStyle;
}

function textStyle(value: unknown, nodeId: string, issues: IssueSink): TextStyle {
  const style: Record<string, unknown> = {};
  if (isObject(value)) {
    const family = asToken(value.family, FONT_FAMILIES);
    if (family !== undefined) style.family = family;
    const size = asToken(value.size, FONT_SIZES);
    if (size !== undefined) style.size = size;
    const weight = asToken(value.weight, FONT_WEIGHTS);
    if (weight !== undefined) style.weight = weight;
    const color = asToken(value.color, COLORS);
    if (color !== undefined) style.color = color;
    const align = asToken(value.align, TEXT_ALIGNS);
    if (align !== undefined) style.align = align;
    // Landing-grade text tokens: unknowns drop WITH a (bounded) issue.
    const setStrict = (key: string, allowed: readonly string[]): void => {
      const token = asToken(value[key], allowed);
      if (token !== undefined) {
        style[key] = token;
      } else if (value[key] !== undefined) {
        issues.push(
          `node "${printableKey(nodeId)}": unknown ${key} token ${printableValue(value[key])} dropped`,
        );
      }
    };
    setStrict("tracking", TRACKINGS);
    setStrict("leading", LEADINGS);
    setStrict("highlight", HIGHLIGHTS);
  }
  return style as TextStyle;
}

function mediaStyle(value: unknown): MediaStyle {
  const style: Record<string, unknown> = {};
  if (isObject(value)) {
    const radius = asToken(value.radius, RADII);
    if (radius !== undefined) style.radius = radius;
    const width = asToken(value.width, SIZINGS);
    if (width !== undefined) style.width = width;
    const ratio = asToken(value.ratio, RATIOS);
    if (ratio !== undefined) style.ratio = ratio;
  }
  return style as MediaStyle;
}

function fieldStyle(value: unknown): FieldStyle | undefined {
  if (!isObject(value)) return undefined;
  const width = asToken<(typeof SIZINGS)[number]>(value.width, SIZINGS);
  return width !== undefined ? { width } : undefined;
}

function fieldOptions(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const options: string[] = [];
  for (const option of value) {
    if (options.length >= MAX_FIELD_OPTIONS) break;
    if (typeof option === "string") {
      options.push(option.slice(0, MAX_FIELD_VALUE_CHARS));
    }
  }
  return options.length > 0 ? options : undefined;
}

export {
  MAX_CHART_POINTS,
  MAX_CHART_SERIES,
  MAX_LIST_ITEMS,
  MAX_NODE_BODY_CHARS,
  MAX_NODE_LABEL_CHARS,
  MAX_TABLE_CELL_CHARS,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  MAX_TABS_ITEMS,
} from "./component-validation-shared.js";
function asVariant(value: unknown, nodeId: string, issues: IssueSink): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && isValidSlotName(value)) return value;
  issues.push(`node "${printableKey(nodeId)}": malformed variant dropped`);
  return undefined;
}

/**
 * Enabler B: sanitize the `active` view-state predicate through the closed
 * `sanitizeViewPredicate` (drops an unknown/future kind WITH an issue), so a
 * hostile/unknown predicate degrades to the default look and never becomes an
 * expression eval.
 */
function setActivePredicate(
  raw: Record<string, unknown>,
  id: string,
  node: { active?: ViewPredicate },
  issues: IssueSink,
): void {
  if (raw.active === undefined) return;
  const active = sanitizeViewPredicate(raw.active);
  if (active !== undefined) {
    node.active = active;
    return;
  }
  issues.push(
    `node "${printableKey(id)}": unknown active predicate ${printableValue(raw.active)} dropped`,
  );
}

export interface SanitizeNodeOptions {
  readonly allowSlotMarkers?: boolean;
}

/**
 * Per-primitive validate handlers. Bodies are the former `sanitizeNode` switch
 * cases verbatim — the brick registry (`brick-registry.ts`) references these so
 * `sanitizeNode` is a registry lookup, not a hardcoded switch. `rawType` carries
 * the original input type so the media handler preserves the `image` alias.
 */
export type PrimitiveValidator = (
  id: string,
  raw: Record<string, unknown>,
  issues: IssueSink,
  options: SanitizeNodeOptions,
  rawType: string,
) => FacetNode | undefined;

// Hoisted function declarations (not const arrows) so the brick registry can
// reference them safely across the registry↔module import cycle.
export function validateBox(
  id: string,
  raw: Record<string, unknown>,
  issues: IssueSink,
): FacetNode | undefined {
  const key = printableKey(id);
  const children = Array.isArray(raw.children)
    ? raw.children.filter((child): child is string => typeof child === "string")
    : [];
  const node: {
    id: string;
    type: "box";
    style: BoxStyle;
    children: string[];
    onPress?: FacetAction;
    onHold?: FacetAction;
    hidden?: boolean;
    variant?: string;
    backdrop?: string;
    activeVariant?: string;
    activeStyle?: BoxStyle;
    active?: ViewPredicate;
  } = { id, type: "box", style: boxStyle(raw.style, id, issues), children };
  const variant = asVariant(raw.variant, id, issues);
  if (variant !== undefined) node.variant = variant;
  // Enabler B active look: `activeVariant` is a recipe name; `activeStyle` runs
  // through the SAME boxStyle() token sanitizer as base `style` (no token
  // bypass); `active` is the closed predicate. All additive optionals.
  const activeVariant = asVariant(raw.activeVariant, id, issues);
  if (activeVariant !== undefined) node.activeVariant = activeVariant;
  if (raw.activeStyle !== undefined) {
    const activeStyle = boxStyle(raw.activeStyle, id, issues);
    if (Object.keys(activeStyle).length > 0) node.activeStyle = activeStyle;
  }
  setActivePredicate(raw, id, node, issues);
  // `backdrop` is a node-id STRING (resolved to a media node fail-safe at
  // render time in WU-6), NOT a token: kept iff a string, else dropped with
  // a (bounded) issue.
  if (typeof raw.backdrop === "string") {
    node.backdrop = raw.backdrop;
  } else if (raw.backdrop !== undefined) {
    issues.push(`node "${key}": backdrop is not a string ${printableValue(raw.backdrop)} dropped`);
  }
  const onPress = normalizeFacetAction(raw.onPress, id, "onPress", issues);
  if (onPress !== undefined) node.onPress = onPress;
  const onHold = normalizeFacetAction(raw.onHold, id, "onHold", issues);
  if (onHold !== undefined) node.onHold = onHold;
  // Only a literal boolean is a visibility default; anything else is stripped
  // (silent, like invalid style tokens — the box just stays visible).
  const hidden = asBool(raw.hidden);
  if (hidden !== undefined) node.hidden = hidden;
  return node;
}

export function validateText(
  id: string,
  raw: Record<string, unknown>,
  issues: IssueSink,
): FacetNode | undefined {
  const key = printableKey(id);
  const value = asString(raw.value);
  if (value === undefined) {
    issues.push(`node "${key}": text has no string value`);
    return undefined;
  }
  const node: {
    id: string;
    type: "text";
    value: string;
    style: TextStyle;
    variant?: string;
    from?: string;
    column?: string;
    row?: number;
    activeVariant?: string;
    activeStyle?: TextStyle;
    active?: ViewPredicate;
  } = {
    id,
    type: "text",
    value,
    style: textStyle(raw.style, id, issues),
  };
  const variant = asVariant(raw.variant, id, issues);
  if (variant !== undefined) node.variant = variant;
  // Enabler A store binding: same name/row-clamp rules as metric/stat.
  setFrom(raw, id, node, issues);
  setColumnRow(raw, node);
  // Enabler B active look: `activeStyle` routes through the SAME textStyle()
  // token sanitizer as base `style`; `active` is the closed predicate.
  const activeVariant = asVariant(raw.activeVariant, id, issues);
  if (activeVariant !== undefined) node.activeVariant = activeVariant;
  if (raw.activeStyle !== undefined) {
    const activeStyle = textStyle(raw.activeStyle, id, issues);
    if (Object.keys(activeStyle).length > 0) node.activeStyle = activeStyle;
  }
  setActivePredicate(raw, id, node, issues);
  return node;
}

export function validateMedia(
  id: string,
  raw: Record<string, unknown>,
  issues: IssueSink,
  options: SanitizeNodeOptions,
  rawType: string,
): FacetNode | undefined {
  const key = printableKey(id);
  const src = asString(raw.src);
  if (src === undefined) {
    issues.push(`node "${key}": media needs a string src`);
    return undefined;
  }
  if (!isSafeMediaSrc(src) && !(options.allowSlotMarkers === true && isSlotMarker(src))) {
    issues.push(`node "${key}": unsafe media src dropped`);
    return undefined;
  }
  const kind =
    rawType === "image"
      ? "image"
      : raw.kind === undefined
        ? "image"
        : asToken<MediaKind>(raw.kind, MEDIA_KINDS);
  if (kind === undefined) {
    issues.push(`node "${key}": unknown media kind ${printableValue(raw.kind)} dropped`);
    return undefined;
  }
  const node: {
    id: string;
    type: "media";
    kind: MediaKind;
    src: string;
    variant?: string;
    alt?: string;
    poster?: string;
    controls?: boolean;
    style: MediaStyle;
  } = { id, type: "media", kind, src, style: mediaStyle(raw.style) };
  const variant = asVariant(raw.variant, id, issues);
  if (variant !== undefined) node.variant = variant;
  const alt = asString(raw.alt);
  node.alt = alt ?? "";
  const poster = asString(raw.poster);
  if (
    poster !== undefined &&
    (isSafeMediaSrc(poster) || (options.allowSlotMarkers === true && isSlotMarker(poster)))
  ) {
    node.poster = poster;
  }
  const controls = asBool(raw.controls);
  if (controls !== undefined) node.controls = controls;
  return node;
}

export function validateField(
  id: string,
  raw: Record<string, unknown>,
  issues: IssueSink,
): FacetNode | undefined {
  const name = asString(raw.name);
  if (name === undefined) {
    issues.push(`node "${printableKey(id)}": field has no name`);
    return undefined;
  }
  const node: {
    id: string;
    type: "field";
    name: string;
    variant?: string;
    input?: FieldInput;
    label?: string;
    placeholder?: string;
    options?: readonly string[];
    style?: FieldStyle;
  } = { id, type: "field", name };
  const variant = asVariant(raw.variant, id, issues);
  if (variant !== undefined) node.variant = variant;
  const input = asToken<FieldInput>(raw.input, FIELD_INPUTS);
  if (input !== undefined) node.input = input;
  const options = fieldOptions(raw.options);
  if (options !== undefined) node.options = options;
  if ((input === "select" || input === "radio") && options === undefined) {
    issues.push(
      `node "${printableKey(id)}": ${printableValue(input)} field has no valid options — rendered control will be empty`,
    );
  }
  const label = asString(raw.label);
  if (label !== undefined) node.label = label;
  const placeholder = asString(raw.placeholder);
  if (placeholder !== undefined) node.placeholder = placeholder;
  // Field style was silently stripped before — kit emits it and the
  // renderer consumes it, so sanitize it through like every other style.
  const style = fieldStyle(raw.style);
  if (style !== undefined) node.style = style;
  return node;
}

export function sanitizeNode(
  id: string,
  raw: unknown,
  issues: IssueSink,
  options: SanitizeNodeOptions = {},
): FacetNode | undefined {
  const key = printableKey(id);
  const type = isObject(raw) ? asString(raw.type) : undefined;
  if (!isObject(raw) || type === undefined) {
    issues.push(`node "${key}": not an object with a type`);
    return undefined;
  }
  if (isComponentNodeType(type)) return sanitizeComponentNode(id, raw, issues, type);
  // The primitive brick registry keys off canonical node types; `image` is an
  // input alias for the `media` primitive (kind defaulted from the raw type).
  const lookupType = type === "image" ? "media" : type;
  const entry = (BRICK_REGISTRY as Record<string, BrickEntry | undefined>)[lookupType];
  if (entry?.validate !== undefined) return entry.validate(id, raw, issues, options, type);
  issues.push(`node "${key}": unknown type "${printableKey(type)}"`);
  return undefined;
}
