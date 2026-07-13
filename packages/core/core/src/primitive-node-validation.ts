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
  SCRIMS,
  SCROLL_AXES,
  SHADOWS,
  SIZINGS,
  SPACES,
  TEXT_ALIGNS,
  TRACKINGS,
} from "./tokens.js";
// `scheme` reuses the pre-existing closed light/dark set from view.ts.
import { SCHEMES } from "./view.js";
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
import { MAX_FIELD_OPTIONS, MAX_FIELD_VALUE_CHARS } from "./protocol.js";
import {
  isPlainObject as isObject,
  printableKey,
  printableValue,
  type IssueSink,
} from "./issues.js";
import { SLOT_MARKER_RE, SLOT_NAME_RE } from "./slot-marker.js";

function isPrimitive(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/**
 * FILTERING form of the action-payload rule: a plain (non-array) object keeps
 * only its primitive-valued entries; anything else yields `undefined`. Used by
 * the fail-safe path (`asAction`) that salvages a partial payload. For the
 * REJECTING form (validators that discard the whole thing on any non-primitive
 * value) use `isPrimitiveRecord`.
 */
export function sanitizeActionPayload(
  value: unknown,
): Record<string, string | number | boolean> | undefined {
  if (!isObject(value)) return undefined;
  const payload: Record<string, string | number | boolean> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (isPrimitive(raw)) payload[key] = raw;
  }
  return payload;
}

/**
 * PREDICATE form of the action-payload rule: true iff `value` is a plain
 * (non-array) object whose every value is a primitive. Unlike
 * `sanitizeActionPayload`, this rejects rather than filters — for callers that
 * discard an action wholesale on any non-primitive value.
 */
export function isPrimitiveRecord(value: unknown): boolean {
  return isObject(value) && Object.values(value).every(isPrimitive);
}

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

/**
 * Normalizes an action value (`onPress`/`onHold`) to the FacetAction union. A
 * bare legacy `{name}` (kind absent) or explicit `kind: "agent"` gets the
 * canonical `kind: "agent"` discriminator SILENTLY (no issue — it is the same action,
 * not a mistake). Malformed or unknown-kind actions are stripped with an issue
 * naming `field` (the node property being normalized), so the box degrades to
 * a plain non-pressable box.
 */
function asAction(
  value: unknown,
  nodeId: string,
  field: "onPress" | "onHold",
  issues: IssueSink,
): FacetAction | undefined {
  const node = printableKey(nodeId);
  if (value === undefined) return undefined;
  if (!isObject(value)) {
    issues.push(`node "${node}": ${field} is not an action object`);
    return undefined;
  }
  const kind = value.kind;
  if (kind === undefined || kind === "agent") {
    const name = asString(value.name);
    if (name === undefined) {
      issues.push(`node "${node}": ${field} agent action has no string name`);
      return undefined;
    }
    const action: {
      kind: "agent";
      name: string;
      payload?: Record<string, string | number | boolean>;
      collect?: string;
    } = { kind: "agent", name };
    const payload = sanitizeActionPayload(value.payload);
    if (payload !== undefined) {
      action.payload = payload;
    }
    if (typeof value.collect === "string") {
      action.collect = value.collect;
    } else if (value.collect !== undefined) {
      issues.push(`node "${node}": ${field} collect is not a string; dropped`);
    }
    return action;
  }
  if (kind === "navigate") {
    const to = asString(value.to);
    if (to === undefined) {
      issues.push(`node "${node}": ${field} navigate action needs a string "to"`);
      return undefined;
    }
    return { kind: "navigate", to };
  }
  if (kind === "toggle") {
    const target = asString(value.target);
    if (target === undefined) {
      issues.push(`node "${node}": ${field} toggle action needs a string "target"`);
      return undefined;
    }
    return { kind: "toggle", target };
  }
  // `kind` is untrusted (any property of an isObject-checked action): a string
  // goes through the key cap, primitives echo verbatim, and everything else
  // becomes a constant placeholder — NEVER JSON.stringify an arbitrary untrusted
  // value into an issue string (a cyclic object/BigInt would throw, breaching
  // the never-throws boundary; a huge value would flood the operator log).
  issues.push(`node "${node}": unknown ${field} kind ${printableValue(kind)} dropped`);
  return undefined;
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
    setStrict("scheme", SCHEMES);
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
} from "./classic-component-validation.js";
function asVariant(value: unknown, nodeId: string, issues: IssueSink): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && isValidSlotName(value)) return value;
  issues.push(`node "${printableKey(nodeId)}": malformed variant dropped`);
  return undefined;
}

export interface SanitizeNodeOptions {
  readonly allowSlotMarkers?: boolean;
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
  switch (type) {
    case "box": {
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
      } = { id, type: "box", style: boxStyle(raw.style, id, issues), children };
      const variant = asVariant(raw.variant, id, issues);
      if (variant !== undefined) node.variant = variant;
      // `backdrop` is a node-id STRING (resolved to a media node fail-safe at
      // render time in WU-6), NOT a token: kept iff a string, else dropped with
      // a (bounded) issue.
      if (typeof raw.backdrop === "string") {
        node.backdrop = raw.backdrop;
      } else if (raw.backdrop !== undefined) {
        issues.push(
          `node "${key}": backdrop is not a string ${printableValue(raw.backdrop)} dropped`,
        );
      }
      const onPress = asAction(raw.onPress, id, "onPress", issues);
      if (onPress !== undefined) node.onPress = onPress;
      const onHold = asAction(raw.onHold, id, "onHold", issues);
      if (onHold !== undefined) node.onHold = onHold;
      // Only a literal boolean is a visibility default; anything else is stripped
      // (silent, like invalid style tokens — the box just stays visible).
      const hidden = asBool(raw.hidden);
      if (hidden !== undefined) node.hidden = hidden;
      return node;
    }
    case "text": {
      const value = asString(raw.value);
      if (value === undefined) {
        issues.push(`node "${key}": text has no string value`);
        return undefined;
      }
      const node: { id: string; type: "text"; value: string; style: TextStyle; variant?: string } =
        {
          id,
          type: "text",
          value,
          style: textStyle(raw.style, id, issues),
        };
      const variant = asVariant(raw.variant, id, issues);
      if (variant !== undefined) node.variant = variant;
      return node;
    }
    case "image":
    case "media": {
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
        type === "image"
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
    case "field": {
      const name = asString(raw.name);
      if (name === undefined) {
        issues.push(`node "${key}": field has no name`);
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
    default:
      issues.push(`node "${key}": unknown type "${printableKey(type)}"`);
      return undefined;
  }
}
