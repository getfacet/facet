import { DEFAULT_CATALOG } from "@facet/assets";
import { parseMarkup, validateAuthorMarkup } from "@facet/core";
import type {
  ComponentDocument,
  ComponentSpec,
  DataModel,
  FacetAssetRegistry,
  FacetCatalog,
} from "@facet/core";

import type { QuickstartResolvedDesignExample } from "../design-overlay.js";

export interface ComponentPreviewFixture {
  readonly tag: string;
  readonly source: string;
  readonly data: DataModel;
  readonly document: ComponentDocument;
  readonly targetNodeId: string;
}

export interface ComponentPreviewSpecimen {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly display: "standard" | "wide";
  readonly recipeTokens: readonly string[];
  readonly result: ComponentPreviewFixtureResult;
}

export type ComponentPreviewFixtureErrorPhase = "missing" | "parse" | "validate" | "target";

export interface ComponentPreviewFixtureError {
  readonly phase: ComponentPreviewFixtureErrorPhase;
  readonly code: string;
  readonly detail: string;
}

export type ComponentPreviewFixtureResult =
  | {
      readonly ok: true;
      readonly tag: string;
      readonly fixture: ComponentPreviewFixture;
    }
  | {
      readonly ok: false;
      readonly tag: string;
      readonly source: string | null;
      readonly data: DataModel;
      readonly error: ComponentPreviewFixtureError;
    };

export const QUICKSTART_PREVIEW_ASSET_REGISTRY: FacetAssetRegistry = Object.freeze({
  preview: Object.freeze({
    kind: "image",
    src: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
    width: 1,
    height: 1,
  }),
});

const PREVIEW_DATA: DataModel = Object.freeze({
  previewRows: Object.freeze([
    Object.freeze({ component: "Text", state: "Ready" }),
    Object.freeze({ component: "Table", state: "Bound" }),
  ]),
  previewSeries: Object.freeze([
    Object.freeze({ label: "Mon", value: 18 }),
    Object.freeze({ label: "Tue", value: 26 }),
    Object.freeze({ label: "Wed", value: 22 }),
  ]),
  previewOptions: Object.freeze([
    Object.freeze({ label: "Email", value: "email" }),
    Object.freeze({ label: "Chat", value: "chat" }),
  ]),
  previewSelections: Object.freeze(["email"]),
  previewEvents: Object.freeze([
    Object.freeze({ id: "event-1", title: "Consultation", start: "2026-08-21T10:00:00Z" }),
    Object.freeze({ id: "event-2", title: "Review", start: "2026-08-22T14:00:00Z" }),
  ]),
  previewMessages: Object.freeze([
    Object.freeze({
      id: "m1",
      author: "Mina",
      body: "Can you review the launch?",
      side: "incoming",
    }),
    Object.freeze({
      id: "m2",
      author: "Alex",
      body: "Yes, I will send notes today.",
      side: "outgoing",
    }),
  ]),
});

function previewSource(body: string, maxWidth: "medium" | "wide" = "medium"): string {
  return `<Facet entry="preview">
  <Screen name="preview" padding="md" maxWidth="${maxWidth}">
    ${body}
  </Screen>
</Facet>`;
}

const PREVIEW_SOURCE_BY_TAG: Readonly<Record<string, string>> = Object.freeze({
  Screen: `<Facet entry="preview">
  <Screen name="preview" title="Preview screen" maxWidth="medium" padding="md">
    <Text value="A screen frames one named view." />
  </Screen>
</Facet>`,
  Stack: previewSource(`<Stack gap="sm" align="stretch" padding="sm">
      <Text value="Stack item one" />
      <Badge label="Ready" tone="positive" />
    </Stack>`),
  Row: previewSource(`<Row gap="sm" align="center" justify="between" wrap="true">
      <Text value="Inline summary" />
      <Button label="Open" action="agent:open" />
    </Row>`),
  Grid: previewSource(`<Grid columns="3" gap="sm" collapse="true">
      <Metric label="Open" value="18" />
      <Metric label="Closed" value="42" />
      <Metric label="SLA" value="97" unit="%" />
    </Grid>`),
  Split: previewSource(
    `<Split ratio="60:40" gap="md" align="stretch">
      <Card slot="primary" title="Primary"><Text value="Primary region" /></Card>
      <Card slot="secondary" title="Secondary"><Text value="Secondary region" /></Card>
    </Split>`,
    "wide",
  ),
  AppShell: previewSource(
    `<AppShell gap="md" sidebar="start" collapse="true">
      <Navigation slot="navigation" label="Workspace" orientation="vertical">
        <NavigationItem slot="items" label="Overview" action="nav:preview" active="true" />
      </Navigation>
      <Stack slot="main" gap="md"><Text value="Workspace content" /></Stack>
    </AppShell>`,
    "wide",
  ),
  Section:
    previewSource(`<Section title="Preview section" description="A named content region." tone="muted">
      <Text value="Section content stays in document flow." />
    </Section>`),
  Card: previewSource(`<Card title="Preview card" tone="accent" padding="md">
      <Text value="Cards group related content." />
    </Card>`),
  Modal:
    previewSource(`<Modal triggerLabel="Open details" title="Preview modal" description="Facet owns the modal frame.">
      <Text slot="body" value="Modal content stays in the trusted frame." />
      <Button slot="actions" label="Confirm" action="agent:confirm" tone="primary" />
    </Modal>`),
  Divider: previewSource(
    `<Stack gap="sm"><Text value="Before" /><Divider label="Next" emphasis="strong" /><Text value="After" /></Stack>`,
  ),
  Navigation: previewSource(
    `<Navigation label="Preview navigation" orientation="horizontal" tone="neutral">
      <Text slot="brand" value="Facet" variant="heading" />
      <NavigationItem slot="items" label="Overview" action="nav:preview" active="true" />
      <Button slot="actions" label="Account" action="agent:account" tone="quiet" />
    </Navigation>`,
    "wide",
  ),
  NavigationItem: previewSource(`<Navigation label="Preview navigation">
      <NavigationItem slot="items" label="Overview" action="nav:preview" mark="01" meta="4" active="true" />
    </Navigation>`),
  Button: previewSource(`<Button label="Go to preview" action="nav:preview" tone="primary" />`),
  ActionGroup: previewSource(`<ActionGroup title="Available actions" layout="row" align="start">
      <Button label="Save" action="agent:save" tone="primary" />
      <Button label="Cancel" action="agent:cancel" tone="quiet" />
    </ActionGroup>`),
  ActionBar: previewSource(
    `<ActionBar align="between" tone="accent">
      <Text slot="context" value="2 selected" />
      <Button slot="actions" label="Archive" action="agent:archive" tone="primary" />
    </ActionBar>`,
    "wide",
  ),
  Text: previewSource(
    `<Text value="Readable body copy for the preview." variant="body" tone="default" />`,
  ),
  Avatar: previewSource(`<Avatar label="Alex Morgan" initials="AM" size="lg" tone="accent" />`),
  Icon: previewSource(`<Icon name="calendar" label="Calendar" size="lg" tone="accent" />`),
  Image: previewSource(
    `<Image asset="asset:preview" alt="Preview image" aspect="wide" fit="cover" />`,
  ),
  Badge: previewSource(`<Badge label="Healthy" tone="positive" />`),
  Metric: previewSource(`<Metric label="Conversion" value="42" unit="%" />`),
  MetricGroup: previewSource(`<MetricGroup title="Performance" columns="3" tone="accent">
      <Metric label="Open" value="18" />
      <Metric label="Closed" value="42" />
      <Metric label="SLA" value="97" unit="%" />
    </MetricGroup>`),
  Table: previewSource(
    `<Table rows="data:previewRows" caption="Preview component states" />`,
    "wide",
  ),
  Chart: previewSource(
    `<Chart data="data:previewSeries" xKey="label" yKey="value" type="bar" title="Weekly volume" />`,
    "wide",
  ),
  Progress: previewSource(`<Progress label="Launch target" value="74" tone="accent" />`),
  Timeline: previewSource(`<Timeline title="Milestones" tone="accent">
      <Card title="Concept"><Text value="Name the product point of view." /></Card>
      <Card title="Launch"><Text value="Publish the focused surface." /></Card>
    </Timeline>`),
  List: previewSource(`<List title="Checklist" marker="number" density="comfortable">
      <Text value="Review the brief" />
      <Text value="Publish the result" />
    </List>`),
  Header: previewSource(
    `<Header eyebrow="Preview" title="Component header" description="Identity, context, and action in named regions." tone="accent">
      <Avatar slot="leading" label="Alex Morgan" initials="AM" />
      <Badge slot="meta" label="Available" tone="positive" />
      <Button slot="actions" label="Contact" action="agent:contact" tone="primary" />
    </Header>`,
    "wide",
  ),
  Collection: previewSource(
    `<Collection title="Resources" description="A browsable set." layout="grid" columns="2">
      <ItemCard slot="items" title="Launch brief" description="Review the current direction." />
      <ItemCard slot="items" title="Research notes" description="Read the supporting evidence." />
    </Collection>`,
    "wide",
  ),
  ItemCard:
    previewSource(`<ItemCard title="Launch brief" description="One item in a collection." eyebrow="Resource" meta="Updated today" tone="accent">
      <Badge slot="content" label="Ready" tone="positive" />
      <Button slot="actions" label="Open" action="agent:open" />
    </ItemCard>`),
  Detail: previewSource(
    `<Detail eyebrow="Service" title="Strategy consultation" description="A focused record detail." meta="45 minutes" tone="accent">
      <Metric slot="summary" label="Availability" value="4" unit="slots" />
      <PropertyList slot="details" title="Details"><Property slot="items" label="Format" value="Video" /></PropertyList>
      <Button slot="actions" label="Book" action="agent:book" tone="primary" />
    </Detail>`,
    "wide",
  ),
  PropertyList: previewSource(`<PropertyList title="Account details" columns="2">
      <Property slot="items" label="Plan" value="Team" />
      <Property slot="items" label="Status" value="Active" />
    </PropertyList>`),
  Property: previewSource(
    `<PropertyList title="Account details"><Property slot="items" label="Plan" value="Team" /></PropertyList>`,
  ),
  Board: previewSource(
    `<Board title="Launch board">
      <BoardColumn slot="columns" title="Ready" tone="accent"><Card title="Publish"><Badge label="Today" /></Card></BoardColumn>
      <BoardColumn slot="columns" title="Done"><Card title="Brief"><Badge label="Approved" tone="positive" /></Card></BoardColumn>
    </Board>`,
    "wide",
  ),
  BoardColumn: previewSource(
    `<Board title="Launch board"><BoardColumn slot="columns" title="Ready" tone="accent"><Card title="Publish"><Text value="Prepare release notes." /></Card></BoardColumn></Board>`,
    "wide",
  ),
  Calendar: previewSource(
    `<Calendar name="appointment" title="Appointments" events="data:previewEvents" view="agenda" />`,
    "wide",
  ),
  Result:
    previewSource(`<Result title="Request received" description="We will reply within one business day." tone="success">
      <Badge slot="summary" label="Complete" tone="positive" />
      <Text slot="details" value="Reference LF-2048" />
      <Button slot="actions" label="Start another" action="agent:restart" />
    </Result>`),
  Empty: previewSource(`<Empty title="No records" description="Add content to fill this space.">
      <Button slot="actions" label="Refresh" action="agent:refresh" tone="primary" />
    </Empty>`),
  Alert:
    previewSource(`<Alert title="Review needed" description="One important message stays visible." tone="warning">
      <Button slot="actions" label="Review" action="agent:review" />
    </Alert>`),
  Form: previewSource(`<Form layout="stacked">
      <Field slot="fields" name="email" label="Email" placeholder="you@example.com" />
      <Select slot="fields" name="channel" label="Channel" options="data:previewOptions" />
      <Button slot="actions" label="Submit" action="agent:submit" collect="email channel" tone="primary" />
    </Form>`),
  Field: previewSource(
    `<Field name="email" label="Email" value="hello@example.com" placeholder="you@example.com" secret="false" />`,
  ),
  Select: previewSource(
    `<Select name="channel" label="Channel" options="data:previewOptions" value="email" />`,
  ),
  ChoiceGroup: previewSource(
    `<ChoiceGroup name="channels" label="Channels" options="data:previewOptions" value="data:previewSelections" layout="inline" />`,
  ),
  Toggle: previewSource(`<Toggle name="updates" label="Send product updates" value="true" />`),
  MessageThread: previewSource(`<MessageThread messages="data:previewMessages" />`, "wide"),
  Accordion: previewSource(`<Accordion multiple="true">
      <AccordionItem slot="items" title="What is Facet?" defaultOpen="true"><Text slot="body" value="Safe live UI authored as component markup." /></AccordionItem>
      <AccordionItem slot="items" title="How is it bounded?"><Text slot="body" value="The active catalog defines the complete vocabulary." /></AccordionItem>
    </Accordion>`),
  AccordionItem: previewSource(
    `<Accordion><AccordionItem slot="items" title="What is Facet?" defaultOpen="true"><Text slot="body" value="Safe live UI authored as component markup." /><Button slot="actions" label="Learn more" action="agent:learn" /></AccordionItem></Accordion>`,
  ),
});

interface PreviewSpecimenSource {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly source: string;
  readonly display: "standard" | "wide";
  readonly recipeTokens?: readonly string[];
}

const PREVIEW_SPECIMENS_BY_TAG: Readonly<Record<string, readonly PreviewSpecimenSource[]>> =
  Object.freeze({
    Button: Object.freeze(
      ["primary", "secondary", "quiet"].map((tone) =>
        Object.freeze({
          id: `button-${tone}`,
          label: titleCase(tone),
          description: `Button tone="${tone}" uses the corresponding trusted recipe tokens.`,
          source: previewSource(
            `<Button label="${titleCase(tone)} action" action="agent:preview" tone="${tone}" />`,
          ),
          display: "standard" as const,
          recipeTokens: buttonRecipeTokens(tone),
        }),
      ),
    ),
    AppShell: Object.freeze([
      Object.freeze({
        id: "app-shell-start",
        label: "Start navigation",
        description: "Responsive app frame with navigation before the main region.",
        source: PREVIEW_SOURCE_BY_TAG["AppShell"] ?? "",
        display: "wide" as const,
      }),
      Object.freeze({
        id: "app-shell-end",
        label: "End navigation",
        description: "The same named regions with navigation placed after main content.",
        source: previewSource(
          `<AppShell gap="md" sidebar="end" collapse="true">
          <Navigation slot="navigation" label="Review" orientation="vertical"><NavigationItem slot="items" label="Queue" action="nav:preview" active="true" /></Navigation>
          <Stack slot="main" gap="md"><Text value="Review queue" /></Stack>
        </AppShell>`,
          "wide",
        ),
        display: "wide" as const,
      }),
    ]),
  });

function reject(
  tag: string,
  source: string | null,
  phase: ComponentPreviewFixtureErrorPhase,
  code: string,
  detail: string,
  data: DataModel = PREVIEW_DATA,
): ComponentPreviewFixtureResult {
  return Object.freeze({
    ok: false,
    tag,
    source,
    data,
    error: Object.freeze({ phase, code, detail }),
  });
}

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function buttonRecipeTokens(tone: string): readonly string[] {
  if (tone === "primary") {
    return Object.freeze(["primaryBg", "primaryText", "primaryBorder", "radius", "focusRing"]);
  }
  if (tone === "secondary") {
    return Object.freeze([
      "secondaryBg",
      "secondaryText",
      "secondaryBorder",
      "radius",
      "focusRing",
    ]);
  }
  return Object.freeze(["quietText", "radius", "focusRing"]);
}

function targetNodeId(document: ComponentDocument, tag: string): string | null {
  for (const [nodeId, node] of Object.entries(document.nodes)) {
    if (node.tag === tag) return nodeId;
  }
  return null;
}

function componentExamplesForTag(
  tag: string,
  examples: readonly QuickstartResolvedDesignExample[] | undefined,
): readonly QuickstartResolvedDesignExample[] {
  if (examples === undefined) return Object.freeze([]);
  return Object.freeze(
    examples.filter((example) => example.kind === "component" && example.tags.includes(tag)),
  );
}

function buildFixtureFromExample(
  tag: string,
  example: QuickstartResolvedDesignExample,
): ComponentPreviewFixtureResult {
  const nodeId = targetNodeId(example.document, tag);
  if (nodeId === null) {
    return reject(
      tag,
      example.markup,
      "target",
      "target-node-missing",
      `Example ${example.id} does not include the target component.`,
      example.data,
    );
  }
  return Object.freeze({
    ok: true,
    tag,
    fixture: Object.freeze({
      tag,
      source: example.markup,
      data: example.data,
      document: example.document,
      targetNodeId: nodeId,
    }),
  });
}

function buildFixtureFromSource(
  spec: ComponentSpec,
  catalog: FacetCatalog,
  source: string,
): ComponentPreviewFixtureResult {
  const parsed = parseMarkup(source);
  if (!parsed.ok) return reject(spec.tag, source, "parse", parsed.error.code, parsed.error.cause);
  const validated = validateAuthorMarkup(
    parsed.ast,
    catalog,
    PREVIEW_DATA,
    QUICKSTART_PREVIEW_ASSET_REGISTRY,
  );
  if (!validated.ok) {
    return reject(spec.tag, source, "validate", validated.error.code, validated.error.cause);
  }
  const nodeId = targetNodeId(validated.document, spec.tag);
  if (nodeId === null) {
    return reject(spec.tag, source, "target", "target-node-missing", "No target node exists.");
  }
  return Object.freeze({
    ok: true,
    tag: spec.tag,
    fixture: Object.freeze({
      tag: spec.tag,
      source,
      data: PREVIEW_DATA,
      document: validated.document,
      targetNodeId: nodeId,
    }),
  });
}

function buildFixture(
  spec: ComponentSpec,
  catalog: FacetCatalog,
  examples?: readonly QuickstartResolvedDesignExample[],
): ComponentPreviewFixtureResult {
  const example = componentExamplesForTag(spec.tag, examples)[0];
  if (example !== undefined) return buildFixtureFromExample(spec.tag, example);
  const source = PREVIEW_SOURCE_BY_TAG[spec.tag];
  if (source === undefined) {
    return reject(spec.tag, null, "missing", "missing-preview-source", "No preview source exists.");
  }
  return buildFixtureFromSource(spec, catalog, source);
}

export function deriveComponentPreviewFixtures(
  catalog: FacetCatalog = DEFAULT_CATALOG,
  examples?: readonly QuickstartResolvedDesignExample[],
): readonly ComponentPreviewFixtureResult[] {
  return Object.freeze(catalog.components.map((spec) => buildFixture(spec, catalog, examples)));
}

export function previewFixtureForTag(
  tag: string,
  catalog: FacetCatalog | undefined = DEFAULT_CATALOG,
  examples?: readonly QuickstartResolvedDesignExample[],
): ComponentPreviewFixtureResult {
  const resolvedCatalog = catalog ?? DEFAULT_CATALOG;
  const spec = resolvedCatalog.components.find((candidate) => candidate.tag === tag);
  if (spec === undefined) {
    return reject(tag, null, "missing", "missing-catalog-tag", "No catalog spec exists.");
  }
  return buildFixture(spec, resolvedCatalog, examples);
}

export function previewSpecimensForTag(
  tag: string,
  catalog: FacetCatalog | undefined = DEFAULT_CATALOG,
  examples?: readonly QuickstartResolvedDesignExample[],
): readonly ComponentPreviewSpecimen[] {
  const resolvedCatalog = catalog ?? DEFAULT_CATALOG;
  const spec = resolvedCatalog.components.find((candidate) => candidate.tag === tag);
  if (spec === undefined) {
    return Object.freeze([
      Object.freeze({
        id: "missing",
        label: "Missing",
        description: "No catalog spec exists.",
        display: "standard",
        recipeTokens: Object.freeze([]),
        result: reject(tag, null, "missing", "missing-catalog-tag", "No catalog spec exists."),
      }),
    ]);
  }

  const exampleSpecimens = componentExamplesForTag(tag, examples).map((example) =>
    Object.freeze({
      id: example.id,
      label: example.label,
      description: example.description ?? "Active declarative component example.",
      display: "standard" as const,
      recipeTokens: Object.freeze(Object.keys(spec.themeRecipe?.tokens ?? {})),
      result: buildFixtureFromExample(tag, example),
    }),
  );
  if (exampleSpecimens.length > 0) return Object.freeze(exampleSpecimens);

  const sources = PREVIEW_SPECIMENS_BY_TAG[tag];
  if (sources === undefined || sources.length === 0) {
    return Object.freeze([
      Object.freeze({
        id: "default",
        label: "Default",
        description: "Default component fixture.",
        display: "standard",
        recipeTokens: Object.freeze(Object.keys(spec.themeRecipe?.tokens ?? {})),
        result: buildFixture(spec, resolvedCatalog),
      }),
    ]);
  }

  return Object.freeze(
    sources.map((source) =>
      Object.freeze({
        id: source.id,
        label: source.label,
        description: source.description,
        display: source.display,
        recipeTokens: Object.freeze([
          ...(source.recipeTokens ?? Object.keys(spec.themeRecipe?.tokens ?? {})),
        ]),
        result: buildFixtureFromSource(spec, resolvedCatalog, source.source),
      }),
    ),
  );
}
