import {
  ALIGNS,
  APPEARS,
  COLUMNS,
  COLORS,
  DIRECTIONS,
  FONT_FAMILIES,
  FONT_SIZES,
  FONT_WEIGHTS,
  JUSTIFIES,
  RADII,
  RATIOS,
  SCROLL_AXES,
  SHADOWS,
  SIZINGS,
  SPACES,
  TEXT_ALIGNS,
} from "./tokens.js";
import {
  CHART_KINDS,
  COMPONENT_NODE_TYPES,
  FIELD_INPUTS,
  MEDIA_KINDS,
  TONES,
  isContainer,
  type BoxStyle,
  type ChartKind,
  type FacetAction,
  type FacetNode,
  type FieldInput,
  type FieldStyle,
  type MediaKind,
  type MediaStyle,
  type NodeId,
  type TableCell,
  type TableRow,
  type TextStyle,
  type Tone,
} from "./nodes.js";
import {
  isComponentNodeType,
  isPrimitiveBrickType,
  sanitizeComponentNode,
} from "./component-validation.js";
import { MAX_FIELD_OPTIONS, MAX_FIELD_VALUE_CHARS } from "./protocol.js";
import { EMPTY_TREE, type FacetTree } from "./tree.js";
import { isValidThemeName, MAX_DESCRIPTION_LENGTH } from "./theme.js";
import {
  BoundedIssues,
  boundedDescription,
  isControlChar,
  isForbiddenKey,
  isPlainObject as isObject,
  nullMap,
  printableKey,
  printableValue,
  type IssueSink,
} from "./issues.js";
import { SLOT_MARKER_RE, SLOT_NAME_RE } from "./slot-marker.js";
export { SLOT_MARKER_RE, SLOT_NAME_RE } from "./slot-marker.js";

/**
 * Turns arbitrary input (e.g. an LLM's JSON, which may be malformed, use unknown
 * node types, or invent style values) into a GUARANTEED-VALID FacetTree.
 *
 * This is the fail-safe boundary for untrusted stage sources: unknown node types
 * are dropped, invalid style tokens are stripped, dangling child references are
 * removed, and if there's no usable root it returns an empty tree. It never
 * throws and always returns a renderable tree, plus a list of issues so a caller
 * (like the CLI generator) can report what the agent got wrong.
 */
export interface ValidationResult {
  readonly tree: FacetTree;
  readonly issues: readonly string[];
}

/**
 * Max stage nesting depth — beyond this, children are dropped (fail-safe, no
 * stack overflow). Single source of truth: the @facet/react renderer imports
 * this (barrel-reachable via `export * from "./validate.js"`) to cap its own
 * recursion at the same bound, so validation and render never disagree.
 */
export const MAX_DEPTH = 100;

/**
 * Max total nodes a validated tree may carry before it is flagged. Single source
 * of truth: the @facet/react renderer imports this to size its per-pass render
 * budget, so the validator's acceptance and the renderer's budget agree — a tree
 * the validator declares clean can't then render permanently truncated with no
 * diagnostic. validateTree does NOT drop nodes past the cap (a patch stream
 * accumulates them legitimately); it warns so an operator sees the tree crossed
 * the size the renderer will truncate at.
 */
export const MAX_RENDER_NODES = 5000;

/**
 * Max named screens kept per tree. Beyond this, extra screens are dropped with
 * an issue: each kept screen is a fresh walk root for `breakCycles`, so an
 * unbounded screens count would make validateTree O(screens × nodes) — a cheap
 * CPU-exhaustion input on the synchronous per-visitor save path.
 */
export const MAX_SCREENS = 100;

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
  }
  return style as BoxStyle;
}

function textStyle(value: unknown): TextStyle {
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

export const MAX_NODE_LABEL_CHARS = 200;
export const MAX_NODE_BODY_CHARS = 1000;
export const MAX_TABLE_COLUMNS = 12;
export const MAX_TABLE_ROWS = 100;
export const MAX_TABLE_CELL_CHARS = 200;
export const MAX_CHART_SERIES = 8;
export const MAX_CHART_POINTS = 200;
export const MAX_LIST_ITEMS = 50;
export const MAX_TABS_ITEMS = 12;
const MAX_COMPOSITION_METADATA_ITEMS = 16;
const MAX_COMPOSITION_NODES = 1023;

const LEGACY_COMPOSITION_NODE_TYPES = ["image"] as const;

const FORBIDDEN_COMPOSITION_FIELDS = [
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

function boundedString(
  value: unknown,
  nodeId: string,
  field: string,
  max: number,
  issues: IssueSink,
): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value.length <= max) return value;
  issues.push(`node "${printableKey(nodeId)}": ${field} truncated to ${max} characters`);
  return value.slice(0, max);
}

function asVariant(value: unknown, nodeId: string, issues: IssueSink): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && isValidSlotName(value)) return value;
  issues.push(`node "${printableKey(nodeId)}": malformed variant dropped`);
  return undefined;
}

function asTone(value: unknown, nodeId: string, issues: IssueSink): Tone | undefined {
  if (value === undefined) return undefined;
  const tone = asToken<Tone>(value, TONES);
  if (tone !== undefined) return tone;
  issues.push(`node "${printableKey(nodeId)}": unknown tone ${printableValue(value)} dropped`);
  return undefined;
}

function childRefs(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((child): child is string => typeof child === "string")
    : [];
}

function capArray<T>(
  values: readonly T[],
  max: number,
  nodeId: string,
  field: string,
  issues: IssueSink,
): readonly T[] {
  if (values.length <= max) return values;
  issues.push(
    `node "${printableKey(nodeId)}": ${field} exceeded the ${max}-item cap; extra items dropped`,
  );
  return values.slice(0, max);
}

function tableColumns(
  value: unknown,
  nodeId: string,
  issues: IssueSink,
): readonly {
  key: string;
  label: string;
  align?: "start" | "center" | "end";
}[] {
  if (!Array.isArray(value)) return [];
  const columns: { key: string; label: string; align?: "start" | "center" | "end" }[] = [];
  const capped = capArray(value, MAX_TABLE_COLUMNS, nodeId, "columns", issues);
  for (const raw of capped) {
    if (!isObject(raw)) continue;
    const key = typeof raw.key === "string" && isValidSlotName(raw.key) ? raw.key : undefined;
    const label = boundedString(raw.label, nodeId, "column label", MAX_NODE_LABEL_CHARS, issues);
    if (key === undefined || label === undefined) continue;
    const column: { key: string; label: string; align?: "start" | "center" | "end" } = {
      key,
      label,
    };
    const align = asToken<"start" | "center" | "end">(raw.align, TEXT_ALIGNS);
    if (align !== undefined) column.align = align;
    columns.push(column);
  }
  return columns;
}

function tableCell(value: unknown, nodeId: string, issues: IssueSink): TableCell | undefined {
  if (typeof value === "string") {
    if (value.length <= MAX_TABLE_CELL_CHARS) return value;
    issues.push(
      `node "${printableKey(nodeId)}": table cell truncated to ${MAX_TABLE_CELL_CHARS} characters`,
    );
    return value.slice(0, MAX_TABLE_CELL_CHARS);
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  return undefined;
}

function tableRows(
  value: unknown,
  columns: readonly { key: string }[],
  nodeId: string,
  issues: IssueSink,
): readonly TableRow[] {
  if (!Array.isArray(value) || columns.length === 0) return [];
  const rows: TableRow[] = [];
  const capped = capArray(value, MAX_TABLE_ROWS, nodeId, "rows", issues);
  for (const raw of capped) {
    if (!isObject(raw)) continue;
    const row: Record<string, TableCell> = nullMap<TableCell>();
    for (const column of columns) {
      const cell = tableCell(raw[column.key], nodeId, issues);
      if (cell !== undefined) row[column.key] = cell;
    }
    rows.push(row);
  }
  return rows;
}

function chartSeries(
  value: unknown,
  nodeId: string,
  issues: IssueSink,
): readonly {
  label: string;
  values: readonly number[];
}[] {
  if (!Array.isArray(value)) return [];
  const out: { label: string; values: readonly number[] }[] = [];
  const cappedSeries = capArray(value, MAX_CHART_SERIES, nodeId, "series", issues);
  for (const raw of cappedSeries) {
    if (!isObject(raw)) continue;
    const label = boundedString(raw.label, nodeId, "series label", MAX_NODE_LABEL_CHARS, issues);
    if (label === undefined || !Array.isArray(raw.values)) continue;
    const cappedValues = capArray(raw.values, MAX_CHART_POINTS, nodeId, "points", issues);
    const values: number[] = [];
    for (const point of cappedValues) {
      if (typeof point === "number" && Number.isFinite(point)) values.push(point);
    }
    out.push({ label, values });
  }
  return out;
}

function stringList(
  value: unknown,
  nodeId: string,
  field: string,
  issues: IssueSink,
): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const kept: string[] = [];
  const capped = capArray(value, MAX_CHART_POINTS, nodeId, field, issues);
  for (const raw of capped) {
    const label = boundedString(raw, nodeId, field, MAX_NODE_LABEL_CHARS, issues);
    if (label !== undefined) kept.push(label);
  }
  return kept.length > 0 ? kept : undefined;
}

function listItems(
  value: unknown,
  nodeId: string,
  issues: IssueSink,
): readonly {
  title: string;
  body?: string;
}[] {
  if (!Array.isArray(value)) return [];
  const items: { title: string; body?: string }[] = [];
  const capped = capArray(value, MAX_LIST_ITEMS, nodeId, "items", issues);
  for (const raw of capped) {
    if (typeof raw === "string") {
      items.push({ title: raw.slice(0, MAX_NODE_LABEL_CHARS) });
      continue;
    }
    if (!isObject(raw)) continue;
    const title = boundedString(raw.title, nodeId, "item title", MAX_NODE_LABEL_CHARS, issues);
    if (title === undefined) continue;
    const item: { title: string; body?: string } = { title };
    const body = boundedString(raw.body, nodeId, "item body", MAX_NODE_BODY_CHARS, issues);
    if (body !== undefined) item.body = body;
    items.push(item);
  }
  return items;
}

function progressValue(value: unknown, nodeId: string, issues: IssueSink): number {
  const raw = typeof value === "number" && Number.isFinite(value) ? value : 0;
  const clamped = Math.min(100, Math.max(0, raw));
  if (clamped !== raw) {
    issues.push(`node "${printableKey(nodeId)}": progress value clamped to ${String(clamped)}`);
  }
  return clamped;
}

interface SanitizeNodeOptions {
  readonly allowSlotMarkers?: boolean;
}

function sanitizeNode(
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
      } = { id, type: "box", style: boxStyle(raw.style, id, issues), children };
      const variant = asVariant(raw.variant, id, issues);
      if (variant !== undefined) node.variant = variant;
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
          style: textStyle(raw.style),
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
    case "button": {
      const label = boundedString(raw.label, id, "label", MAX_NODE_LABEL_CHARS, issues);
      if (label === undefined) {
        issues.push(`node "${key}": button has no string label`);
        return undefined;
      }
      const node: {
        id: string;
        type: "button";
        label: string;
        variant?: string;
        tone?: Tone;
        disabled?: boolean;
        onPress?: FacetAction;
        onHold?: FacetAction;
      } = { id, type: "button", label };
      const variant = asVariant(raw.variant, id, issues);
      if (variant !== undefined) node.variant = variant;
      const tone = asTone(raw.tone, id, issues);
      if (tone !== undefined) node.tone = tone;
      const disabled = asBool(raw.disabled);
      if (disabled !== undefined) node.disabled = disabled;
      const onPress = asAction(raw.onPress, id, "onPress", issues);
      if (onPress !== undefined) node.onPress = onPress;
      const onHold = asAction(raw.onHold, id, "onHold", issues);
      if (onHold !== undefined) node.onHold = onHold;
      return node;
    }
    case "section": {
      const node: {
        id: string;
        type: "section";
        title?: string;
        eyebrow?: string;
        body?: string;
        variant?: string;
        children: string[];
      } = { id, type: "section", children: childRefs(raw.children) };
      const title = boundedString(raw.title, id, "title", MAX_NODE_LABEL_CHARS, issues);
      if (title !== undefined) node.title = title;
      const eyebrow = boundedString(raw.eyebrow, id, "eyebrow", MAX_NODE_LABEL_CHARS, issues);
      if (eyebrow !== undefined) node.eyebrow = eyebrow;
      const body = boundedString(raw.body, id, "body", MAX_NODE_BODY_CHARS, issues);
      if (body !== undefined) node.body = body;
      const variant = asVariant(raw.variant, id, issues);
      if (variant !== undefined) node.variant = variant;
      return node;
    }
    case "card": {
      const node: {
        id: string;
        type: "card";
        title?: string;
        body?: string;
        variant?: string;
        tone?: Tone;
        onPress?: FacetAction;
        onHold?: FacetAction;
        children: string[];
      } = { id, type: "card", children: childRefs(raw.children) };
      const title = boundedString(raw.title, id, "title", MAX_NODE_LABEL_CHARS, issues);
      if (title !== undefined) node.title = title;
      const body = boundedString(raw.body, id, "body", MAX_NODE_BODY_CHARS, issues);
      if (body !== undefined) node.body = body;
      const variant = asVariant(raw.variant, id, issues);
      if (variant !== undefined) node.variant = variant;
      const tone = asTone(raw.tone, id, issues);
      if (tone !== undefined) node.tone = tone;
      const onPress = asAction(raw.onPress, id, "onPress", issues);
      if (onPress !== undefined) node.onPress = onPress;
      const onHold = asAction(raw.onHold, id, "onHold", issues);
      if (onHold !== undefined) node.onHold = onHold;
      return node;
    }
    case "tabs": {
      const items: { label: string; to: string }[] = [];
      if (Array.isArray(raw.items)) {
        const capped = capArray(raw.items, MAX_TABS_ITEMS, id, "items", issues);
        for (const item of capped) {
          if (!isObject(item)) continue;
          const label = boundedString(item.label, id, "tab label", MAX_NODE_LABEL_CHARS, issues);
          const to = asString(item.to);
          if (label !== undefined && to !== undefined) items.push({ label, to });
        }
      }
      const node: {
        id: string;
        type: "tabs";
        items: { label: string; to: string }[];
        variant?: string;
      } = {
        id,
        type: "tabs",
        items,
      };
      const variant = asVariant(raw.variant, id, issues);
      if (variant !== undefined) node.variant = variant;
      return node;
    }
    case "table": {
      const columns = tableColumns(raw.columns, id, issues);
      const node: {
        id: string;
        type: "table";
        columns: typeof columns;
        rows: readonly TableRow[];
        caption?: string;
        variant?: string;
      } = { id, type: "table", columns, rows: tableRows(raw.rows, columns, id, issues) };
      const caption = boundedString(raw.caption, id, "caption", MAX_NODE_LABEL_CHARS, issues);
      if (caption !== undefined) node.caption = caption;
      const variant = asVariant(raw.variant, id, issues);
      if (variant !== undefined) node.variant = variant;
      return node;
    }
    case "chart": {
      const kind = asToken<ChartKind>(raw.kind, CHART_KINDS) ?? "bar";
      const node: {
        id: string;
        type: "chart";
        kind: ChartKind;
        series: ReturnType<typeof chartSeries>;
        labels?: readonly string[];
        title?: string;
        variant?: string;
      } = { id, type: "chart", kind, series: chartSeries(raw.series, id, issues) };
      const labels = stringList(raw.labels, id, "labels", issues);
      if (labels !== undefined) node.labels = labels;
      const title = boundedString(raw.title, id, "title", MAX_NODE_LABEL_CHARS, issues);
      if (title !== undefined) node.title = title;
      const variant = asVariant(raw.variant, id, issues);
      if (variant !== undefined) node.variant = variant;
      return node;
    }
    case "stat": {
      const label = boundedString(raw.label, id, "label", MAX_NODE_LABEL_CHARS, issues);
      const value = boundedString(raw.value, id, "value", MAX_NODE_LABEL_CHARS, issues);
      if (label === undefined || value === undefined) {
        issues.push(`node "${key}": stat needs string label and value`);
        return undefined;
      }
      const node: {
        id: string;
        type: "stat";
        label: string;
        value: string;
        delta?: string;
        tone?: Tone;
        variant?: string;
      } = { id, type: "stat", label, value };
      const delta = boundedString(raw.delta, id, "delta", MAX_NODE_LABEL_CHARS, issues);
      if (delta !== undefined) node.delta = delta;
      const tone = asTone(raw.tone, id, issues);
      if (tone !== undefined) node.tone = tone;
      const variant = asVariant(raw.variant, id, issues);
      if (variant !== undefined) node.variant = variant;
      return node;
    }
    case "badge": {
      const label = boundedString(raw.label, id, "label", MAX_NODE_LABEL_CHARS, issues);
      if (label === undefined) {
        issues.push(`node "${key}": badge has no string label`);
        return undefined;
      }
      const node: { id: string; type: "badge"; label: string; tone?: Tone; variant?: string } = {
        id,
        type: "badge",
        label,
      };
      const tone = asTone(raw.tone, id, issues);
      if (tone !== undefined) node.tone = tone;
      const variant = asVariant(raw.variant, id, issues);
      if (variant !== undefined) node.variant = variant;
      return node;
    }
    case "progress": {
      const node: {
        id: string;
        type: "progress";
        value: number;
        label?: string;
        tone?: Tone;
        variant?: string;
      } = { id, type: "progress", value: progressValue(raw.value, id, issues) };
      const label = boundedString(raw.label, id, "label", MAX_NODE_LABEL_CHARS, issues);
      if (label !== undefined) node.label = label;
      const tone = asTone(raw.tone, id, issues);
      if (tone !== undefined) node.tone = tone;
      const variant = asVariant(raw.variant, id, issues);
      if (variant !== undefined) node.variant = variant;
      return node;
    }
    case "alert": {
      const body = boundedString(raw.body, id, "body", MAX_NODE_BODY_CHARS, issues);
      if (body === undefined) {
        issues.push(`node "${key}": alert has no string body`);
        return undefined;
      }
      const node: {
        id: string;
        type: "alert";
        body: string;
        title?: string;
        tone?: Tone;
        variant?: string;
      } = { id, type: "alert", body };
      const title = boundedString(raw.title, id, "title", MAX_NODE_LABEL_CHARS, issues);
      if (title !== undefined) node.title = title;
      const tone = asTone(raw.tone, id, issues);
      if (tone !== undefined) node.tone = tone;
      const variant = asVariant(raw.variant, id, issues);
      if (variant !== undefined) node.variant = variant;
      return node;
    }
    case "list": {
      const node: {
        id: string;
        type: "list";
        items: ReturnType<typeof listItems>;
        variant?: string;
      } = { id, type: "list", items: listItems(raw.items, id, issues) };
      const variant = asVariant(raw.variant, id, issues);
      if (variant !== undefined) node.variant = variant;
      return node;
    }
    case "divider": {
      const node: { id: string; type: "divider"; label?: string; variant?: string } = {
        id,
        type: "divider",
      };
      const label = boundedString(raw.label, id, "label", MAX_NODE_LABEL_CHARS, issues);
      if (label !== undefined) node.label = label;
      const variant = asVariant(raw.variant, id, issues);
      if (variant !== undefined) node.variant = variant;
      return node;
    }
    case "metric":
    case "keyValue":
    case "nav":
    case "form":
    case "search":
    case "filterBar":
    case "emptyState":
    case "loading":
      return sanitizeComponentNode(id, raw, issues);
    default:
      issues.push(`node "${key}": unknown type "${printableKey(type)}"`);
      return undefined;
  }
}

/**
 * Sanitizes screens: keep only entries whose value is a string naming an
 * existing container node (a screen root must be renderable as a root). Zero
 * survivors ⇒ both fields come back undefined and the tree stays the plain
 * single-screen form. entry must name a kept screen, else fall back to the
 * first kept key so a kept screens map always ships a valid entry.
 */
function sanitizeScreens(
  rawScreens: unknown,
  rawEntry: unknown,
  nodes: Readonly<Record<string, FacetNode>>,
  issues: IssueSink,
): { screens?: Record<string, string>; entry?: string } {
  if (rawScreens === undefined) return {};
  if (!isObject(rawScreens)) {
    issues.push("screens is not an object map; dropped");
    return {};
  }
  // Null-prototype accumulator, matching sanitizeNodeMap: with a plain literal a
  // screen keyed "__proto__" would hit the inherited setter (silent no-op) and
  // an `entry` naming an Object.prototype member ("constructor"/"toString") would
  // resolve through the chain and ship an entry that names no kept screen.
  const kept: Record<string, string> = nullMap<string>();
  let keptCount = 0;
  let capped = false;
  for (const [name, target] of Object.entries(rawScreens)) {
    const screen = printableKey(name);
    // Forbidden screen names dropped WITH an issue (mirrors sanitizeNodeMap's
    // forbidden-id policy) rather than silently mutating the accumulator.
    if (isForbiddenKey(name)) {
      issues.push(`screen "${screen}": forbidden screen name dropped`);
      continue;
    }
    if (keptCount >= MAX_SCREENS) {
      capped = true;
      break;
    }
    if (typeof target !== "string") {
      issues.push(`screen "${screen}": target is not a node id string; dropped`);
      continue;
    }
    const node = nodes[target];
    if (node === undefined) {
      issues.push(`screen "${screen}": target "${printableKey(target)}" does not exist; dropped`);
      continue;
    }
    if (!isContainer(node)) {
      issues.push(
        `screen "${screen}": target "${printableKey(target)}" is not a container; dropped`,
      );
      continue;
    }
    kept[name] = target;
    keptCount += 1;
  }
  if (capped) {
    issues.push(`screens exceeded the ${MAX_SCREENS}-screen cap; extra screens dropped`);
  }
  const firstKey = Object.keys(kept)[0];
  if (firstKey === undefined) return {};
  const entry = asString(rawEntry);
  if (entry !== undefined && kept[entry] !== undefined) {
    return { screens: kept, entry };
  }
  // Only report the fallback when an entry was actually SUPPLIED. `entry?` is a
  // legal optional on FacetTree, so an omitted entry is a valid shape, not a
  // mistake — silently default it to the first kept screen. Guard on the RAW
  // input (not `entry`) so a present-but-non-string entry still gets the
  // diagnostic while the legal omitted-entry case stays quiet.
  if (rawEntry !== undefined) {
    issues.push(`entry does not name a kept screen; falling back to "${printableKey(firstKey)}"`);
  }
  return { screens: kept, entry: firstKey };
}

/**
 * Sanitizes a raw `nodes` map into a null-prototype accumulator of kept nodes.
 *
 * Null-prototype: with a plain object literal, a node keyed "__proto__" would
 * ASSIGN the map's [[Prototype]] instead of storing a node (silently losing it
 * and making dangling-child lookups resolve through the prototype chain). Such
 * ids are also dropped outright — patch pointers to them are forbidden anyway,
 * so they'd be unreachable. Shared by `validateTree` and `validateComposition` so the
 * brick-shape + token-membership sanitization is derived once, not twice.
 */
function sanitizeNodeMap(
  rawNodes: Record<string, unknown>,
  issues: IssueSink,
  options: SanitizeNodeOptions = {},
): Record<string, FacetNode> {
  const nodes: Record<string, FacetNode> = nullMap<FacetNode>();
  for (const [id, raw] of Object.entries(rawNodes)) {
    if (id === "") {
      issues.push('node "": empty node id dropped');
      continue;
    }
    if (isForbiddenKey(id)) {
      issues.push(`node "${printableKey(id)}": forbidden node id dropped`);
      continue;
    }
    const node = sanitizeNode(id, raw, issues, options);
    if (node !== undefined) {
      nodes[id] = node;
    }
  }
  return nodes;
}

/**
 * Drops child references that point at nodes we couldn't keep, and dedupes
 * duplicate siblings (a child id may appear at most once under one parent —
 * keep the first occurrence). A dup would otherwise render the same subtree
 * twice and make patch pointers to it ambiguous. Mutates `nodes` in place.
 */
function pruneDanglingChildren(nodes: Record<string, FacetNode>, issues: IssueSink): void {
  for (const node of Object.values(nodes)) {
    if (isContainer(node)) {
      const seen = new Set<string>();
      const kept: string[] = [];
      let dangling = false;
      for (const child of node.children) {
        if (nodes[child] === undefined) {
          dangling = true;
          continue;
        }
        if (seen.has(child)) {
          issues.push(
            `node "${printableKey(node.id)}": removed duplicate sibling child "${printableKey(child)}"`,
          );
          continue;
        }
        seen.add(child);
        kept.push(child);
      }
      if (dangling) {
        issues.push(`node "${printableKey(node.id)}": removed dangling child references`);
      }
      if (kept.length !== node.children.length) {
        nodes[node.id] = { ...node, children: kept };
      }
    }
  }
}

/**
 * Breaks cycles AND collapses shared children so the sanitized graph is a true
 * tree (invariant #2): a child ref pointing back to an ancestor is dropped (it
 * would recurse forever), depth is capped at MAX_DEPTH (a pathologically deep
 * input can't blow the stack), and — critically — a child already kept under
 * another parent in the SAME walk is dropped. Without that last rule a
 * shared-child DAG stays acyclic and validates clean, but has an exponential
 * number of root-to-node PATHS, so the renderer (which caps depth only)
 * instantiates 2^depth elements and hangs the tab.
 *
 * Single-parent is enforced PER WALK ROOT: `claimed` resets at the start of each
 * root's DFS (the roots are the tree root plus each kept screen root; a composition
 * passes its single fragment root). This is deliberate — two screens legitimately
 * SHARE a node (a common header/footer), so a global claim would strip the ref
 * from the second screen and break the pre-drawn-screens feature. Path explosion
 * only matters within one render pass (one root); across roots a node may still
 * be kept under multiple different walk roots. Mutates `nodes` in place.
 */
function breakCycles(
  nodes: Record<string, FacetNode>,
  roots: readonly string[],
  issues: IssueSink,
): { worstRoot: string; maxReachable: number } {
  const inPath = new Set<string>();
  // Nodes kept under some parent during the CURRENT root's walk. Reset per root
  // so cross-screen sharing survives; within one walk, `claimed` also prevents
  // re-visiting a subtree, keeping validation linear with no separate settled set.
  let claimed = new Set<string>();
  const visit = (nodeId: string, depth: number): void => {
    const node = nodes[nodeId];
    if (node === undefined || !isContainer(node)) {
      return;
    }
    inPath.add(nodeId);
    const kept: string[] = [];
    for (const child of node.children) {
      if (inPath.has(child)) {
        issues.push(
          `node "${printableKey(nodeId)}": removed cyclic child "${printableKey(child)}"`,
        );
        continue;
      }
      if (depth >= MAX_DEPTH) {
        issues.push(
          `node "${printableKey(nodeId)}": dropped child "${printableKey(child)}" beyond max depth`,
        );
        continue;
      }
      if (claimed.has(child)) {
        issues.push(
          `node "${printableKey(nodeId)}": removed shared child "${printableKey(child)}" (already kept under another parent)`,
        );
        continue;
      }
      claimed.add(child);
      kept.push(child);
      visit(child, depth + 1);
    }
    if (kept.length !== node.children.length) {
      nodes[nodeId] = { ...node, children: kept };
    }
    inPath.delete(nodeId);
  };
  // Track the heaviest render root: the renderer spends a fresh budget per pass on
  // the CURRENT screen's subtree, so what matters for truncation is the MOST nodes
  // any single root reaches, not the whole map. Reachable = the root itself plus
  // every child claimed during its walk (shared nodes counted per root, matching
  // the renderer, which re-instantiates a shared node in each screen it appears in).
  let worstRoot = roots[0] ?? "";
  let maxReachable = 0;
  for (const root of roots) {
    claimed = new Set<string>();
    visit(root, 0);
    const reachable = claimed.size + (nodes[root] !== undefined ? 1 : 0);
    if (reachable > maxReachable) {
      maxReachable = reachable;
      worstRoot = root;
    }
  }
  return { worstRoot, maxReachable };
}

export function validateTree(input: unknown): ValidationResult {
  const issues = new BoundedIssues();
  try {
    return validateTreeUnsafe(input, issues);
  } catch {
    issues.push("input could not be read safely; empty tree used");
    return { tree: EMPTY_TREE, issues: issues.list };
  }
}

function validateTreeUnsafe(input: unknown, issues: BoundedIssues): ValidationResult {
  if (!isObject(input) || !isObject(input.nodes)) {
    issues.push("input is not a tree object with a nodes map");
    return { tree: EMPTY_TREE, issues: issues.list };
  }

  const nodes = sanitizeNodeMap(input.nodes, issues);
  pruneDanglingChildren(nodes, issues);

  const explicitRoot = typeof input.root === "string" && nodes[input.root] !== undefined;
  const rootId = explicitRoot
    ? (input.root as string)
    : nodes["root"] !== undefined
      ? "root"
      : undefined;
  // A dangling/absent `input.root` that we salvaged by falling back to the node
  // keyed "root" is a stored-vs-live divergence the fail-safe renderer does NOT
  // reproduce (its isRenderableTree goes blank on the dangling id), so surface
  // it as an issue instead of falling back silently — the runtime logs it and
  // converges live tabs on this recovered root.
  if (!explicitRoot && rootId === "root" && input.root !== undefined) {
    // `input.root` is untrusted: a bounded, never-throwing echo — a cyclic object
    // or BigInt handed in via the public API would make JSON.stringify throw
    // (breaching the never-throws boundary), and a huge value would flood the
    // runtime's save-time console.error. printableValue quotes a capped string
    // and collapses anything else to a constant placeholder.
    issues.push(`root ${printableValue(input.root)} not found; fell back to "root"`);
  }

  const rootNode = rootId === undefined ? undefined : nodes[rootId];
  if (rootId === undefined || rootNode === undefined) {
    issues.push("no valid root node");
    return { tree: EMPTY_TREE, issues: issues.list };
  }
  if (!isContainer(rootNode)) {
    issues.push("root node must be a container");
    return { tree: EMPTY_TREE, issues: issues.list };
  }

  const { screens, entry } = sanitizeScreens(input.screens, input.entry, nodes, issues);

  // Dedupe the walk roots: several screens may target the SAME box, and a screen
  // may target the tree root — breakCycles resets its claim set per root, so
  // rewalking a repeated root is redundant work (its subtree is already pruned).
  const walkRoots = Array.from(
    new Set([rootId, ...(screens !== undefined ? Object.values(screens) : [])]),
  );
  const { worstRoot, maxReachable } = breakCycles(nodes, walkRoots, issues);

  // The renderer truncates a PASS at MAX_RENDER_NODES nodes, and a pass renders one
  // render root's subtree — so warn when the heaviest single root crosses the cap,
  // not when the whole node map does. A multi-screen tree whose total exceeds the
  // cap but whose every screen fits renders fully; warning on the map total would
  // be a false diagnostic. This keeps the guarantee bidirectional: a clean verdict
  // means no screen can render truncated, a warning means one actually will.
  if (maxReachable > MAX_RENDER_NODES) {
    issues.push(
      `render root "${printableKey(worstRoot)}" reaches ${maxReachable} nodes; a render pass will truncate past ${MAX_RENDER_NODES}`,
    );
  }

  const tree: {
    root: string;
    nodes: Record<string, FacetNode>;
    theme?: string;
    screens?: Record<string, string>;
    entry?: string;
  } = { root: rootId, nodes };
  // Keep the theme NAME only when it is a string that passes the theme-name rule
  // (`isValidThemeName`, the same floor `validateTheme` applies to a document's
  // own name) — otherwise it is dropped with an issue (else the save-time
  // re-validate at runtime.ts would strip it silently). This caps an untrusted
  // writer (a prompt-injected model, a visitor) at 64 chars of `[a-zA-Z0-9_-]`
  // so an unbounded or control-character name can't be stored and re-shipped in
  // every rehydrate/replay frame. Styles stay tokens — the tree never carries a
  // CSS value.
  if (typeof input.theme === "string" && isValidThemeName(input.theme)) {
    tree.theme = input.theme;
  } else if (input.theme !== undefined) {
    issues.push("theme is not a valid theme name; dropped");
  }
  if (screens !== undefined && entry !== undefined) {
    tree.screens = screens;
    tree.entry = entry;
  }
  return { tree, issues: issues.list };
}

/**
 * A reusable, validated brick fragment — a named `{root, nodes}` subtree the
 * operator authors and an agent can expand into ordinary patches. The `root`
 * need NOT be a box (a single-text composition is legal), and unlike a tree a composition
 * has no `screens`/`entry`.
 */
export interface FacetComposition {
  readonly name: string;
  readonly description?: string;
  readonly metadata?: CompositionMetadata;
  readonly slots?: Readonly<Record<string, string>>;
  readonly root: NodeId;
  readonly nodes: Readonly<Record<NodeId, FacetNode>>;
}

export interface CompositionMetadata {
  readonly category?: string;
  readonly useWhen?: string;
  readonly avoidWhen?: string;
  readonly variants?: readonly string[];
  readonly tags?: readonly string[];
  readonly repeatable?: boolean;
  readonly preferredParent?: "root" | "box" | "section" | "card";
  readonly composedOf?: readonly FacetNode["type"][];
  readonly dataRequirements?: readonly string[];
  readonly followUpEdits?: readonly string[];
}

export interface CompositionValidationResult {
  readonly composition?: FacetComposition;
  readonly issues: readonly string[];
}

/**
 * Fail-safe boundary for an untrusted composition document, mirroring `validateTree`'s
 * discipline (shared `sanitizeNodeMap`/`pruneDanglingChildren`/`breakCycles`):
 * brick-shape + token-membership sanitization, null-proto node map, dangling and
 * cyclic child refs removed, depth capped. Never throws. A composition needs a string
 * `name` and a `root` that resolves to a kept node (any brick type); optional
 * `slots` are bounded string defaults; no usable root ⇒ `composition` undefined.
 * Issues report everything that was fixed or refused.
 */
export function validateComposition(input: unknown): CompositionValidationResult {
  const issues = new BoundedIssues();
  try {
    return validateCompositionUnsafe(input, issues);
  } catch {
    issues.push("composition could not be read safely; refused");
    return { issues: issues.list };
  }
}

function validateCompositionUnsafe(
  input: unknown,
  issues: BoundedIssues,
): CompositionValidationResult {
  if (!isObject(input) || !isObject(input.nodes)) {
    issues.push("composition is not an object with a nodes map");
    return { issues: issues.list };
  }

  const rawNodeCount = Object.keys(input.nodes).length;
  if (rawNodeCount > MAX_COMPOSITION_NODES) {
    issues.push(`composition nodes exceeded the ${MAX_COMPOSITION_NODES}-node cap; refused`);
    return { issues: issues.list };
  }
  if (!inspectCompositionNodes(input.nodes, issues)) {
    return { issues: issues.list };
  }

  const name = asString(input.name);
  if (name === undefined || name.trim() === "") {
    issues.push("composition has no string name");
    return { issues: issues.list };
  }
  // Cap the name with the same rule a theme document's name uses (a short,
  // filename-safe identifier), so an unbounded or control-character name can't
  // flow into prompt/issue/log strings.
  if (!isValidThemeName(name)) {
    // Refuse WITHOUT echoing the raw name: an unbounded or terminal-escape name
    // is exactly what this branch rejects, so interpolating it here would defeat
    // the cap and inject into the prompt/issue/log strings it flows into (matches
    // validateTheme's constant "name is missing or malformed" posture).
    issues.push("composition name is missing or malformed (letters/digits/_/-, max 64); refused");
    return { issues: issues.list };
  }

  const nodes = sanitizeNodeMap(input.nodes, issues, { allowSlotMarkers: true });
  pruneDanglingChildren(nodes, issues);

  const rootId =
    typeof input.root === "string" && nodes[input.root] !== undefined ? input.root : undefined;
  if (rootId === undefined) {
    issues.push("composition has no valid root node");
    return { issues: issues.list };
  }

  breakCycles(nodes, [rootId], issues);

  const composition: {
    name: string;
    description?: string;
    metadata?: CompositionMetadata;
    slots?: Record<string, string>;
    root: string;
    nodes: Record<string, FacetNode>;
  } = { name, root: rootId, nodes };
  if (input.description !== undefined) {
    // Same validate/truncate policy validateTheme applies (shared helper): a
    // non-string is dropped WITH an issue so the operator sees the field was
    // ignored; an over-cap string is truncated at the shared 200-char cap so a
    // giant description can't blow the prompt/context budget it is injected into.
    const { description, warning } = boundedDescription(
      input.description,
      "composition",
      MAX_DESCRIPTION_LENGTH,
    );
    if (description !== undefined) composition.description = description;
    if (warning !== undefined) issues.push(warning);
  }
  const slots = sanitizeCompositionSlots(input.slots, issues);
  if (slots !== undefined) composition.slots = slots;
  const metadata = sanitizeCompositionMetadata(input.metadata, issues);
  if (metadata !== undefined) composition.metadata = metadata;
  return { composition, issues: issues.list };
}

function inspectCompositionNodes(rawNodes: Record<string, unknown>, issues: IssueSink): boolean {
  let safe = true;
  for (const [id, raw] of Object.entries(rawNodes)) {
    if (!isObject(raw)) continue;
    if (!isAllowedCompositionNodeType(raw.type)) {
      issues.push(
        `node "${printableKey(id)}": unknown component type ${printableValue(raw.type)} in composition`,
      );
      safe = false;
    }
    for (const field of FORBIDDEN_COMPOSITION_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(raw, field)) {
        issues.push(`node "${printableKey(id)}": ${field} is not allowed in compositions; refused`);
        safe = false;
      }
    }
  }
  return safe;
}

function isAllowedCompositionNodeType(value: unknown): boolean {
  return (
    isPrimitiveBrickType(value) ||
    isComponentNodeType(value) ||
    (typeof value === "string" &&
      (LEGACY_COMPOSITION_NODE_TYPES as readonly string[]).includes(value))
  );
}

function metadataString(raw: unknown, field: string, issues: IssueSink): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") {
    issues.push(`composition metadata "${field}" is not a string; dropped`);
    return undefined;
  }
  if (raw.length <= MAX_DESCRIPTION_LENGTH) return raw;
  issues.push(`composition metadata "${field}" truncated to ${MAX_DESCRIPTION_LENGTH} characters`);
  return raw.slice(0, MAX_DESCRIPTION_LENGTH);
}

// `variants`/`tags` are slot-name gated; `freeText` fields are prose that accept
// any string after bounded sanitation (control chars stripped, trimmed, capped).
function metadataStringList(
  raw: unknown,
  field: string,
  issues: IssueSink,
  freeText = false,
): readonly string[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    issues.push(`composition metadata "${field}" is not an array; dropped`);
    return undefined;
  }
  const out: string[] = [];
  for (const value of raw.slice(0, MAX_COMPOSITION_METADATA_ITEMS)) {
    if (typeof value !== "string") {
      if (freeText) issues.push(`composition metadata "${field}" entry is not a string; dropped`);
    } else if (!freeText) {
      if (isValidSlotName(value)) out.push(value);
    } else {
      const text = boundedMetadataText(value, field, issues);
      if (text !== undefined) out.push(text);
    }
  }
  if (raw.length > MAX_COMPOSITION_METADATA_ITEMS) {
    issues.push(
      `composition metadata "${field}" exceeded the ${MAX_COMPOSITION_METADATA_ITEMS}-item cap; extra items dropped`,
    );
  }
  return out.length > 0 ? out : undefined;
}

function boundedMetadataText(value: string, field: string, issues: IssueSink): string | undefined {
  const kept = [...value].filter((ch) => !isControlChar(ch.charCodeAt(0)));
  const stripped = kept.join("").trim();
  if (stripped.length === 0) return undefined;
  if (stripped.length <= MAX_DESCRIPTION_LENGTH) return stripped;
  issues.push(
    `composition metadata "${field}" entry truncated to ${MAX_DESCRIPTION_LENGTH} characters`,
  );
  return stripped.slice(0, MAX_DESCRIPTION_LENGTH);
}

// Full component vocabulary incl. legacy `stat`, so `composedOf` keeps every real node type.
const COMPOSITION_METADATA_NODE_TYPES = [
  ...new Set<FacetNode["type"]>(["box", "text", "media", "field", ...COMPONENT_NODE_TYPES]),
] as const satisfies readonly FacetNode["type"][];

function metadataNodeTypeList(
  raw: unknown,
  field: string,
  issues: IssueSink,
): readonly FacetNode["type"][] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    issues.push(`composition metadata "${field}" is not an array; dropped`);
    return undefined;
  }
  const out: FacetNode["type"][] = [];
  for (const value of raw.slice(0, MAX_COMPOSITION_METADATA_ITEMS)) {
    if (
      typeof value === "string" &&
      (COMPOSITION_METADATA_NODE_TYPES as readonly string[]).includes(value)
    ) {
      out.push(value as FacetNode["type"]);
    }
  }
  if (raw.length > MAX_COMPOSITION_METADATA_ITEMS) {
    issues.push(
      `composition metadata "${field}" exceeded the ${MAX_COMPOSITION_METADATA_ITEMS}-item cap; extra items dropped`,
    );
  }
  return out.length > 0 ? out : undefined;
}

function sanitizeCompositionMetadata(
  raw: unknown,
  issues: IssueSink,
): CompositionMetadata | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) {
    issues.push("composition metadata is not an object; dropped");
    return undefined;
  }
  const metadata: {
    category?: string;
    useWhen?: string;
    avoidWhen?: string;
    variants?: readonly string[];
    tags?: readonly string[];
    repeatable?: boolean;
    preferredParent?: "root" | "box" | "section" | "card";
    composedOf?: readonly FacetNode["type"][];
    dataRequirements?: readonly string[];
    followUpEdits?: readonly string[];
  } = {};
  const category = metadataString(raw.category, "category", issues);
  if (category !== undefined) metadata.category = category;
  const useWhen = metadataString(raw.useWhen, "useWhen", issues);
  if (useWhen !== undefined) metadata.useWhen = useWhen;
  const avoidWhen = metadataString(raw.avoidWhen, "avoidWhen", issues);
  if (avoidWhen !== undefined) metadata.avoidWhen = avoidWhen;
  const variants = metadataStringList(raw.variants, "variants", issues);
  if (variants !== undefined) metadata.variants = variants;
  const tags = metadataStringList(raw.tags, "tags", issues);
  if (tags !== undefined) metadata.tags = tags;
  if (typeof raw.repeatable === "boolean") metadata.repeatable = raw.repeatable;
  if (
    raw.preferredParent === "root" ||
    raw.preferredParent === "box" ||
    raw.preferredParent === "section" ||
    raw.preferredParent === "card"
  ) {
    metadata.preferredParent = raw.preferredParent;
  } else if (raw.preferredParent !== undefined) {
    issues.push("composition metadata preferredParent is invalid; dropped");
  }
  const composedOf = metadataNodeTypeList(raw.composedOf, "composedOf", issues);
  if (composedOf !== undefined) metadata.composedOf = composedOf;
  const freeTextList = (r: unknown, f: string): readonly string[] | undefined =>
    metadataStringList(r, f, issues, true);
  const dataRequirements = freeTextList(raw.dataRequirements, "dataRequirements");
  if (dataRequirements !== undefined) metadata.dataRequirements = dataRequirements;
  const followUpEdits = freeTextList(raw.followUpEdits, "followUpEdits");
  if (followUpEdits !== undefined) metadata.followUpEdits = followUpEdits;
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function sanitizeCompositionSlots(
  raw: unknown,
  issues: IssueSink,
): Record<string, string> | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) {
    issues.push("composition slots is not an object map; dropped");
    return undefined;
  }
  const slots = nullMap<string>();
  for (const [name, value] of Object.entries(raw)) {
    const key = printableKey(name);
    if (isForbiddenKey(name)) {
      issues.push(`composition slot "${key}": forbidden slot name dropped`);
      continue;
    }
    if (!isValidSlotName(name)) {
      issues.push(`composition slot "${key}": invalid slot name dropped`);
      continue;
    }
    if (typeof value !== "string") {
      issues.push(`composition slot "${key}": default is not a string; dropped`);
      continue;
    }
    if (value.length > MAX_FIELD_VALUE_CHARS) {
      slots[name] = value.slice(0, MAX_FIELD_VALUE_CHARS);
      issues.push(
        `composition slot "${key}": default truncated to ${MAX_FIELD_VALUE_CHARS} characters`,
      );
      continue;
    }
    slots[name] = value;
  }
  return Object.keys(slots).length > 0 ? slots : undefined;
}
