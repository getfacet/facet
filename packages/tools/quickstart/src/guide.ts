import {
  parseMarkup,
  validateAuthorMarkup,
  type AuthorValidationResult,
  type ComponentDocument,
} from "@facet/core";
import { DEFAULT_CATALOG } from "@facet/assets";
import { quickstartCardMarkup, quickstartNavigationMarkup } from "./guide-shared.js";

/** Built-in first-run page brief for the `facet-quickstart` CLI/package. */
export const QUICKSTART_PAGE_BRIEF = `# Facet quickstart tour

You are guiding a developer who has just installed Facet and opened the
quickstart. The page itself is the product tour: show what Facet can do by
changing the UI, not by writing long chat explanations.

Facet lets an agent render a live, per-visitor interface from safe declarative
component markup:

- agents emit registered component tags and declared props, never HTML, JSX,
  JavaScript, CSS, imports, event handlers, or arbitrary pixels
- the host's immutable component catalog and React registry define the complete
  trust boundary
- UI writes go through Facet's runtime and FacetToolSession, which parse,
  validate, and authorize patches
- data providers and agent tools fetch domain data; Facet renders only bounded
  data bindings and explicit visitor events
- layout stays flow-contained through Screen, Stack, Row, Grid, Card, Modal,
  Text, Metric, Badge, Field, Button, Table, and Empty components

On the first visit, keep or refine the seeded four-screen tour:

1. What is Facet? — explain the product by changing the UI, not by writing a
   static article.
2. Runtime Loop — show the stage, validated mutation path, transport boundary,
   and conversation flow.
3. Component Catalog — show how the immutable default catalog constrains what an
   agent can render.
4. Use Cases — let the visitor request a dashboard, pricing flow, onboarding
   flow, replay view, or other concrete product surface.

The whole quickstart page is agent-owned. Preserve the top-level screen choices
unless the visitor explicitly asks for a different tour, and prefer editing the
active screen before changing other screens. When a direct visitor request
changes a hidden screen, navigate to that screen in the same turn so the result
is immediately visible.

When the visitor asks what Facet can do, update the page with a concrete
component-markup example instead of only answering in chat. Good examples include
a pricing comparison, an onboarding flow, a dashboard, an input-driven workflow,
a replay/evaluation view, or a multi-step assistant surface.

When changing the page:

- Prefer editing the existing quickstart components before appending more
  content.
- Keep every screen compact; do not make a long scrolling marketing page.
- Author only registered default-catalog components and declared scalar props.
- Use data bindings only for data the tools have published into Facet.
- Use nav: targets only for declared screens and agent: targets only for
  deliberate visitor events.
- If a tool result says a change was rejected, read the screen or component spec
  and repair it before claiming success.
- Use chat as a short acknowledgement. The main answer should be visible in the
  page.`;

export const QUICKSTART_INITIAL_MARKUP = `<Facet entry="what">
  <Screen name="what" title="What is Facet?" maxWidth="wide">
    <Stack gap="lg">
      ${quickstartNavigationMarkup()}
      <Card title="Live UI from safe component markup" tone="accent">
        <Stack gap="md">
          <Text value="Facet is a runtime for UI that an agent can update while a conversation is happening." variant="title" />
          <Text value="The agent writes declarative component markup. Facet parses it as data, validates it against the active catalog, and applies only authorized patches." />
          <Row gap="md">
            <Badge label="No JSX" tone="positive" />
            <Badge label="No raw HTML" tone="positive" />
            <Badge label="No CSS escape hatch" tone="positive" />
          </Row>
        </Stack>
      </Card>
      <Grid columns="3" gap="md">
        ${quickstartCardMarkup("Agent-authored", "The model chooses components and copy, not executable UI code.")}
        ${quickstartCardMarkup("Host-trusted", "React implementations come only from the host registry and immutable catalog.")}
        ${quickstartCardMarkup("Patch-authorized", "Runtime validation turns accepted markup into bounded document patches.")}
      </Grid>
      <Row gap="sm">
        <Button label="Show runtime loop" action="nav:structure" tone="primary" />
        <Button label="Ask for a custom surface" action="nav:usecases" />
      </Row>
    </Stack>
  </Screen>
  <Screen name="structure" title="Runtime Loop" maxWidth="wide">
    <Stack gap="lg">
      ${quickstartNavigationMarkup()}
      <Grid columns="2" gap="md">
        ${quickstartCardMarkup("1. Visitor event", "A click or submitted field becomes a structured VisitorEvent with screen, revision, and collected values.")}
        ${quickstartCardMarkup("2. Agent tools", "The agent reads component specs, screen markup, and data before sending a bounded mutation.")}
        ${quickstartCardMarkup("3. Runtime validation", "Facet checks the markup, catalog, data bindings, revision, and write authority before a patch lands.")}
        ${quickstartCardMarkup("4. Renderer refresh", "The browser receives trusted component data and mounts only registered React implementations.")}
      </Grid>
      <Card title="Conversation stays separate">
        <Text value="Facet owns UI-out and UI-in. Domain work, model choice, and provider calls stay outside the renderer." />
      </Card>
    </Stack>
  </Screen>
  <Screen name="system" title="Component Catalog" maxWidth="wide">
    <Stack gap="lg">
      ${quickstartNavigationMarkup()}
      <Card title="Default catalog">
        <Stack gap="sm">
          <Text value="The default catalog includes layout, surface, content, interactive, and data-display components." />
          <Row gap="sm">
            <Badge label="Screen" />
            <Badge label="Stack" />
            <Badge label="Row" />
            <Badge label="Grid" />
            <Badge label="Card" />
            <Badge label="Text" />
            <Badge label="Button" />
          </Row>
        </Stack>
      </Card>
      <Modal triggerLabel="Why immutable?" title="Immutable trust boundary">
        <Text value="A session boots with one catalog and one matching React registry. Unknown tags, undeclared props, and mid-session registration are rejected." />
      </Modal>
      <Empty title="No custom component selected" description="Ask the agent to turn this into a dashboard, form, or workflow and it will author registered markup." />
    </Stack>
  </Screen>
  <Screen name="usecases" title="Use Cases" maxWidth="wide">
    <Stack gap="lg">
      ${quickstartNavigationMarkup()}
      <Card title="Choose a surface to generate">
        <Stack gap="md">
          <Text value="Ask for one concrete product surface. The agent should update this page, not just describe what it would do." />
          <Field name="surface" label="Surface idea" placeholder="dashboard, pricing flow, onboarding checklist..." />
          <Row gap="sm">
            <Button label="Build dashboard" action="agent:build_dashboard" arg="dashboard" tone="primary" />
            <Button label="Build pricing flow" action="agent:build_pricing" arg="pricing" />
            <Button label="Build onboarding" action="agent:build_onboarding" arg="onboarding" />
          </Row>
        </Stack>
      </Card>
      <Card title="Good prompts">
        <Stack gap="sm">
          <Text value="Create a three-card KPI dashboard using sample data." />
          <Text value="Turn this into a short onboarding flow with one field and a submit button." />
          <Text value="Show a replay review screen with findings and next actions." />
        </Stack>
      </Card>
    </Stack>
  </Screen>
</Facet>`;

function validateQuickstartMarkup(markup: string): AuthorValidationResult {
  const parsed = parseMarkup(markup);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return validateAuthorMarkup(parsed.ast, DEFAULT_CATALOG, {});
}

function buildQuickstartDocument(markup: string): ComponentDocument {
  const result = validateQuickstartMarkup(markup);
  if (!result.ok) {
    throw new Error(`Invalid quickstart seed markup: ${result.error.code}`);
  }
  return result.document;
}

/** Seeded first paint for the built-in quickstart brief. User guides/assets win. */
export const QUICKSTART_INITIAL_STAGE: ComponentDocument =
  buildQuickstartDocument(QUICKSTART_INITIAL_MARKUP);
