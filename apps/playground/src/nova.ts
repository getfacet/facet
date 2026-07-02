/**
 * `nova` — the playground's local agent. Pure rule-based logic, NO LLM: it reads
 * the event and drives the stage deterministically. This is what a Facet agent
 * looks like; swapping the hand-written branches for an LLM call would not change
 * anything else in the stack. Shared by both the node demo and the web app.
 */
import { defineAgent } from "@facet/agent";

let counter = 0;
const id = (prefix: string): string => `${prefix}-${++counter}`;

export const nova = defineAgent(({ event, stage }) => {
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
            onPress: { kind: "agent", name: "view_pricing" },
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
          style: {
            direction: "col",
            gap: "sm",
            pad: "lg",
            bg: "surface",
            radius: "lg",
            border: true,
          },
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
        stage.say(`You said: "${event.text}". Try asking about "pricing".`);
      }
      break;
    }
    case "action": {
      stage.say(`(you pressed: ${event.action.name})`);
      break;
    }
  }
});
