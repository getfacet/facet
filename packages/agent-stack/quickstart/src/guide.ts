import type { FacetTree } from "@facet/core";

/** Built-in first-run page brief for the `facet-quickstart` CLI/package. */
export const QUICKSTART_PAGE_BRIEF = `# Facet Live Lab

You are guiding a developer who has just installed Facet and opened the
quickstart. The page itself is the product tour: show what Facet can do by
changing the UI, not by writing long chat explanations.

The goal is to make the visitor understand, within a few interactions, that
Facet lets an agent render a live, per-visitor interface from safe bricks and
patches:

- safe declarative UI, never raw HTML, JS, CSS, or arbitrary pixels
- theme-locked, token-based visual styling
- reusable stamps and high-level bricks before primitive fallback
- live JSON Patch updates that mutate the page during a conversation
- multiple screens with local navigation
- fields and buttons that send structured context back to the agent
- compact product surfaces with charts, tables, stats, cards, alerts, progress,
  lists, forms, and action buttons

On the first visit, keep or refine the seeded "Facet Live Lab" screen. It should
stay compact and product-quality: a short hero, representative app bricks, and a
small intake form that can send structured context back to the agent.

When the visitor asks what Facet can do, update the page with a concrete example
instead of only answering in chat. Good examples include a pricing comparison,
an onboarding flow, a dashboard, a form-driven workflow, a replay/evaluation
view, or a multi-step assistant surface.

When changing the page:

- Prefer editing the existing quickstart nodes before appending more sections.
- Keep every screen compact; do not make a long scrolling marketing page.
- Use available stamps and high-level bricks first. Use box/text/media/field
  only when the catalog or stamps cannot express the needed UI.
- Keep the active theme unless theme switching is explicitly allowed.
- If a tool result says a change was rejected, inspect the stage and repair it
  before claiming success.
- Use chat as a short acknowledgement. The main answer should be visible in the
  page.`;

/** Seeded first paint for the built-in quickstart brief. User guides/assets win. */
export const QUICKSTART_INITIAL_STAGE: FacetTree = {
  root: "qs.home.root",
  entry: "home",
  theme: "default",
  screens: {
    home: "qs.home.root",
    live: "qs.live.root",
    runtime: "qs.runtime.root",
  },
  nodes: {
    "qs.home.root": {
      id: "qs.home.root",
      type: "box",
      style: { direction: "col", gap: "lg", pad: "xl" },
      children: [
        "qs.nav.home",
        "qs.hero",
        "qs.metrics",
        "qs.surface.card",
        "qs.intake",
        "qs.runtime.summary",
      ],
    },
    "qs.nav.home": {
      id: "qs.nav.home",
      type: "tabs",
      variant: "default",
      items: [
        { label: "Overview", to: "home" },
        { label: "Live UI", to: "live" },
        { label: "Runtime", to: "runtime" },
      ],
    },
    "qs.hero": {
      id: "qs.hero",
      type: "section",
      eyebrow: "Facet quickstart",
      title: "Facet Live Lab",
      body: "A live UI surface an agent can safely reshape while you talk: typed bricks, token styling, reusable assets, and JSON Patch updates instead of raw client code.",
      variant: "surface",
      children: ["qs.hero.actions"],
    },
    "qs.hero.actions": {
      id: "qs.hero.actions",
      type: "box",
      style: { direction: "row", gap: "sm", wrap: true },
      children: ["qs.hero.primary", "qs.hero.secondary"],
    },
    "qs.hero.primary": {
      id: "qs.hero.primary",
      type: "button",
      label: "Build a product workflow",
      variant: "primary",
      tone: "accent",
      onPress: {
        kind: "agent",
        name: "show_dynamic_example",
        payload: { example: "workflow" },
      },
    },
    "qs.hero.secondary": {
      id: "qs.hero.secondary",
      type: "button",
      label: "Open the UI kit",
      variant: "secondary",
      onPress: { kind: "navigate", to: "live" },
    },
    "qs.metrics": {
      id: "qs.metrics",
      type: "box",
      style: { columns: 3, gap: "md" },
      children: ["qs.stat.patch", "qs.card.safety", "qs.card.progress"],
    },
    "qs.stat.patch": {
      id: "qs.stat.patch",
      type: "stat",
      label: "Patch loop",
      value: "Live",
      delta: "per visitor",
      tone: "success",
      variant: "success",
    },
    "qs.card.safety": {
      id: "qs.card.safety",
      type: "card",
      title: "Safe bricks",
      body: "Agents emit validated stage data, not HTML or scripts.",
      children: ["qs.badge.safe"],
    },
    "qs.badge.safe": {
      id: "qs.badge.safe",
      type: "badge",
      label: "Closed vocabulary",
      tone: "success",
      variant: "success",
    },
    "qs.card.progress": {
      id: "qs.card.progress",
      type: "card",
      title: "First paint",
      body: "The shell starts with a real stage, then the provider-backed agent can refine it.",
      children: ["qs.progress.ready"],
    },
    "qs.progress.ready": {
      id: "qs.progress.ready",
      type: "progress",
      value: 82,
      label: "Polished default kit",
      tone: "info",
      variant: "default",
    },
    "qs.surface.card": {
      id: "qs.surface.card",
      type: "card",
      title: "Representative product surface",
      body: "Display bricks stay display-only. Ask the agent to turn this into your own dashboard, pricing path, or workflow.",
      variant: "interactive",
      children: ["qs.surface.chart", "qs.surface.divider", "qs.surface.table"],
    },
    "qs.surface.chart": {
      id: "qs.surface.chart",
      type: "chart",
      kind: "line",
      title: "Stage updates",
      variant: "default",
      labels: ["Visit", "Ask", "Tool", "Repair"],
      series: [{ label: "patches", values: [1, 4, 7, 5] }],
    },
    "qs.surface.divider": {
      id: "qs.surface.divider",
      type: "divider",
      label: "Tool outcomes",
      variant: "default",
    },
    "qs.surface.table": {
      id: "qs.surface.table",
      type: "table",
      caption: "Recent stage tool results",
      variant: "default",
      columns: [
        { key: "tool", label: "Tool" },
        { key: "result", label: "Result" },
        { key: "visible", label: "Visible" },
      ],
      rows: [
        { tool: "render_page", result: "applied_visible", visible: true },
        { tool: "use_stamp", result: "applied_visible", visible: true },
        { tool: "set_node", result: "needs_repair", visible: false },
      ],
    },
    "qs.intake": {
      id: "qs.intake",
      type: "card",
      title: "Give the agent a target",
      body: "Field values remain browser view-state until this button collects them.",
      children: ["qs.intake.goal", "qs.intake.surface", "qs.intake.alert", "qs.intake.submit"],
    },
    "qs.intake.goal": {
      id: "qs.intake.goal",
      type: "field",
      name: "goal",
      label: "What should the agent build?",
      placeholder: "A customer onboarding flow",
      variant: "default",
    },
    "qs.intake.surface": {
      id: "qs.intake.surface",
      type: "field",
      name: "surface",
      input: "select",
      label: "Surface",
      options: ["Dashboard", "Pricing", "Form flow", "Replay view"],
      variant: "default",
    },
    "qs.intake.alert": {
      id: "qs.intake.alert",
      type: "alert",
      title: "Provider-backed",
      body: "The normal quickstart path still uses your OpenAI or Anthropic key; this seed is just the first paint.",
      tone: "info",
      variant: "info",
    },
    "qs.intake.submit": {
      id: "qs.intake.submit",
      type: "button",
      label: "Transform this page",
      variant: "primary",
      tone: "accent",
      onPress: {
        kind: "agent",
        name: "transform_quickstart",
        collect: "qs.intake",
      },
    },
    "qs.runtime.summary": {
      id: "qs.runtime.summary",
      type: "section",
      title: "What happens next",
      body: "The agent can inspect, patch, theme, and repair the same stage you are already seeing.",
      children: ["qs.runtime.list"],
    },
    "qs.runtime.list": {
      id: "qs.runtime.list",
      type: "list",
      variant: "compact",
      items: [
        { title: "Visitor event arrives", body: "Visit, chat, tap, or collected fields." },
        { title: "Provider selects tools", body: "Stage edits are validated before patches ship." },
        { title: "Renderer updates live", body: "The browser folds the same patch stream." },
      ],
    },
    "qs.live.root": {
      id: "qs.live.root",
      type: "box",
      style: { direction: "col", gap: "lg", pad: "xl" },
      children: ["qs.nav.live", "qs.live.section"],
    },
    "qs.nav.live": {
      id: "qs.nav.live",
      type: "tabs",
      variant: "default",
      items: [
        { label: "Overview", to: "home" },
        { label: "Live UI", to: "live" },
        { label: "Runtime", to: "runtime" },
      ],
    },
    "qs.live.section": {
      id: "qs.live.section",
      type: "section",
      title: "Ask the agent to reshape this",
      body: "Turn the starter surface into a dashboard, signup flow, pricing comparison, or evaluation view. Prefer compact edits over a long page.",
      variant: "surface",
      children: ["qs.live.actions"],
    },
    "qs.live.actions": {
      id: "qs.live.actions",
      type: "box",
      style: { direction: "row", gap: "sm", wrap: true },
      children: ["qs.live.back"],
    },
    "qs.live.back": {
      id: "qs.live.back",
      type: "button",
      label: "Back to overview",
      variant: "secondary",
      onPress: { kind: "navigate", to: "home" },
    },
    "qs.runtime.root": {
      id: "qs.runtime.root",
      type: "box",
      style: { direction: "col", gap: "lg", pad: "xl" },
      children: ["qs.nav.runtime", "qs.runtime.section"],
    },
    "qs.nav.runtime": {
      id: "qs.nav.runtime",
      type: "tabs",
      variant: "default",
      items: [
        { label: "Overview", to: "home" },
        { label: "Live UI", to: "live" },
        { label: "Runtime", to: "runtime" },
      ],
    },
    "qs.runtime.section": {
      id: "qs.runtime.section",
      type: "section",
      title: "Runtime boundary",
      body: "Facet owns the stage contract, renderer, runtime, and reference transports. Your agent owns product reasoning and domain data.",
      variant: "surface",
      children: [],
    },
  },
};
