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

type Container = Record<string, unknown> | unknown[];

function isContainerValue(value: unknown): value is Container {
  return typeof value === "object" && value !== null;
}

/** Pointer tokens that would walk into the prototype chain instead of own data. */
const FORBIDDEN_TOKENS = new Set(["__proto__", "prototype", "constructor"]);

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
    if (FORBIDDEN_TOKENS.has(token)) {
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

function childOf(node: Container, token: string): unknown {
  if (Array.isArray(node)) {
    return node[token === "-" ? node.length : Number(token)];
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
    const index = key === "-" ? container.length : Number(key);
    if (Number.isNaN(index)) {
      throw new Error(`invalid array index: "${key}"`);
    }
    if (mode === "add") {
      container.splice(index, 0, value);
    } else {
      container[index] = value;
    }
  } else {
    container[key] = value;
  }
}

function removeMember(container: Container, key: string): void {
  if (Array.isArray(container)) {
    const index = Number(key);
    if (Number.isNaN(index)) {
      throw new Error(`invalid array index: "${key}"`);
    }
    container.splice(index, 1);
  } else {
    delete container[key];
  }
}

function applyOperation(root: unknown, operation: JsonPatchOperation): unknown {
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
      const value = getAt(root, fromTokens);
      removeMember(parentContainer(root, fromTokens), lastToken(fromTokens));
      const toTokens = parsePointer(operation.path);
      if (toTokens.length === 0) {
        return value;
      }
      setMember(parentContainer(root, toTokens), lastToken(toTokens), value, "add");
      return root;
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
      if (JSON.stringify(value) !== JSON.stringify(operation.value)) {
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

/** Applies an ordered batch of operations to a tree, returning a new tree. */
export function applyPatch(tree: FacetTree, operations: readonly JsonPatchOperation[]): FacetTree {
  let root: unknown = structuredClone(tree);
  for (const operation of operations) {
    root = applyOperation(root, operation);
  }
  return root as FacetTree;
}
