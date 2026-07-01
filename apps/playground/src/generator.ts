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

function extractJson(text: string): unknown {
  const fenced = text.replace(/```(?:json)?/gi, "");
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("no JSON object found in model output");
  }
  return JSON.parse(fenced.slice(start, end + 1));
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

export async function generatePage(request: string): Promise<GenerateResult> {
  const raw = await callClaude(`${SYSTEM}\n\nUser request: ${request}\n\nJSON:`);
  return validateTree(extractJson(raw));
}
