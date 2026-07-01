/**
 * In-process Facet demo — no browser, no LLM, no network.
 *
 * It proves the core model end to end: two visitors hit the SAME agent link and
 * get DIFFERENT stages from the first paint, and a chat message mutates one
 * visitor's stage live while the other's is untouched. Everything is built from
 * the four low-level bricks (box / text / image / field) with token styles. Swap
 * the hand-written logic in `nova` for a real LLM call and the rest is identical.
 *
 * Run:  pnpm demo
 */
import {
  applyPatch,
  EMPTY_TREE,
  type FacetTree,
  type ServerMessage,
  type VisitorContext,
} from "@facet/core";
import { defineAgent } from "@facet/agent";
import { FacetRuntime } from "@facet/runtime";

let counter = 0;
const id = (prefix: string): string => `${prefix}-${++counter}`;

/** A toy agent that diverges per visitor and reacts to chat — pure bricks. */
const nova = defineAgent(({ event, stage }) => {
  switch (event.kind) {
    case "visit": {
      const fromTwitter = event.visitor.referrer?.includes("twitter") ?? false;
      const heading = id("text");
      const intro = id("text");
      const cta = id("box"); // a pressable box = a button
      const ctaLabel = id("text");
      stage.render({
        root: "root",
        nodes: {
          root: {
            id: "root",
            type: "box",
            style: { direction: "col", gap: "lg", pad: "xl" },
            children: [heading, intro, cta],
          },
          [heading]: {
            id: heading,
            type: "text",
            value: "Hi, I'm Nova",
            style: { size: "3xl", weight: "bold", color: "fg" },
          },
          [intro]: {
            id: intro,
            type: "text",
            value: fromTwitter
              ? "Saw you came from Twitter — here's the short version."
              : "Ask me anything, and this page rebuilds itself for you.",
            style: { size: "md", color: "fg-muted" },
          },
          [cta]: {
            id: cta,
            type: "box",
            style: { bg: "accent", radius: "md", pad: "md", align: "center" },
            onPress: { name: "view_pricing" },
            children: [ctaLabel],
          },
          [ctaLabel]: {
            id: ctaLabel,
            type: "text",
            value: "See pricing",
            style: { color: "accent-fg", weight: "semibold" },
          },
        },
      });
      break;
    }
    case "message": {
      if (/pric|가격/i.test(event.text)) {
        const card = id("box"); // a box with a border = a card
        const title = id("text");
        const price = id("text");
        stage.append("root", {
          id: card,
          type: "box",
          style: { direction: "col", gap: "sm", pad: "lg", bg: "surface", radius: "lg", border: true },
          children: [title, price],
        });
        stage.set({ id: title, type: "text", value: "Pro", style: { size: "lg", weight: "bold" } });
        stage.set({
          id: price,
          type: "text",
          value: "$20/mo — everything, no limits.",
          style: { color: "fg-muted" },
        });
        stage.say("Added the pricing card below 👇");
      } else {
        stage.say(`You said: "${event.text}". Tell me what to put on the page.`);
      }
      break;
    }
    case "action": {
      stage.say(`(action: ${event.action.name})`);
      break;
    }
  }
});

const runtime = new FacetRuntime({ agentId: "nova", agent: nova });

/** Re-derive a viewer's stage from the messages they received, for printing. */
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
  const walk = (nodeId: string, depth: number): void => {
    const node = tree.nodes[nodeId];
    if (node === undefined) return;
    const pad = "  ".repeat(depth);
    const summary = node.type === "text" ? `: "${node.value}"` : "";
    const pressable = node.type === "box" && node.onPress !== undefined ? " [pressable]" : "";
    console.log(`${pad}${node.type}${summary}${pressable}`);
    if (node.type === "box") {
      for (const child of node.children) walk(child, depth + 1);
    }
  };
  walk(tree.root, 0);
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

  // Alice chats; her stage mutates. Bob's does not.
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
