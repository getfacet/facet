import {
  COMPONENT_NODE_TYPES,
  PRIMITIVE_BRICK_TYPES,
  type FacetNode,
  type NodeId,
} from "./nodes.js";
import { isComponentNodeType, isPrimitiveBrickType } from "./component-validation.js";
import { isValidThemeName, MAX_DESCRIPTION_LENGTH } from "./theme.js";
import {
  BoundedIssues,
  boundedDescription,
  isControlChar,
  isPlainObject as isObject,
  printableKey,
  printableValue,
  type IssueSink,
} from "./issues.js";
import { SLOT_NAME_RE } from "./slot-marker.js";
import { breakCycles, pruneDanglingChildren, sanitizeNodeMap } from "./tree-validation.js";
import { isCompositionRefShape, sanitizeSlotMap } from "./primitive-node-validation.js";

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

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isValidSlotName(name: string): boolean {
  return SLOT_NAME_RE.test(name);
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
  readonly nodes: Readonly<Record<NodeId, FacetNode | CompositionRef>>;
}

/**
 * A CLOSED reference from one composition's node map to ANOTHER composition,
 * resolved recursively to primitive/native nodes at expand time. It is the only
 * non-`FacetNode` value a composition's `nodes` map may hold, and it is admitted
 * ONLY inside a composition DEFINITION (never the live stage tree — see
 * `SanitizeNodeOptions.allowReference`). Only `use` and (bounded-string) `slots`
 * survive sanitation; it carries no `url`/`fetch`/`binding`/`query`/`resolver`.
 */
export interface CompositionRef {
  readonly use: string;
  readonly slots?: Readonly<Record<string, string>>;
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

  const nodes = sanitizeNodeMap(input.nodes, issues, {
    allowSlotMarkers: true,
    allowReference: true,
  });
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
    nodes: Record<string, FacetNode | CompositionRef>;
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
    // A node is either an allowed brick type OR a CLOSED composition reference
    // `{ use, slots }`. Anything else refuses the whole composition. The
    // forbidden-field sweep below still applies to references, so a ref carrying
    // `url`/`fetch`/… is refused too.
    if (!isAllowedCompositionNodeType(raw.type) && !isCompositionRefShape(raw)) {
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

// Every real node type, so `composedOf` metadata can name any of them. Derived from
// the canonical primitive + component lists (NOT a frozen literal) so a newly added
// primitive brick (e.g. `richtext`) is admitted automatically instead of drifting.
const COMPOSITION_METADATA_NODE_TYPES = [
  ...new Set<FacetNode["type"]>([...PRIMITIVE_BRICK_TYPES, ...COMPONENT_NODE_TYPES]),
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

// Composition slot DEFAULTS and composition-reference slot ARGUMENTS share ONE
// bounded-string sanitizer (`sanitizeSlotMap`), so a reference's `slots` are
// bounded exactly like a slot default (MAX_FIELD_VALUE_CHARS truncation,
// isValidSlotName gate, forbidden-key drop).
function sanitizeCompositionSlots(
  raw: unknown,
  issues: IssueSink,
): Record<string, string> | undefined {
  return sanitizeSlotMap(raw, issues, "composition slot");
}
