import {
  BLOCK_TYPES,
  INPUT_KINDS,
  MARK_KINDS,
  MEDIA_KINDS,
  OVERLAY_KINDS,
  type BlockType,
  type BoxStyle,
  type FacetAction,
  type FacetNode,
  type InputKind,
  type InputStyle,
  type LinkTarget,
  type Mark,
  type MarkKind,
  type MediaKind,
  type MediaStyle,
  type Overlay,
  type OverlayKind,
  type RichTextBlock,
  type RichTextStyle,
  type Run,
  type TextStyle,
} from "./nodes.js";
import { MAX_NODE_BODY_CHARS, setFrom } from "./brick-validation-shared.js";
import { sanitizeViewPredicate, type ViewPredicate } from "./view.js";
import { BRICK_REGISTRY, type BrickEntry } from "./brick-registry.js";
import { MAX_FIELD_OPTIONS, MAX_FIELD_VALUE_CHARS } from "./protocol.js";
import {
  isForbiddenKey,
  isPlainObject as isObject,
  printableKey,
  printableValue,
  type IssueSink,
} from "./issues.js";
import { SLOT_NAME_RE } from "./slot-marker.js";
import { normalizeFacetAction } from "./action-validation.js";
import { sanitizeBrickStyle } from "./style-validation.js";
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

/**
 * Gate for a link `href` — deliberately STRICTER than `isSafeMediaSrc`. A media
 * src is LOADED into `<img>`/`<video>`; an href is NAVIGATED at top level, where
 * any `data:` URL (including `data:image/svg+xml`, whose SVG can script on
 * navigation) is a script/exfil vector. So this allows ONLY `http(s)://`,
 * protocol-relative `//`, and local `/path`, and rejects ALL `data:`,
 * `javascript:`, and every other scheme. Do NOT reuse `isSafeMediaSrc` here.
 */
export function isSafeHref(href: string): boolean {
  const s = href.trim().toLowerCase();
  return (
    s.startsWith("https://") ||
    s.startsWith("http://") ||
    s.startsWith("//") ||
    (s.startsWith("/") && !s.startsWith("//"))
  );
}

function inputOptions(value: unknown): readonly string[] | undefined {
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
} from "./brick-validation-shared.js";

/** Copy the closed text cell selector used with a valid `from` binding. */
function setColumnRow(raw: Record<string, unknown>, node: { column?: string; row?: number }): void {
  if (
    typeof raw.column === "string" &&
    !isForbiddenKey(raw.column) &&
    SLOT_NAME_RE.test(raw.column)
  ) {
    node.column = raw.column;
  }
  if (typeof raw.row === "number" && Number.isInteger(raw.row) && raw.row >= 0) {
    node.row = raw.row;
  }
}
/**
 * Sanitize the `activeWhen` view-state predicate through the closed
 * `sanitizeViewPredicate` (drops an unknown/future kind WITH an issue), so a
 * hostile/unknown predicate degrades to the default look and never becomes an
 * expression eval.
 */
function setActiveWhen(
  raw: Record<string, unknown>,
  id: string,
  node: { activeWhen?: ViewPredicate },
  issues: IssueSink,
): void {
  if (raw.activeWhen === undefined) return;
  const activeWhen = sanitizeViewPredicate(raw.activeWhen);
  if (activeWhen !== undefined) {
    node.activeWhen = activeWhen;
    return;
  }
  issues.push(
    `node "${printableKey(id)}": unknown activeWhen predicate ${printableValue(raw.activeWhen)} dropped`,
  );
}

/**
 * Validate handlers for the five universal bricks defined in this module. The
 * brick registry (`brick-registry.ts`) references these so `sanitizeNode` is a
 * registry lookup, not a hardcoded switch. `rawType` carries
 * the original input type so the media handler preserves the `image` alias.
 */
export type PrimitiveValidator = (
  id: string,
  raw: Record<string, unknown>,
  issues: IssueSink,
  rawType: string,
) => FacetNode | undefined;

// Admit ONLY a closed overlay descriptor `{ kind }` (kind ∈ OVERLAY_KINDS),
// reading nothing else so no author positioning key survives (DC-004). A
// non-object, an unknown/missing kind, or a hostile (throwing-getter) descriptor
// drops the WHOLE descriptor with a bounded issue and never throws (DC-003).
function sanitizeOverlay(raw: unknown, key: string, issues: IssueSink): Overlay | undefined {
  if (raw === undefined) return undefined;
  if (isObject(raw)) {
    let kind: unknown;
    try {
      kind = (raw as Record<string, unknown>).kind;
    } catch {
      kind = undefined;
    }
    if (typeof kind === "string" && (OVERLAY_KINDS as readonly string[]).includes(kind)) {
      return { kind: kind as OverlayKind };
    }
  }
  issues.push(`node "${key}": overlay ${printableValue(raw)} dropped`);
  return undefined;
}

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
    style?: BoxStyle;
    children: string[];
    onPress?: FacetAction;
    onHold?: FacetAction;
    hidden?: boolean;
    backdrop?: string;
    overlay?: Overlay;
    activeWhen?: ViewPredicate;
  } = { id, type: "box", children };
  const style = sanitizeBrickStyle("box", raw.style, { nodeId: id, issues });
  if (style !== undefined) node.style = style;
  setActiveWhen(raw, id, node, issues);
  // `backdrop` is a node-id STRING (resolved to a media node fail-safe at
  // render time in WU-6), NOT a token: kept iff a string, else dropped with
  // a (bounded) issue.
  if (typeof raw.backdrop === "string") {
    node.backdrop = raw.backdrop;
  } else if (raw.backdrop !== undefined) {
    issues.push(`node "${key}": backdrop is not a string ${printableValue(raw.backdrop)} dropped`);
  }
  // `overlay` is a CLOSED descriptor: admit ONLY `{ kind }` with `kind ∈
  // OVERLAY_KINDS`, reading nothing else — every extra author key (z/top/inset/
  // position) is left behind, and the WHOLE descriptor is dropped (bounded issue)
  // on a non-object / unknown / missing kind. The renderer owns placement/z, so
  // no author coordinate can leak (DC-004); never throws (DC-003).
  const overlay = sanitizeOverlay(raw.overlay, key, issues);
  if (overlay !== undefined) node.overlay = overlay;
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
    style?: TextStyle;
    from?: string;
    column?: string;
    row?: number;
    activeWhen?: ViewPredicate;
  } = {
    id,
    type: "text",
    value,
  };
  const style = sanitizeBrickStyle("text", raw.style, { nodeId: id, issues });
  if (style !== undefined) node.style = style;
  // Enabler A store binding: use the shared bounded dataset-cell rules.
  setFrom(raw, id, node, issues);
  setColumnRow(raw, node);
  setActiveWhen(raw, id, node, issues);
  return node;
}

export function validateMedia(
  id: string,
  raw: Record<string, unknown>,
  issues: IssueSink,
  rawType: string,
): FacetNode | undefined {
  const key = printableKey(id);
  const src = asString(raw.src);
  if (src === undefined) {
    issues.push(`node "${key}": media needs a string src`);
    return undefined;
  }
  if (!isSafeMediaSrc(src)) {
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
    alt?: string;
    poster?: string;
    controls?: boolean;
    style?: MediaStyle;
  } = { id, type: "media", kind, src };
  const style = sanitizeBrickStyle("media", raw.style, { nodeId: id, issues });
  if (style !== undefined) node.style = style;
  const alt = asString(raw.alt);
  node.alt = alt ?? "";
  const poster = asString(raw.poster);
  if (poster !== undefined && isSafeMediaSrc(poster)) {
    node.poster = poster;
  }
  const controls = asBool(raw.controls);
  if (controls !== undefined) node.controls = controls;
  return node;
}

export function validateInput(
  id: string,
  raw: Record<string, unknown>,
  issues: IssueSink,
): FacetNode | undefined {
  const name = asString(raw.name);
  if (name === undefined) {
    issues.push(`node "${printableKey(id)}": input has no name`);
    return undefined;
  }
  const node: {
    id: string;
    type: "input";
    name: string;
    input?: InputKind;
    label?: string;
    placeholder?: string;
    options?: readonly string[];
    style?: InputStyle;
  } = { id, type: "input", name };
  const input = asToken<InputKind>(raw.input, INPUT_KINDS);
  if (input !== undefined) node.input = input;
  const options = inputOptions(raw.options);
  if (options !== undefined) node.options = options;
  if ((input === "select" || input === "radio") && options === undefined) {
    issues.push(
      `node "${printableKey(id)}": ${printableValue(input)} input has no valid options — rendered control will be empty`,
    );
  }
  const label = asString(raw.label);
  if (label !== undefined) node.label = label;
  const placeholder = asString(raw.placeholder);
  if (placeholder !== undefined) node.placeholder = placeholder;
  const style = sanitizeBrickStyle("input", raw.style, {
    nodeId: id,
    issues,
    inputKind: input ?? "text",
  });
  if (style !== undefined) node.style = style;
  return node;
}

/** Bounds for the richtext leaf. Over-cap slices/clamps — never throws. */
export const MAX_RICHTEXT_BLOCKS = 64;
export const MAX_RUNS_PER_BLOCK = 64;
export const MAX_MARKS_PER_RUN = 8;
export const MAX_LIST_DEPTH = 5;

/**
 * Coerce a numeric value and CLAMP it to `[min, max]`. A missing/non-numeric value yields `fallback`;
 * an over/under-cap value clamps to the boundary. Never throws.
 */
function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

/**
 * Sanitize a richtext link target. A `{ href }` object is an EXTERNAL URL gated
 * by `isSafeHref` (unsafe → dropped); anything else is an INTERNAL target routed
 * through the SHARED `normalizeFacetAction` — never a parallel action validator.
 */
function sanitizeLinkTarget(raw: unknown, id: string, issues: IssueSink): LinkTarget | undefined {
  const key = printableKey(id);
  if (!isObject(raw)) {
    issues.push(`node "${key}": richtext link has no target object; mark dropped`);
    return undefined;
  }
  if (typeof raw.href === "string") {
    if (isSafeHref(raw.href)) return { href: raw.href.slice(0, MAX_NODE_BODY_CHARS) };
    issues.push(`node "${key}": unsafe richtext link href dropped`);
    return undefined;
  }
  return normalizeFacetAction(raw, id, "richtext link", issues);
}

/** Sanitize one mark: drop unknown kinds (run text kept); route `link` targets. */
function sanitizeMark(raw: unknown, id: string, issues: IssueSink): Mark | undefined {
  if (!isObject(raw)) return undefined;
  const kind = asToken<MarkKind>(raw.kind, MARK_KINDS);
  if (kind === undefined) {
    issues.push(
      `node "${printableKey(id)}": unknown richtext mark kind ${printableValue(raw.kind)} dropped`,
    );
    return undefined;
  }
  if (kind === "link") {
    const target = sanitizeLinkTarget(raw.target, id, issues);
    return target === undefined ? undefined : { kind: "link", target };
  }
  return { kind };
}

/** Sanitize one run: skip a run with missing/non-string text; cap + sanitize marks. */
function sanitizeRun(raw: unknown, id: string, issues: IssueSink): Run | undefined {
  if (!isObject(raw)) return undefined;
  const text = asString(raw.text);
  if (text === undefined) {
    issues.push(`node "${printableKey(id)}": richtext run has no string text; skipped`);
    return undefined;
  }
  const run: { text: string; marks?: Mark[] } = { text: text.slice(0, MAX_NODE_BODY_CHARS) };
  if (Array.isArray(raw.marks)) {
    const marks: Mark[] = [];
    for (const rawMark of raw.marks) {
      if (marks.length >= MAX_MARKS_PER_RUN) break;
      const mark = sanitizeMark(rawMark, id, issues);
      if (mark !== undefined) marks.push(mark);
    }
    if (marks.length > 0) run.marks = marks;
  }
  return run;
}

/**
 * Sanitize one block: degrade an unknown `type` to `paragraph` (keeping the
 * text), cap + sanitize runs, clamp heading `level` / list `depth`. A block with
 * zero valid runs is dropped (nothing to render).
 */
function sanitizeRichTextBlock(
  raw: unknown,
  id: string,
  issues: IssueSink,
): RichTextBlock | undefined {
  if (!isObject(raw)) return undefined;
  let type = asToken<BlockType>(raw.type, BLOCK_TYPES);
  if (type === undefined) {
    if (raw.type !== undefined) {
      issues.push(
        `node "${printableKey(id)}": unknown richtext block type ${printableValue(raw.type)} degraded to paragraph`,
      );
    }
    type = "paragraph";
  }
  const runs: Run[] = [];
  if (Array.isArray(raw.runs)) {
    for (const rawRun of raw.runs) {
      if (runs.length >= MAX_RUNS_PER_BLOCK) break;
      const run = sanitizeRun(rawRun, id, issues);
      if (run !== undefined) runs.push(run);
    }
  }
  if (runs.length === 0) return undefined;
  const block: { type: BlockType; level?: number; depth?: number; runs: Run[] } = { type, runs };
  if (type === "heading") block.level = clampInt(raw.level, 1, 3, 1);
  if (type === "listItem") block.depth = clampInt(raw.depth, 0, MAX_LIST_DEPTH, 0);
  return block;
}

/**
 * The richtext leaf validator. Holds its own `blocks`/`runs` (no children, no
 * `from` binding — DC-005). Caps blocks/runs/marks/text, drops unknown marks,
 * degrades unknown block types, clamps level/depth. NEVER throws and never
 * returns undefined — a structurally-empty input degrades to `blocks: []`.
 */
export function validateRichText(
  id: string,
  raw: Record<string, unknown>,
  issues: IssueSink,
): FacetNode | undefined {
  const blocks: RichTextBlock[] = [];
  if (Array.isArray(raw.blocks)) {
    for (const rawBlock of raw.blocks) {
      if (blocks.length >= MAX_RICHTEXT_BLOCKS) break;
      const block = sanitizeRichTextBlock(rawBlock, id, issues);
      if (block !== undefined) blocks.push(block);
    }
  }
  const node: {
    id: string;
    type: "richtext";
    blocks: RichTextBlock[];
    style?: RichTextStyle;
  } = { id, type: "richtext", blocks };
  const style = sanitizeBrickStyle("richtext", raw.style, { nodeId: id, issues });
  if (style !== undefined) node.style = style;
  return node;
}

export function sanitizeNode(id: string, raw: unknown, issues: IssueSink): FacetNode | undefined {
  const key = printableKey(id);
  const type = isObject(raw) ? asString(raw.type) : undefined;
  if (!isObject(raw) || type === undefined) {
    issues.push(`node "${key}": not an object with a type`);
    return undefined;
  }
  // The final brick registry keys off canonical node types; `image` remains an
  // input alias for `media` (kind defaulted from the raw type).
  const lookupType = type === "image" ? "media" : type;
  const entry = Object.prototype.hasOwnProperty.call(BRICK_REGISTRY, lookupType)
    ? (BRICK_REGISTRY as Record<string, BrickEntry | undefined>)[lookupType]
    : undefined;
  if (entry?.validate !== undefined) return entry.validate(id, raw, issues, type);
  issues.push(`node "${key}": unknown type "${printableKey(type)}"`);
  return undefined;
}
