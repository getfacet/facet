/**
 * The deterministic stub brain (spec Decision 6) — the keyless fixture agent
 * behind `facet-quickstart --stub` and the /live-test Tier-1 gate.
 *
 * Zero network, zero randomness, zero clock reads: the same event sequence
 * always yields deep-equal message sequences (DC-008), so the E2E gate can
 * assert exact outputs. One fixture tree exercises collect, screens, and
 * patching in a single boot.
 */
import { isValidThemeName, type ClientEvent, type FacetAgent, type FacetTree } from "@facet/core";
import { defineAgent } from "@facet/agent";

/**
 * The fixture stage: a hero line, a `signup` box with name + email fields, a
 * pressable submit box collecting `signup`, and two screens (home/about) with
 * navigate boxes both ways. Valid per `validateTree` (pinned in agent.test.ts).
 */
export const STUB_TREE: FacetTree = {
  root: "home",
  screens: { home: "home", about: "about" },
  entry: "home",
  nodes: {
    home: {
      id: "home",
      type: "box",
      style: { direction: "col", gap: "md" },
      children: ["hero", "signup", "submit", "go-about"],
    },
    hero: { id: "hero", type: "text", value: "Facet quickstart — stub stage" },
    signup: {
      id: "signup",
      type: "box",
      style: { direction: "col", gap: "sm" },
      children: ["signup-name", "signup-email"],
    },
    "signup-name": {
      id: "signup-name",
      type: "field",
      name: "name",
      label: "Name",
    },
    "signup-email": {
      id: "signup-email",
      type: "field",
      name: "email",
      input: "email",
      label: "Email",
    },
    submit: {
      id: "submit",
      type: "box",
      style: { border: true },
      onPress: { kind: "agent", name: "submit", collect: "signup" },
      children: ["submit-label"],
    },
    "submit-label": { id: "submit-label", type: "text", value: "Send" },
    "go-about": {
      id: "go-about",
      type: "box",
      onPress: { kind: "navigate", to: "about" },
      children: ["go-about-label"],
    },
    "go-about-label": { id: "go-about-label", type: "text", value: "About →" },
    about: {
      id: "about",
      type: "box",
      style: { direction: "col", gap: "md" },
      children: ["about-title", "go-home"],
    },
    "about-title": { id: "about-title", type: "text", value: "About this stub" },
    "go-home": {
      id: "go-home",
      type: "box",
      onPress: { kind: "navigate", to: "home" },
      children: ["go-home-label"],
    },
    "go-home-label": { id: "go-home-label", type: "text", value: "← Home" },
  },
};

/** `event.fields ?? {}` as sorted `key=value` pairs after the action name. */
function describeAction(event: Extract<ClientEvent, { kind: "action" }>): string {
  const name = event.action.name ?? event.action.kind;
  const fields = event.fields ?? {};
  const pairs = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key] ?? ""}`);
  return [`${name}:`, ...pairs].join(" ");
}

export function createStubAgent(): FacetAgent {
  return defineAgent(({ event, session, stage }) => {
    switch (event.kind) {
      case "visit": {
        stage.render(STUB_TREE);
        return;
      }
      case "message": {
        // Deterministic theme switch: "theme <name>" selects a theme by name
        // (the DC-010 live vehicle) instead of echoing. Zero randomness/clock.
        const THEME_PREFIX = "theme ";
        if (event.text.startsWith(THEME_PREFIX)) {
          const name = event.text.slice(THEME_PREFIX.length).trim();
          // Mirror the real agent's set_theme gate: an invalid name would be
          // stripped from the stored stage while the raw `add /theme` frame still
          // reached live clients — a stored-vs-live divergence. Refuse instead.
          if (!isValidThemeName(name)) {
            stage.say("stub: invalid theme name (letters/digits/_/-, max 64)");
            return;
          }
          stage.theme(name);
          stage.say(`stub: theme ${name}`);
          return;
        }
        const echo = { id: "stub-echo", type: "text", value: `echo: ${event.text}` } as const;
        if (session.stage.nodes["stub-echo"] === undefined) {
          stage.append(session.stage.root, echo);
        } else {
          stage.set(echo);
        }
        stage.say(`stub: ${event.text}`);
        return;
      }
      case "action": {
        stage.say(describeAction(event));
        return;
      }
    }
  });
}
