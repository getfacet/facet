import { BOUNDS } from "./bounds.js";
import { isFacetIdentifier } from "./identifiers.js";

/** One named region accepted by a structured component. */
export interface ComponentSlotSpec {
  readonly guidance: string;
  readonly minChildren: number;
  readonly maxChildren: number;
  readonly allowedTags?: readonly string[];
}

/** The closed content contract every component declares. */
export type ComponentContentSpec =
  | { readonly mode: "none" }
  | { readonly mode: "children" }
  | {
      readonly mode: "slots";
      readonly slots: Readonly<Record<string, ComponentSlotSpec>>;
    };

/** Agent-facing composition labels derived from the content contract. */
export type ComponentContentClass = "Leaf" | "Container" | "Structured";

type ContentValidationResult =
  | { readonly ok: true; readonly content: ComponentContentSpec }
  | {
      readonly ok: false;
      readonly code: string;
      readonly at: string;
      readonly detail: string;
    };

type ContentRejection = Extract<ContentValidationResult, { readonly ok: false }>;

const CONTENT_KEYS: readonly string[] = ["mode", "slots"];
const SLOT_KEYS: readonly string[] = ["guidance", "minChildren", "maxChildren", "allowedTags"];

/** Derives the discovery class instead of storing independent role metadata. */
export function deriveComponentContentClass(content: ComponentContentSpec): ComponentContentClass {
  if (content.mode === "none") {
    return "Leaf";
  }
  return content.mode === "children" ? "Container" : "Structured";
}

/** Package-private validation entrypoint used by the component-spec trust boundary. */
export function validateComponentContentSpec(
  value: unknown,
):
  | { readonly ok: true; readonly content: ComponentContentSpec }
  | { readonly ok: false; readonly code: string; readonly at: string; readonly detail: string } {
  try {
    return validateContent(value);
  } catch {
    return reject(
      "content_read_failed",
      "content",
      "Reading content threw; component content must be plain data.",
    );
  }
}

function validateContent(value: unknown): ContentValidationResult {
  if (!isRecord(value)) {
    return reject("content_not_an_object", "content", "Component content must be a plain object.");
  }
  const unknownKey = firstUnknownKey(value, CONTENT_KEYS);
  if (unknownKey !== undefined) {
    return reject(
      "unknown_content_key",
      unknownKey === null ? "content" : `content.${unknownKey}`,
      "The component content branch is closed.",
    );
  }
  const mode = value["mode"];
  if (mode !== "none" && mode !== "children" && mode !== "slots") {
    return reject(
      "invalid_content_mode",
      "content.mode",
      "Content mode must be none, children, or slots.",
    );
  }
  if (mode !== "slots") {
    if ("slots" in value) {
      return reject(
        "unknown_content_key",
        "content.slots",
        `The ${mode} content branch carries only its mode.`,
      );
    }
    return { ok: true, content: Object.freeze({ mode }) };
  }
  return validateSlots(value["slots"]);
}

function validateSlots(value: unknown): ContentValidationResult {
  if (!isRecord(value)) {
    return reject("invalid_slots", "content.slots", "Slots must be a plain object.");
  }
  const names = boundedEnumerableKeys(value, BOUNDS.dataModelObjectKeys);
  if (names === null) {
    return reject("too_many_slots", "content.slots", "Slot count exceeds B-18.");
  }
  if (names.length === 0) {
    return reject("empty_slots", "content.slots", "Slots mode must declare a named slot.");
  }
  const slots: Record<string, ComponentSlotSpec> = {};
  for (const name of names) {
    const at = `content.slots.${name}`;
    if (!isFacetIdentifier(name)) {
      return reject("invalid_slot_name", at, "A slot name must be a Facet identifier.");
    }
    const result = validateSlot(value[name], at);
    if (!result.ok) {
      return result;
    }
    slots[name] = result.slot;
  }
  return {
    ok: true,
    content: Object.freeze({ mode: "slots", slots: Object.freeze(slots) }),
  };
}

function validateSlot(
  value: unknown,
  at: string,
): { readonly ok: true; readonly slot: ComponentSlotSpec } | ContentRejection {
  if (!isRecord(value)) {
    return reject("invalid_slot_spec", at, "A slot spec must be a plain object.");
  }
  const unknownKey = firstUnknownKey(value, SLOT_KEYS);
  if (unknownKey !== undefined) {
    return reject(
      "unknown_slot_key",
      unknownKey === null ? at : `${at}.${unknownKey}`,
      "The slot spec is closed.",
    );
  }
  const guidance = value["guidance"];
  if (typeof guidance !== "string" || guidance.length === 0) {
    return reject("invalid_slot_guidance", `${at}.guidance`, "Every slot needs guidance text.");
  }
  if (guidance.length > BOUNDS.propGuidanceChars) {
    return reject("slot_guidance_too_long", `${at}.guidance`, "Slot guidance exceeds B-13.");
  }
  const minChildren = value["minChildren"];
  if (!isChildCount(minChildren)) {
    return reject(
      "invalid_slot_min_children",
      `${at}.minChildren`,
      "minChildren must be an integer from zero through B-07.",
    );
  }
  const maxChildren = value["maxChildren"];
  if (!isChildCount(maxChildren)) {
    return reject(
      "invalid_slot_max_children",
      `${at}.maxChildren`,
      "maxChildren must be an integer from zero through B-07.",
    );
  }
  if (minChildren > maxChildren) {
    return reject("inverted_slot_cardinality", at, "minChildren must not exceed maxChildren.");
  }
  const allowedTags =
    "allowedTags" in value
      ? validateAllowedTags(value["allowedTags"], `${at}.allowedTags`)
      : undefined;
  if (allowedTags !== undefined && !allowedTags.ok) {
    return allowedTags;
  }
  return {
    ok: true,
    slot: Object.freeze({
      guidance,
      minChildren,
      maxChildren,
      ...(allowedTags === undefined ? {} : { allowedTags: allowedTags.tags }),
    }),
  };
}

function validateAllowedTags(
  value: unknown,
  at: string,
): { readonly ok: true; readonly tags: readonly string[] } | ContentRejection {
  if (!Array.isArray(value)) {
    return reject("invalid_allowed_tags", at, "allowedTags must be an array.");
  }
  const tags: readonly unknown[] = value;
  if (tags.length === 0) {
    return reject("empty_allowed_tags", at, "allowedTags must name at least one tag.");
  }
  if (tags.length > BOUNDS.componentsPerCatalog) {
    return reject("too_many_allowed_tags", at, "allowedTags exceeds B-09.");
  }
  const seen = new Set<string>();
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index];
    const tagAt = `${at}.${index}`;
    if (!isFacetIdentifier(tag)) {
      return reject("invalid_allowed_tag", tagAt, "An allowed tag must be a Facet identifier.");
    }
    if (tag === "Screen") {
      return reject("screen_not_allowed_in_slot", tagAt, "Screen cannot be nested in a slot.");
    }
    if (seen.has(tag)) {
      return reject("duplicate_allowed_tag", tagAt, "Allowed tags must be distinct.");
    }
    seen.add(tag);
  }
  return { ok: true, tags: Object.freeze([...seen]) };
}

function isChildCount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= BOUNDS.nodesPerDocument
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function firstUnknownKey(
  record: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): string | null | undefined {
  const keys = boundedEnumerableKeys(record, BOUNDS.propsPerElement);
  if (keys === null) return null;
  return keys.find((key) => !allowed.includes(key));
}

function boundedEnumerableKeys(
  record: Readonly<Record<string, unknown>>,
  limit: number,
): readonly string[] | null {
  const keys: string[] = [];
  for (const key in record) {
    if (!Object.hasOwn(record, key)) {
      break;
    }
    keys.push(key);
    if (keys.length > limit) return null;
  }
  return Object.freeze(keys.sort());
}

function reject(code: string, at: string, detail: string): ContentRejection {
  return { ok: false, code, at, detail };
}
