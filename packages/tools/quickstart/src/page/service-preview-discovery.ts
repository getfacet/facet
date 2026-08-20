import type { DataModel } from "@facet/core";

export interface ServicePreviewSource {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly roles: readonly string[];
  readonly source: string;
  readonly data: DataModel;
}

export const SERVICE_PREVIEW_DATA: DataModel = Object.freeze({
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

function servicePreviewSource(
  id: string,
  label: string,
  description: string,
  roles: readonly string[],
  source: string,
): ServicePreviewSource {
  return Object.freeze({
    id,
    label,
    description,
    roles: Object.freeze([...roles]),
    source,
    data: SERVICE_PREVIEW_DATA,
  });
}

export const SERVICE_PREVIEW_DISCOVERY: readonly ServicePreviewSource[] = Object.freeze([
  servicePreviewSource(
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
  servicePreviewSource(
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
      "Text",
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
  servicePreviewSource(
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
      "Text",
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
  servicePreviewSource(
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
      "Text",
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
]);
