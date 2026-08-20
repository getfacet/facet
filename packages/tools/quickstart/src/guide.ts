import { DEFAULT_CATALOG } from "@facet/assets";
import {
  BOUNDS,
  parseMarkup,
  validateAuthorMarkup,
  type AuthorValidationResult,
  type ComponentDocument,
} from "@facet/core";
import { TOOLS } from "@facet/reference-agent";

import { quickstartCardMarkup, quickstartNavigationMarkup } from "./guide-shared.js";

const DEFAULT_CATALOG_TAG_COUNT = String(DEFAULT_CATALOG.components.length);
const DEFAULT_AGENT_TOOL_COUNT = String(TOOLS.length);
const MARKUP_SOURCE_LIMIT_CHARS = String(BOUNDS.markupSourceChars);

/** Built-in first-run page brief for the `facet-quickstart` CLI/package. */
export const QUICKSTART_PAGE_BRIEF = `# Facet quickstart tour

You are guiding a developer who has just installed Facet and opened the
quickstart. The Live tab is the product tour and playground: show what Facet is,
what it can build, and how an agent changes UI by changing the page instead of
writing long chat explanations.

Facet lets an agent render a live, per-visitor interface from safe declarative
component markup:

- agents emit registered component tags and declared props, never HTML, JSX,
  JavaScript, CSS, imports, event handlers, or arbitrary pixels
- the host's immutable component catalog and React registry define the complete
  trust boundary
- every component declares content mode none, children, or named slots; the
  discovery class Leaf, Container, or Structured is derived from that contract
- UI writes go through Facet's runtime and FacetToolSession, which parse,
  validate, and authorize patches
- data providers and agent tools fetch domain data; Facet renders only bounded
  data bindings and explicit visitor events
- the exact built-in catalog has 47 tags:
  Screen, Stack, Row, Grid, Split, AppShell, Section, Card, Modal, Divider,
  Navigation, NavigationItem, Button, ActionGroup, ActionBar, Text, Avatar,
  Icon, Image, Badge, Metric, MetricGroup, Table, Chart, Progress, Timeline,
  List, Header, Collection, ItemCard, Detail, PropertyList, Property, Board,
  BoardColumn, Calendar, Result, Empty, Alert, Form, Field, Select, ChoiceGroup,
  Toggle, MessageThread, Accordion, and AccordionItem

On the first visit, keep or refine the seeded four-screen tour:

1. What is Facet? - explain safe live UI through the visible page.
2. What can it build? - show multiple service surfaces, not only dashboards.
3. Design System - show the catalog, registry, theme, and validation boundary.
4. Try It Live - let the visitor request a concrete product surface.

The whole quickstart page is agent-owned. Preserve the top-level screen choices
unless the visitor explicitly asks for a different tour, and prefer editing the
active screen before changing hidden screens. When a request changes a hidden
screen, navigate there in the same turn so the result is immediately visible.

When the visitor asks what Facet can do, update the page with a concrete
component-markup example instead of only answering in chat. Choose the service
family before choosing components: Landing, Personal Profile / Resume,
Commerce, SaaS, Analytics, Booking / Consultation, Support, Collaboration,
Education, Knowledge, Finance, or Operations / Board. SaaS
and analytics are only two families; do not make every request into metrics and
tables.

When changing the page:

- Prefer editing existing quickstart components before appending more content.
- Keep every screen compact and responsive.
- Author only tags from the active registered catalog and declared scalar props.
- For Structured components, assign every direct child to a declared slot and
  satisfy each slot's cardinality.
- Use data bindings only for data the tools have published into Facet.
- Use nav: targets only for declared screens and agent: targets only for
  deliberate visitor events.
- If a tool result rejects a change, read the screen or component spec and
  repair it before claiming success.
- Use chat as a short acknowledgement. The main answer should be visible in the
  page.
- Do not say the page changed unless a mutation tool returned an accepted patch.
- Keep the seeded tour layout stable and use the shared top Navigation on all
  four screens unless the visitor explicitly requests a different app shell.`;

export const QUICKSTART_INITIAL_MARKUP = `<Facet entry="what">
  <Screen name="what" title="What is Facet?" maxWidth="wide">
    <Stack gap="lg">
      ${quickstartNavigationMarkup()}
      <Header eyebrow="Facet quickstart" title="UI the model can safely change" description="Facet lets an agent revise a live interface with declarative component markup while the host controls trusted React components, theme values, and validation." tone="accent">
        <Badge slot="meta" label="No executable UI" tone="positive" />
        <Badge slot="meta" label="Validated patches" tone="positive" />
        <Button slot="actions" label="Try a surface" action="nav:try" tone="primary" />
        <Button slot="actions" label="See what it can build" action="nav:build" />
      </Header>
      <Split ratio="60:40" gap="lg" align="stretch">
        <Detail slot="primary" eyebrow="Live contract" title="The page is data, not code" description="The agent authors registered tags and declared props. Facet validates them and renders only trusted implementations." tone="accent">
          <PropertyList slot="details" columns="2">
            <Property slot="items" label="Authoring" value="Component markup" />
            <Property slot="items" label="Rendering" value="Trusted React" />
            <Property slot="items" label="Updates" value="Authorized patches" />
            <Property slot="items" label="Data" value="Bound projections" />
          </PropertyList>
        </Detail>
        <Card slot="secondary" title="One connected runtime" tone="neutral" padding="lg">
          <Stack gap="sm"><Text value="Conversation, visitor events, stage patches, and bounded data stay connected." /><Progress label="Trust boundary" value="100" tone="success" /></Stack>
        </Card>
      </Split>
      <MetricGroup title="What stays bounded" columns="3" tone="neutral">
        <Metric label="Default tags" value="${DEFAULT_CATALOG_TAG_COUNT}" unit="components" />
        <Metric label="Tool surface" value="${DEFAULT_AGENT_TOOL_COUNT}" unit="tools" />
        <Metric label="Markup limit" value="${MARKUP_SOURCE_LIMIT_CHARS}" unit="chars" />
      </MetricGroup>
      <Alert title="Try the page, not just the chat" description="Ask for a product surface and the agent should update this live stage before it explains." tone="info" />
    </Stack>
  </Screen>
  <Screen name="build" title="What can it build?" maxWidth="wide">
    <Stack gap="lg">
      ${quickstartNavigationMarkup()}
      <Header eyebrow="Twelve service families" title="Service surfaces, not one dashboard template" description="Facet can turn a conversation into a focused screen for many product moments." />
      <Collection title="Starter surfaces" description="Choose the family that matches the visitor's job." layout="grid" columns="3">
        <ItemCard slot="items" title="Landing" description="Product, campaign, event, and waitlist surfaces." />
        <ItemCard slot="items" title="Personal Profile / Resume" description="Identity, experience, proof, and contact." />
        <ItemCard slot="items" title="Commerce" description="Product discovery, detail, and order status." />
        <ItemCard slot="items" title="SaaS" description="Workspace, settings, account, and approval flows." />
        <ItemCard slot="items" title="Analytics" description="Metrics, trends, evidence, and findings." />
        <ItemCard slot="items" title="Booking / Consultation" description="Service choice, schedule, intake, and confirmation." />
        <ItemCard slot="items" title="Support" description="Help, diagnosis, conversation, and escalation." />
        <ItemCard slot="items" title="Collaboration" description="Shared setup, progress, and team preferences." />
        <ItemCard slot="items" title="Operations / Board" description="Queues, workflow columns, and handoffs." />
        <ItemCard slot="items" title="Education" description="Learning schedules, preparation, and progress." />
        <ItemCard slot="items" title="Knowledge" description="Evidence, expert context, questions, and actions." />
        <ItemCard slot="items" title="Finance" description="Structured financial input followed by a clear outcome." />
      </Collection>
      <Grid columns="3" gap="md" collapse="true">
        ${quickstartCardMarkup("Pick the service family", "Match the page to the job before choosing components.")}
        ${quickstartCardMarkup("Read the active screen", "Inspect current markup before choosing a targeted mutation.")}
        ${quickstartCardMarkup("Make the result visible", "Leave a changed page, not only a chat transcript.")}
      </Grid>
      <ActionBar align="between" tone="accent"><Text slot="context" value="Bring one concrete product idea." /><Button slot="actions" label="Try it live" action="nav:try" tone="primary" /><Button slot="actions" label="Review design system" action="nav:system" /></ActionBar>
    </Stack>
  </Screen>
  <Screen name="system" title="Design System" maxWidth="wide">
    <Stack gap="lg">
      ${quickstartNavigationMarkup()}
      <Header eyebrow="Default assets" title="One closed catalog with structured content contracts" description="The agent chooses registered tags and declared props. The host owns the theme values and trusted registry." tone="neutral"><Button slot="actions" label="Try a live edit" action="nav:try" tone="primary" /></Header>
      <Grid columns="2" gap="md" collapse="true">
        ${quickstartCardMarkup("Catalog", `${DEFAULT_CATALOG_TAG_COUNT} registered tags define what the agent may author.`)}
        ${quickstartCardMarkup("Registry", "The browser mounts only trusted implementations with an exact matching tag set.")}
        ${quickstartCardMarkup("Content", "Leaf, Container, and Structured classes derive from none, children, and slots modes.")}
        ${quickstartCardMarkup("Runtime", "Only validated patch operations change the stage at the current revision.")}
      </Grid>
      <Split ratio="60:40" gap="lg" align="stretch">
        <Detail slot="primary" title="Catalog equals registry" description="Unknown tags, undeclared props, and invalid slot placement reject before render." tone="accent"><PropertyList slot="details"><Property slot="items" label="Leaf" value="No authored content" /><Property slot="items" label="Container" value="Ordered children" /><Property slot="items" label="Structured" value="Named slots" /></PropertyList></Detail>
        <List slot="secondary" title="A visible turn" marker="number"><Text value="Visitor asks" /><Text value="Agent reads" /><Text value="Facet validates" /><Text value="Renderer updates" /></List>
      </Split>
      <Timeline title="Trust boundary" tone="accent"><Card title="Catalog discovery"><Text value="The agent reads the exact active contract." /></Card><Card title="Validated mutation"><Text value="The runtime rejects invalid composition atomically." /></Card><Card title="Trusted render"><Text value="The browser mounts only registered implementations." /></Card></Timeline>
    </Stack>
  </Screen>
  <Screen name="try" title="Try It Live" maxWidth="wide">
    <Stack gap="lg">
      ${quickstartNavigationMarkup()}
      <Header eyebrow="Live quickstart" title="Build with the agent" description="Describe one product surface in the floating chat or use the controls below." tone="accent"><Button slot="actions" label="Open possibilities" action="nav:build" /><Button slot="actions" label="Inspect the system" action="nav:system" /></Header>
      <Split ratio="60:40" gap="lg" align="stretch">
        <Form slot="primary" layout="stacked"><Field slot="fields" name="surface" label="Surface idea" placeholder="onboarding checklist, support flow, booking review..." /><Button slot="actions" label="Build my surface" action="agent:build_surface" collect="surface" tone="primary" /></Form>
        <Result slot="secondary" title="Your prompt becomes UI" description="A full rewrite starts with a validated Facet document; later turns can target smaller subtrees." tone="neutral"><Badge slot="summary" label="render_page" /><Button slot="actions" label="Build dashboard" action="agent:build_dashboard" arg="dashboard" /><Button slot="actions" label="Build onboarding" action="agent:build_onboarding" arg="onboarding" /></Result>
      </Split>
      <ActionGroup title="Prompt starters" layout="stack"><Button label="Create a three-metric KPI surface using sample data." action="agent:prompt_dashboard" arg="dashboard" /><Button label="Turn this into a short onboarding flow." action="agent:prompt_onboarding" arg="onboarding" /><Button label="Show a support review with findings and next actions." action="agent:prompt_support" arg="support" /></ActionGroup>
      <Modal triggerLabel="How should I ask?" title="Good Facet prompts" description="Ask for one visible product surface, not a generic explanation."><Stack slot="body" gap="sm"><Text value="Name the surface, audience, and decision it should support." /><Text value="Example: Build a support triage screen with severity, owner, and next actions." /></Stack><Button slot="actions" label="Got it" action="agent:closePromptHelp" /></Modal>
      <Empty title="No generated surface yet" description="Use the floating chat or controls above and the agent will replace this state."><Button slot="actions" label="Start with landing" action="agent:prompt_landing" /></Empty>
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
    throw new Error(`Invalid quickstart seed markup: ${result.error.code}: ${result.error.cause}`);
  }
  return result.document;
}

/** Seeded first paint for the built-in quickstart brief. User guides/assets win. */
export const QUICKSTART_INITIAL_STAGE: ComponentDocument =
  buildQuickstartDocument(QUICKSTART_INITIAL_MARKUP);
