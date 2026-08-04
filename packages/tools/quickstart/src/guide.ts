import {
  BOUNDS,
  parseMarkup,
  validateAuthorMarkup,
  type AuthorValidationResult,
  type ComponentDocument,
} from "@facet/core";
import { DEFAULT_CATALOG } from "@facet/assets";
import { TOOLS } from "@facet/reference-agent";
import { quickstartCardMarkup, quickstartNavigationMarkup } from "./guide-shared.js";

const DEFAULT_CATALOG_TAG_COUNT = String(DEFAULT_CATALOG.components.length);
const DEFAULT_AGENT_TOOL_COUNT = String(TOOLS.length);
const MARKUP_SOURCE_LIMIT_CHARS = String(BOUNDS.markupSourceChars);

/** Built-in first-run page brief for the `facet-quickstart` CLI/package. */
export const QUICKSTART_PAGE_BRIEF = `# Facet quickstart tour

You are guiding a developer who has just installed Facet and opened the
quickstart. The Live tab is the product tour and the playground: show what
Facet is, what it can build, and how an agent changes UI by changing the page,
not by writing long chat explanations.

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
- layout stays flow-contained through registered default-catalog components:
  Screen, AppShell, Stack, Row, Split, Grid, Modal, Card, Empty, LogoMark, Nav,
  SideNav, SideNavItem, Section, Divider, Hero, Avatar, ProfileHeader,
  ProductShowcase, VisualPanel,
  MediaCard, LinkList, SocialLinks, FeatureList, StatStrip, Gallery,
  Testimonial, Timeline, CTA, Alert, Progress, Footer, Text, Metric, Badge,
  Table, Button, and Field

On the first visit, keep or refine the seeded four-screen tour:

1. What is Facet? - explain safe live UI through the visible page.
2. What can it build? - show multiple service surfaces, not only dashboards.
3. Design System - show the catalog, registry, theme, and validation boundary.
4. Try It Live - let the visitor ask for a dashboard, pricing flow, onboarding
   flow, replay view, or another concrete product surface.

The whole quickstart page is agent-owned. Preserve the top-level screen choices
unless the visitor explicitly asks for a different tour, and prefer editing the
active screen before changing other screens. When a direct visitor request
changes a hidden screen, navigate to that screen in the same turn so the result
is immediately visible.

When the visitor asks what Facet can do, update the page with a concrete
component-markup example instead of only answering in chat. Choose the service group before choosing components:
Personal Presence, Marketing / Landing, Commerce / Booking, SaaS / Workspace,
Content / Editorial, Data / Report, or Support / Form Flow. A dashboard/workspace is only one group;
do not make every request into metrics and tables. Good examples include a
personal bio, launch page, booking inquiry, article, report, support intake,
dashboard, input-driven workflow, replay/evaluation view, or multi-step
assistant surface.

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
- Use chat as a short acknowledgement in the floating chat. The main answer
  should be visible in the page.
- Do not say the page changed unless a mutation tool returned an accepted patch.
  If you are updating the live tour, make the change visually obvious: update the
  screen title or hero and at least one substantial section, then keep final
  prose to one sentence.
- Keep the seeded tour layout stable. Use the shared top Nav on all four tour
  screens; do not switch the Design System screen into a SideNav/AppShell
  workspace layout unless the visitor explicitly asks for an app shell example.`;

export const QUICKSTART_INITIAL_MARKUP = `<Facet entry="what">
  <Screen name="what" title="What is Facet?" maxWidth="wide">
    <Stack gap="lg">
      ${quickstartNavigationMarkup()}
      <Hero eyebrow="Facet quickstart" title="UI the model can safely change" subtitle="Facet lets an agent build and revise a live interface with declarative component markup while the host keeps control of trusted React components, theme values, and validation." tone="accent">
        <Row gap="sm">
          <Button label="Try a surface" action="nav:try" tone="primary" />
          <Button label="See what it can build" action="nav:build" />
        </Row>
      </Hero>
      <Split ratio="60:40" gap="lg" align="stretch">
        <ProductShowcase eyebrow="Live contract" title="The page is data, not code" description="The agent authors registered tags and scalar props. Facet validates them, folds authorized patches, and renders only trusted React implementations." meta="safe / live / per visitor" tone="accent">
          <Row gap="sm">
            <Badge label="No JSX" tone="positive" />
            <Badge label="No raw HTML" tone="positive" />
            <Badge label="No CSS escape hatch" tone="positive" />
          </Row>
        </ProductShowcase>
        <VisualPanel title="One runtime" value="UI-OUT + UI-IN" caption="Conversation, visitor events, stage patches, and bounded data stay connected without browser-side domain fetches." tone="brand" scale="hero" />
      </Split>
      <StatStrip title="What stays bounded" columns="3" tone="neutral">
        <Metric label="Default tags" value="${DEFAULT_CATALOG_TAG_COUNT}" unit="components" />
        <Metric label="Tool surface" value="${DEFAULT_AGENT_TOOL_COUNT}" unit="tools" />
        <Metric label="Markup limit" value="${MARKUP_SOURCE_LIMIT_CHARS}" unit="chars" />
      </StatStrip>
      <Alert title="Try the page, not just the chat" description="Ask for a product surface and the agent should update this live stage before it explains." tone="info" />
    </Stack>
  </Screen>
  <Screen name="build" title="What can it build?" maxWidth="wide">
    <Stack gap="lg">
      ${quickstartNavigationMarkup()}
      <Section title="Service surfaces, not one dashboard template" description="Facet can turn a conversation into a focused screen for many product moments." tone="muted">
        <Gallery title="Starter surfaces" columns="3" rhythm="even">
          <MediaCard title="Founder intake" description="A compact flow that captures the goal, audience, and first experiment." eyebrow="Personal Presence" meta="profile + form" tone="brand" aspect="wide" />
          <MediaCard title="Launch page" description="A brand-led page with proof, features, and a strong call to action." eyebrow="Marketing / Landing" meta="hero + proof" tone="accent" aspect="wide" />
          <MediaCard title="Workspace view" description="An app surface with navigation, tasks, status, and next actions." eyebrow="SaaS / Workspace" meta="side nav + cards" tone="neutral" aspect="wide" />
          <MediaCard title="Booking request" description="A service flow that asks for scope, timing, and contact details." eyebrow="Commerce / Booking" meta="field + action" tone="brand" aspect="wide" />
          <MediaCard title="Report brief" description="An answer-first readout with metrics, findings, and recommended moves." eyebrow="Data / Report" meta="metrics + narrative" tone="accent" aspect="wide" />
          <MediaCard title="Support triage" description="A structured intake that narrows the issue and routes the next event." eyebrow="Support / Form Flow" meta="alert + collect" tone="neutral" aspect="wide" />
        </Gallery>
      </Section>
      <FeatureList title="How the agent chooses" columns="3">
        ${quickstartCardMarkup("Pick the service group", "The page should match the job: bio, launch, booking, workspace, editorial, report, or support.")}
        ${quickstartCardMarkup("Read the active screen", "The agent can inspect current markup before choosing a targeted mutation.")}
        ${quickstartCardMarkup("Make the result visible", "A successful turn should leave a changed page, not only a chat transcript.")}
      </FeatureList>
      <CTA title="Bring a concrete idea" description="Try one product surface and watch the agent use the same registered component catalog to reshape the page." tone="accent">
        <Row gap="sm">
          <Button label="Try it live" action="nav:try" tone="primary" />
          <Button label="Review design system" action="nav:system" />
        </Row>
      </CTA>
    </Stack>
  </Screen>
  <Screen name="system" title="Design System" maxWidth="wide">
    <Stack gap="lg">
      ${quickstartNavigationMarkup()}
      <Hero eyebrow="Default assets" title="A closed catalog with a coherent theme" subtitle="The agent chooses registered tags and declared props. The host owns the theme values and React registry that render them." tone="neutral">
        <Row gap="sm">
          <Button label="See build examples" action="nav:build" tone="secondary" />
          <Button label="Try a live edit" action="nav:try" tone="primary" />
        </Row>
      </Hero>
      <Section title="What the design system owns" description="The catalog and theme make the agent's output feel coherent without letting authored markup carry raw styles or executable UI." tone="muted">
        <Grid columns="2" gap="md">
          ${quickstartCardMarkup("Catalog", `${DEFAULT_CATALOG_TAG_COUNT} registered component tags define what the agent may author. Unknown tags and undeclared props reject before render.`)}
          ${quickstartCardMarkup("Registry", "The browser mounts only trusted React implementations whose tag set exactly matches the active catalog.")}
          ${quickstartCardMarkup("Theme", "Foundation, semantic, and component recipe values decide visual output without raw CSS in markup.")}
          ${quickstartCardMarkup("Runtime", "Only validated patch operations change the stage, and every event carries the current revision.")}
        </Grid>
      </Section>
      <Split ratio="60:40" gap="lg" align="stretch">
        <VisualPanel title="Trust boundary" value="catalog = registry" caption="If the model asks for an unknown tag or undeclared prop, the mutation is rejected before render." tone="brand" scale="hero" />
        <Card title="Tour layout stays consistent" tone="accent">
          <Stack gap="sm">
            <Text value="This screen uses the same top tour navigation as the rest of the quickstart." />
            <Text value="SideNav and AppShell remain available default components for workspace-style surfaces, but they are not used as the quickstart tour chrome." />
          </Stack>
        </Card>
      </Split>
      <Timeline title="A visible turn" tone="accent">
        ${quickstartCardMarkup("1. Visitor asks", "A message or button creates an explicit visitor event with screen and revision context.")}
        ${quickstartCardMarkup("2. Agent reads", "The reference agent can inspect specs, screens, and published data before editing.")}
        ${quickstartCardMarkup("3. Facet validates", "Markup is parsed as data and rejected atomically if it escapes the catalog.")}
        ${quickstartCardMarkup("4. Renderer updates", "The live stage refreshes through trusted components, while chat remains a separate channel.")}
      </Timeline>
      <Row gap="md">
        <Progress label="Default catalog coverage" value="100" tone="success" />
        <Badge label="No executable UI code" tone="positive" />
        <Badge label="Validated patches only" tone="positive" />
      </Row>
      <Testimonial quote="The host owns the trust boundary; the agent owns the composition." source="Facet invariant" role="catalog + registry" tone="accent" />
    </Stack>
  </Screen>
  <Screen name="try" title="Try It Live" maxWidth="wide">
    <Stack gap="lg">
      ${quickstartNavigationMarkup()}
      <ProfileHeader name="Build with the agent" role="Live quickstart" summary="Describe a product surface in the floating chat or use the controls below. The agent should update this stage with safe default-catalog markup." align="start" tone="accent">
        <Row gap="sm">
          <Button label="Open possibilities" action="nav:build" />
          <Button label="Inspect the system" action="nav:system" />
        </Row>
      </ProfileHeader>
      <Split ratio="40:60" gap="lg" align="stretch">
        <VisualPanel title="Your prompt becomes UI" value="render_page" caption="The first full rewrite starts with a validated Facet document. Later turns can target smaller subtrees." tone="warm" scale="hero" />
        <Card title="Describe a surface" tone="accent">
          <Stack gap="md">
            <Text value="Give the agent one concrete job. It should use the page as the answer surface and keep chat short." />
            <Field name="surface" label="Surface idea" placeholder="onboarding checklist, pricing flow, replay review..." />
            <Row gap="sm">
              <Button label="Build my surface" action="agent:build_surface" collect="surface" tone="primary" />
              <Button label="Build dashboard" action="agent:build_dashboard" arg="dashboard" />
              <Button label="Build onboarding" action="agent:build_onboarding" arg="onboarding" />
            </Row>
          </Stack>
        </Card>
      </Split>
      <LinkList title="Prompt starters" density="comfortable">
        <Button label="Create a three-card KPI dashboard using sample data." action="agent:prompt_dashboard" arg="dashboard" />
        <Button label="Turn this into a short onboarding flow with one field." action="agent:prompt_onboarding" arg="onboarding" />
        <Button label="Show a replay review screen with findings and next actions." action="agent:prompt_replay" arg="replay" />
      </LinkList>
      <Modal triggerLabel="How should I ask?" title="Good Facet prompts" description="Ask for one visible product surface, not a generic explanation.">
        <Stack gap="sm">
          <Text value="Name the surface, the audience, and the decision it should help with." />
          <Text value="Example: Build a support triage screen for a developer tools startup with severity, owner, and next-action fields." />
        </Stack>
      </Modal>
      <Empty title="No generated surface yet" description="Use the floating chat or buttons above and the agent will replace this space with a tailored page." />
      <Footer title="Facet" description="Safe live UI that an agent can render differently for every visitor." tone="inverse" />
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
