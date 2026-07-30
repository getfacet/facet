/**
 * The authorized RFC 6902 fold over the stage.
 *
 * Every change to a session's `FacetStage` — an authored mutation, an accepted
 * data publish, a reconnecting browser's resync — is an ordered batch of RFC
 * 6902 operations, and **the same `applyPatch` folds it on the server and in the
 * browser**. One implementation is the point: two folds that agree today drift
 * tomorrow, and a stage that disagrees with itself across the wire is invisible
 * until a visitor sees the wrong page.
 *
 * **Stage-rooted, never document-rooted.** Pointers address the whole stage:
 * `/document/nodes/n4/props/label` for an authored change, `/data/sales/q1` for
 * a published one, and `""` — the root — for a resync that replaces *both*
 * halves at once. A bare `/nodes/n4` is not a Facet pointer and is rejected; the
 * document is a half of the stage, not the root of it.
 *
 * **Authorized, not merely valid.** RFC 6902 defines six operations; Facet
 * authorizes three. `add`, `remove` and `replace` are the whole vocabulary its
 * producers emit. `move` and `copy` are refused because they are the operations
 * that make a fold non-atomic by construction — `move` deletes its source before
 * its destination can fail — and nothing in Facet needs them: a reordered child
 * list is one `replace` of an id array. `test` is refused because it makes the
 * outcome of a batch depend on a comparison that the revision contract already
 * owns: staleness is decided by `StageRevision` compare-and-swap before the fold
 * runs, not by a conditional inside it. Authorization also covers the *shape* of
 * an operation — its exact member set — and the *shape of the result*: a batch
 * that would leave the stage without both of its halves is refused whatever its
 * operations looked like individually.
 *
 * **All-or-nothing, and total.** A batch is accepted whole or rejected whole. A
 * rejection answers with the prior stage **by identity** — nothing is cloned,
 * nothing is salvaged operation by operation, and `document` and `data` are both
 * byte-identical to what they were. There is nothing to roll back, because the
 * fold works on a private clone and only publishes it once every operation has
 * landed. `applyPatch` never throws, for any input of any type: an unparseable
 * pointer, a hostile getter, a value the structured clone cannot carry and a
 * corrupt prior stage are all the same answer — the stage you already had.
 *
 * Identity is therefore the whole rejection vocabulary, and it is unambiguous:
 * an accepted batch **always** produces a fresh object, including an empty one,
 * so `applyPatch(stage, ops) === stage` means the batch was refused. The
 * structured author error that a refused *mutation* reports to the agent belongs
 * to the runtime's mutation path, not to the fold — the same division as
 * `buildDocument`, which answers `null` and leaves the diagnosis to validation.
 *
 * **What the fold does not check.** It authorizes which changes may happen, not
 * whether the values being written are legal Facet data. A document is validated
 * against the active catalog before its operations are generated, and a
 * published value passes `evaluateCandidateModel` before its operations are, so
 * by the time a batch reaches this fold both halves have already been through
 * their own gate. Re-walking every value here would duplicate those gates
 * without being able to replace either.
 */

import type { FacetStage } from "./stage.js";

/**
 * One authorized operation.
 *
 * The union *is* the vocabulary: the three refused RFC 6902 operations are not
 * expressible, so a caller inside this repository cannot even write one down.
 * The runtime still checks, because operations also arrive from the wire as
 * parsed JSON that no type has ever guarded.
 */
export type JsonPatchOperation =
  | { readonly op: "add"; readonly path: string; readonly value: unknown }
  | { readonly op: "remove"; readonly path: string }
  | { readonly op: "replace"; readonly path: string; readonly value: unknown };

/**
 * The most operations one batch may carry.
 *
 * This is **not** one of the `B-01..B-25` bounds — those bound what an author or
 * a publish may say, and this bounds the mechanical batch that carries the
 * result. It exists because the count itself has to be bounded before the loop
 * runs: a runaway batch of hundreds of thousands of operations would occupy the
 * synchronous per-visitor fold for seconds even though every one of them is
 * about to be rejected.
 *
 * The value sits above the widest batch a legal mutation can produce — `B-02`
 * nodes, each at most one write plus one parent relink — and `patch.test.ts`
 * pins that relationship against `BOUNDS`, so raising `B-02` past this cap fails
 * a test rather than quietly making a legal mutation unfoldable.
 */
export const MAX_PATCH_OPS = 1024;

/**
 * The authorized operation names, as a value.
 *
 * The vocabulary is declared once, in `JsonPatchOperation`; this record is
 * pinned to it in **both** directions by its annotation — an exhaustive `Record`
 * over the union's `op` member. A union member missing here is a compile error,
 * and a key here that the union does not declare is a compile error too, so the
 * type and the runtime check cannot drift apart.
 */
const AUTHORIZED_OPS: Readonly<Record<JsonPatchOperation["op"], true>> = Object.freeze({
  add: true,
  remove: true,
  replace: true,
});

/** The two halves a stage has, and the only first tokens a pointer may take. */
const STAGE_HALVES: Readonly<Record<keyof FacetStage, true>> = Object.freeze({
  document: true,
  data: true,
});

/**
 * Pointer tokens that walk into the prototype chain instead of own data.
 *
 * Security-critical: `/data/__proto__/x` would write to `Object.prototype` — on
 * the server *and* in every connected browser, since both run this fold.
 */
const FORBIDDEN_TOKENS: ReadonlySet<string> = new Set(["__proto__", "prototype", "constructor"]);

/** An RFC 6901 array index: `0`, or a digit run with no leading zero or sign. */
const ARRAY_INDEX = /^(0|[1-9][0-9]*)$/;

/** The append token, legal for `add` into an array and nowhere else. */
const APPEND_TOKEN = "-";

type Container = Record<string, unknown> | unknown[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A plain JSON object — not an array, and not a class instance or exotic. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isContainer(value: unknown): value is Container {
  return typeof value === "object" && value !== null;
}

function hasOwn(container: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(container, key);
}

/** Whether a value names one of the three authorized operations. */
function isAuthorizedOp(value: unknown): value is JsonPatchOperation["op"] {
  return typeof value === "string" && hasOwn(AUTHORIZED_OPS, value);
}

function decodePointerToken(token: string): string | null {
  for (let index = 0; index < token.length; index += 1) {
    if (token[index] === "~") {
      const escape = token[index + 1];
      if (escape !== "0" && escape !== "1") {
        return null;
      }
      index += 1;
    }
  }
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

/**
 * Reads one operation out of untrusted input, or `null` when it is not an
 * authorized one.
 *
 * The member set is checked **exactly**, not merely for the members that are
 * needed: an operation carrying a `from` alongside `path` is a `move` or a
 * `copy` wearing an authorized name, and an operation carrying anything else is
 * something this fold does not understand. Either way the answer is the same —
 * a batch is only folded when every operation in it is fully understood.
 */
function readOperation(candidate: unknown): JsonPatchOperation | null {
  if (!isRecord(candidate)) {
    return null;
  }
  const op: unknown = candidate["op"];
  const path: unknown = candidate["path"];
  if (!isAuthorizedOp(op) || typeof path !== "string") {
    return null;
  }
  const members = Object.keys(candidate).length;
  switch (op) {
    case "add":
    case "replace": {
      if (members !== 3 || !hasOwn(candidate, "value")) {
        return null;
      }
      return { op, path, value: candidate["value"] };
    }
    case "remove": {
      if (members !== 2) {
        return null;
      }
      return { op, path };
    }
    default: {
      // Unreachable: `op` is narrowed to the union, so this branch is `never`
      // and the assignment is what makes the switch exhaustive against it.
      const unreachable: never = op;
      return unreachable;
    }
  }
}

/**
 * Parses an authorized stage pointer into its tokens, or `null` when the pointer
 * is not one Facet admits.
 *
 * Three rules, in order: the pointer is the root or is absolute; its first token
 * names a stage half; and no token anywhere walks the prototype chain.
 */
function readPointer(pointer: string): readonly string[] | null {
  if (pointer === "") {
    return [];
  }
  if (!pointer.startsWith("/")) {
    return null;
  }
  const tokens: string[] = [];
  for (const token of pointer.slice(1).split("/")) {
    const decoded = decodePointerToken(token);
    if (decoded === null) {
      return null;
    }
    tokens.push(decoded);
  }
  const half = tokens[0];
  if (half === undefined || !hasOwn(STAGE_HALVES, half)) {
    return null;
  }
  for (const token of tokens) {
    if (FORBIDDEN_TOKENS.has(token)) {
      return null;
    }
  }
  return tokens;
}

/**
 * Resolves an array index token strictly. `insert` admits the append token and
 * any position in `[0, length]`; `access` admits neither the append token nor
 * `length` itself. Anything else throws, which the fold turns into a reject.
 */
function arrayIndex(token: string, length: number, mode: "insert" | "access"): number {
  if (token === APPEND_TOKEN) {
    if (mode === "insert") {
      return length;
    }
    throw new Error("the append token addresses no existing item");
  }
  if (!ARRAY_INDEX.test(token)) {
    throw new Error("not an array index");
  }
  const index = Number(token);
  if (index > (mode === "insert" ? length : length - 1)) {
    throw new Error("array index out of range");
  }
  return index;
}

function childOf(container: Container, token: string): unknown {
  if (Array.isArray(container)) {
    return container[arrayIndex(token, container.length, "access")];
  }
  if (!hasOwn(container, token)) {
    return unreachableMember();
  }
  return container[token];
}

function unreachableMember(): never {
  throw new Error("pointer names a member that is not there");
}

/** Walks to the container holding the final token, throwing if there is none. */
function parentContainer(root: unknown, tokens: readonly string[]): Container {
  let node: unknown = root;
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index];
    if (token === undefined || !isContainer(node)) {
      return unreachableMember();
    }
    node = childOf(node, token);
  }
  if (!isContainer(node)) {
    return unreachableMember();
  }
  return node;
}

function lastToken(tokens: readonly string[]): string {
  const token = tokens[tokens.length - 1];
  if (token === undefined) {
    return unreachableMember();
  }
  return token;
}

function setMember(
  container: Container,
  key: string,
  value: unknown,
  mode: "add" | "replace",
): void {
  if (Array.isArray(container)) {
    if (mode === "add") {
      container.splice(arrayIndex(key, container.length, "insert"), 0, value);
      return;
    }
    container[arrayIndex(key, container.length, "access")] = value;
    return;
  }
  if (mode === "replace" && !hasOwn(container, key)) {
    unreachableMember();
  }
  container[key] = value;
}

function removeMember(container: Container, key: string): void {
  if (Array.isArray(container)) {
    container.splice(arrayIndex(key, container.length, "access"), 1);
    return;
  }
  if (!hasOwn(container, key)) {
    unreachableMember();
  }
  delete container[key];
}

/**
 * Applies one operation to the fold's private working root, in place.
 *
 * The inserted value is cloned rather than referenced. Inserting by reference
 * would alias the caller's operation object into the stage, so a later operation
 * in the same batch that appends into the just-added subtree would mutate the
 * *patch message* — which the server then forwards to the browser, where it
 * applies a second time as a visible duplicate.
 */
function applyInPlace(
  root: unknown,
  operation: JsonPatchOperation,
  tokens: readonly string[],
): void {
  const parent = parentContainer(root, tokens);
  const key = lastToken(tokens);
  if (operation.op === "remove") {
    removeMember(parent, key);
    return;
  }
  setMember(parent, key, structuredClone(operation.value), operation.op);
}

/**
 * The post-condition every accepted batch must satisfy: what came out is still a
 * stage — exactly two halves, a document or `null`, and a data model.
 *
 * Checking the *result* rather than each operation is what closes the long tail:
 * `remove /data`, a root replace carrying a number, and a batch that deletes a
 * half and adds an unrelated one are all one rule instead of three.
 */
function asStage(root: unknown): FacetStage | null {
  if (!isPlainObject(root)) {
    return null;
  }
  const keys = Object.keys(root);
  if (keys.length !== 2 || !hasOwn(root, "document") || !hasOwn(root, "data")) {
    return null;
  }
  const document: unknown = root["document"];
  const data: unknown = root["data"];
  if (!(document === null || isPlainObject(document)) || !isPlainObject(data)) {
    return null;
  }
  return Object.freeze({
    document: document as FacetStage["document"],
    data: data as FacetStage["data"],
  });
}

/**
 * Folds an ordered batch of authorized operations over a stage, returning the
 * new stage — or the prior stage itself, unchanged and by identity, when the
 * batch is rejected.
 *
 * Never throws, for any input of any type.
 */
export function applyPatch(
  stage: FacetStage,
  operations: readonly JsonPatchOperation[],
): FacetStage {
  try {
    return fold(stage, operations);
  } catch {
    return stage;
  }
}

function fold(stage: FacetStage, operations: readonly JsonPatchOperation[]): FacetStage {
  if (!Array.isArray(operations) || operations.length > MAX_PATCH_OPS) {
    return stage;
  }

  // `root` becomes a private working value the moment anything needs to change,
  // and only then. A resync never reads the prior root at all, which is what
  // lets a stage that is too corrupt to clone still be replaced wholesale.
  let root: unknown = stage;
  let owned = false;

  for (const candidate of operations) {
    const operation = readOperation(candidate);
    if (operation === null) {
      return stage;
    }
    const tokens = readPointer(operation.path);
    if (tokens === null) {
      return stage;
    }
    if (tokens.length === 0) {
      // The root is a resync, and a resync is a replace of the whole stage.
      if (operation.op !== "replace") {
        return stage;
      }
      root = structuredClone(operation.value);
      owned = true;
      continue;
    }
    if (!owned) {
      root = structuredClone(stage);
      owned = true;
    }
    applyInPlace(root, operation, tokens);
  }

  if (!owned) {
    // An empty batch still answers with a fresh stage, so a caller can read
    // identity as the reject signal without a special case for "no operations".
    root = { document: stage.document, data: stage.data };
  }
  return asStage(root) ?? stage;
}
