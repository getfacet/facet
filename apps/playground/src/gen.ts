/**
 * CLI generator — the quickest way to test whether an LLM can actually compose
 * good, valid pages from Facet's four bricks.
 *
 * It asks the local (authenticated) `claude` CLI to emit a Facet stage tree as
 * JSON, runs it through `validateTree` (the fail-safe boundary), prints an ASCII
 * preview + any issues, and saves the tree. No API key needed.
 *
 *   pnpm --filter @facet/playground gen "a portfolio page for a photographer"
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
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

function printTree(tree: FacetTree): void {
  const walk = (id: string, depth: number): void => {
    const node = tree.nodes[id];
    if (node === undefined) return;
    const pad = "  ".repeat(depth);
    const detail =
      node.type === "text"
        ? `: "${node.value}"`
        : node.type === "image"
          ? `: ${node.src}`
          : node.type === "field"
            ? `: ${node.name}`
            : "";
    const press = node.type === "box" && node.onPress !== undefined ? ` [→ ${node.onPress.name}]` : "";
    console.log(`${pad}${node.type}${detail}${press}`);
    if (node.type === "box") {
      for (const child of node.children) walk(child, depth + 1);
    }
  };
  walk(tree.root, 0);
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
      else reject(new Error(`claude exited ${code}: ${err.trim()}`));
    });
  });
}

async function main(): Promise<void> {
  const request = process.argv.slice(2).join(" ").trim() || "a simple landing page for a coffee shop";
  console.log(`\n▸ Asking the agent to build: "${request}"\n  (calling local claude CLI — no API key)…\n`);

  const raw = await callClaude(`${SYSTEM}\n\nUser request: ${request}\n\nJSON:`);

  let parsed: unknown;
  try {
    parsed = extractJson(raw);
  } catch (error) {
    console.error("✗ Could not parse model output as JSON.");
    console.error(String(error));
    console.error("\n--- raw output ---\n" + raw.slice(0, 2000));
    process.exit(1);
  }

  const { tree, issues } = validateTree(parsed);

  console.log("── validated stage ─────────────────────────────");
  printTree(tree);

  const nodeCount = Object.keys(tree.nodes).length;
  console.log(`\n${nodeCount} node(s).`);
  if (issues.length === 0) {
    console.log("✓ No validation issues — the agent produced a fully valid tree.");
  } else {
    console.log(`⚠ ${issues.length} issue(s) repaired by validateTree (fail-safe):`);
    for (const issue of issues) console.log(`   - ${issue}`);
  }

  mkdirSync(new URL("../generated/", import.meta.url), { recursive: true });
  const file = new URL("../generated/latest.json", import.meta.url);
  writeFileSync(file, JSON.stringify(tree, null, 2));
  console.log(`\nSaved tree → apps/playground/generated/latest.json`);
}

void main();
