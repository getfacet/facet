/**
 * Salvage parser for the built-in agent's LLM output (spec Decision 5).
 *
 * Fence-strip + string/escape-aware balanced scan ADAPTED from
 * apps/playground/src/generator.ts (balancedEnd / hasNodesObject / extractJson)
 * — copied on purpose, never imported: the playground is unpublished and must
 * stay a leaf (AGENTS.md dependency direction); a future /refactor-audit may
 * hoist a shared home for the salvage scan.
 *
 * Acceptance (per balanced candidate, first match wins):
 * - a `{say?, tree?}` wrapper — `say` must be a string when present, `tree`
 *   must be tree-shaped or `{nodes}`-bearing when present;
 * - a bare tree-shaped (or `{nodes}`-bearing) object ⇒ treated as `{tree}`;
 * - any other JSON object ⇒ keep scanning for the next balanced candidate;
 * - nothing usable ⇒ throw (caught by the agent loop, which retries once).
 */
import { isTreeShaped } from "@facet/core";

export interface ParsedReply {
  readonly say?: string;
  readonly tree?: unknown;
}

/** The index after the balanced `{...}` starting at `start`, or -1. String/escape aware. */
function balancedEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** A rootless `{nodes}` object is still buildable: `validateTree` falls back to
 * `nodes["root"]`, so don't skip it for a trailing JSON object. */
function hasNodesObject(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const nodes = (value as Record<string, unknown>)["nodes"];
  return typeof nodes === "object" && nodes !== null && !Array.isArray(nodes);
}

function isUsableTree(value: unknown): boolean {
  return isTreeShaped(value) || hasNodesObject(value);
}

/** One parsed candidate → an accepted reply, or null (keep scanning). */
function toReply(value: unknown): ParsedReply | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const hasSay = "say" in record;
  const hasTree = "tree" in record;
  if (hasSay || hasTree) {
    const sayValue = record["say"];
    if (hasSay && typeof sayValue !== "string") return null;
    const say = typeof sayValue === "string" ? sayValue : undefined;
    if (hasTree) {
      const tree = record["tree"];
      if (!isUsableTree(tree)) return null;
      return say !== undefined ? { say, tree } : { tree };
    }
    return say !== undefined ? { say } : null;
  }
  if (isUsableTree(record)) return { tree: record };
  return null;
}

/**
 * Extracts the agent's reply from raw model output — robust to prose, code
 * fences, or extra JSON objects before/after the payload. Scans every balanced
 * top-level `{...}` and returns the first acceptable one; throws when nothing
 * usable is found.
 */
export function parseReply(text: string): ParsedReply {
  const fenced = text.replace(/```(?:json)?/gi, "");
  for (let i = 0; i < fenced.length; i += 1) {
    if (fenced[i] !== "{") continue;
    const end = balancedEnd(fenced, i);
    if (end === -1) break;
    try {
      const parsed: unknown = JSON.parse(fenced.slice(i, end));
      const reply = toReply(parsed);
      if (reply !== null) return reply;
    } catch {
      // not a complete/valid object at this position; keep scanning
    }
    i = end - 1; // skip past this balanced object
  }
  throw new Error("no usable JSON object found in model output");
}
