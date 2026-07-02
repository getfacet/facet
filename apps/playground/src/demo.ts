/**
 * In-process Facet demo — no browser, no LLM, no network.
 *
 * Proves the core model in the terminal: two visitors hit the SAME agent link and
 * get DIFFERENT stages, and a chat message mutates one visitor's stage while the
 * other's is untouched. The browser playground (pnpm dev) shows the same `nova`
 * agent rendered for real. Run:  pnpm demo
 */
import {
  applyPatch,
  EMPTY_TREE,
  type FacetTree,
  type ServerMessage,
  type VisitorContext,
} from "@facet/core";
import { FacetRuntime } from "@facet/runtime";
import { nova } from "./nova.js";
import { printTree } from "./print-tree.js";

const runtime = new FacetRuntime({ agentId: "nova", agent: nova });

/** Re-derive a visitor's stage from the messages they received, for printing. */
function render(messages: readonly ServerMessage[], base: FacetTree): FacetTree {
  let tree = base;
  for (const message of messages) {
    if (message.kind === "patch") {
      tree = applyPatch(tree, message.patches);
    }
  }
  return tree;
}

function printStage(label: string, tree: FacetTree): void {
  console.log(`\n── ${label} ─────────────────────────────`);
  printTree(tree);
}

async function main(): Promise<void> {
  const alice: VisitorContext = {
    visitorId: "alice",
    referrer: "https://twitter.com/x",
    locale: "en-US",
  };
  const bob: VisitorContext = { visitorId: "bob", locale: "ko-KR" };

  const aliceVisit = await runtime.handle(alice, { kind: "visit", visitor: alice });
  const bobVisit = await runtime.handle(bob, { kind: "visit", visitor: bob });

  let aliceTree = render(aliceVisit, EMPTY_TREE);
  const bobTree = render(bobVisit, EMPTY_TREE);

  printStage("Alice (from Twitter) — first paint", aliceTree);
  printStage("Bob (direct) — first paint", bobTree);

  const alicePricing = await runtime.handle(alice, {
    kind: "message",
    text: "what's your pricing?",
  });
  aliceTree = render(alicePricing, aliceTree);
  for (const m of alicePricing) {
    if (m.kind === "say") console.log(`\nNova → Alice: ${m.text}`);
  }

  printStage("Alice — after asking about pricing", aliceTree);
  printStage("Bob — unchanged", bobTree);
}

void main();
