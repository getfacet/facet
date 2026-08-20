import { BOUNDS } from "./bounds.js";
import { isFacetIdentifier } from "./identifiers.js";
import { isArrayValue, isPlainObject } from "./json-shape.js";

/** One scalar field in a closed shallow structured-data shape. */
export interface StructuredFieldSpec {
  readonly type: "string" | "number" | "boolean";
  readonly guidance: string;
  readonly required?: boolean;
}

/** A closed shallow object shape, also used for each item of a shaped array. */
export interface StructuredShapeSpec {
  readonly fields: Readonly<Record<string, StructuredFieldSpec>>;
}

type StructuredShapeValidationResult =
  | { readonly ok: true; readonly shape: StructuredShapeSpec }
  | {
      readonly ok: false;
      readonly code: string;
      readonly at: string;
      readonly detail: string;
    };

type ShapeRejection = Extract<StructuredShapeValidationResult, { readonly ok: false }>;

const SHAPE_KEYS: readonly string[] = ["fields"];
const FIELD_KEYS: readonly string[] = ["type", "guidance", "required"];
const FIELD_TYPES: readonly StructuredFieldSpec["type"][] = ["string", "number", "boolean"];

/**
 * Validates and snapshots a closed scalar field schema.
 *
 * The optional location lets the component-spec validator preserve its own
 * path when a shape is nested under a prop. The function is total for every
 * runtime input, including hostile getters and proxies.
 */
export function validateStructuredShapeSpec(
  value: unknown,
  at = "shape",
):
  | { readonly ok: true; readonly shape: StructuredShapeSpec }
  | { readonly ok: false; readonly code: string; readonly at: string; readonly detail: string } {
  try {
    return validateShape(value, at);
  } catch {
    return reject(
      "structured_shape_read_failed",
      at,
      "Reading the structured shape threw; it must be plain data.",
    );
  }
}

function validateShape(value: unknown, at: string): StructuredShapeValidationResult {
  if (!isPlainObject(value)) {
    return reject(
      "structured_shape_not_an_object",
      at,
      "A structured shape must be a plain object.",
    );
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return reject(
      "unknown_structured_shape_key",
      at,
      "The structured shape form accepts string keys only.",
    );
  }
  const unknownKey = firstUnknownKey(value, SHAPE_KEYS);
  if (unknownKey !== undefined) {
    return reject(
      "unknown_structured_shape_key",
      unknownKey === null ? at : `${at}.${unknownKey}`,
      "The structured shape form is closed.",
    );
  }

  const rawFields = value["fields"];
  if (!isPlainObject(rawFields)) {
    return reject(
      "invalid_structured_fields",
      `${at}.fields`,
      "Structured fields must be a plain object.",
    );
  }
  if (Object.getOwnPropertySymbols(rawFields).length > 0) {
    return reject(
      "invalid_structured_field_name",
      `${at}.fields`,
      "Structured field names must be string Facet identifiers.",
    );
  }

  const names = boundedEnumerableKeys(rawFields, BOUNDS.dataModelObjectKeys);
  if (names === null) {
    return reject(
      "too_many_structured_fields",
      `${at}.fields`,
      "Structured field count exceeds B-18.",
    );
  }
  const fields: Record<string, StructuredFieldSpec> = Object.create(null) as Record<
    string,
    StructuredFieldSpec
  >;
  for (const name of names) {
    const fieldAt = `${at}.fields.${name}`;
    if (!isFacetIdentifier(name)) {
      return reject(
        "invalid_structured_field_name",
        fieldAt,
        "A structured field name must be a Facet identifier.",
      );
    }
    const field = validateField(rawFields[name], fieldAt);
    if (!field.ok) {
      return field;
    }
    defineFrozenEntry(fields, name, field.field);
  }

  return {
    ok: true,
    shape: Object.freeze({ fields: Object.freeze(fields) }),
  };
}

function validateField(
  value: unknown,
  at: string,
): { readonly ok: true; readonly field: StructuredFieldSpec } | ShapeRejection {
  if (!isPlainObject(value)) {
    return reject(
      "invalid_structured_field",
      at,
      "A structured field spec must be a plain object.",
    );
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return reject(
      "unknown_structured_field_key",
      at,
      "The structured field form accepts string keys only.",
    );
  }
  const unknownKey = firstUnknownKey(value, FIELD_KEYS);
  if (unknownKey !== undefined) {
    return reject(
      "unknown_structured_field_key",
      unknownKey === null ? at : `${at}.${unknownKey}`,
      "The structured field form is closed.",
    );
  }

  const type = value["type"];
  if (typeof type !== "string" || !FIELD_TYPES.includes(type as StructuredFieldSpec["type"])) {
    return reject(
      "invalid_structured_field_type",
      `${at}.type`,
      "A structured field must be a string, number, or boolean.",
    );
  }

  const guidance = value["guidance"];
  if (typeof guidance !== "string" || guidance.length === 0) {
    return reject(
      "invalid_structured_field_guidance",
      `${at}.guidance`,
      "Every structured field needs guidance text.",
    );
  }
  if (guidance.length > BOUNDS.propGuidanceChars) {
    return reject(
      "structured_field_guidance_too_long",
      `${at}.guidance`,
      "Structured field guidance exceeds B-13.",
    );
  }

  const required = value["required"];
  if ("required" in value && typeof required !== "boolean") {
    return reject(
      "invalid_structured_field_required",
      `${at}.required`,
      "required must be a boolean when declared.",
    );
  }

  return {
    ok: true,
    field: Object.freeze({
      type: type as StructuredFieldSpec["type"],
      guidance,
      ...(typeof required === "boolean" ? { required } : {}),
    }),
  };
}

/**
 * Checks a resolved object or array value against a validated shallow shape.
 * Arrays apply the same closed object contract independently to every item.
 */
export function validateStructuredValue(
  value: unknown,
  containerType: "object" | "array",
  shape: StructuredShapeSpec,
): boolean {
  try {
    const validatedShape = validateStructuredShapeSpec(shape);
    if (!validatedShape.ok) {
      return false;
    }
    if (containerType === "object") {
      return matchesObject(value, validatedShape.shape.fields);
    }
    if (containerType !== "array" || !isArrayValue(value)) {
      return false;
    }
    if (value.length > BOUNDS.dataModelArrayLength) {
      return false;
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!matchesObject(value[index], validatedShape.shape.fields)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function matchesObject(
  value: unknown,
  fields: Readonly<Record<string, StructuredFieldSpec>>,
): boolean {
  if (!isPlainObject(value)) {
    return false;
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return false;
  }
  const valueKeys = Object.getOwnPropertyNames(value);
  if (valueKeys.length > BOUNDS.dataModelObjectKeys) {
    return false;
  }
  for (const key of valueKeys) {
    if (!Object.hasOwn(fields, key)) {
      return false;
    }
  }

  for (const name of Object.getOwnPropertyNames(fields)) {
    const field = fields[name];
    if (field === undefined) {
      return false;
    }
    const present = Object.hasOwn(value, name);
    if (!present) {
      if (field.required === true) {
        return false;
      }
      continue;
    }
    if (!matchesFieldValue(value[name], field.type)) {
      return false;
    }
  }
  return true;
}

function matchesFieldValue(value: unknown, type: StructuredFieldSpec["type"]): boolean {
  switch (type) {
    case "string":
      return typeof value === "string" && value.length <= BOUNDS.dataModelStringChars;
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
  }
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

function defineFrozenEntry<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    writable: false,
    configurable: false,
  });
}

function reject(code: string, at: string, detail: string): ShapeRejection {
  return { ok: false, code, at, detail };
}
