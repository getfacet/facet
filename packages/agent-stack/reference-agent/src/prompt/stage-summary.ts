import {
  EMPTY_TREE,
  type ComponentNodeType,
  type FacetTree,
  type PrimitiveBrickType,
} from "@facet/core";

export const DEFAULT_STAGE_JSON_CHAR_LIMIT = 48_000;
export const DEFAULT_STAGE_SUMMARY_NODE_LIMIT = 80;

const ID_CHAR_LIMIT = 80;

export interface StageSummaryOptions {
  readonly maxJsonChars?: number;
  readonly maxSummaryNodes?: number;
}

export function formatCurrentStageForPrompt(
  stage: FacetTree,
  options: StageSummaryOptions = {},
): string {
  const safeStage = safeFacetTree(stage);
  const maxJsonChars = safeNonNegativeInteger(options.maxJsonChars, DEFAULT_STAGE_JSON_CHAR_LIMIT);
  if (maxJsonChars > 0 && jsonLengthWithin(safeStage, maxJsonChars)) {
    const json = stringifyStage(safeStage);
    if (json !== undefined && json.length <= maxJsonChars) return `CURRENT STAGE: ${json}`;
  }
  return `CURRENT STAGE SUMMARY:\n${summarizeStageForPrompt(safeStage, options)}`;
}

export function summarizeStageForPrompt(
  stage: FacetTree,
  options: Pick<StageSummaryOptions, "maxSummaryNodes"> = {},
): string {
  const safeStage = safeFacetTree(stage);
  const maxSummaryNodes = safeNonNegativeInteger(
    options.maxSummaryNodes,
    DEFAULT_STAGE_SUMMARY_NODE_LIMIT,
  );
  const nodeIds = Object.keys(safeStage.nodes).sort();
  const screenCount = isRecord(safeStage.screens) ? Object.keys(safeStage.screens).length : 0;
  const visibleIds = nodeIds.slice(0, maxSummaryNodes);
  const omittedCount = nodeIds.length - visibleIds.length;

  const lines: string[] = [
    `root=${safeField(safeStage.root)}`,
    `nodes=${String(nodeIds.length)}`,
    `screens=${String(screenCount)}`,
  ];
  if (typeof safeStage.entry === "string") lines.push(`entry=${safeField(safeStage.entry)}`);
  if (typeof safeStage.theme === "string") lines.push(`theme=${safeField(safeStage.theme)}`);
  lines.push(`node_summaries=${String(visibleIds.length)}/${String(nodeIds.length)} sorted_by=id`);
  for (const id of visibleIds) {
    lines.push(`- ${safeField(id)}: ${summarizeNode(safeStage.nodes[id])}`);
  }
  if (omittedCount > 0) {
    lines.push(`... ${String(omittedCount)} more nodes omitted`);
  }
  lines.push("Use inspect_stage or inspect_node for full details before targeted edits.");
  return lines.join("\n");
}

/** The core node-type identifiers this summarizer recognizes. */
type SummarizableNodeType = PrimitiveBrickType | ComponentNodeType;

/** Per-brick summary handler — receives a raw (already `isRecord`-checked) node. */
type NodeSummarizer = (node: Record<string, unknown>) => string;

/**
 * The per-brick summary registry: one entry per core node type → its (unchanged)
 * summary handler. This de-scatters the former `summarizeNode` `switch`; the
 * handler BODIES are identical, only the dispatch now reads this table.
 *
 * SOFT lookup: this is a partial map, NOT an exhaustive `Record`. A miss (a type
 * absent here — e.g. an unrecognized/malformed `type`, or the raw `image` media
 * alias) falls through to the `type=unknown` default in `summarizeNode`, exactly
 * as the original `switch`'s trailing `return "type=unknown"` did.
 */
const STAGE_SUMMARY_REGISTRY: Partial<Record<SummarizableNodeType, NodeSummarizer>> = {
  box: (node) => {
    const children = Array.isArray(node["children"]) ? node["children"].length : 0;
    return `type=box children=${String(children)}${node["hidden"] === true ? " hidden=true" : ""}`;
  },
  text: (node) => {
    const value = typeof node["value"] === "string" ? node["value"] : "";
    return `type=text chars=${String(value.length)}`;
  },
  media: (node) => {
    const kind = typeof node["kind"] === "string" ? safeField(node["kind"]) : "unknown";
    const src = typeof node["src"] === "string" ? node["src"] : "";
    const alt = typeof node["alt"] === "string" ? ` altChars=${String(node["alt"].length)}` : "";
    return `type=media kind=${kind} srcChars=${String(src.length)}${alt}`;
  },
  richtext: (node) => {
    const blocks = Array.isArray(node["blocks"]) ? node["blocks"] : [];
    const preview = richTextPreview(blocks);
    return compactSummary([
      "type=richtext",
      `blocks=${String(blocks.length)}`,
      `runs=${String(richTextRunCount(blocks))}`,
      preview.length > 0 ? `text=${safeField(preview)}` : undefined,
    ]);
  },
  field: (node) => {
    const name = typeof node["name"] === "string" ? safeField(node["name"]) : "(missing)";
    const input = typeof node["input"] === "string" ? ` input=${safeField(node["input"])}` : "";
    const options = Array.isArray(node["options"])
      ? ` options=${String(node["options"].length)}`
      : "";
    return `type=field name=${name}${input}${options}`;
  },
  section: (node) => summarizeContainer("section", node, ["title", "eyebrow", "body"], ["variant"]),
  card: (node) => summarizeContainer("card", node, ["title", "body"], ["variant", "tone"]),
  button: (node) =>
    compactSummary([
      "type=button",
      charSummary(node["label"], "labelChars"),
      safeStringSummary(node["variant"], "variant"),
      safeStringSummary(node["tone"], "tone"),
      node["disabled"] === true ? "disabled=true" : undefined,
    ]),
  tabs: (node) =>
    compactSummary([
      "type=tabs",
      `items=${String(arrayCount(node["items"]))}`,
      safeStringSummary(node["variant"], "variant"),
    ]),
  nav: (node) =>
    compactSummary([
      "type=nav",
      `items=${String(arrayCount(node["items"]))}`,
      safeStringSummary(node["variant"], "variant"),
    ]),
  table: (node) =>
    compactSummary([
      "type=table",
      `columns=${String(arrayCount(node["columns"]))}`,
      `rows=${String(arrayCount(node["rows"]))}`,
      charSummary(node["caption"], "captionChars"),
      safeStringSummary(node["variant"], "variant"),
    ]),
  chart: (node) => {
    const kind = typeof node["kind"] === "string" ? safeField(node["kind"]) : "unknown";
    return compactSummary([
      `type=chart kind=${kind}`,
      `series=${String(arrayCount(node["series"]))}`,
      `points=${String(chartPointCount(node["series"]))}`,
      `labels=${String(arrayCount(node["labels"]))}`,
      charSummary(node["title"], "titleChars"),
      safeStringSummary(node["variant"], "variant"),
    ]);
  },
  metric: (node) => summarizeMetric("metric", node),
  stat: (node) => summarizeMetric("stat", node),
  keyValue: (node) =>
    compactSummary([
      "type=keyValue",
      `items=${String(arrayCount(node["items"]))}`,
      safeStringSummary(node["variant"], "variant"),
    ]),
  badge: (node) =>
    compactSummary([
      "type=badge",
      charSummary(node["label"], "labelChars"),
      safeStringSummary(node["tone"], "tone"),
      safeStringSummary(node["variant"], "variant"),
    ]),
  progress: (node) =>
    compactSummary([
      "type=progress",
      numberSummary(node["value"], "value"),
      charSummary(node["label"], "labelChars"),
      safeStringSummary(node["tone"], "tone"),
      safeStringSummary(node["variant"], "variant"),
    ]),
  alert: (node) =>
    compactSummary([
      "type=alert",
      charSummary(node["title"], "titleChars"),
      charSummary(node["body"], "bodyChars"),
      safeStringSummary(node["tone"], "tone"),
      safeStringSummary(node["variant"], "variant"),
    ]),
  list: (node) =>
    compactSummary([
      "type=list",
      `items=${String(arrayCount(node["items"]))}`,
      safeStringSummary(node["variant"], "variant"),
    ]),
  divider: (node) =>
    compactSummary([
      "type=divider",
      charSummary(node["label"], "labelChars"),
      safeStringSummary(node["variant"], "variant"),
    ]),
  form: (node) => summarizeContainer("form", node, ["title", "body", "submitLabel"], ["variant"]),
  search: (node) => {
    const name = typeof node["name"] === "string" ? safeField(node["name"]) : "(missing)";
    return compactSummary([
      `type=search name=${name}`,
      charSummary(node["label"], "labelChars"),
      charSummary(node["placeholder"], "placeholderChars"),
      charSummary(node["value"], "valueChars"),
      charSummary(node["submitLabel"], "submitLabelChars"),
      safeStringSummary(node["variant"], "variant"),
    ]);
  },
  filterBar: (node) =>
    compactSummary([
      "type=filterBar",
      `filters=${String(arrayCount(node["filters"]))}`,
      safeStringSummary(node["variant"], "variant"),
    ]),
  emptyState: (node) =>
    compactSummary([
      "type=emptyState",
      charSummary(node["title"], "titleChars"),
      charSummary(node["body"], "bodyChars"),
      charSummary(node["actionLabel"], "actionLabelChars"),
      safeStringSummary(node["variant"], "variant"),
    ]),
  loading: (node) =>
    compactSummary([
      "type=loading",
      charSummary(node["label"], "labelChars"),
      safeStringSummary(node["variant"], "variant"),
    ]),
};

/** Exposed for the registry-exhaustiveness test; not part of the package barrel. */
export { STAGE_SUMMARY_REGISTRY };

function summarizeNode(node: FacetTree["nodes"][string] | undefined): string {
  if (!isRecord(node)) return "type=unknown";
  const type = typeof node["type"] === "string" ? node["type"] : "unknown";
  // Own-property check: a bare lookup returns an inherited `Object.prototype`
  // member for a type like "constructor"/"toString", so `summarize(node)` would
  // emit `[object Object]` instead of the former switch's `type=unknown`.
  const summarize = Object.hasOwn(STAGE_SUMMARY_REGISTRY, type)
    ? (STAGE_SUMMARY_REGISTRY as Record<string, NodeSummarizer | undefined>)[type]
    : undefined;
  return summarize ? summarize(node) : "type=unknown";
}

function summarizeMetric(type: "metric" | "stat", node: Record<string, unknown>): string {
  return compactSummary([
    `type=${type}`,
    charSummary(node["label"], "labelChars"),
    charSummary(node["value"], "valueChars"),
    charSummary(node["delta"], "deltaChars"),
    safeStringSummary(node["tone"], "tone"),
    safeStringSummary(node["variant"], "variant"),
  ]);
}

function summarizeContainer(
  type: "section" | "card" | "form",
  node: Record<string, unknown>,
  charFields: readonly string[],
  safeStringFields: readonly string[],
): string {
  return compactSummary([
    `type=${type}`,
    `children=${String(arrayCount(node["children"]))}`,
    ...charFields.map((field) => charSummary(node[field], `${field}Chars`)),
    ...safeStringFields.map((field) => safeStringSummary(node[field], field)),
  ]);
}

function compactSummary(parts: readonly (string | undefined)[]): string {
  return parts.filter((part): part is string => part !== undefined && part.length > 0).join(" ");
}

function charSummary(value: unknown, label: string): string | undefined {
  return typeof value === "string" ? `${label}=${String(value.length)}` : undefined;
}

function safeStringSummary(value: unknown, label: string): string | undefined {
  return typeof value === "string" ? `${label}=${safeField(value)}` : undefined;
}

function numberSummary(value: unknown, label: string): string | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? `${label}=${String(value)}`
    : undefined;
}

function arrayCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function chartPointCount(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  let total = 0;
  for (const series of value) {
    if (!isRecord(series) || !Array.isArray(series["values"])) continue;
    total += series["values"].length;
  }
  return total;
}

function richTextRunCount(blocks: readonly unknown[]): number {
  let total = 0;
  for (const block of blocks) {
    if (isRecord(block) && Array.isArray(block["runs"])) total += block["runs"].length;
  }
  return total;
}

/**
 * Flatten a richtext node's `blocks`/`runs` into a single leading text preview:
 * concatenate run `text` in document order until enough characters accumulate to
 * fill the field cap, so the summary reflects the prose instead of `type=unknown`.
 */
function richTextPreview(blocks: readonly unknown[]): string {
  const parts: string[] = [];
  let length = 0;
  for (const block of blocks) {
    if (!isRecord(block) || !Array.isArray(block["runs"])) continue;
    for (const run of block["runs"]) {
      if (!isRecord(run) || typeof run["text"] !== "string") continue;
      parts.push(run["text"]);
      length += run["text"].length;
      if (length >= ID_CHAR_LIMIT) return parts.join("");
    }
  }
  return parts.join("");
}

function safeNonNegativeInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}

function stringifyStage(stage: FacetTree): string | undefined {
  try {
    return JSON.stringify(stage);
  } catch {
    return undefined;
  }
}

function jsonLengthWithin(value: unknown, maxChars: number): boolean {
  return boundedJsonLength(value, maxChars, new WeakSet<object>()) !== undefined;
}

function boundedJsonLength(
  value: unknown,
  maxChars: number,
  seen: WeakSet<object>,
): number | undefined {
  if (maxChars < 0) return undefined;
  if (value === null) return boundedLength(4, maxChars);

  switch (typeof value) {
    case "string":
      return boundedJsonStringLength(value, maxChars);
    case "number":
      return boundedLength(Number.isFinite(value) ? String(value).length : 4, maxChars);
    case "boolean":
      return boundedLength(value ? 4 : 5, maxChars);
    case "bigint":
      return undefined;
    case "object":
      return Array.isArray(value)
        ? boundedArrayJsonLength(value, maxChars, seen)
        : boundedObjectJsonLength(value, maxChars, seen);
    default:
      return undefined;
  }
}

function boundedArrayJsonLength(
  value: readonly unknown[],
  maxChars: number,
  seen: WeakSet<object>,
): number | undefined {
  if (seen.has(value)) return undefined;
  seen.add(value);
  let total = 2;
  for (let index = 0; index < value.length; index += 1) {
    if (index > 0) total += 1;
    const item = value[index];
    const itemLength =
      item === undefined || typeof item === "function" || typeof item === "symbol"
        ? 4
        : boundedJsonLength(item, maxChars - total, seen);
    if (itemLength === undefined) return undefined;
    total += itemLength;
    if (total > maxChars) return undefined;
  }
  seen.delete(value);
  return total;
}

function boundedObjectJsonLength(
  value: object,
  maxChars: number,
  seen: WeakSet<object>,
): number | undefined {
  if (seen.has(value)) return undefined;
  seen.add(value);
  let total = 2;
  let emitted = 0;
  for (const key of Object.keys(value)) {
    const property = (value as Record<string, unknown>)[key];
    if (property === undefined || typeof property === "function" || typeof property === "symbol") {
      continue;
    }
    const keyLength = boundedJsonStringLength(key, maxChars - total);
    if (keyLength === undefined) return undefined;
    const propertyLength = boundedJsonLength(property, maxChars - total - keyLength - 1, seen);
    if (propertyLength === undefined) return undefined;
    total += (emitted > 0 ? 1 : 0) + keyLength + 1 + propertyLength;
    emitted += 1;
    if (total > maxChars) return undefined;
  }
  seen.delete(value);
  return total;
}

function boundedJsonStringLength(value: string, maxChars: number): number | undefined {
  let length = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c) length += 2;
    else if (code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d) {
      length += 2;
    } else if (code <= 0x1f) length += 6;
    else length += 1;
    if (length > maxChars) return undefined;
  }
  return length;
}

function boundedLength(length: number, maxChars: number): number | undefined {
  return length <= maxChars ? length : undefined;
}

function safeField(value: string): string {
  return capAscii(value, ID_CHAR_LIMIT);
}

function capAscii(value: string, maxChars: number): string {
  const ascii = asciiOnly(value);
  if (ascii.length <= maxChars) return ascii;
  const suffix = "...";
  return `${ascii.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`;
}

function asciiOnly(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, (character) => {
    const code = character.charCodeAt(0).toString(16).padStart(4, "0");
    return `\\u${code}`;
  });
}

function safeFacetTree(stage: FacetTree): FacetTree {
  if (!isRecord(stage)) return EMPTY_TREE;
  if (typeof stage["root"] !== "string") return EMPTY_TREE;
  if (!isRecord(stage["nodes"])) return EMPTY_TREE;
  return stage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
