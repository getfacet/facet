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
            style: { direction: "column", gap: "lg", padding: "xl" },
            children: [heading, intro, cta],
          },
          [heading]: {
            id: heading,
            type: "text",
            value: "Hi, I'm Nova",
            style: { fontSize: "3xl", fontWeight: "bold", color: "foreground" },
          },
          [intro]: {
            id: intro,
            type: "text",
            value: fromTwitter
              ? "Saw you came from Twitter — here's the short version."
              : "Ask me anything, and this page rebuilds itself for you.",
            style: { fontSize: "md", color: "mutedForeground" },
          },
          [cta]: {
            id: cta,
            type: "box",
            style: {
              background: "accent",
              borderRadius: "md",
              padding: "md",
              alignItems: "center",
            },
            onPress: { kind: "agent", name: "view_pricing" },
            children: [ctaLabel],
          },
          [ctaLabel]: {
            id: ctaLabel,
            type: "text",
            value: "See pricing",
            style: { color: "accentForeground", fontWeight: "semibold" },
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
            direction: "column",
            gap: "sm",
            padding: "lg",
            background: "surface",
            borderColor: "border",
            borderWidth: "thin",
            borderRadius: "lg",
          },
          children: [title, price],
        });
        stage.set({
          id: title,
          type: "text",
          value: "Pro",
          style: { fontSize: "lg", fontWeight: "bold" },
        });
        stage.set({
          id: price,
          type: "text",
          value: "$20/mo — everything, no limits.",
          style: { color: "mutedForeground" },
        });
        stage.say("Added the pricing card below 👇");
      } else {
        stage.say(`You said: "${event.text}". Try asking about "pricing".`);
      }
      break;
    }
    case "tap": {
      stage.say(`(you pressed: ${event.action.name})`);
      break;
    }
  }
});
