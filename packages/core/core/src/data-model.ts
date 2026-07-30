/**
 * The bounded hierarchical Data Model and its single measurement point.
 *
 * A session holds **one** Data Model per document. A publish never mutates it:
 * `writePath` derives a *candidate* model from the prior one, and
 * `evaluateCandidateModel` decides whether that candidate may be committed.
 *
 * **The measurement rule.** `B-15..B-19` are evaluated on the **complete
 * candidate model a publish would produce**, never on the incoming payload.
 * Measuring the payload alone would let a sequence of individually small
 * publishes accumulate an unbounded model, which makes the bound decorative.
 * `B-20` separately bounds an agent-authored incoming payload — a different
 * question, measured by `measurePublishPayload`, because a large payload can
 * produce a small model. `B-21` is **not** measured here at all: it is a
 * deterministic *clamp* on what one `read_data` result projects — items and
 * characters together, whichever binds first — and never a rejection of stored
 * data, so it belongs to that read tool rather than to the model.
 *
 * **The public surface.** This module exports exactly `DataModel`, `writePath`,
 * `evaluateCandidateModel`, `DataModelEvaluation`, `measurePublishPayload` and
 * `PayloadEvaluation`, and nothing else; every other symbol here is private.
 * The payload helper is public because `B-20` bounds an **agent-authored**
 * hand-in while the agent tools live in a different package: `publish_data` must
 * be able to import this one total helper. Left private, that caller would
 * re-derive the measurement as `JSON.stringify(payload).length` — which throws
 * on a cycle or a `BigInt`, reopening the exact fail-safe hole this module
 * exists to close.
 *
 * Both **result types** are public because both producing functions are. A
 * cross-package caller that stores an outcome, passes it on, or writes a helper
 * over it must be able to name what it is holding; an unexported result type
 * makes that `TS2459` and pushes the caller into restating the shape. For the
 * same reason no private alias appears inside either type: a `.d.ts` may carry
 * an unexported alias, but a consumer cannot name it, so each reject branch is
 * spelled out inline and the private aliases are derived from the public types.
 *
 * **The structural precondition.** Before any measurement,
 * `evaluateCandidateModel` walks the candidate and rejects anything that is not
 * plain JSON data — a cycle, a `BigInt`, a function, a symbol, `undefined`, a
 * non-finite number, an exotic object, or a property whose getter throws. This
 * is a *rejection rule, not a bound*: it adds and adjusts no `B-01..B-25`
 * value. It exists because the in-process publish paths hand **real JS objects**
 * in; without it `JSON.stringify` throws on a cycle and value counting never
 * terminates, which would break invariant 3's fail-safe fold from the inside.
 *
 * Every function here is **total**: it never throws and always terminates, for
 * any input of any type and any size. Each walk is iterative — recursion would
 * turn a deeply nested candidate into a stack overflow, which is a throw.
 */

import { BOUNDS } from "./bounds.js";
import type { DataPath } from "./identifiers.js";

/**
 * The bounded hierarchical model a document reads through `data:` references.
 *
 * The value type is deliberately opaque. Validity is proven by
 * `evaluateCandidateModel` at the one write entrypoint, not asserted by the
 * declaration — a declared recursive JSON type would claim a guarantee the
 * type system cannot enforce over values arriving from a host process.
 */
export type DataModel = { readonly [key: string]: unknown };

/**
 * The outcome of evaluating one candidate model.
 *
 * Exported for the same reason `PayloadEvaluation` is: `evaluateCandidateModel`
 * is public, so a caller that stores an outcome, hands it on, or writes a helper
 * over it has to **name** it — and an unexported result type turns that into
 * `TS2459: declares 'X' locally, but it is not exported`.
 *
 * The reject branch is written out inline rather than referring to a shared
 * private alias. A `.d.ts` may carry an unexported alias, but a consumer then
 * cannot name that branch on its own; spelling it out keeps every part of this
 * emitted signature nameable while the module's export list stays exactly the
 * six documented names.
 */
export type DataModelEvaluation =
  | {
      readonly ok: true;
      /** The candidate, now cleared for commit. */
      readonly model: DataModel;
      /** Deterministic, key-sorted, whitespace-free JSON of the whole model. */
      readonly canonicalJson: string;
      /** Every node in the model — the root, each container and each scalar. */
      readonly valueCount: number;
    }
  | {
      readonly ok: false;
      /** Why the candidate may not be committed. Closed, structured, and stable. */
      readonly reason:
        | "data_not_serializable"
        | "data_model_not_an_object"
        | "data_model_chars_exceeded"
        | "data_model_values_exceeded"
        | "data_array_length_exceeded"
        | "data_object_keys_exceeded"
        | "data_string_chars_exceeded"
        | "publish_payload_chars_exceeded";
      /** The bound that was crossed, or `null` for the serializability rule. */
      readonly bound: string | null;
      /** Where in the candidate the rejection happened; `""` is the model root. */
      readonly path: string;
    };

/**
 * The reject branch, named for the private measurement helpers that build one.
 * Derived from the public type so the two can never drift apart, and never
 * itself part of an emitted public signature.
 */
type Reject = Extract<DataModelEvaluation, { readonly ok: false }>;

/** Marks a property read that threw, so a hostile getter becomes a rejection. */
const READ_FAILED = Symbol("facet.readFailed");

/** Own enumerable string keys, the exact set JSON serialization considers. */
function ownKeys(container: object): readonly string[] | typeof READ_FAILED {
  try {
    return Object.keys(container);
  } catch {
    return READ_FAILED;
  }
}

/** Array length, read safely because Proxies can throw from the `length` trap. */
function arrayLength(container: readonly unknown[]): number | typeof READ_FAILED {
  try {
    return container.length;
  } catch {
    return READ_FAILED;
  }
}

/**
 * Reads one own property without ever throwing. A getter that throws yields
 * `READ_FAILED`, which every classifier treats as non-serializable.
 */
function readOwn(container: object, key: string): unknown {
  try {
    return (container as Record<string, unknown>)[key];
  } catch {
    return READ_FAILED;
  }
}

/**
 * Whether `value` is an array.
 *
 * `Array.isArray` is not total: on a revoked `Proxy` it throws
 * `TypeError: Cannot perform 'IsArray' on a proxy that has been revoked`. Since
 * the in-process publish paths hand real JS objects in, an unguarded call here
 * would let that `TypeError` escape the one write entrypoint — the very failure
 * the structural precondition exists to prevent. A value whose array-ness
 * cannot be established is not an array.
 */
function isArrayValue(value: unknown): value is readonly unknown[] {
  try {
    return Array.isArray(value);
  } catch {
    return false;
  }
}

/**
 * Whether `value` is a plain JSON object — not an array, Date, Map or instance.
 *
 * Total for the same reason `isArrayValue` is: `Object.getPrototypeOf` also
 * throws on a revoked proxy, and a proxy may install a `getPrototypeOf` trap
 * that throws. Such a value classifies as neither an array nor a plain object,
 * which makes it non-serializable — the correct outcome, since it is not JSON
 * data and nothing can be read out of it.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  try {
    if (typeof value !== "object" || value === null || isArrayValue(value)) {
      return false;
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

/** Extends a diagnostic path with one object key or array index. */
function extendPath(prefix: string, key: string, inArray: boolean): string {
  if (inArray) {
    return `${prefix}[${key}]`;
  }
  return prefix === "" ? key : `${prefix}.${key}`;
}

/** Whether a value is JSON data in its own right, ignoring its children. */
function isSerializableValue(value: unknown): boolean {
  if (value === null) {
    return true;
  }
  switch (typeof value) {
    case "string":
    case "boolean":
      return true;
    case "number":
      return Number.isFinite(value);
    case "object":
      return isArrayValue(value) || isPlainObject(value);
    default:
      // undefined, bigint, function, symbol — and the READ_FAILED sentinel.
      return false;
  }
}

/** One level of a container, materialized so the walk can be iterative. */
type Frame = {
  readonly container: object;
  readonly entries: readonly (readonly [string, unknown])[];
  readonly path: string;
  index: number;
};

/** Materializes a container's children as `[key, value]` pairs, reading safely. */
function frameFor(container: object, path: string): Frame | typeof READ_FAILED {
  const entries: (readonly [string, unknown])[] = [];
  if (isArrayValue(container)) {
    const length = arrayLength(container);
    if (length === READ_FAILED) {
      return READ_FAILED;
    }
    for (let index = 0; index < length; index += 1) {
      entries.push([String(index), readOwn(container, String(index))]);
    }
  } else {
    const keys = ownKeys(container);
    if (keys === READ_FAILED) {
      return READ_FAILED;
    }
    for (const key of keys) {
      entries.push([key, readOwn(container, key)]);
    }
  }
  return { container, entries, path, index: 0 };
}

/**
 * The structural precondition. Returns the path of the first value that is not
 * plain JSON data, or `null` when the whole candidate is serializable.
 *
 * Two sets carry the walk. `ancestors` holds the containers currently open, so
 * a self-reference or a mutual cycle is caught the moment it closes. `checked`
 * holds every container already cleared, so a shared **acyclic** subtree — legal
 * JSON — is verified once instead of re-walked. Without `checked`, a graph that
 * shares nodes exponentially would take exponential time here even though it is
 * perfectly serializable; with it, the walk is linear in the number of distinct
 * containers and therefore always terminates.
 */
function findUnserializable(root: unknown): string | null {
  if (!isSerializableValue(root)) {
    return "";
  }
  if (typeof root !== "object" || root === null) {
    return null;
  }

  const ancestors = new Set<object>([root]);
  const checked = new Set<object>([root]);
  if (isArrayValue(root)) {
    const length = arrayLength(root);
    if (length === READ_FAILED) {
      return "";
    }
    if (length > BOUNDS.dataModelArrayLength) {
      return null;
    }
  }
  const initialFrame = frameFor(root, "");
  if (initialFrame === READ_FAILED) {
    return "";
  }
  const stack: Frame[] = [initialFrame];

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame === undefined) {
      break;
    }
    const entry = frame.entries[frame.index];
    if (entry === undefined) {
      stack.pop();
      ancestors.delete(frame.container);
      continue;
    }
    frame.index += 1;

    const [key, value] = entry;
    const path = extendPath(frame.path, key, isArrayValue(frame.container));
    if (!isSerializableValue(value)) {
      return path;
    }
    if (typeof value !== "object" || value === null) {
      continue;
    }
    if (isArrayValue(value)) {
      const length = arrayLength(value);
      if (length === READ_FAILED) {
        return path;
      }
      if (length > BOUNDS.dataModelArrayLength) {
        continue;
      }
    }
    if (ancestors.has(value)) {
      return path;
    }
    if (checked.has(value)) {
      continue;
    }
    ancestors.add(value);
    checked.add(value);
    const next = frameFor(value, path);
    if (next === READ_FAILED) {
      return path;
    }
    stack.push(next);
  }
  return null;
}

/**
 * Counts every value and checks the per-node bounds `B-16`, `B-17`, `B-18` and
 * `B-19`. A container's own bound is checked before its children are walked, so
 * the reported reason is the structural one.
 *
 * The value counter aborts the instant it passes `B-16`. That abort is what
 * bounds a legal but exponentially shared graph: the model *expands* to an
 * astronomical value count, and the walk stops after `B-16` + 1 steps.
 */
function measureStructure(root: DataModel): {
  readonly reject: Reject | null;
  readonly valueCount: number;
} {
  let valueCount = 0;
  const stack: Frame[] = [];

  const visit = (value: unknown, path: string): Reject | null => {
    valueCount += 1;
    if (valueCount > BOUNDS.dataModelValues) {
      return { ok: false, reason: "data_model_values_exceeded", bound: "B-16", path: "" };
    }
    if (typeof value === "string" && value.length > BOUNDS.dataModelStringChars) {
      return { ok: false, reason: "data_string_chars_exceeded", bound: "B-19", path };
    }
    if (isArrayValue(value)) {
      const length = arrayLength(value);
      if (length === READ_FAILED) {
        return { ok: false, reason: "data_not_serializable", bound: null, path };
      }
      if (length > BOUNDS.dataModelArrayLength) {
        return { ok: false, reason: "data_array_length_exceeded", bound: "B-17", path };
      }
      const frame = frameFor(value, path);
      if (frame === READ_FAILED) {
        return { ok: false, reason: "data_not_serializable", bound: null, path };
      }
      stack.push(frame);
      return null;
    }
    if (isPlainObject(value)) {
      const keys = ownKeys(value);
      if (keys === READ_FAILED) {
        return { ok: false, reason: "data_not_serializable", bound: null, path };
      }
      if (keys.length > BOUNDS.dataModelObjectKeys) {
        return { ok: false, reason: "data_object_keys_exceeded", bound: "B-18", path };
      }
      const frame = frameFor(value, path);
      if (frame === READ_FAILED) {
        return { ok: false, reason: "data_not_serializable", bound: null, path };
      }
      stack.push(frame);
    }
    return null;
  };

  const seeded = visit(root, "");
  if (seeded !== null) {
    return { reject: seeded, valueCount };
  }

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame === undefined) {
      break;
    }
    const entry = frame.entries[frame.index];
    if (entry === undefined) {
      stack.pop();
      continue;
    }
    frame.index += 1;
    const [key, value] = entry;
    const rejected = visit(value, extendPath(frame.path, key, isArrayValue(frame.container)));
    if (rejected !== null) {
      return { reject: rejected, valueCount };
    }
  }
  return { reject: null, valueCount };
}

/** One step of the canonical serializer: emit fixed text, or serialize a value. */
type EmitTask = { readonly literal: string } | { readonly value: unknown };

/**
 * Serializes the model to canonical JSON — object keys sorted by code unit, no
 * whitespace — aborting with `null` the moment the output would pass `maxChars`.
 *
 * The abort is what makes `B-15` enforceable rather than aspirational: a model
 * that is within `B-16` may still hold hundreds of megabytes of text, and
 * serializing it whole before measuring would be the very exhaustion the bound
 * exists to prevent.
 */
function canonicalize(root: unknown, maxChars: number): string | null {
  const chunks: string[] = [];
  let length = 0;
  const stack: EmitTask[] = [{ value: root }];

  const emit = (text: string): boolean => {
    length += text.length;
    if (length > maxChars) {
      return false;
    }
    chunks.push(text);
    return true;
  };

  const pushAll = (tasks: EmitTask[]): void => {
    for (let index = tasks.length - 1; index >= 0; index -= 1) {
      const task = tasks[index];
      if (task !== undefined) {
        stack.push(task);
      }
    }
  };

  while (stack.length > 0) {
    const task = stack.pop();
    if (task === undefined) {
      break;
    }
    if ("literal" in task) {
      if (!emit(task.literal)) {
        return null;
      }
      continue;
    }

    const value = task.value;
    if (value === null || !isSerializableValue(value)) {
      // A JSON null, or — unreachable after the precondition — anything that is
      // not JSON data at all, which stays total by serializing as null.
      if (!emit("null")) {
        return null;
      }
      continue;
    }
    if (typeof value === "string" || typeof value === "number") {
      if (!emit(JSON.stringify(value))) {
        return null;
      }
      continue;
    }
    if (typeof value === "boolean") {
      if (!emit(value ? "true" : "false")) {
        return null;
      }
      continue;
    }
    if (isArrayValue(value)) {
      const tasks: EmitTask[] = [{ literal: "[" }];
      const length = arrayLength(value);
      if (length === READ_FAILED) {
        if (!emit("null")) {
          return null;
        }
        continue;
      }
      if (length > BOUNDS.dataModelArrayLength) {
        return null;
      }
      for (let index = 0; index < length; index += 1) {
        if (index > 0) {
          tasks.push({ literal: "," });
        }
        tasks.push({ value: readOwn(value, String(index)) });
      }
      tasks.push({ literal: "]" });
      pushAll(tasks);
      continue;
    }

    if (isPlainObject(value)) {
      const unsortedKeys = ownKeys(value);
      if (unsortedKeys === READ_FAILED) {
        if (!emit("null")) {
          return null;
        }
        continue;
      }
      const keys = [...unsortedKeys].sort();
      const tasks: EmitTask[] = [{ literal: "{" }];
      for (const [index, key] of keys.entries()) {
        tasks.push({ literal: `${index > 0 ? "," : ""}${JSON.stringify(key)}:` });
        tasks.push({ value: readOwn(value, key) });
      }
      tasks.push({ literal: "}" });
      pushAll(tasks);
      continue;
    }

    // Unreachable once the precondition has passed; `null` keeps this total.
    if (!emit("null")) {
      return null;
    }
  }
  return chunks.join("");
}

/**
 * Derives the candidate model a publish of `value` at `path` would produce.
 *
 * The prior model is never mutated: every object along the path is rebuilt and
 * every untouched subtree is shared by reference. That is what lets a rejected
 * publish leave prior data byte-identical — there is nothing to roll back.
 *
 * An intermediate segment that is not a plain object is replaced, including an
 * array: a data path addresses **named keys only** (D-06), so it never
 * describes a position inside a collection.
 *
 * The result is a *candidate*. It carries `value` unvalidated and is only a
 * committable model once `evaluateCandidateModel` accepts it.
 */
export function writePath(model: DataModel, path: DataPath, value: unknown): DataModel {
  const parents: DataModel[] = [model];
  for (let index = 0; index < path.length - 1; index += 1) {
    const parent = parents[index];
    const segment = path[index];
    if (parent === undefined || segment === undefined) {
      break;
    }
    const existing = Object.prototype.hasOwnProperty.call(parent, segment)
      ? parent[segment]
      : undefined;
    parents.push(isPlainObject(existing) ? existing : {});
  }

  let result = model;
  let child: unknown = value;
  for (let index = parents.length - 1; index >= 0; index -= 1) {
    const parent = parents[index];
    const segment = path[index];
    if (parent === undefined || segment === undefined) {
      continue;
    }
    result = { ...parent, [segment]: child };
    child = result;
  }
  return result;
}

/**
 * Decides whether a candidate model may be committed, measuring the **whole**
 * candidate rather than whatever the publish contributed to it.
 *
 * The order is load-bearing:
 *
 * 1. the structural precondition — a non-serializable candidate is rejected
 *    before anything tries to count or serialize it;
 * 2. the model root must be an object;
 * 3. `B-16`, `B-17`, `B-18`, `B-19` over every node; then
 * 4. `B-15` over the canonical JSON, built with an abort so an over-large model
 *    is never fully materialized.
 *
 * Never throws and always terminates, for any input.
 */
export function evaluateCandidateModel(candidate: unknown): DataModelEvaluation {
  const unserializableAt = findUnserializable(candidate);
  if (unserializableAt !== null) {
    return { ok: false, reason: "data_not_serializable", bound: null, path: unserializableAt };
  }
  if (!isPlainObject(candidate)) {
    return { ok: false, reason: "data_model_not_an_object", bound: null, path: "" };
  }

  const structure = measureStructure(candidate);
  if (structure.reject !== null) {
    return structure.reject;
  }

  const canonicalJson = canonicalize(candidate, BOUNDS.dataModelCanonicalJsonChars);
  if (canonicalJson === null) {
    return { ok: false, reason: "data_model_chars_exceeded", bound: "B-15", path: "" };
  }

  const detached: unknown = JSON.parse(canonicalJson);
  if (!isPlainObject(detached)) {
    return { ok: false, reason: "data_model_not_an_object", bound: null, path: "" };
  }

  return { ok: true, model: detached, canonicalJson, valueCount: structure.valueCount };
}

/**
 * The outcome of measuring one incoming agent payload against `B-20`.
 *
 * Exported alongside `measurePublishPayload`: a cross-package caller that has to
 * hold, pass on, or narrow an outcome needs to name it, and an anonymous return
 * type would push that caller into restating the shape.
 *
 * The reject branch is the same one `DataModelEvaluation` carries — the two
 * helpers reject through one closed reason vocabulary, so this reuses that
 * branch rather than declaring a second, drifting copy of it.
 */
export type PayloadEvaluation =
  | { readonly ok: true; readonly chars: number }
  | Extract<DataModelEvaluation, { readonly ok: false }>;

/**
 * Measures an incoming `publish_data` payload against `B-20`.
 *
 * `B-20` is a different question from `B-15..B-19`: those bound the model a
 * publish *results in*, this bounds what one agent turn may hand in. A caller
 * cannot substitute the model bounds for it — a payload can be arbitrarily large
 * while the resulting model stays small, because a publish overwrites a path.
 *
 * The obvious implementation, `JSON.stringify(payload).length`, is not
 * available: the in-process publish paths hand real JS objects in, and
 * `JSON.stringify` **throws** on a cycle or a `BigInt`. So the structural
 * precondition runs first here too, and the measurement reuses the aborting
 * canonical serializer — an over-large payload is never fully materialized.
 *
 * A payload is any JSON value, not necessarily an object: the model root must be
 * an object, but the value published *at a path* may be an array or a scalar.
 *
 * Never throws and always terminates, for any input.
 */
export function measurePublishPayload(payload: unknown): PayloadEvaluation {
  const unserializableAt = findUnserializable(payload);
  if (unserializableAt !== null) {
    return { ok: false, reason: "data_not_serializable", bound: null, path: unserializableAt };
  }
  const json = canonicalize(payload, BOUNDS.publishDataPayloadChars);
  if (json === null) {
    return { ok: false, reason: "publish_payload_chars_exceeded", bound: "B-20", path: "" };
  }
  return { ok: true, chars: json.length };
}
