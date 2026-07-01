/**
 * CLI generator — the quickest way to test whether an LLM can compose good, valid
 * pages from Facet's four bricks.
 *
 *   pnpm --filter @facet/playground gen "a portfolio page for a photographer"
 */
import { mkdirSync, writeFileSync } from "node:fs";
import type { FacetTree } from "@facet/core";
import { generatePage } from "./generator.js";

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

async function main(): Promise<void> {
  const request = process.argv.slice(2).join(" ").trim() || "a simple landing page for a coffee shop";
  console.log(`\n▸ Asking the agent to build: "${request}"\n  (calling local claude CLI — no API key)…\n`);

  const { tree, issues } = await generatePage(request);

  console.log("── validated stage ─────────────────────────────");
  printTree(tree);

  const nodeCount = Object.keys(tree.nodes).length;
  console.log(`\n${String(nodeCount)} node(s).`);
  if (issues.length === 0) {
    console.log("✓ No validation issues — the agent produced a fully valid tree.");
  } else {
    console.log(`⚠ ${String(issues.length)} issue(s) repaired by validateTree (fail-safe):`);
    for (const issue of issues) console.log(`   - ${issue}`);
  }

  mkdirSync(new URL("../generated/", import.meta.url), { recursive: true });
  writeFileSync(new URL("../generated/latest.json", import.meta.url), JSON.stringify(tree, null, 2));
  console.log(`\nSaved tree → apps/playground/generated/latest.json`);
}

void main();
