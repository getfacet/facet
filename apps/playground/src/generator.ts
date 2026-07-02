/**
 * Shared LLM page generator — asks the local (authenticated) `claude` CLI to emit
 * a Facet stage tree and validates it. Used by both the CLI (`gen`) and the live
 * server (`serve`). No API key needed.
 */
import { spawn } from "node:child_process";
import { isTreeShaped, STAGE_SPEC, validateTree, type FacetTree } from "@facet/core";

export const SYSTEM = `You generate Facet pages. Output ONLY a single JSON object for a stage tree — no prose, no markdown code fences.

${STAGE_SPEC}

Output JSON only.`;

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

/**
 * Extracts the stage tree from the model output — robust to prose, code fences,
 * or extra JSON objects before/after the tree (models sometimes emit a preamble
 * object or a trailing sentence). Scans every balanced top-level `{...}`, parses
 * each, and returns the FIRST one that is tree-shaped (a `root` string and a
 * `nodes` object); falls back to the last parseable object. Brace-counting is
 * string/escape aware so a `}` inside a string doesn't end an object early.
 */

/** Salvage acceptance for LLM output: a full tree shape OR a rootless `{nodes}`
 * object (validateTree falls back to `nodes["root"]`, so a missing top-level
 * `root` is still buildable — don't skip it for a trailing JSON object). */
function hasNodesObject(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const nodes = (value as Record<string, unknown>)["nodes"];
  return typeof nodes === "object" && nodes !== null && !Array.isArray(nodes);
}

export function extractJson(text: string): unknown {
  const fenced = text.replace(/```(?:json)?/gi, "");
  const objects: unknown[] = [];
  for (let i = 0; i < fenced.length; i += 1) {
    if (fenced[i] !== "{") continue;
    const end = balancedEnd(fenced, i);
    if (end === -1) break;
    try {
      const parsed: unknown = JSON.parse(fenced.slice(i, end));
      if (isTreeShaped(parsed) || hasNodesObject(parsed)) return parsed;
      objects.push(parsed);
    } catch {
      // not a complete/valid object at this position; keep scanning
    }
    i = end - 1; // skip past this object
  }
  const last = objects[objects.length - 1];
  if (last !== undefined) return last;
  throw new Error("no JSON object found in model output");
}

function callClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", prompt], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += String(chunk)));
    child.stderr.on("data", (chunk) => (err += String(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`claude exited ${String(code)}: ${err.trim()}`));
    });
  });
}

export interface GenerateResult {
  readonly tree: FacetTree;
  readonly issues: readonly string[];
}

/** A tree renders something only if its root box has at least one child. */
function isRenderable(tree: FacetTree): boolean {
  const root = tree.nodes[tree.root];
  return root !== undefined && root.type === "box" && root.children.length > 0;
}

/**
 * Generates (or refines) a page. When `current` is given and non-empty, the
 * model is asked to MODIFY that page rather than build a fresh one — the basis
 * for multi-turn refinement (step B).
 *
 * The model occasionally emits malformed output that validates down to an empty
 * page; rather than show a blank stage, retry once before giving up.
 */
export async function generatePage(request: string, current?: FacetTree): Promise<GenerateResult> {
  const hasCurrent = current !== undefined && Object.keys(current.nodes).length > 1;
  const context = hasCurrent
    ? `\n\nThe visitor's CURRENT page (modify it, reusing node ids where possible): ${JSON.stringify(current)}`
    : "";
  const prompt = `${SYSTEM}${context}\n\nUser request: ${request}\n\nJSON:`;

  let last: GenerateResult | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = validateTree(extractJson(await callClaude(prompt)));
      last = result;
      if (isRenderable(result.tree)) return result;
    } catch (error) {
      lastError = error;
    }
  }
  if (last !== undefined) return last;
  throw lastError instanceof Error ? lastError : new Error("generation failed");
}
