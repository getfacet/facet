/**
 * Read-only resolution of a `data:path` reference against the Data Model.
 *
 * A binding is authorized by the **declared prop schema**, not by the reference:
 * a prop only accepts a `data:` reference when its component spec declares it
 * bindable, and the value the path selects must satisfy the same schema an
 * inline authored value would have to satisfy. Facet reads; it never fetches,
 * projects, or coerces.
 *
 * **A missing path rejects.** It is never rendered as empty. "Empty" is an
 * explicit, schema-valid value — `""`, `[]`, `{}` — that the model actually
 * holds, and it is a different outcome from a path that selects nothing.
 * Collapsing the two would let a typo, a renamed key, or a publish that never
 * landed present itself to the visitor as real, empty data.
 *
 * **The same-domain rule.** A bound value clears exactly the domain an inline
 * authored value clears — type, `enum`, **and** the numeric `minimum`/`maximum`
 * `checkNumber` in `document-validation.ts` enforces. A binding is a second way
 * to fill a prop, never a second, weaker contract: a value the author grammar
 * refused must not become mountable by arriving through the Data Model instead.
 *
 * `resolveBinding` is **total**: it never throws, for any reference, model, or
 * schema. Totality here is a property of the code, not of this sentence — every
 * primitive it reaches through (`Array.isArray`, `Object.getPrototypeOf`,
 * `hasOwnProperty`, `Object.keys`, a property read, an `enum` membership test)
 * throws on a revoked `Proxy` or a hostile trap, so each is called behind a
 * guard that turns the failure into one of the closed reject reasons. The cost
 * of getting this wrong is not confined to one caller: resolving a node's props catches
 * one throw and loses every sibling prop that had already resolved, reporting
 * a clean success for a node that failed.
 *
 * This module exports exactly `resolveBinding` and `BindingResolution`, and
 * nothing else; every other symbol here is private.
 */

import type { DataModel } from "./data-model.js";
import { parseDataPath } from "./identifiers.js";
import { isArrayValue, isPlainObject } from "./json-shape.js";
import {
  type StructuredShapeSpec,
  validateStructuredShapeSpec,
  validateStructuredValue,
} from "./structured-shape.js";

/** The authored prefix of a data reference; the bare dotted path is also accepted. */
const DATA_PREFIX = "data:";

/** The prop types a binding may satisfy — the restricted JSON-Schema subset. */
const BINDABLE_TYPES = ["string", "number", "boolean", "array", "object"] as const;

type BindableType = (typeof BINDABLE_TYPES)[number];

/**
 * The two **structured** branches. They are shallow, closed and binding-only:
 * they declare no element or property contract, so a resolution checks that the
 * value is a collection or a record and stops there. Nothing deeper is declared,
 * so nothing deeper may be assumed.
 */
const STRUCTURED_TYPES: readonly BindableType[] = ["array", "object"];

/**
 * Every keyword a structured branch admits. `enum`, `default`, `minimum` and
 * `maximum` belong to the scalar branches only, so a structured schema carrying
 * one is not a `PropSchema` this resolver understands — and silently ignoring an
 * unadmitted keyword would resolve a binding against a contract the author
 * believes is being enforced.
 */
const STRUCTURED_KEYWORDS: readonly string[] = [
  "type",
  "guidance",
  "required",
  "bindable",
  "shape",
];

/**
 * The part of a declared prop schema a binding needs to consult.
 *
 * `minimum` and `maximum` are carried because the author path enforces them: a
 * resolver that read the type and the `enum` and stopped would accept a bound
 * value its own catalog refuses to let an author write.
 */
type BindingSchema = {
  readonly type: BindableType;
  readonly bindable: boolean;
  readonly enum: readonly unknown[] | null;
  readonly minimum: number | null;
  readonly maximum: number | null;
  readonly shape: StructuredShapeSpec | null;
};

/**
 * The outcome of resolving one binding.
 *
 * Exported because `resolveBinding` is: a renderer or validator that stores a
 * resolution, threads it through a helper, or narrows it in a second function
 * has to **name** it, and an unexported result type turns that into
 * `TS2459: declares 'X' locally, but it is not exported`.
 *
 * The reject reasons are written out inline rather than behind a shared private
 * alias. A `.d.ts` may carry an unexported alias, but a consumer cannot name it,
 * so spelling the union out keeps every part of this emitted signature nameable
 * while the module's export list stays exactly `resolveBinding` and this type.
 */
export type BindingResolution =
  | {
      readonly ok: true;
      /** The selected value, already agreed with the declared prop schema. */
      readonly value:
        string | number | boolean | readonly unknown[] | { readonly [key: string]: unknown };
    }
  | {
      readonly ok: false;
      /** Why the binding did not resolve. Closed, structured, and stable. */
      readonly reason:
        | "invalid_prop_schema"
        | "prop_not_bindable"
        | "invalid_reference"
        | "path_not_found"
        | "schema_mismatch";
    };

/** Marks a property read that threw, so a hostile getter can never escape. */
const READ_FAILED = Symbol("facet.readFailed");

/**
 * Reads one **own** property without ever throwing.
 *
 * Own-property lookup is what keeps `toString` or `constructor` from resolving:
 * an inherited member is not data the host published, so it must read as
 * missing rather than as a value.
 *
 * The presence test is inside the `try` because it is itself a trapped
 * operation: `hasOwnProperty` goes through `getOwnPropertyDescriptor`, which a
 * proxy may refuse. A key whose presence cannot be established is not present.
 */
function readOwn(container: Record<string, unknown>, key: string): unknown {
  try {
    if (!Object.prototype.hasOwnProperty.call(container, key)) {
      return READ_FAILED;
    }
    return container[key];
  } catch {
    return READ_FAILED;
  }
}

/**
 * Reads one keyword off an unvalidated prop schema without ever throwing.
 *
 * A prop schema is `unknown`, so it may carry a getter that throws — and every
 * keyword this resolver consults is a plain property read. `READ_FAILED` is a
 * symbol, so an unreadable keyword fails each caller's `typeof` or array test
 * on its own and lands on `invalid_prop_schema` without a special case.
 */
function readKeyword(propSchema: Record<string, unknown>, key: string): unknown {
  try {
    return propSchema[key];
  } catch {
    return READ_FAILED;
  }
}

/**
 * The schema's own enumerable keys, or `null` when they cannot be enumerated.
 *
 * The two outcomes must stay distinct: an unreadable key set is not an empty
 * one. Treating it as empty would let a proxy pass the structured branches'
 * closed-keyword check by refusing to say what it declares.
 */
function schemaKeys(propSchema: Record<string, unknown>): readonly string[] | null {
  try {
    return Object.keys(propSchema);
  } catch {
    return null;
  }
}

/** Reads an optional numeric domain bound: absent, a finite number, or invalid. */
function readBound(propSchema: Record<string, unknown>, key: string): number | null | "invalid" {
  const declared = readKeyword(propSchema, key);
  if (declared === undefined) {
    return null;
  }
  if (typeof declared !== "number" || !Number.isFinite(declared)) {
    return "invalid";
  }
  return declared;
}

/**
 * Narrows an unvalidated prop schema to the bindable subset a resolution needs,
 * or returns `null` when it is not a schema this resolver understands.
 *
 * The schema arrives as `unknown` deliberately: the catalog is the trust
 * boundary that admits it, and an unrecognized shape must reject here rather
 * than be assumed well-formed.
 */
function readSchema(propSchema: unknown): BindingSchema | null {
  if (!isPlainObject(propSchema)) {
    return null;
  }
  const declaredType = readKeyword(propSchema, "type");
  if (typeof declaredType !== "string") {
    return null;
  }
  const type = BINDABLE_TYPES.find((candidate) => candidate === declaredType);
  if (type === undefined) {
    return null;
  }
  const declaredBindable = readKeyword(propSchema, "bindable");
  if (declaredBindable !== undefined && typeof declaredBindable !== "boolean") {
    return null;
  }
  const bindable = declaredBindable === true;

  if (STRUCTURED_TYPES.includes(type)) {
    const keywords = schemaKeys(propSchema);
    if (keywords === null) {
      return null;
    }
    for (const keyword of keywords) {
      if (!STRUCTURED_KEYWORDS.includes(keyword)) {
        return null;
      }
    }
    const rawShape = readKeyword(propSchema, "shape");
    let shape: StructuredShapeSpec | null = null;
    if (rawShape !== undefined) {
      const validation = validateStructuredShapeSpec(rawShape);
      if (!validation.ok) {
        return null;
      }
      shape = validation.shape;
    }
    // A structured branch declares no scalar domain; an optional shape governs
    // the shallow object or every shallow object item in an array.
    return { type, bindable, enum: null, minimum: null, maximum: null, shape };
  }

  const declaredEnum = readKeyword(propSchema, "enum");
  if (declaredEnum !== undefined && !isArrayValue(declaredEnum)) {
    return null;
  }

  // Only the `number` branch admits a range, so only it reads one. Reading
  // `minimum` off a string schema would enforce a keyword the catalog does not
  // let that branch declare in the first place.
  const minimum = type === "number" ? readBound(propSchema, "minimum") : null;
  const maximum = type === "number" ? readBound(propSchema, "maximum") : null;
  if (minimum === "invalid" || maximum === "invalid") {
    return null;
  }

  return {
    type,
    bindable,
    enum: declaredEnum === undefined ? null : declaredEnum,
    minimum,
    maximum,
    shape: null,
  };
}

/**
 * The three outcomes of testing a selected value against a declared schema.
 *
 * `unreadable` is separate from `mismatch` on purpose: a schema whose own
 * domain cannot be consulted is not a schema that rejected the value, and
 * reporting it as a mismatch would blame the published data for a fault in the
 * declaration.
 */
type SchemaAgreement = "agrees" | "mismatch" | "unreadable";

/**
 * Whether the selected value satisfies the declared type and the full domain —
 * the same domain `checkNumber` and the string `enum` check enforce on the
 * author path, in the same order: type, then `enum`, then `minimum`, then
 * `maximum`.
 *
 * The membership test is the one place this module calls back into a value the
 * catalog handed it: `enum` is declared data, and an `Array` subclass or proxy
 * can make `includes` throw or make an element read throw. An enum whose
 * membership cannot be decided leaves the schema unreadable rather than
 * silently admitting or refusing the value.
 */
function agreesWithSchema(value: unknown, schema: BindingSchema): SchemaAgreement {
  const typeAgrees = ((): boolean => {
    switch (schema.type) {
      case "string":
        return typeof value === "string";
      case "number":
        return typeof value === "number" && Number.isFinite(value);
      case "boolean":
        return typeof value === "boolean";
      case "array":
        return isArrayValue(value);
      case "object":
        return isPlainObject(value);
    }
  })();
  if (!typeAgrees) {
    return "mismatch";
  }

  if (
    schema.shape !== null &&
    (schema.type === "array" || schema.type === "object") &&
    !validateStructuredValue(value, schema.type, schema.shape)
  ) {
    return "mismatch";
  }

  if (schema.enum !== null) {
    let admitted: boolean;
    try {
      admitted = schema.enum.includes(value);
    } catch {
      return "unreadable";
    }
    if (!admitted) {
      return "mismatch";
    }
  }

  if (typeof value === "number") {
    if (schema.minimum !== null && value < schema.minimum) {
      return "mismatch";
    }
    if (schema.maximum !== null && value > schema.maximum) {
      return "mismatch";
    }
  }
  return "agrees";
}

/**
 * Resolves an authored `data:path` reference against `model`, authorized by the
 * prop's declared schema.
 *
 * The reference may carry its authored `data:` prefix or arrive already
 * stripped; `data:` can never be a legal first segment, so accepting both is
 * unambiguous. Path grammar comes from `parseDataPath` — there is one path
 * grammar in Facet, and it admits **named keys only** (D-06).
 *
 * Traversal descends through plain objects only. An array is a terminal value:
 * a path never addresses a position inside a collection, and refusing to
 * descend is also what stops `rows.length` from reading as published data.
 */
export function resolveBinding(
  reference: unknown,
  model: DataModel,
  propSchema: unknown,
): BindingResolution {
  const schema = readSchema(propSchema);
  if (schema === null) {
    return { ok: false, reason: "invalid_prop_schema" };
  }
  if (!schema.bindable) {
    return { ok: false, reason: "prop_not_bindable" };
  }

  const bare =
    typeof reference === "string" && reference.startsWith(DATA_PREFIX)
      ? reference.slice(DATA_PREFIX.length)
      : reference;
  const path = parseDataPath(bare);
  if (path === null) {
    return { ok: false, reason: "invalid_reference" };
  }

  let cursor: unknown = model;
  for (const segment of path) {
    if (!isPlainObject(cursor)) {
      return { ok: false, reason: "path_not_found" };
    }
    const next = readOwn(cursor, segment);
    if (next === READ_FAILED || next === undefined) {
      return { ok: false, reason: "path_not_found" };
    }
    cursor = next;
  }

  const agreement = agreesWithSchema(cursor, schema);
  if (agreement === "unreadable") {
    return { ok: false, reason: "invalid_prop_schema" };
  }
  if (agreement === "mismatch") {
    return { ok: false, reason: "schema_mismatch" };
  }
  // `agreesWithSchema` has just proven `cursor` inhabits one of the five
  // declarable types, which is exactly the resolved-value union.
  if (
    typeof cursor === "string" ||
    typeof cursor === "number" ||
    typeof cursor === "boolean" ||
    isArrayValue(cursor) ||
    isPlainObject(cursor)
  ) {
    return { ok: true, value: cursor };
  }
  return { ok: false, reason: "schema_mismatch" };
}
