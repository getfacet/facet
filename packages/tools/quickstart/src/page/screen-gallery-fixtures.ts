import { DEFAULT_CATALOG } from "@facet/assets";
import { parseMarkup, validateAuthorMarkup } from "@facet/core";
import type { ComponentDocument, DataModel, FacetCatalog } from "@facet/core";

import {
  QUICKSTART_PREVIEW_ASSET_REGISTRY,
  type ComponentPreviewFixture,
  type ComponentPreviewFixtureError,
  type ComponentPreviewFixtureErrorPhase,
  type ComponentPreviewFixtureResult,
} from "./component-preview-fixtures.js";
import type { QuickstartResolvedDesignExample } from "../design-overlay.js";

export interface ScreenPattern {
  readonly id: string;
  readonly source: "default" | "imported";
  readonly label: string;
  readonly description: string;
  readonly roles: readonly string[];
  readonly result: ComponentPreviewFixtureResult;
}

export interface ScreenPatternOptions {
  readonly catalog?: FacetCatalog;
  readonly examples?: readonly QuickstartResolvedDesignExample[];
}

interface ScreenPatternSource {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly roles: readonly string[];
  readonly source: string;
  readonly data: DataModel;
}

const GALLERY_DATA: DataModel = Object.freeze({
  records: Object.freeze([
    Object.freeze({ item: "Launch brief", owner: "Mina", status: "Ready" }),
    Object.freeze({ item: "Partner proof", owner: "Jules", status: "Review" }),
    Object.freeze({ item: "Release notes", owner: "Alex", status: "Draft" }),
  ]),
  series: Object.freeze([
    Object.freeze({ day: "Mon", value: 18 }),
    Object.freeze({ day: "Tue", value: 24 }),
    Object.freeze({ day: "Wed", value: 31 }),
    Object.freeze({ day: "Thu", value: 28 }),
  ]),
  options: Object.freeze([
    Object.freeze({ label: "Email", value: "email" }),
    Object.freeze({ label: "Video call", value: "video" }),
    Object.freeze({ label: "Chat", value: "chat" }),
  ]),
  selections: Object.freeze(["email", "chat"]),
  events: Object.freeze([
    Object.freeze({ id: "evt-1", title: "Discovery call", start: "2026-08-21T10:00:00Z" }),
    Object.freeze({ id: "evt-2", title: "Design review", start: "2026-08-22T14:00:00Z" }),
    Object.freeze({ id: "evt-3", title: "Launch check", start: "2026-08-24T09:00:00Z" }),
  ]),
  messages: Object.freeze([
    Object.freeze({
      id: "msg-1",
      author: "Mina",
      body: "The export is ready for review.",
      timestamp: "09:12",
      side: "incoming",
    }),
    Object.freeze({
      id: "msg-2",
      author: "Alex",
      body: "I will check the final states now.",
      timestamp: "09:14",
      side: "outgoing",
      status: "Delivered",
    }),
  ]),
});

const SCREEN_PATTERN_SOURCES: readonly ScreenPatternSource[] = Object.freeze([
  patternSource(
    "landing",
    "Landing",
    "Responsive product landing surface with navigation, visual proof, and a focused action band.",
    [
      "Screen",
      "Navigation",
      "NavigationItem",
      "Header",
      "Image",
      "Grid",
      "ItemCard",
      "Row",
      "Text",
      "Badge",
      "ActionBar",
      "Button",
    ],
    `<Facet entry="preview">
  <Screen name="preview" maxWidth="wide" padding="lg">
    <Navigation label="Launch navigation" tone="neutral">
      <Text slot="brand" value="Northstar" variant="heading" />
      <NavigationItem slot="items" label="Overview" action="nav:preview" active="true" />
      <NavigationItem slot="items" label="Proof" action="agent:proof" />
      <Button slot="actions" label="Request access" action="agent:request" tone="primary" />
    </Navigation>
    <Header eyebrow="New release" title="A clearer way to run launch reviews" description="Bring context, proof, and the next decision into one bounded surface." tone="accent">
      <Image slot="media" asset="asset:preview" alt="Northstar launch preview" aspect="wide" />
      <Badge slot="meta" label="Private beta" tone="positive" />
      <Button slot="actions" label="Join beta" action="agent:join" tone="primary" />
    </Header>
    <Grid columns="3" gap="md" collapse="true">
      <ItemCard title="Shared context" description="Keep the decision and evidence together." />
      <ItemCard title="Trusted actions" description="Every action stays explicit and bounded." />
      <ItemCard title="Responsive flow" description="The same surface adapts to narrow containers." />
    </Grid>
    <Row gap="sm" align="center" justify="start"><Text value="Launch status" tone="muted" /><Badge label="Ready for review" tone="positive" /></Row>
    <ActionBar align="between" tone="accent">
      <Text slot="context" value="Ready to review the live surface?" />
      <Button slot="actions" label="Open workspace" action="agent:openWorkspace" tone="primary" />
    </ActionBar>
  </Screen>
</Facet>`,
  ),
  patternSource(
    "personal-profile-resume",
    "Personal Profile / Resume",
    "Profile and resume surface with identity, experience, properties, and direct contact actions.",
    [
      "Screen",
      "Header",
      "Avatar",
      "Detail",
      "PropertyList",
      "Property",
      "Timeline",
      "Card",
      "ActionGroup",
      "Button",
    ],
    `<Facet entry="preview">
  <Screen name="preview" maxWidth="wide" padding="lg">
    <Header eyebrow="Product systems" title="Alex Morgan" description="Designer focused on clear service surfaces and agent-owned interfaces." align="center">
      <Avatar slot="leading" label="Alex Morgan" initials="AM" size="lg" />
      <Button slot="actions" label="Start a conversation" action="agent:contact" tone="primary" />
    </Header>
    <Detail title="Profile" description="Selected experience and working preferences." meta="Seoul / Remote" tone="accent">
      <PropertyList slot="details" title="Overview" columns="2">
        <Property slot="items" label="Focus" value="Product systems" />
        <Property slot="items" label="Availability" value="September" />
        <Property slot="items" label="Experience" value="8 years" />
      </PropertyList>
      <ActionGroup slot="actions" layout="row">
        <Button label="View portfolio" action="agent:portfolio" />
        <Button label="Download resume" action="agent:resume" tone="quiet" />
      </ActionGroup>
    </Detail>
    <Timeline title="Experience" tone="accent">
      <Card title="Northstar, Product Designer"><Text value="2024-2026: service surfaces and design systems." /></Card>
      <Card title="Canvas Lab, Design Lead"><Text value="2021-2024: product direction and launch systems." /></Card>
    </Timeline>
  </Screen>
</Facet>`,
  ),
  patternSource(
    "commerce",
    "Commerce",
    "Product collection and detail surface with visual items, status, properties, and order actions.",
    [
      "Screen",
      "Header",
      "Collection",
      "ItemCard",
      "Image",
      "Badge",
      "Detail",
      "PropertyList",
      "Property",
      "ActionBar",
      "Button",
    ],
    `<Facet entry="preview">
  <Screen name="preview" maxWidth="wide" padding="lg">
    <Header eyebrow="Citrus Supply" title="Fresh orders, ready for review" description="Product discovery and fulfillment context in one customer-safe view." />
    <Collection title="Today products" description="Compare the current release set." layout="grid" columns="3">
      <ItemCard slot="items" title="Market box" description="Seasonal produce for two." meta="USD 48" tone="accent"><Image slot="media" asset="asset:preview" alt="Market box" aspect="square" /><Badge slot="content" label="In stock" tone="positive" /><Button slot="actions" label="Add" action="agent:addMarket" tone="primary" /></ItemCard>
      <ItemCard slot="items" title="Pantry set" description="Six everyday staples." meta="USD 36"><Badge slot="content" label="Low stock" tone="warning" /><Button slot="actions" label="Add" action="agent:addPantry" /></ItemCard>
      <ItemCard slot="items" title="Studio bundle" description="A larger weekly delivery." meta="USD 72"><Badge slot="content" label="Preorder" /><Button slot="actions" label="Details" action="agent:details" /></ItemCard>
    </Collection>
    <Detail title="Order 1012" description="Packed and ready for courier pickup." meta="USD 216">
      <PropertyList slot="details" columns="3"><Property slot="items" label="Customer" value="Nora" /><Property slot="items" label="Status" value="Packed" /><Property slot="items" label="Window" value="14:00-16:00" /></PropertyList>
      <Button slot="actions" label="Send update" action="agent:sendUpdate" tone="primary" />
    </Detail>
    <ActionBar align="between" tone="inverse"><Text slot="context" value="3 orders need a final check" /><Button slot="actions" label="Review queue" action="agent:reviewQueue" tone="primary" /></ActionBar>
  </Screen>
</Facet>`,
  ),
  patternSource(
    "saas",
    "SaaS",
    "Responsive workspace shell with navigation, account metrics, settings, and table-backed activity.",
    [
      "Screen",
      "AppShell",
      "Navigation",
      "NavigationItem",
      "Stack",
      "Header",
      "MetricGroup",
      "Metric",
      "Table",
      "Form",
      "Toggle",
      "Button",
    ],
    `<Facet entry="preview">
  <Screen name="preview" maxWidth="full" padding="md">
    <AppShell gap="lg" sidebar="start" collapse="true">
      <Navigation slot="navigation" label="Workspace" orientation="vertical" tone="inverse"><Text slot="brand" value="Facet Cloud" variant="heading" /><NavigationItem slot="items" label="Overview" action="nav:preview" active="true" /><NavigationItem slot="items" label="Settings" action="agent:settings" /><NavigationItem slot="items" label="Billing" action="agent:billing" /></Navigation>
      <Stack slot="main" gap="lg">
        <Header title="Workspace overview" description="Usage, recent activity, and account controls." tone="neutral"><Button slot="actions" label="Invite member" action="agent:invite" tone="primary" /></Header>
        <MetricGroup title="This month" columns="3"><Metric label="Sessions" value="1284" /><Metric label="Published pages" value="42" /><Metric label="Success rate" value="98" unit="%" /></MetricGroup>
        <Table rows="data:records" caption="Recent workspace activity" />
        <Form layout="inline"><Toggle slot="fields" name="digest" label="Weekly digest" value="true" /><Button slot="actions" label="Save settings" action="agent:saveSettings" collect="digest" tone="primary" /></Form>
      </Stack>
    </AppShell>
  </Screen>
</Facet>`,
  ),
  patternSource(
    "analytics",
    "Analytics",
    "Answer-first analytics readout with comparable metrics, trend chart, evidence table, and guardrail status.",
    [
      "Screen",
      "Header",
      "MetricGroup",
      "Metric",
      "Grid",
      "Chart",
      "Table",
      "Progress",
      "Alert",
      "Section",
    ],
    `<Facet entry="preview">
  <Screen name="preview" title="Weekly product health" maxWidth="full" padding="lg">
    <Header eyebrow="Analytics" title="Activation improved while support load stayed flat" description="The strongest movement came from guided setup completion." tone="accent"><Metric slot="meta" label="Activation" value="68" unit="%" /></Header>
    <MetricGroup title="Core signals" columns="3"><Metric label="Activation" value="68" unit="%" /><Metric label="Retained teams" value="412" /><Metric label="Support rate" value="3" unit="%" /></MetricGroup>
    <Grid columns="2" gap="lg" collapse="true"><Chart data="data:series" xKey="day" yKey="value" type="line" title="Daily activation" /><Section title="Guardrails" tone="muted"><Progress label="Quarter target" value="74" tone="success" /><Alert title="Watch enterprise setup" description="Completion is lower for workspaces above 50 seats." tone="warning" /></Section></Grid>
    <Table rows="data:records" caption="Validated driver evidence" />
  </Screen>
</Facet>`,
  ),
  patternSource(
    "booking-consultation",
    "Booking / Consultation",
    "Service detail, selectable schedule, consultation intake, and confirmation outcome.",
    [
      "Screen",
      "Header",
      "Split",
      "Detail",
      "PropertyList",
      "Property",
      "Calendar",
      "Form",
      "Field",
      "Select",
      "ChoiceGroup",
      "Button",
      "Result",
    ],
    `<Facet entry="preview">
  <Screen name="preview" maxWidth="wide" padding="lg">
    <Header eyebrow="Studio North" title="Book a focused consultation" description="Choose a time and share enough context for a useful first session." tone="accent" />
    <Split ratio="50:50" gap="lg" collapse="true">
      <Detail slot="primary" title="Product strategy session" description="A structured review of positioning, workflow, and next decisions." meta="45 minutes"><PropertyList slot="details"><Property slot="items" label="Format" value="Video call" /><Property slot="items" label="Price" value="USD 180" /></PropertyList><Calendar slot="summary" name="appointment" title="Available times" events="data:events" view="agenda" /></Detail>
      <Form slot="secondary" layout="stacked"><Field slot="fields" name="name" label="Name" placeholder="Your name" /><Select slot="fields" name="format" label="Format" options="data:options" value="video" /><ChoiceGroup slot="fields" name="topics" label="Topics" options="data:options" value="data:selections" /><Button slot="actions" label="Request consultation" action="agent:requestConsultation" collect="name format topics" tone="primary" /></Form>
    </Split>
    <Result title="Times held for ten minutes" description="Submit the request to confirm your preferred slot." tone="neutral"><Button slot="actions" label="Review request" action="agent:reviewRequest" /></Result>
  </Screen>
</Facet>`,
  ),
  patternSource(
    "support",
    "Support",
    "Support workspace with incident context, troubleshooting disclosures, conversation history, and escalation intake.",
    [
      "Screen",
      "Header",
      "Alert",
      "Accordion",
      "AccordionItem",
      "Text",
      "MessageThread",
      "Form",
      "Field",
      "Select",
      "Button",
    ],
    `<Facet entry="preview">
  <Screen name="preview" maxWidth="wide" padding="lg">
    <Header eyebrow="Support" title="Resolve export issue INC-1842" description="Keep the incident, diagnostic steps, and customer conversation together." />
    <Alert title="Export queue delayed" description="New exports are completing within twelve minutes." tone="warning"><Button slot="actions" label="Refresh status" action="agent:refreshStatus" /></Alert>
    <Accordion multiple="true"><AccordionItem slot="items" title="Check workspace status" defaultOpen="true"><Text slot="body" value="The workspace is healthy and within plan limits." /></AccordionItem><AccordionItem slot="items" title="Retry the export"><Text slot="body" value="Create one fresh export after the current queue clears." /><Button slot="actions" label="Retry" action="agent:retry" /></AccordionItem></Accordion>
    <MessageThread messages="data:messages" />
    <Form layout="inline"><Field slot="fields" name="reply" label="Reply" placeholder="Write a concise update" /><Select slot="fields" name="channel" label="Channel" options="data:options" value="email" /><Button slot="actions" label="Send update" action="agent:sendReply" collect="reply channel" tone="primary" /></Form>
  </Screen>
</Facet>`,
  ),
  patternSource(
    "onboarding",
    "Onboarding",
    "Guided setup flow with progress, a short checklist, preferences, and one clear continuation action.",
    [
      "Screen",
      "Header",
      "Progress",
      "List",
      "Form",
      "Field",
      "Select",
      "ChoiceGroup",
      "Toggle",
      "ActionBar",
      "Button",
    ],
    `<Facet entry="preview">
  <Screen name="preview" maxWidth="medium" padding="lg">
    <Header eyebrow="Step 2 of 3" title="Set up your workspace" description="Choose the defaults your team needs on day one." tone="accent" />
    <Progress label="Setup progress" value="66" tone="accent" />
    <List title="Before you continue" marker="number"><Text value="Name the workspace" /><Text value="Choose a primary channel" /><Text value="Confirm notification preferences" /></List>
    <Form layout="stacked"><Field slot="fields" name="workspace" label="Workspace name" placeholder="Northstar" /><Select slot="fields" name="channel" label="Primary channel" options="data:options" /><ChoiceGroup slot="fields" name="updates" label="Update channels" options="data:options" value="data:selections" /><Toggle slot="fields" name="digest" label="Send a weekly digest" value="true" /><Button slot="actions" label="Continue" action="agent:continueSetup" collect="workspace channel updates digest" tone="primary" /></Form>
    <ActionBar align="between"><Text slot="context" value="You can change these settings later." /><Button slot="actions" label="Save draft" action="agent:saveDraft" tone="quiet" /></ActionBar>
  </Screen>
</Facet>`,
  ),
  patternSource(
    "operations-board",
    "Operations / Board",
    "Responsive operating board with workflow columns, bounded records, status, and batch actions.",
    [
      "Screen",
      "AppShell",
      "Navigation",
      "NavigationItem",
      "Stack",
      "Header",
      "Board",
      "BoardColumn",
      "Card",
      "Badge",
      "ActionBar",
      "Button",
    ],
    `<Facet entry="preview">
  <Screen name="preview" maxWidth="full" padding="md">
    <AppShell gap="lg" collapse="true"><Navigation slot="navigation" label="Operations" orientation="vertical" tone="inverse"><Text slot="brand" value="Launch Ops" variant="heading" /><NavigationItem slot="items" label="Board" action="nav:preview" active="true" /><NavigationItem slot="items" label="Archive" action="agent:archive" /></Navigation><Stack slot="main" gap="lg"><Header title="Launch operations" description="Move each work item through review without losing owner context." /><Board title="Current cycle"><BoardColumn slot="columns" title="Ready" tone="accent"><Card title="Creative brief"><Badge label="Mina" /><Text value="Final copy and proof are attached." /></Card></BoardColumn><BoardColumn slot="columns" title="Review"><Card title="Partner proof"><Badge label="Today" tone="warning" /><Text value="Legal approval is the final dependency." /></Card></BoardColumn><BoardColumn slot="columns" title="Done"><Card title="Release notes"><Badge label="Approved" tone="positive" /></Card></BoardColumn></Board><ActionBar align="between" tone="accent"><Text slot="context" value="2 items selected" /><Button slot="actions" label="Assign owner" action="agent:assign" /><Button slot="actions" label="Move to review" action="agent:move" tone="primary" /></ActionBar></Stack></AppShell>
  </Screen>
</Facet>`,
  ),
  patternSource(
    "calendar-scheduling",
    "Calendar / Scheduling",
    "Agenda and schedule-management surface with event selection, appointment context, and actions.",
    [
      "Screen",
      "Header",
      "Calendar",
      "Collection",
      "ItemCard",
      "Badge",
      "Form",
      "Select",
      "ActionBar",
      "Button",
    ],
    `<Facet entry="preview">
  <Screen name="preview" maxWidth="wide" padding="lg">
    <Header eyebrow="Schedule" title="Week of August 21" description="Review availability and prepare each upcoming session." />
    <Calendar name="event" title="Upcoming appointments" events="data:events" view="agenda" />
    <Collection title="Preparation queue" layout="list" columns="1"><Select slot="controls" name="owner" label="Owner" options="data:options" /><ItemCard slot="items" title="Discovery call" description="Confirm goals and attendees." meta="Friday, 10:00"><Badge slot="content" label="Ready" tone="positive" /></ItemCard><ItemCard slot="items" title="Design review" description="Attach the latest decision log." meta="Saturday, 14:00"><Badge slot="content" label="Needs notes" tone="warning" /></ItemCard></Collection>
    <ActionBar align="between"><Text slot="context" value="Select an event to manage its schedule." /><Button slot="actions" label="Create event" action="agent:createEvent" tone="primary" /></ActionBar>
  </Screen>
</Facet>`,
  ),
  patternSource(
    "messaging",
    "Messaging",
    "Conversation surface with contact identity, chronological messages, reply input, and escalation actions.",
    [
      "Screen",
      "Header",
      "Icon",
      "Badge",
      "MessageThread",
      "Form",
      "Field",
      "ActionGroup",
      "Button",
      "Alert",
    ],
    `<Facet entry="preview">
  <Screen name="preview" maxWidth="medium" padding="lg">
    <Header title="Mina Park" description="Launch review conversation" tone="neutral"><Icon slot="leading" name="message" label="Conversation" size="lg" tone="accent" /><Badge slot="meta" label="Online" tone="positive" /></Header>
    <Alert title="Context preserved" description="Replies include the current screen and revision." tone="info" />
    <MessageThread messages="data:messages" />
    <Form layout="stacked"><Field slot="fields" name="message" label="Reply" placeholder="Write a message" /><Button slot="actions" label="Send" action="agent:sendMessage" collect="message" tone="primary" /></Form>
    <ActionGroup title="Conversation actions" layout="row"><Button label="Add note" action="agent:addNote" /><Button label="Escalate" action="agent:escalate" tone="quiet" /></ActionGroup>
  </Screen>
</Facet>`,
  ),
  patternSource(
    "form-result",
    "Form / Result",
    "Input and outcome surface covering structured fields, modal help, empty state, and a clear result.",
    [
      "Screen",
      "Header",
      "Split",
      "Form",
      "Field",
      "Select",
      "ChoiceGroup",
      "Toggle",
      "Button",
      "Divider",
      "Result",
      "Empty",
      "Modal",
    ],
    `<Facet entry="preview">
  <Screen name="preview" maxWidth="wide" padding="lg">
    <Header eyebrow="Request" title="Create a launch review" description="Collect the minimum context, then show the submitted outcome." tone="accent" />
    <Split ratio="60:40" gap="lg" collapse="true"><Form slot="primary" layout="stacked"><Field slot="fields" name="project" label="Project" placeholder="Northstar launch" /><Select slot="fields" name="channel" label="Primary channel" options="data:options" /><ChoiceGroup slot="fields" name="reviewers" label="Reviewers" options="data:options" value="data:selections" /><Toggle slot="fields" name="urgent" label="Urgent review" /><Button slot="actions" label="Submit request" action="agent:submitRequest" collect="project channel reviewers urgent" tone="primary" /></Form><Result slot="secondary" title="Draft ready" description="The request has all required fields." tone="success"><Badge slot="summary" label="Complete" tone="positive" /><Text slot="details" value="Reference LF-2048" /><Button slot="actions" label="Open draft" action="agent:openDraft" /></Result></Split>
    <Divider label="Supporting states" />
    <Empty title="No previous requests" description="Submitted reviews will appear here."><Button slot="actions" label="Refresh" action="agent:refresh" /></Empty>
    <Modal triggerLabel="What should I include?" title="Request guidance"><Text slot="body" value="Name the audience, decision, and desired delivery date." /><Button slot="actions" label="Got it" action="agent:closeHelp" /></Modal>
  </Screen>
</Facet>`,
  ),
]);

function patternSource(
  id: string,
  label: string,
  description: string,
  roles: readonly string[],
  source: string,
): ScreenPatternSource {
  return Object.freeze({
    id,
    label,
    description,
    roles: Object.freeze([...roles]),
    source,
    data: GALLERY_DATA,
  });
}

function reject(
  source: ScreenPatternSource,
  phase: ComponentPreviewFixtureErrorPhase,
  code: string,
  detail: string,
): ComponentPreviewFixtureResult {
  const error: ComponentPreviewFixtureError = Object.freeze({ phase, code, detail });
  return Object.freeze({
    ok: false,
    tag: "Screen",
    source: source.source,
    data: source.data,
    error,
  });
}

function fixtureFor(
  source: ScreenPatternSource,
  catalog: FacetCatalog,
): ComponentPreviewFixtureResult {
  const parsed = parseMarkup(source.source);
  if (!parsed.ok) return reject(source, "parse", parsed.error.code, parsed.error.cause);
  const validated = validateAuthorMarkup(
    parsed.ast,
    catalog,
    source.data,
    QUICKSTART_PREVIEW_ASSET_REGISTRY,
  );
  if (!validated.ok) return reject(source, "validate", validated.error.code, validated.error.cause);
  const targetNodeId = screenNodeId(validated.document);
  if (targetNodeId === null)
    return reject(source, "target", "target-screen-missing", "No entry screen exists.");
  const fixture: ComponentPreviewFixture = Object.freeze({
    tag: "Screen",
    source: source.source,
    data: source.data,
    document: validated.document,
    targetNodeId,
  });
  return Object.freeze({ ok: true, tag: "Screen", fixture });
}

function fixtureForExample(
  example: QuickstartResolvedDesignExample,
): ComponentPreviewFixtureResult {
  const targetNodeId = screenNodeId(example.document);
  if (targetNodeId === null) {
    return Object.freeze({
      ok: false,
      tag: "Screen",
      source: example.markup,
      data: example.data,
      error: Object.freeze({
        phase: "target",
        code: "target-screen-missing",
        detail: "No entry screen exists.",
      }),
    });
  }
  return Object.freeze({
    ok: true,
    tag: "Screen",
    fixture: Object.freeze({
      tag: "Screen",
      source: example.markup,
      data: example.data,
      document: example.document,
      targetNodeId,
    }),
  });
}

function screenNodeId(document: ComponentDocument): string | null {
  for (const [nodeId, node] of Object.entries(document.nodes)) {
    if (node.tag === "Screen") return nodeId;
  }
  return null;
}

function rolesForExample(example: QuickstartResolvedDesignExample): readonly string[] {
  const roles = new Set(example.tags);
  for (const node of Object.values(example.document.nodes)) roles.add(node.tag);
  return Object.freeze([...roles]);
}

function screenPatternFromExample(example: QuickstartResolvedDesignExample): ScreenPattern | null {
  if (example.kind !== "screen") return null;
  return Object.freeze({
    id: example.id,
    source: "imported",
    label: example.label,
    description: example.description ?? "Active design screen example.",
    roles: rolesForExample(example),
    result: fixtureForExample(example),
  });
}

function uniquifyActiveScreenPatternIds(
  defaultPatterns: readonly ScreenPattern[],
  activePatterns: readonly ScreenPattern[],
): readonly ScreenPattern[] {
  const occupied = new Set(defaultPatterns.map((pattern) => pattern.id));
  return Object.freeze(
    activePatterns.map((pattern) => {
      if (!occupied.has(pattern.id)) {
        occupied.add(pattern.id);
        return pattern;
      }
      let suffix = 1;
      let id = `active:${pattern.id}`;
      while (occupied.has(id)) {
        suffix += 1;
        id = `active:${pattern.id}:${String(suffix)}`;
      }
      occupied.add(id);
      return Object.freeze({ ...pattern, id });
    }),
  );
}

function isFacetCatalogInput(input: FacetCatalog | ScreenPatternOptions): input is FacetCatalog {
  return Array.isArray((input as { readonly components?: unknown }).components);
}

function screenPatternOptions(input: FacetCatalog | ScreenPatternOptions): {
  readonly catalog: FacetCatalog;
  readonly examples: readonly QuickstartResolvedDesignExample[];
} {
  if (isFacetCatalogInput(input)) return { catalog: input, examples: Object.freeze([]) };
  return {
    catalog: input.catalog ?? DEFAULT_CATALOG,
    examples: input.examples ?? Object.freeze([]),
  };
}

function defaultScreenPatterns(catalog: FacetCatalog): readonly ScreenPattern[] {
  return Object.freeze(
    SCREEN_PATTERN_SOURCES.map((source) =>
      Object.freeze({
        id: source.id,
        source: "default" as const,
        label: source.label,
        description: source.description,
        roles: source.roles,
        result: fixtureFor(source, catalog),
      }),
    ),
  );
}

const DEFAULT_SCREEN_PATTERNS = defaultScreenPatterns(DEFAULT_CATALOG);

export function screenPatterns(catalog?: FacetCatalog): readonly ScreenPattern[];
export function screenPatterns(options: ScreenPatternOptions): readonly ScreenPattern[];
export function screenPatterns(
  input: FacetCatalog | ScreenPatternOptions = DEFAULT_CATALOG,
): readonly ScreenPattern[] {
  const options = screenPatternOptions(input);
  const defaultPatterns =
    options.catalog === DEFAULT_CATALOG
      ? DEFAULT_SCREEN_PATTERNS
      : defaultScreenPatterns(options.catalog);
  const activePatterns = options.examples.flatMap((example) => {
    const pattern = screenPatternFromExample(example);
    return pattern === null ? [] : [pattern];
  });
  const visibleActivePatterns = uniquifyActiveScreenPatternIds(defaultPatterns, activePatterns);
  return Object.freeze(
    visibleActivePatterns.length === 0
      ? defaultPatterns
      : [...defaultPatterns, ...visibleActivePatterns],
  );
}
