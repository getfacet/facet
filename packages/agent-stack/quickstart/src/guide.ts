import type { FacetTree } from "@facet/core";

/** Built-in first-run page brief for the `facet-quickstart` CLI/package. */
export const QUICKSTART_PAGE_BRIEF = `# Facet quickstart tour

You are guiding a developer who has just installed Facet and opened the
quickstart. The page itself is the product tour: show what Facet can do by
changing the UI, not by writing long chat explanations.

The goal is to make the visitor understand, within a few interactions, that
Facet lets an agent render a live, per-visitor interface from safe bricks and
patches:

- safe declarative UI, never raw HTML, JS, CSS, or arbitrary pixels
- theme-locked, token-based visual styling
- catalog compositions and intrinsic components before primitive fallback
- live JSON Patch updates that mutate the page during a conversation
- multiple screens with local navigation
- fields and buttons that send structured context back to the agent
- compact product surfaces with charts, tables, metrics, cards, alerts, progress,
  lists, forms, and action buttons

On the first visit, keep or refine the seeded four-tab tour:

1. What is Facet? — explain the product by changing the UI, not by writing a
   static article.
2. Core Structure — show the stage, patch loop, renderer, runtime, assets, and
   agent tool boundary.
3. Design System — introduce the default theme, components, compositions, and catalog
   through live Facet UI examples.
4. Use Cases — let the visitor request a dashboard, pricing flow, onboarding
   flow, replay view, or other concrete product surface.

The whole quickstart page is agent-owned. Preserve the top-level tabs unless the
visitor explicitly asks for a different tour, and prefer editing the active tab
before changing other screens. When a direct visitor request changes a hidden
screen, navigate to that screen in the same turn so the result is immediately
visible.

When the visitor asks what Facet can do, update the page with a concrete example
instead of only answering in chat. Good examples include a pricing comparison,
an onboarding flow, a dashboard, a form-driven workflow, a replay/evaluation
view, or a multi-step assistant surface.

When changing the page:

- Prefer editing the existing quickstart nodes before appending more sections.
- Keep every screen compact; do not make a long scrolling marketing page.
- Use available catalog compositions and intrinsic components first. Use
  box/text/media/field only when the catalog cannot express the needed UI.
- Keep the active theme unless theme switching is explicitly allowed.
- If a tool result says a change was rejected, inspect the stage and repair it
  before claiming success.
- Use chat as a short acknowledgement. The main answer should be visible in the
  page.`;

const QUICKSTART_NAV_ITEMS = [
  { label: "What is Facet?", to: "what" },
  { label: "Core Structure", to: "structure" },
  { label: "Design System", to: "system" },
  { label: "Use Cases", to: "usecases" },
] as const;

/** Seeded first paint for the built-in quickstart brief. User guides/assets win. */
export const QUICKSTART_INITIAL_STAGE: FacetTree = {
  root: "qs.home.root",
  entry: "what",
  theme: "default",
  screens: {
    what: "qs.home.root",
    structure: "qs.runtime.root",
    system: "qs.system.root",
    usecases: "qs.usecases.root",
  },
  nodes: {
    "qs.home.root": {
      id: "qs.home.root",
      type: "box",
      style: { direction: "col", gap: "lg", pad: "xl" },
      children: ["qs.nav.home", "qs.hero", "qs.metrics", "qs.surface.card", "qs.runtime.summary"],
    },
    "qs.nav.home": {
      id: "qs.nav.home",
      type: "tabs",
      variant: "default",
      items: QUICKSTART_NAV_ITEMS,
    },
    "qs.hero": {
      id: "qs.hero",
      type: "section",
      eyebrow: "Facet quickstart",
      title: "What is Facet?",
      body: "Facet is a live UI surface an agent can safely reshape while you talk: typed bricks, token styling, reusable assets, and JSON Patch updates instead of raw client code.",
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
      label: "Show a live example",
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
      label: "Try a use case",
      variant: "secondary",
      onPress: { kind: "navigate", to: "usecases" },
    },
    "qs.metrics": {
      id: "qs.metrics",
      type: "box",
      style: { direction: "col", gap: "md" },
      children: ["qs.metric.patch", "qs.card.safety", "qs.card.progress"],
    },
    "qs.metric.patch": {
      id: "qs.metric.patch",
      type: "metric",
      label: "Patch loop",
      value: "Live",
      delta: "per visitor",
      tone: "success",
      variant: "success",
    },
    "qs.card.safety": {
      id: "qs.card.safety",
      type: "card",
      title: "Safe vocabulary",
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
      body: "Display components stay display-only. Ask the agent to turn this into your own dashboard, pricing path, or workflow.",
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
        { tool: "append_node", result: "applied_visible", visible: true },
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
      title: "A page the agent owns",
      body: "Every tab is still the same Facet stage. Navigation is local, while agent actions can patch the visible page.",
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
    "qs.system.root": {
      id: "qs.system.root",
      type: "box",
      style: { direction: "col", gap: "lg", pad: "xl" },
      children: [
        "qs.nav.system",
        "qs.system.hero",
        "qs.system.theme",
        "qs.system.bricks",
        "qs.system.compositions",
        "qs.system.catalog",
      ],
    },
    "qs.nav.system": {
      id: "qs.nav.system",
      type: "tabs",
      variant: "default",
      items: QUICKSTART_NAV_ITEMS,
    },
    "qs.system.hero": {
      id: "qs.system.hero",
      type: "section",
      eyebrow: "Default assets",
      title: "Design System",
      body: "The agent can introduce the default theme, catalog variants, intrinsic components, fields, and composition patterns through live Facet UI examples.",
      variant: "surface",
      children: ["qs.system.hero.alert"],
    },
    "qs.system.hero.alert": {
      id: "qs.system.hero.alert",
      type: "alert",
      title: "Renderer QA surface",
      body: "This tab doubles as a renderer QA surface for alignment, overflow, native-control, and recipe-part issues.",
      variant: "info",
      tone: "info",
    },
    "qs.system.theme": {
      id: "qs.system.theme",
      type: "section",
      title: "Theme recipes",
      body: "Agents choose variants and bounded tones. The renderer resolves token-only recipes into the final UI.",
      variant: "surface",
      children: ["qs.system.theme.badges", "qs.system.theme.progress", "qs.system.theme.list"],
    },
    "qs.system.theme.badges": {
      id: "qs.system.theme.badges",
      type: "box",
      style: { direction: "row", gap: "sm", wrap: true },
      children: [
        "qs.system.badge.neutral",
        "qs.system.badge.success",
        "qs.system.badge.warning",
        "qs.system.badge.danger",
      ],
    },
    "qs.system.badge.neutral": {
      id: "qs.system.badge.neutral",
      type: "badge",
      label: "neutral",
      variant: "neutral",
      tone: "neutral",
    },
    "qs.system.badge.success": {
      id: "qs.system.badge.success",
      type: "badge",
      label: "success",
      variant: "success",
      tone: "success",
    },
    "qs.system.badge.warning": {
      id: "qs.system.badge.warning",
      type: "badge",
      label: "warning",
      variant: "warning",
      tone: "warning",
    },
    "qs.system.badge.danger": {
      id: "qs.system.badge.danger",
      type: "badge",
      label: "danger",
      variant: "danger",
      tone: "danger",
    },
    "qs.system.theme.progress": {
      id: "qs.system.theme.progress",
      type: "progress",
      label: "Recipe coverage",
      value: 92,
      variant: "success",
      tone: "success",
    },
    "qs.system.theme.list": {
      id: "qs.system.theme.list",
      type: "list",
      variant: "compact",
      items: [
        { title: "Theme", body: "Default token maps stay inside assets and renderer." },
        { title: "Variants", body: "Catalog names advertise the choices agents can make." },
        { title: "Recipes", body: "Parts style labels, controls, cells, tracks, and fills." },
      ],
    },
    "qs.system.bricks": {
      id: "qs.system.bricks",
      type: "section",
      title: "Component gallery",
      body: "The built-in intrinsic components render through React recipe parts while box, text, media, and field remain the primitive base.",
      variant: "surface",
      children: [
        "qs.system.actions.card",
        "qs.system.data.card",
        "qs.system.form.card",
        "qs.system.feedback.card",
      ],
    },
    "qs.system.actions.card": {
      id: "qs.system.actions.card",
      type: "card",
      title: "Actions and layout",
      body: "Buttons, cards, metrics, badges, progress, dividers, and flow boxes.",
      children: [
        "qs.system.action.buttons",
        "qs.system.action.metric",
        "qs.system.action.progress",
        "qs.system.action.divider",
      ],
    },
    "qs.system.action.buttons": {
      id: "qs.system.action.buttons",
      type: "box",
      style: { direction: "row", gap: "sm", wrap: true },
      children: [
        "qs.system.button.primary",
        "qs.system.button.secondary",
        "qs.system.button.danger",
      ],
    },
    "qs.system.button.primary": {
      id: "qs.system.button.primary",
      type: "button",
      label: "Primary",
      variant: "primary",
      tone: "accent",
      onPress: { kind: "agent", name: "show_primary_action" },
    },
    "qs.system.button.secondary": {
      id: "qs.system.button.secondary",
      type: "button",
      label: "Secondary",
      variant: "secondary",
      onPress: { kind: "agent", name: "show_secondary_action" },
    },
    "qs.system.button.danger": {
      id: "qs.system.button.danger",
      type: "button",
      label: "Danger",
      variant: "danger",
      tone: "danger",
      onPress: { kind: "agent", name: "show_danger_action" },
    },
    "qs.system.action.metric": {
      id: "qs.system.action.metric",
      type: "metric",
      label: "Interactive components",
      value: "12",
      delta: "plus field",
      variant: "success",
      tone: "success",
    },
    "qs.system.action.progress": {
      id: "qs.system.action.progress",
      type: "progress",
      label: "Polish pass",
      value: 76,
      variant: "default",
      tone: "info",
    },
    "qs.system.action.divider": {
      id: "qs.system.action.divider",
      type: "divider",
      label: "Data display",
      variant: "default",
    },
    "qs.system.data.card": {
      id: "qs.system.data.card",
      type: "card",
      title: "Display-only data",
      body: "Tables and charts show bounded data only. They do not fetch, sort, or bind backend state.",
      children: ["qs.system.data.chart", "qs.system.data.table"],
    },
    "qs.system.data.chart": {
      id: "qs.system.data.chart",
      type: "chart",
      title: "Renderer checks",
      kind: "bar",
      variant: "default",
      labels: ["Table", "Chart", "Field", "Composition"],
      series: [{ label: "coverage", values: [3, 4, 3, 5] }],
    },
    "qs.system.data.table": {
      id: "qs.system.data.table",
      type: "table",
      caption: "Catalog variants",
      variant: "default",
      columns: [
        { key: "component", label: "Component" },
        { key: "contract", label: "Variant / role" },
      ],
      rows: [
        { component: "button", contract: "primary, secondary, danger" },
        { component: "table", contract: "display-only rows" },
        { component: "progress", contract: "track and fill" },
        { component: "field", contract: "primitive browser view-state" },
      ],
    },
    "qs.system.form.card": {
      id: "qs.system.form.card",
      type: "card",
      title: "Field controls",
      body: "Field values stay in browser view-state until an action collects them.",
      children: ["qs.system.form.name", "qs.system.form.kind", "qs.system.form.submit"],
    },
    "qs.system.form.name": {
      id: "qs.system.form.name",
      type: "field",
      name: "showcase_name",
      label: "Showcase name",
      placeholder: "Design audit",
      variant: "default",
    },
    "qs.system.form.kind": {
      id: "qs.system.form.kind",
      type: "field",
      name: "showcase_kind",
      input: "select",
      label: "Surface type",
      options: ["Dashboard", "Form", "Catalog", "Workflow"],
      variant: "default",
    },
    "qs.system.form.submit": {
      id: "qs.system.form.submit",
      type: "button",
      label: "Collect field values",
      variant: "secondary",
      onPress: { kind: "agent", name: "inspect_showcase_fields", collect: "qs.system.form.card" },
    },
    "qs.system.feedback.card": {
      id: "qs.system.feedback.card",
      type: "card",
      title: "Feedback patterns",
      body: "Alerts and lists carry product state without overlays, z-index, or absolute positioning.",
      children: ["qs.system.feedback.alert", "qs.system.feedback.list"],
    },
    "qs.system.feedback.alert": {
      id: "qs.system.feedback.alert",
      type: "alert",
      title: "Token-only styling",
      body: "The agent never chooses raw colors, classes, pixels, HTML, or scripts.",
      variant: "success",
      tone: "success",
    },
    "qs.system.feedback.list": {
      id: "qs.system.feedback.list",
      type: "list",
      variant: "default",
      items: [
        { title: "Flow layout", body: "No overlay or absolute-position contracts." },
        { title: "Bounded intent", body: "Variants and tones are the visual knobs." },
        { title: "Fail-safe renderer", body: "Malformed nodes skip instead of throwing." },
      ],
    },
    "qs.system.compositions": {
      id: "qs.system.compositions",
      type: "section",
      title: "Default composition patterns",
      body: "The agent sees composition names, slots, and metadata before it falls back to primitive composition.",
      variant: "surface",
      children: ["qs.system.compositions.list", "qs.system.compositions.table"],
    },
    "qs.system.compositions.list": {
      id: "qs.system.compositions.list",
      type: "list",
      variant: "compact",
      items: [
        { title: "hero", body: "Compact product intro with a call to action." },
        { title: "pricing-section", body: "Three-card plan comparison." },
        { title: "dashboard-summary", body: "KPI metric, status badge, and progress." },
        { title: "settings-panel", body: "Fields plus a collect action." },
        { title: "chart-table-view", body: "Display-only data view." },
      ],
    },
    "qs.system.compositions.table": {
      id: "qs.system.compositions.table",
      type: "table",
      caption: "Composition slots",
      variant: "default",
      columns: [
        { key: "composition", label: "Composition" },
        { key: "slots", label: "Slots" },
      ],
      rows: [
        { composition: "hero", slots: "title, subtitle, cta" },
        { composition: "settings-panel", slots: "title, email, timezone, save" },
        { composition: "support-triage", slots: "issue, details, submit" },
      ],
    },
    "qs.system.catalog": {
      id: "qs.system.catalog",
      type: "section",
      title: "Catalog policy",
      body: "The default order is composition, then component, then primitive fallback. The model chooses intent; assets and renderer own polish.",
      variant: "surface",
      children: ["qs.system.catalog.list"],
    },
    "qs.system.catalog.list": {
      id: "qs.system.catalog.list",
      type: "list",
      variant: "default",
      items: [
        { title: "Theme", body: "default, locked by name" },
        { title: "Component", body: "variant and tone from the catalog only" },
        { title: "Composition", body: "name and slots, never fragment JSON in prompt" },
        { title: "Primitive", body: "box, text, media, and field as fallback base" },
      ],
    },
    "qs.usecases.root": {
      id: "qs.usecases.root",
      type: "box",
      style: { direction: "col", gap: "lg", pad: "xl" },
      children: ["qs.nav.usecases", "qs.usecases.hero", "qs.usecases.examples", "qs.intake"],
    },
    "qs.nav.usecases": {
      id: "qs.nav.usecases",
      type: "tabs",
      variant: "default",
      items: QUICKSTART_NAV_ITEMS,
    },
    "qs.usecases.hero": {
      id: "qs.usecases.hero",
      type: "section",
      eyebrow: "Your turn",
      title: "Use Cases",
      body: "Ask Facet to draw a concrete app surface. The agent should update the page with components, compositions, variants, and fields instead of only replying in chat.",
      variant: "surface",
      children: ["qs.usecases.alert"],
    },
    "qs.usecases.alert": {
      id: "qs.usecases.alert",
      type: "alert",
      title: "Try a real request",
      body: "Examples: customer onboarding, pricing comparison, CRM dashboard, evaluation replay, or support triage.",
      variant: "info",
      tone: "info",
    },
    "qs.usecases.examples": {
      id: "qs.usecases.examples",
      type: "section",
      title: "Starting points",
      body: "These are prompts the agent can turn into a live page.",
      children: ["qs.usecases.list", "qs.usecases.actions"],
    },
    "qs.usecases.list": {
      id: "qs.usecases.list",
      type: "list",
      variant: "default",
      items: [
        { title: "Dashboard", body: "KPIs, chart, table, status, and next action." },
        { title: "Pricing", body: "Plan comparison with a conversion path." },
        { title: "Onboarding", body: "Step-by-step fields and completion state." },
        { title: "Replay view", body: "Evaluation results with summaries and details." },
      ],
    },
    "qs.usecases.actions": {
      id: "qs.usecases.actions",
      type: "box",
      style: { direction: "row", gap: "sm", wrap: true },
      children: [
        "qs.usecases.dashboard",
        "qs.usecases.pricing",
        "qs.usecases.onboarding",
        "qs.usecases.replay",
      ],
    },
    "qs.usecases.dashboard": {
      id: "qs.usecases.dashboard",
      type: "button",
      label: "Dashboard",
      variant: "secondary",
      onPress: {
        kind: "agent",
        name: "show_use_case",
        payload: { use_case: "dashboard" },
      },
    },
    "qs.usecases.pricing": {
      id: "qs.usecases.pricing",
      type: "button",
      label: "Pricing",
      variant: "secondary",
      onPress: {
        kind: "agent",
        name: "show_use_case",
        payload: { use_case: "pricing" },
      },
    },
    "qs.usecases.onboarding": {
      id: "qs.usecases.onboarding",
      type: "button",
      label: "Onboarding",
      variant: "secondary",
      onPress: {
        kind: "agent",
        name: "show_use_case",
        payload: { use_case: "onboarding" },
      },
    },
    "qs.usecases.replay": {
      id: "qs.usecases.replay",
      type: "button",
      label: "Replay view",
      variant: "secondary",
      onPress: {
        kind: "agent",
        name: "show_use_case",
        payload: { use_case: "replay" },
      },
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
      items: QUICKSTART_NAV_ITEMS,
    },
    "qs.runtime.section": {
      id: "qs.runtime.section",
      type: "section",
      eyebrow: "Architecture",
      title: "Core Structure",
      body: "Facet separates the safe stage contract, renderer, runtime, assets, transport, and agent tools. The model chooses bounded intent; Facet validates and renders.",
      variant: "surface",
      children: ["qs.structure.list", "qs.structure.table"],
    },
    "qs.structure.list": {
      id: "qs.structure.list",
      type: "list",
      variant: "default",
      items: [
        {
          title: "Stage",
          body: "A validated tree of primitive bricks, components, and local screens.",
        },
        { title: "Patch loop", body: "Server and browser fold the same JSON Patch stream." },
        { title: "Assets", body: "Themes, compositions, and catalog policy guide visual intent." },
        { title: "Renderer", body: "React resolves token recipes into product UI." },
      ],
    },
    "qs.structure.table": {
      id: "qs.structure.table",
      type: "table",
      caption: "Package roles",
      variant: "default",
      columns: [
        { key: "layer", label: "Layer" },
        { key: "package", label: "Package" },
        { key: "owns", label: "Owns" },
      ],
      rows: [
        { layer: "Contract", package: "@facet/core", owns: "nodes, tokens, patches" },
        { layer: "Assets", package: "@facet/assets", owns: "default recipes, compositions" },
        { layer: "Renderer", package: "@facet/react", owns: "component rendering" },
        { layer: "Agent tools", package: "@facet/agent-tools", owns: "safe mutations" },
      ],
    },
  },
};
