import {
  MAX_PATCH_OPS,
  sanitizeView,
  validateAuthorTree,
  type FacetTheme,
  type FacetTree,
  type JsonPatchOperation,
  type ViewSnapshot,
} from "@facet/core";
import { cloneBoundedJson, type ProjectionErrorCode } from "../shared/redaction.js";
import {
  MAX_EVIDENCE_DEPTH,
  MAX_EVIDENCE_NODES,
  MAX_JSON_REQUEST_BYTES,
  type JsonValue,
} from "../shared/run-contract.js";

export const MAX_SANDBOX_DOCUMENT_BYTES = MAX_JSON_REQUEST_BYTES;

export type SandboxFormatErrorCode =
  | ProjectionErrorCode
  | "empty-input"
  | "malformed-json"
  | "prohibited-content"
  | "invalid-tree"
  | "invalid-patch"
  | "invalid-view";

export interface SandboxFormatError {
  readonly code: SandboxFormatErrorCode;
  readonly message: string;
}

export type SandboxFormatResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: SandboxFormatError };

const encoder = new TextEncoder();

const PROHIBITED_KEYS = new Set([
  "css",
  "dangerouslysetinnerhtml",
  "eval",
  "execute",
  "fetch",
  "function",
  "html",
  "innerhtml",
  "javascript",
  "rawcss",
  "rawhtml",
  "script",
  "srcdoc",
  "stylesheet",
]);

const PROHIBITED_STRING_PATTERNS = [
  /<\/?(?:script|style|iframe|object|embed|link|meta)\b/iu,
  /<\/?[a-z][^>]*>/iu,
  /\bjavascript\s*:/iu,
  /\bdata\s*:\s*text\/html/iu,
  /\b(?:eval|fetch|function)\s*\(/iu,
  /(?:^|[;{\s])@import\b/iu,
  /(?:^|[;{\s])(?:position|display|background|color|font(?:-family|-size)?)\s*:/iu,
] as const;

const OP_FIELDS: Readonly<Record<JsonPatchOperation["op"], readonly string[]>> = {
  add: ["op", "path", "value"],
  remove: ["op", "path"],
  replace: ["op", "path", "value"],
  move: ["op", "from", "path"],
  copy: ["op", "from", "path"],
  test: ["op", "path", "value"],
};

function error(code: SandboxFormatErrorCode, message: string): SandboxFormatResult<never> {
  return { ok: false, error: { code, message } };
}

function projectionError(code: ProjectionErrorCode): SandboxFormatResult<never> {
  const messages: Readonly<Record<ProjectionErrorCode, string>> = {
    cyclic: "Sandbox documents cannot contain cycles.",
    "invalid-bound": "Sandbox document bounds are invalid.",
    "non-json": "Sandbox documents must contain plain JSON values only.",
    "too-deep": "Sandbox documents exceed the nesting-depth limit.",
    "too-large": "Sandbox documents exceed the byte limit.",
    "too-many-nodes": "Sandbox documents exceed the node limit.",
  };
  return error(code, messages[code]);
}

function boundedClone(value: unknown): SandboxFormatResult<JsonValue> {
  const projected = cloneBoundedJson(value, {
    maxBytes: MAX_SANDBOX_DOCUMENT_BYTES,
    maxDepth: MAX_EVIDENCE_DEPTH,
    maxNodes: MAX_EVIDENCE_NODES,
  });
  return projected.ok
    ? { ok: true, value: projected.value }
    : projectionError(projected.error.code);
}

function normalizedKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/gu, "");
}

function containsProhibitedContent(value: JsonValue): boolean {
  if (typeof value === "string") {
    return PROHIBITED_STRING_PATTERNS.some((pattern) => pattern.test(value));
  }
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => containsProhibitedContent(item));
  for (const [key, item] of Object.entries(value)) {
    if (PROHIBITED_KEYS.has(normalizedKey(key)) || containsProhibitedContent(item)) return true;
  }
  return false;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function hasExactFields(
  value: Readonly<Record<string, JsonValue>>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function isValidPointer(pointer: string): boolean {
  if (pointer === "") return true;
  if (!pointer.startsWith("/")) return false;
  for (const rawToken of pointer.slice(1).split("/")) {
    if (/~(?:[^01]|$)/u.test(rawToken)) return false;
    const token = rawToken.replace(/~1/gu, "/").replace(/~0/gu, "~");
    if (token === "__proto__" || token === "constructor" || token === "prototype") return false;
  }
  return true;
}

function pointerHasProhibitedContent(pointer: string): boolean {
  if (pointer === "") return false;
  return pointer
    .slice(1)
    .split("/")
    .map((token) => token.replace(/~1/gu, "/").replace(/~0/gu, "~"))
    .some((token) => PROHIBITED_KEYS.has(normalizedKey(token)));
}

function isPatchObject(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameJson(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameJson(item, right[index] as JsonValue))
    );
  }
  const leftObject = left as Readonly<Record<string, JsonValue>>;
  const rightObject = right as Readonly<Record<string, JsonValue>>;
  const leftKeys = Object.keys(leftObject);
  const rightKeys = Object.keys(rightObject);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(rightObject, key) &&
        sameJson(leftObject[key] as JsonValue, rightObject[key] as JsonValue),
    )
  );
}

function structurallyValidPatch(
  value: Readonly<Record<string, JsonValue>>,
): value is Readonly<Record<string, JsonValue>> & JsonPatchOperation {
  const op = value["op"];
  if (typeof op !== "string" || !(op in OP_FIELDS)) return false;
  const expected = OP_FIELDS[op as JsonPatchOperation["op"]];
  if (!hasExactFields(value, expected)) return false;
  if (typeof value["path"] !== "string" || !isValidPointer(value["path"])) return false;
  if ((op === "move" || op === "copy") && typeof value["from"] !== "string") return false;
  if ((op === "move" || op === "copy") && !isValidPointer(value["from"] as string)) return false;
  return true;
}

export function validateSandboxTree(
  input: unknown,
  theme: FacetTheme,
): SandboxFormatResult<FacetTree> {
  const cloned = boundedClone(input);
  if (!cloned.ok) return cloned;
  if (containsProhibitedContent(cloned.value)) {
    return error("prohibited-content", "Executable or raw markup/style content is prohibited.");
  }
  const validated = validateAuthorTree(cloned.value, theme);
  if (validated.value === undefined) {
    return error("invalid-tree", "The sandbox tree does not satisfy the Facet author contract.");
  }
  return { ok: true, value: deepFreeze(validated.value) };
}

export function validateSandboxPatches(
  input: unknown,
): SandboxFormatResult<readonly JsonPatchOperation[]> {
  const cloned = boundedClone(input);
  if (!cloned.ok) return cloned;
  if (
    !Array.isArray(cloned.value) ||
    cloned.value.length === 0 ||
    cloned.value.length > MAX_PATCH_OPS
  ) {
    return error("invalid-patch", "Sandbox patches must be a bounded, non-empty RFC 6902 array.");
  }

  const patches: JsonPatchOperation[] = [];
  for (const item of cloned.value) {
    if (!isPatchObject(item) || !structurallyValidPatch(item)) {
      return error(
        "invalid-patch",
        "Sandbox patches must use the closed RFC 6902 operation shape.",
      );
    }
    patches.push(item);
  }

  for (const patch of patches) {
    if (
      pointerHasProhibitedContent(patch.path) ||
      ((patch.op === "move" || patch.op === "copy") && pointerHasProhibitedContent(patch.from)) ||
      ((patch.op === "add" || patch.op === "replace" || patch.op === "test") &&
        containsProhibitedContent(patch.value as JsonValue))
    ) {
      return error("prohibited-content", "Executable or raw markup/style content is prohibited.");
    }
  }

  return { ok: true, value: deepFreeze(patches) };
}

export function validateSandboxView(input: unknown): SandboxFormatResult<ViewSnapshot | undefined> {
  if (input === null) return { ok: true, value: undefined };
  const cloned = boundedClone(input);
  if (!cloned.ok) return cloned;
  if (containsProhibitedContent(cloned.value)) {
    return error("prohibited-content", "Executable or raw markup/style content is prohibited.");
  }
  if (typeof cloned.value !== "object" || cloned.value === null || Array.isArray(cloned.value)) {
    return error("invalid-view", "The sandbox view checkpoint is invalid.");
  }
  const sanitized = sanitizeView(cloned.value);
  const normalized = sanitized ?? {};
  if (!sameJson(cloned.value, normalized as JsonValue)) {
    return error("invalid-view", "The sandbox view checkpoint is invalid.");
  }
  return { ok: true, value: sanitized === undefined ? undefined : deepFreeze(sanitized) };
}

function parseJson(text: string): SandboxFormatResult<JsonValue> {
  if (text.trim().length === 0) return error("empty-input", "Sandbox JSON cannot be empty.");
  if (encoder.encode(text).byteLength > MAX_SANDBOX_DOCUMENT_BYTES) {
    return error("too-large", "Sandbox documents exceed the byte limit.");
  }
  try {
    return { ok: true, value: JSON.parse(text) as JsonValue };
  } catch {
    return error("malformed-json", "Sandbox JSON is malformed.");
  }
}

export function parseSandboxTree(text: string, theme: FacetTheme): SandboxFormatResult<FacetTree> {
  const parsed = parseJson(text);
  return parsed.ok ? validateSandboxTree(parsed.value, theme) : parsed;
}

export function parseSandboxPatches(
  text: string,
): SandboxFormatResult<readonly JsonPatchOperation[]> {
  const parsed = parseJson(text);
  return parsed.ok ? validateSandboxPatches(parsed.value) : parsed;
}
