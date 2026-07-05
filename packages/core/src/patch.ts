import { isForbiddenKey } from "./issues.js";
import type { FacetTree } from "./tree.js";

/**
 * The wire format for stage changes is RFC 6902 JSON Patch — the IETF standard,
 * the same format AG-UI uses for its STATE_DELTA. We adopt it instead of
 * inventing our own ops so the format is battle-tested and tool-compatible. A
 * "patch" is an ordered array of these operations; the same pure `applyPatch`
 * runs on the server (authoritative stage) and the client (DOM), so they never
 * drift.
 *
 * Paths are JSON Pointers (RFC 6901) into the FacetTree document, e.g.
 * `/nodes/box-1` or `/nodes/root/children/-` (the "-" appends to an array).
 *
 * This is a small, self-contained implementation (no dependency) — the tree is
 * plain JSON, so the full six-operation standard fits in a few helpers.
 */
export type JsonPatchOperation =
  | { readonly op: "add"; readonly path: string; readonly value: unknown }
  | { readonly op: "remove"; readonly path: string }
  | { readonly op: "replace"; readonly path: string; readonly value: unknown }
  | { readonly op: "move"; readonly from: string; readonly path: string }
  | { readonly op: "copy"; readonly from: string; readonly path: string }
  | { readonly op: "test"; readonly path: string; readonly value: unknown };

/**
 * Hard cap on the number of operations a single patch batch may carry. A batch
 * past this is rejected WHOLE (never salvaged op-by-op) at the fold and wire
 * boundaries: salvage clones the stage once and applies in place, but a hostile
 * or runaway batch of hundreds of thousands of junk ops would still block the
 * synchronous per-visitor path for seconds building the dropped-op list, so the
 * count itself must be bounded before the loop runs. 1024 is far above any real
 * turn (a render is one root `replace`; an incremental edit is a handful of ops).
 */
export const MAX_PATCH_OPS = 1024;

type Container = Record<string, unknown> | unknown[];

function isContainerValue(value: unknown): value is Container {
  return typeof value === "object" && value !== null;
}

/**
 * Structural equality over the JSON domain (null/boolean/number/string plus
 * arrays and plain objects) for the RFC 6902 `test` op. Object comparison is
 * key-order insensitive; no dependency, since `@facet/core` takes none.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  if (aKeys.length !== Object.keys(bObj).length) {
    return false;
  }
  return aKeys.every(
    (key) => Object.prototype.hasOwnProperty.call(bObj, key) && deepEqual(aObj[key], bObj[key]),
  );
}

/** RFC 6901 JSON Pointer → tokens, unescaping ~1 → "/" and ~0 → "~". */
function parsePointer(pointer: string): string[] {
  if (pointer === "") {
    return [];
  }
  if (!pointer.startsWith("/")) {
    throw new Error(`invalid JSON pointer: "${pointer}"`);
  }
  const tokens = pointer
    .slice(1)
    .split("/")
    .map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"));
  for (const token of tokens) {
    // Security: a "/__proto__/x" pointer would write to Object.prototype —
    // global prototype pollution on server AND every connected browser. Reject.
    if (isForbiddenKey(token)) {
      throw new Error(`forbidden pointer token: "${token}"`);
    }
  }
  return tokens;
}

function lastToken(tokens: string[]): string {
  const token = tokens[tokens.length - 1];
  if (token === undefined) {
    throw new Error("operation requires a non-root path");
  }
  return token;
}

/** RFC 6901 array index token: "0" or a non-zero digit run — no sign, no
 * leading zero, no decimal, no empty string. `-` is a distinct append token
 * (valid only for `add`, handled by callers via `mode: "insert"`). */
const ARRAY_INDEX = /^(0|[1-9]\d*)$/;

/**
 * Resolve an array-index token strictly. `insert` (used by `add`/`move`/`copy`
 * targets) allows `-` = append and any index in `[0, length]`; `access` (used
 * by traversal, `replace`, `remove`) forbids `-` and requires `[0, length)`.
 * Anything else throws — the runtime's per-op salvage absorbs the throw.
 */
function arrayIndex(token: string, length: number, mode: "insert" | "access"): number {
  if (token === "-") {
    if (mode === "insert") {
      return length;
    }
    throw new Error(`invalid array index: "-"`);
  }
  if (!ARRAY_INDEX.test(token)) {
    throw new Error(`invalid array index: "${token}"`);
  }
  const index = Number(token);
  const max = mode === "insert" ? length : length - 1;
  if (index > max) {
    throw new Error(`array index out of range: "${token}"`);
  }
  return index;
}

function childOf(node: Container, token: string): unknown {
  if (Array.isArray(node)) {
    return node[arrayIndex(token, node.length, "access")];
  }
  return node[token];
}

/** Walks to the container that holds the final token. */
function parentContainer(root: unknown, tokens: string[]): Container {
  let node: unknown = root;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const token = tokens[i];
    if (token === undefined || !isContainerValue(node)) {
      throw new Error(`path not found: /${tokens.join("/")}`);
    }
    node = childOf(node, token);
  }
  if (!isContainerValue(node)) {
    throw new Error(`path parent is not a container: /${tokens.join("/")}`);
  }
  return node;
}

function getAt(root: unknown, tokens: string[]): unknown {
  let node: unknown = root;
  for (const token of tokens) {
    if (!isContainerValue(node)) {
      throw new Error(`path not found: /${tokens.join("/")}`);
    }
    node = childOf(node, token);
  }
  return node;
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
    } else {
      container[arrayIndex(key, container.length, "access")] = value;
    }
  } else {
    container[key] = value;
  }
}

function removeMember(container: Container, key: string): void {
  if (Array.isArray(container)) {
    container.splice(arrayIndex(key, container.length, "access"), 1);
  } else {
    delete container[key];
  }
}

/**
 * Applies ONE operation to `root`, MUTATING it in place (no clone) and returning
 * the new root — which is `root` itself for every op except a whole-document
 * `replace`/`add`/`move`/`copy` at path `""`, where the new document value is
 * returned. The public, clone-first entry is `applyPatch`; this in-place variant
 * exists so a caller that already owns a private clone (the stage salvage in
 * `stage-fold.ts`) can apply a batch op-by-op WITHOUT re-cloning the whole tree
 * per op — the O(ops × tree_size) blowup a naive per-op `applyPatch` causes.
 *
 * ATOMIC per op: an operation that throws leaves `root` byte-identical to its
 * pre-op state (every op either throws before it mutates, or — for `move`, which
 * removes its source before it can fail on the destination — restores the source
 * on the way out). The salvage relies on this: a dropped op never corrupts the
 * working tree, so no re-clone is needed after a throw.
 */
export function applyOpInPlace(root: unknown, operation: JsonPatchOperation): unknown {
  switch (operation.op) {
    case "add":
    case "replace": {
      const tokens = parsePointer(operation.path);
      // Clone the inserted value: inserting by reference would alias the
      // operation object into the tree, so a later op in the same batch (e.g.
      // append into a just-added node) MUTATES the caller's patch message —
      // the server would then forward already-applied patches and the client
      // would apply them twice (visible duplicate children).
      const value = structuredClone(operation.value);
      if (tokens.length === 0) {
        return value;
      }
      setMember(parentContainer(root, tokens), lastToken(tokens), value, operation.op);
      return root;
    }
    case "remove": {
      const tokens = parsePointer(operation.path);
      removeMember(parentContainer(root, tokens), lastToken(tokens));
      return root;
    }
    case "move": {
      const fromTokens = parsePointer(operation.from);
      const fromParent = parentContainer(root, fromTokens);
      const fromKey = lastToken(fromTokens);
      const value = getAt(root, fromTokens);
      removeMember(fromParent, fromKey);
      try {
        const toTokens = parsePointer(operation.path);
        if (toTokens.length === 0) {
          return value;
        }
        setMember(parentContainer(root, toTokens), lastToken(toTokens), value, "add");
        return root;
      } catch (error) {
        // `move` is the one op that mutates (removes its source) before a later
        // step can throw (a bad destination pointer or out-of-range index).
        // Restore the source so a failed move leaves `root` unchanged, keeping
        // the op atomic for the in-place salvage. Invisible to `applyPatch`,
        // whose working clone is discarded on any throw.
        setMember(fromParent, fromKey, value, "add");
        throw error;
      }
    }
    case "copy": {
      const value = structuredClone(getAt(root, parsePointer(operation.from)));
      const toTokens = parsePointer(operation.path);
      if (toTokens.length === 0) {
        return value;
      }
      setMember(parentContainer(root, toTokens), lastToken(toTokens), value, "add");
      return root;
    }
    case "test": {
      const value = getAt(root, parsePointer(operation.path));
      // RFC 6902 compares the referenced VALUE, not its serialization —
      // JSON.stringify is key-order sensitive (`{a,b}` ≠ `{b,a}`), so a
      // reordered-but-equal object would wrongly fail. Compare by structure.
      if (!deepEqual(value, operation.value)) {
        throw new Error(`test operation failed at "${operation.path}"`);
      }
      return root;
    }
    default:
      // RFC 6902: an unrecognized op MUST be an error. Without this, a wire-level
      // typo (e.g. op:"append") would return undefined and silently wipe the
      // caller's tree.
      throw new Error(`unknown patch op: "${String((operation as { op?: unknown }).op)}"`);
  }
}

/** Applies an ordered batch of operations to a tree, returning a new tree. The
 * input is cloned once up front, so a throwing op discards the whole working
 * clone (all-or-nothing) and the caller's `tree` is never mutated. */
export function applyPatch(tree: FacetTree, operations: readonly JsonPatchOperation[]): FacetTree {
  let root: unknown = structuredClone(tree);
  for (const operation of operations) {
    root = applyOpInPlace(root, operation);
  }
  return root as FacetTree;
}
