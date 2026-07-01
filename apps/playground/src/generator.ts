/**
 * Shared LLM page generator — asks the local (authenticated) `claude` CLI to emit
 * a Facet stage tree and validates it. Used by both the CLI (`gen`) and the live
 * server (`serve`). No API key needed.
 */
import { spawn } from "node:child_process";
import { validateTree, type FacetTree } from "@facet/core";

const SYSTEM = `You generate Facet pages. Output ONLY a single JSON object for a stage tree — no prose, no markdown code fences.

Shape: { "root": "root", "nodes": { "<id>": <node>, ... } }. Exactly one node has id "root" and type "box". Every child id referenced must exist in nodes.

Node types (the ONLY allowed types):
- box:   { "id", "type":"box", "children":[ids], "style"?:BoxStyle, "onPress"?:{"name":string} }
- text:  { "id", "type":"text", "value":string, "style"?:TextStyle }
- image: { "id", "type":"image", "src":url, "alt":string, "style"?:ImageStyle }
- field: { "id", "type":"field", "name":string, "label"?, "placeholder"?, "input"?:("text"|"number"|"email"|"password"|"search"), "style"?:{"width"?} }

box is the ONLY container. A bordered box = a card; a box with onPress = a button; nested boxes = any layout. Layout is flow-only (no absolute positioning).

Style values MUST be tokens (never pixels or hex):
- BoxStyle: direction(row|col), gap/pad(none|xs|sm|md|lg|xl|2xl), align(start|center|end|stretch), justify(start|center|end|between|around), wrap(bool), bg(color), radius(none|sm|md|lg|full), border(bool), grow(bool), width(auto|full)
- TextStyle: size(xs|sm|md|lg|xl|2xl|3xl), weight(regular|medium|semibold|bold), color(color), align(start|center|end)
- ImageStyle: radius(...), width(auto|full), ratio(square|wide|tall)
- color tokens: fg, fg-muted, bg, surface, surface-2, accent, accent-fg, border, success, warning, danger
- for images use https://picsum.photos/seed/<word>/600/400

Compose freely from these four bricks. Output JSON only.`;

/**
 * Extracts the FIRST complete, balanced JSON object from the model output —
 * tolerant of prose or extra content before/after (models sometimes append a
 * sentence). Brace-counts while respecting string literals and escapes, so a `}`
 * inside a string doesn't end it early.
 */
function extractJson(text: string): unknown {
  const fenced = text.replace(/```(?:json)?/gi, "");
  const start = fenced.indexOf("{");
  if (start === -1) throw new Error("no JSON object found in model output");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < fenced.length; i += 1) {
    const ch = fenced[i];
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
      if (depth === 0) return JSON.parse(fenced.slice(start, i + 1));
    }
  }
  throw new Error("no complete JSON object found in model output");
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

/**
 * Generates (or refines) a page. When `current` is given and non-empty, the
 * model is asked to MODIFY that page rather than build a fresh one — the basis
 * for multi-turn refinement (step B).
 */
export async function generatePage(request: string, current?: FacetTree): Promise<GenerateResult> {
  const hasCurrent = current !== undefined && Object.keys(current.nodes).length > 1;
  const context = hasCurrent
    ? `\n\nThe visitor's CURRENT page (modify it, reusing node ids where possible): ${JSON.stringify(current)}`
    : "";
  const raw = await callClaude(`${SYSTEM}${context}\n\nUser request: ${request}\n\nJSON:`);
  return validateTree(extractJson(raw));
}
