import { DEFAULT_CATALOG } from "@facet/assets";
import { parseMarkup, validateAuthorMarkup } from "@facet/core";
import type { ComponentDocument, DataModel, FacetCatalog } from "@facet/core";

import type {
  ComponentPreviewFixture,
  ComponentPreviewFixtureError,
  ComponentPreviewFixtureErrorPhase,
  ComponentPreviewFixtureResult,
} from "./component-preview-fixtures.js";

export interface ScreenPattern {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly roles: readonly string[];
  readonly result: ComponentPreviewFixtureResult;
}

interface ScreenPatternSource {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly roles: readonly string[];
  readonly source: string;
  readonly data: DataModel;
}

const EMPTY_DATA: DataModel = Object.freeze({});

const SALES_DATA: DataModel = Object.freeze({
  pipelineRows: Object.freeze([
    Object.freeze({ account: "Acme", stage: "Negotiation", owner: "Mina", arr: 42000 }),
    Object.freeze({ account: "Northwind", stage: "Legal", owner: "Jules", arr: 31000 }),
    Object.freeze({ account: "Globex", stage: "Expansion", owner: "Ari", arr: 28000 }),
    Object.freeze({ account: "Initech", stage: "Risk review", owner: "Nora", arr: 19000 }),
  ]),
});

const SUCCESS_DATA: DataModel = Object.freeze({
  accountRows: Object.freeze([
    Object.freeze({ account: "Acme", health: "Strong", renewal: "Sep 18", owner: "Mina" }),
    Object.freeze({ account: "Northwind", health: "Watch", renewal: "Oct 02", owner: "Jules" }),
    Object.freeze({ account: "Globex", health: "Strong", renewal: "Oct 09", owner: "Ari" }),
  ]),
});

const SUPPORT_DATA: DataModel = Object.freeze({
  ticketRows: Object.freeze([
    Object.freeze({ ticket: "INC-1842", priority: "P1", status: "Open", owner: "Sora" }),
    Object.freeze({ ticket: "REQ-3021", priority: "P2", status: "Queued", owner: "Theo" }),
    Object.freeze({ ticket: "BUG-7720", priority: "P2", status: "Waiting", owner: "Iris" }),
    Object.freeze({ ticket: "INC-1839", priority: "P3", status: "Resolved", owner: "Mika" }),
  ]),
});

const AUDIT_DATA: DataModel = Object.freeze({
  auditRows: Object.freeze([
    Object.freeze({ event: "API key rotated", actor: "Mina", environment: "Production" }),
    Object.freeze({ event: "Billing role changed", actor: "Jules", environment: "Admin" }),
    Object.freeze({ event: "Webhook retried", actor: "System", environment: "Worker" }),
  ]),
});

const CAMPAIGN_DATA: DataModel = Object.freeze({
  campaignRows: Object.freeze([
    Object.freeze({ beat: "Concept lock", owner: "Alex", due: "Aug 12", status: "Ready" }),
    Object.freeze({ beat: "Landing copy", owner: "Mina", due: "Aug 16", status: "Draft" }),
    Object.freeze({ beat: "Launch deck", owner: "Jules", due: "Aug 22", status: "Review" }),
  ]),
});

const PRODUCT_DATA: DataModel = Object.freeze({
  specRows: Object.freeze([
    Object.freeze({ area: "Battery", target: "20 hr", owner: "Hardware" }),
    Object.freeze({ area: "Audio", target: "Spatial", owner: "Product" }),
    Object.freeze({ area: "Fit", target: "Light seal", owner: "Design" }),
    Object.freeze({ area: "Packaging", target: "Recycled", owner: "Ops" }),
  ]),
});

const CONTROL_DATA: DataModel = Object.freeze({
  scheduleRows: Object.freeze([
    Object.freeze({ rule: "Weekdays", target: "19 C", window: "06:00-10:00", mode: "On" }),
    Object.freeze({ rule: "Evening", target: "20 C", window: "18:00-23:30", mode: "On" }),
    Object.freeze({ rule: "Holiday", target: "Off", window: "All day", mode: "Hold" }),
  ]),
});

const ORDER_DATA: DataModel = Object.freeze({
  orderRows: Object.freeze([
    Object.freeze({ order: "1009", customer: "Mina", status: "Packed", total: 128 }),
    Object.freeze({ order: "1010", customer: "Jules", status: "Delayed", total: 94 }),
    Object.freeze({ order: "1011", customer: "Ari", status: "Refund", total: 42 }),
    Object.freeze({ order: "1012", customer: "Nora", status: "Shipped", total: 216 }),
  ]),
});

const BOOKING_DATA: DataModel = Object.freeze({
  bookingRows: Object.freeze([
    Object.freeze({ guest: "Mina", service: "Cut", time: "10:30", status: "Confirmed" }),
    Object.freeze({ guest: "Jules", service: "Color", time: "12:00", status: "Deposit" }),
    Object.freeze({ guest: "Ari", service: "Consult", time: "14:30", status: "Waitlist" }),
    Object.freeze({ guest: "Nora", service: "Repair", time: "16:00", status: "Confirmed" }),
  ]),
});

const BILLING_DATA: DataModel = Object.freeze({
  invoiceRows: Object.freeze([
    Object.freeze({ account: "Acme", plan: "Team", invoice: "Paid", amount: 240 }),
    Object.freeze({ account: "Northwind", plan: "Scale", invoice: "Failed", amount: 880 }),
    Object.freeze({ account: "Globex", plan: "Team", invoice: "Open", amount: 320 }),
    Object.freeze({ account: "Initech", plan: "Trial", invoice: "Pending", amount: 0 }),
  ]),
});

const WALLET_DATA: DataModel = Object.freeze({
  transactionRows: Object.freeze([
    Object.freeze({ merchant: "Market", category: "Groceries", amount: 84, status: "Posted" }),
    Object.freeze({ merchant: "Metro", category: "Transit", amount: 12, status: "Posted" }),
    Object.freeze({ merchant: "Studio", category: "Learning", amount: 48, status: "Pending" }),
    Object.freeze({ merchant: "Cafe", category: "Food", amount: 9, status: "Posted" }),
  ]),
});

const PROFILE_DATA: DataModel = Object.freeze({
  experienceRows: Object.freeze([
    Object.freeze({ role: "Product Designer", org: "Northstar", period: "2024-2026" }),
    Object.freeze({ role: "Design Lead", org: "Canvas Lab", period: "2021-2024" }),
    Object.freeze({ role: "Brand Systems", org: "Freelance", period: "2019-2021" }),
  ]),
});

const SCREEN_PATTERN_SOURCES: readonly ScreenPatternSource[] = Object.freeze([
  patternSource(
    "revenue-command-center",
    "Revenue command center",
    "Full-width dashboard composition with metric density, brand-led actions, restrained status language and table data.",
    [
      "Screen",
      "AppShell",
      "SideNav",
      "SideNavItem",
      "Grid",
      "Metric",
      "Card",
      "Table",
      "Badge",
      "Button",
    ],
    `<Facet entry="preview">
  <Screen name="preview" title="Revenue command center" maxWidth="full" padding="lg">
    <AppShell gap="lg" sidebar="start" collapse="true">
      <SideNav title="Revenue" label="Command center" tone="inverse">
        <SideNavItem label="Overview" action="agent:openRevenueOverview" mark="01" active="true" />
        <SideNavItem label="Pipeline" action="agent:openPipeline" mark="02" />
        <SideNavItem label="Forecast" action="agent:openForecast" mark="03" meta="Live" />
      </SideNav>
      <Stack gap="lg" align="stretch" grow="true" padding="none">
        <Row gap="md" align="center" justify="between" wrap="true">
          <Text value="Live quarter view across pipeline, risk and forecast." tone="muted" />
          <Row gap="sm" align="center" justify="end" wrap="true">
            <Badge label="Healthy" tone="positive" />
            <Button label="Refresh" action="agent:refreshRevenue" tone="secondary" />
            <Button label="Create plan" action="agent:createPlan" tone="primary" />
          </Row>
        </Row>
        <Grid columns="2" gap="md" collapse="true">
          <Card title="Quarter command" tone="accent" padding="lg">
            <Stack gap="md" align="stretch" padding="none">
              <Text value="Pipeline, risk and expansion work in one operating surface." />
              <Metric label="Pipeline" value="98420" unit="USD" />
              <Text value="Legal review, expansion outreach and owner notes stay visible beside the live metrics." tone="muted" />
            </Stack>
          </Card>
          <Grid columns="1" gap="md" collapse="true">
            <Card tone="neutral" padding="md">
              <Metric label="Forecast" value="71200" unit="USD" />
            </Card>
            <Card tone="neutral" padding="md">
              <Metric label="Win rate" value="42" unit="%" />
            </Card>
            <Card tone="warning" padding="md">
              <Metric label="At risk" value="4" />
            </Card>
          </Grid>
        </Grid>
        <Grid columns="2" gap="md" collapse="true">
          <Card title="Forecast plan" tone="neutral" padding="lg">
            <Stack gap="lg" align="stretch" justify="between" grow="true" padding="none">
              <Stack gap="md" align="stretch" padding="none">
                <Badge label="On track" tone="positive" />
                <Text value="Protect the commit, assign owner reviews, and keep legal-stage deals moving before Friday." />
              </Stack>
              <Row gap="sm" align="center" justify="start" wrap="true">
                <Button label="Open forecast" action="agent:openForecast" tone="secondary" />
              </Row>
            </Stack>
          </Card>
          <Card title="Risk review" tone="warning" padding="lg">
            <Stack gap="lg" align="stretch" justify="between" grow="true" padding="none">
              <Stack gap="md" align="stretch" padding="none">
                <Badge label="Needs attention" tone="warning" />
                <Text value="Four deals need owner action, decision notes, and approval context before Friday." />
              </Stack>
              <Row gap="sm" align="center" justify="start" wrap="true">
                <Button label="Review risks" action="agent:reviewRisks" tone="secondary" />
              </Row>
            </Stack>
          </Card>
          <Card title="Expansion motion" tone="neutral" padding="lg">
            <Stack gap="lg" align="stretch" justify="between" grow="true" padding="none">
              <Stack gap="md" align="stretch" padding="none">
                <Badge label="Strong signal" tone="positive" />
                <Text value="Expansion accounts need outreach, enablement notes, and procurement timing before Friday." />
              </Stack>
              <Row gap="sm" align="center" justify="start" wrap="true">
                <Button label="Plan outreach" action="agent:planOutreach" tone="secondary" />
              </Row>
            </Stack>
          </Card>
          <Card title="Owner notes" tone="neutral" padding="lg">
            <Stack gap="lg" align="stretch" justify="between" grow="true" padding="none">
              <Stack gap="md" align="stretch" padding="none">
                <Badge label="Ready" tone="neutral" />
                <Text value="Keep legal context, procurement blockers and sponsor notes attached to each account." />
              </Stack>
              <Row gap="sm" align="center" justify="start" wrap="true">
                <Button label="Update notes" action="agent:updateOwnerNotes" tone="secondary" />
              </Row>
            </Stack>
          </Card>
        </Grid>
        <Card title="Pipeline detail" tone="neutral" padding="md">
          <Table rows="data:pipelineRows" caption="Open opportunities" />
        </Card>
      </Stack>
    </AppShell>
  </Screen>
</Facet>`,
    SALES_DATA,
  ),
  patternSource(
    "customer-success-review",
    "Customer success review",
    "Account workspace with repeated cards, status language, metrics, table-backed detail and clear next actions.",
    ["Screen", "Grid", "Card", "Metric", "Table", "Badge", "Button"],
    `<Facet entry="preview">
  <Screen name="preview" title="Customer success review" maxWidth="wide" padding="lg">
    <Grid columns="3" gap="md" collapse="true">
      <Card tone="accent" padding="md">
        <Metric label="Renewal ARR" value="128000" unit="USD" />
      </Card>
      <Card tone="neutral" padding="md">
        <Metric label="Accounts" value="24" />
      </Card>
      <Card tone="warning" padding="md">
        <Metric label="Watchlist" value="3" />
      </Card>
    </Grid>
    <Grid columns="2" gap="md" collapse="true">
      <Card title="Northwind renewal" tone="warning" padding="lg">
        <Stack gap="sm" align="stretch" justify="between" grow="true" padding="none">
          <Row gap="sm" align="center" justify="between" wrap="true">
            <Badge label="Watch" tone="warning" />
            <Text value="Owner: Jules" tone="muted" />
          </Row>
          <Text value="Usage dipped after admin migration. Schedule the executive checkpoint and prepare the save plan." />
          <Text value="Next checkpoint: sponsor call with renewal owner." tone="muted" />
          <Row gap="sm" align="center" justify="end" wrap="true">
            <Button label="Draft plan" action="agent:draftPlan" tone="primary" />
          </Row>
        </Stack>
      </Card>
      <Card title="Acme expansion" tone="neutral" padding="lg">
        <Stack gap="sm" align="stretch" justify="between" grow="true" padding="none">
          <Row gap="sm" align="center" justify="between" wrap="true">
            <Badge label="Strong" tone="positive" />
            <Text value="Owner: Mina" tone="muted" />
          </Row>
          <Text value="Champion asked for two-team rollout support. Package enablement before procurement review." />
          <Text value="Next checkpoint: rollout planning session." tone="muted" />
          <Row gap="sm" align="center" justify="end" wrap="true">
            <Button label="Prepare expansion" action="agent:prepareExpansion" tone="primary" />
          </Row>
        </Stack>
      </Card>
    </Grid>
    <Card title="Portfolio table" tone="neutral" padding="md">
      <Table rows="data:accountRows" caption="Account health and renewal timing" />
    </Card>
  </Screen>
</Facet>`,
    SUCCESS_DATA,
  ),
  patternSource(
    "workspace-settings-flow",
    "Workspace settings flow",
    "A denser edit screen with grouped fields, destructive tone, secondary actions and a focused modal decision.",
    ["Screen", "Grid", "Card", "Field", "Modal", "Button", "Badge"],
    `<Facet entry="preview">
  <Screen name="preview" title="Workspace settings" maxWidth="wide" padding="lg">
    <Row gap="md" align="center" justify="between" wrap="true">
      <Text value="Manage identity, routing and security defaults for this workspace." tone="muted" />
      <Badge label="Admin only" tone="neutral" />
    </Row>
    <Grid columns="2" gap="md" collapse="true">
      <Card title="Organization" tone="neutral" padding="lg">
        <Stack gap="md" align="stretch" padding="none">
          <Field name="company" label="Company" value="Facet Labs" placeholder="Company name" />
          <Field name="region" label="Region" value="North America" placeholder="Region" />
          <Field name="domain" label="Allowed domain" value="facet.dev" placeholder="example.com" />
        </Stack>
      </Card>
      <Card title="Security" tone="neutral" padding="lg">
        <Stack gap="md" align="stretch" justify="between" grow="true" padding="none">
          <Field name="owner" label="Owner email" value="ops@facet.dev" placeholder="owner@example.com" />
          <Field name="apiKey" label="API key" value="hidden value" secret="true" />
          <Row gap="sm" align="center" justify="between" wrap="true">
            <Modal triggerLabel="Rotate key" title="Rotate API key" description="Confirm the target before rotating this key.">
              <Field name="environment" label="Environment" value="Production" />
              <Button label="Rotate key" action="agent:rotateKey" collect="environment" tone="primary" />
            </Modal>
            <Button label="Save settings" action="agent:saveSettings" collect="company region domain owner apiKey" tone="primary" />
          </Row>
        </Stack>
      </Card>
    </Grid>
    <Card title="Danger zone" tone="danger" padding="md">
      <Row gap="md" align="center" justify="between" wrap="true">
        <Text value="Deleting the workspace is intentionally separated from routine settings." />
        <Button label="Request deletion" action="agent:requestDeletion" tone="secondary" />
      </Row>
    </Card>
  </Screen>
</Facet>`,
    EMPTY_DATA,
  ),
  patternSource(
    "support-operations-board",
    "Support operations board",
    "Operations screen with queue metrics, severity colors, task cards, table detail and an empty secondary lane.",
    ["Screen", "Grid", "Metric", "Card", "Table", "Empty", "Badge"],
    `<Facet entry="preview">
  <Screen name="preview" title="Support operations board" maxWidth="full" padding="lg">
    <Grid columns="2" gap="md" collapse="true">
      <Card tone="danger" padding="md">
        <Metric label="Open incidents" value="18" />
      </Card>
      <Card tone="warning" padding="md">
        <Metric label="P1 active" value="2" />
      </Card>
      <Card tone="neutral" padding="md">
        <Metric label="Median response" value="14" unit="min" />
      </Card>
      <Card tone="neutral" padding="md">
        <Metric label="Resolved today" value="41" />
      </Card>
    </Grid>
    <Grid columns="3" gap="md" collapse="true">
      <Card title="Priority lane" tone="danger" padding="lg">
        <Stack gap="sm" align="stretch" justify="between" grow="true" padding="none">
          <Badge label="P1" tone="danger" />
          <Text value="Payment webhook retries are failing for one enterprise tenant." />
          <Button label="Open incident" action="agent:openIncident" tone="primary" />
        </Stack>
      </Card>
      <Card title="Queued requests" tone="neutral" padding="lg">
        <Stack gap="sm" align="stretch" justify="between" grow="true" padding="none">
          <Badge label="P2" tone="neutral" />
          <Text value="Three account migrations are waiting on customer confirmation." />
          <Button label="Send updates" action="agent:sendUpdates" tone="secondary" />
        </Stack>
      </Card>
      <Empty title="No release blockers" description="The release lane is clear for this workspace.">
        <Badge label="Clear" tone="positive" />
      </Empty>
    </Grid>
    <Card title="Ticket queue" tone="neutral" padding="md">
      <Table rows="data:ticketRows" caption="Current ticket queue" />
    </Card>
  </Screen>
</Facet>`,
    SUPPORT_DATA,
  ),
  patternSource(
    "security-audit-console",
    "Security audit console",
    "Audit-oriented screen showing table data, warning context, secret fields and a modal-controlled action.",
    ["Screen", "Card", "Table", "Field", "Modal", "Badge", "Button"],
    `<Facet entry="preview">
  <Screen name="preview" title="Security audit console" maxWidth="wide" padding="lg">
    <Grid columns="3" gap="md" collapse="true">
      <Card tone="neutral" padding="md">
        <Metric label="Policy checks" value="128" />
      </Card>
      <Card tone="warning" padding="md">
        <Metric label="Warnings" value="7" />
      </Card>
      <Card tone="danger" padding="md">
        <Metric label="Blocked events" value="2" />
      </Card>
    </Grid>
    <Card title="Rotation request" tone="warning" padding="lg">
      <Stack gap="md" align="stretch" justify="between" grow="true" padding="none">
        <Row gap="sm" align="center" justify="between" wrap="true">
          <Badge label="Requires approval" tone="warning" />
          <Text value="Production key expires in 9 days." tone="muted" />
        </Row>
        <Field name="approver" label="Approver" value="security@facet.dev" placeholder="approver@example.com" />
        <Field name="reason" label="Reason" value="Quarterly rotation" placeholder="Reason" />
        <Modal triggerLabel="Review rotation" title="Approve production rotation" description="This modal owns the focused confirmation frame.">
          <Field name="approvalCode" label="Approval code" value="SEC-2026" />
          <Button label="Approve rotation" action="agent:approveRotation" collect="approvalCode" tone="primary" />
        </Modal>
      </Stack>
    </Card>
    <Card title="Audit events" tone="neutral" padding="md">
      <Table rows="data:auditRows" caption="Recent privileged events" />
    </Card>
  </Screen>
</Facet>`,
    AUDIT_DATA,
  ),
  patternSource(
    "brand-campaign-studio",
    "Brand campaign studio",
    "Brand-led campaign page with a bold hero, offer cards, proof, launch CTA and a quiet production plan.",
    [
      "Screen",
      "Split",
      "Stack",
      "Row",
      "Nav",
      "LogoMark",
      "ProductShowcase",
      "Gallery",
      "MediaCard",
      "StatStrip",
      "Testimonial",
      "Footer",
      "Badge",
      "Button",
      "Table",
    ],
    `<Facet entry="preview">
  <Screen name="preview" maxWidth="full" padding="lg">
    <Nav brand="Solar Pop Studio" mark="SP" label="Creative office" tone="neutral">
      <Button label="Work" action="agent:viewCampaignWork" tone="quiet" />
      <Button label="Services" action="agent:viewServices" tone="quiet" />
      <Button label="Let's create" action="agent:startCampaign" tone="primary" />
    </Nav>
    <Split ratio="50:50" gap="lg" align="stretch" collapse="true">
      <ProductShowcase eyebrow="Citrus launch system" title="Brand design that shines" description="A bright launch page that leads with personality, campaign proof and a clear creative offer." meta="Citrus / Amalfi / Cream" tone="accent">
        <Row gap="sm" align="center" justify="start" wrap="true">
          <LogoMark label="Solar Pop Studio" mark="SP" size="md" tone="brand" shape="circle" />
          <Badge label="Concept locked" tone="positive" />
          <Button label="View work" action="agent:viewCampaignWork" tone="primary" />
        </Row>
      </ProductShowcase>
      <Stack gap="md" align="stretch" justify="between" grow="true" padding="none">
        <VisualPanel title="Launch rhythm" value="SP" caption="Campaign color, offer and proof stay connected before the production detail appears." tone="inverse" />
        <StatStrip title="Campaign proof" columns="2" tone="neutral">
          <Metric label="Launch pages" value="5" />
          <Metric label="Sections" value="12" />
          <Metric label="Client notes" value="80" unit="+" />
        </StatStrip>
        <Testimonial quote="The page finally feels like the brand before it explains the product." source="Mina Park" role="Founder" tone="accent" />
        <VisualPanel title="Ready for review" caption="Package the hero, selected work and proof into one reviewable surface." tone="warm">
          <Button label="Prepare review" action="agent:prepareCampaignReview" tone="primary" />
        </VisualPanel>
      </Stack>
    </Split>
    <Gallery title="Selected work" columns="3" rhythm="even">
      <MediaCard title="Sundaze" description="A warm hero system for a seasonal launch." eyebrow="Work" meta="01" tone="accent" aspect="square" />
      <MediaCard title="Morii" description="Product cards with a tighter editorial rhythm." eyebrow="Deck" meta="02" tone="brand" aspect="square" />
      <MediaCard title="Citrus" description="Offer proof, client notes and launch story." eyebrow="Launch" meta="03" tone="neutral" aspect="square" />
    </Gallery>
    <Section title="Production plan" description="Operational detail remains available after the visual system has established the brand." tone="muted">
      <Table rows="data:campaignRows" caption="Campaign beats" />
    </Section>
    <Footer title="Solar Pop Studio" description="Brand systems, product pages and launch decks." tone="inverse">
      <Button label="Start a brief" action="agent:startCampaignBrief" tone="primary" />
    </Footer>
  </Screen>
</Facet>`,
    CAMPAIGN_DATA,
  ),
  patternSource(
    "product-launch-dossier",
    "Product launch dossier",
    "Editorial product page with an inverse hero, spec narrative, progress proof and a compact readiness table.",
    [
      "Screen",
      "Nav",
      "ProductShowcase",
      "MediaCard",
      "StatStrip",
      "Timeline",
      "Testimonial",
      "CTA",
      "Table",
    ],
    `<Facet entry="preview">
  <Screen name="preview" maxWidth="wide" padding="lg">
    <Nav brand="Northstar Audio" mark="NA" label="Launch candidate" tone="inverse">
      <Button label="Specs" action="agent:viewSpecs" tone="secondary" />
      <Button label="Brief" action="agent:openProductBrief" tone="primary" />
    </Nav>
    <ProductShowcase eyebrow="Product launch" title="Sounds like an epiphany." description="A calm product dossier with editorial scale, proof modules and a clear release path." meta="20 hr / spatial / recycled" tone="inverse">
      <Button label="Open brief" action="agent:openProductBrief" tone="primary" />
    </ProductShowcase>
    <Gallery title="Elaborately simple." columns="3" rhythm="even">
      <MediaCard title="20 hour battery" description="A large spec becomes the first proof point." eyebrow="Spec" meta="20" tone="neutral" aspect="square" />
      <MediaCard title="Spatial tuning" description="Brand blue is saved for emphasis moments." eyebrow="Audio" meta="3D" tone="brand" aspect="square" />
      <MediaCard title="Retail ready" description="Packaging and training are ready for handoff." eyebrow="Ops" meta="Ready" tone="accent" aspect="square" />
    </Gallery>
    <StatStrip title="Readiness path" columns="3" tone="neutral">
      <Progress label="Product page" value="84" tone="accent" />
      <Progress label="Retail training" value="72" tone="warning" />
      <Progress label="Executive proof" value="91" tone="success" />
    </StatStrip>
    <Grid columns="2" gap="md" collapse="true">
      <Timeline title="Release sequence" tone="accent">
        <Card title="Narrative"><Text value="Lock product story and proof hierarchy." /></Card>
        <Card title="Retail"><Text value="Finalize training notes and comparison copy." /></Card>
        <Card title="Publish"><Text value="Release the launch packet with one owner." /></Card>
      </Timeline>
      <Testimonial quote="The detail page feels premium without becoming a dashboard." source="Ari Lane" role="Product lead" tone="neutral" />
    </Grid>
    <Section title="Tech specs" description="Structured detail stays available after the narrative establishes the product." tone="muted">
      <Table rows="data:specRows" caption="Launch spec owners" />
    </Section>
    <CTA title="Publish the launch packet" description="Move from review to release with one focused action." tone="accent">
      <Button label="Publish update" action="agent:publishLaunchUpdate" tone="primary" />
    </CTA>
  </Screen>
</Facet>`,
    PRODUCT_DATA,
  ),
  patternSource(
    "service-control-panel",
    "Service control panel",
    "Dense control-room surface with mode metrics, schedule data, fields and one focused action.",
    ["Screen", "Grid", "Card", "Metric", "Field", "Table", "Badge", "Button", "Modal"],
    `<Facet entry="preview">
  <Screen name="preview" title="Service control panel" maxWidth="wide" padding="lg">
    <Row gap="md" align="center" justify="between" wrap="true">
      <Text value="Operational control panel for state, schedule and manual overrides." tone="muted" />
      <Badge label="Auto mode" tone="positive" />
    </Row>
    <Grid columns="3" gap="md" collapse="true">
      <Card tone="accent" padding="md">
        <Metric label="Target" value="19" unit="C" />
      </Card>
      <Card tone="neutral" padding="md">
        <Metric label="Capacity" value="320" unit="kWh" />
      </Card>
      <Card tone="success" padding="md">
        <Metric label="Yield" value="190" unit="kWh" />
      </Card>
    </Grid>
    <Grid columns="2" gap="md" collapse="true">
      <Card title="Current mode" tone="neutral" padding="lg">
        <Stack gap="md" align="stretch" justify="between" grow="true" padding="none">
          <Field name="temperature" label="Temperature" value="19.0 C" placeholder="Target temperature" />
          <Field name="zone" label="Zone" value="East wing" placeholder="Zone" />
          <Row gap="sm" align="center" justify="between" wrap="true">
            <Badge label="Heating" tone="neutral" />
            <Button label="Apply mode" action="agent:applyControlMode" collect="temperature zone" tone="primary" />
          </Row>
        </Stack>
      </Card>
      <Card title="Manual override" tone="warning" padding="lg">
        <Stack gap="md" align="stretch" justify="between" grow="true" padding="none">
          <Badge label="Maintenance" tone="warning" />
          <Text value="Hold changes for a bounded maintenance window, then return to schedule automatically." />
          <Text value="Last override ended cleanly at 20:00 with no schedule conflict." tone="muted" />
          <Modal triggerLabel="Plan override" title="Plan manual override" description="Confirm the window before changing the control schedule.">
            <Field name="overrideWindow" label="Window" value="18:00-20:00" />
            <Button label="Confirm override" action="agent:confirmOverride" collect="overrideWindow" tone="primary" />
          </Modal>
        </Stack>
      </Card>
    </Grid>
    <Card title="Schedule" tone="neutral" padding="md">
      <Table rows="data:scheduleRows" caption="Control rules" />
    </Card>
  </Screen>
</Facet>`,
    CONTROL_DATA,
  ),
  patternSource(
    "ecommerce-order-desk",
    "E-commerce order desk",
    "Commerce service page that mixes storefront-style merchandising with order operations and customer lookup.",
    [
      "Screen",
      "Nav",
      "ProductShowcase",
      "Gallery",
      "MediaCard",
      "StatStrip",
      "Field",
      "Alert",
      "CTA",
      "Table",
    ],
    `<Facet entry="preview">
  <Screen name="preview" maxWidth="full" padding="lg">
    <Nav brand="Citrus Supply" mark="CS" label="Fresh market desk" tone="neutral">
      <Button label="Orders" action="agent:openOrderDesk" tone="quiet" />
      <Button label="Customers" action="agent:openCustomers" tone="quiet" />
      <Button label="Pack now" action="agent:packNow" tone="primary" />
    </Nav>
    <ProductShowcase eyebrow="Today's drop" title="Fresh orders, packed with care." description="A commerce surface that starts like a storefront, then moves into order operations." meta="Market / pantry / studio" tone="accent">
      <Badge label="Store open" tone="positive" />
    </ProductShowcase>
    <Gallery title="Shop signals" columns="3" rhythm="even">
      <MediaCard title="Packed and ready" description="Orders moving cleanly through the morning queue." eyebrow="Fulfillment" meta="128" tone="brand" aspect="square" />
      <MediaCard title="Delayed shipments" description="Customer updates need one careful pass." eyebrow="Exceptions" meta="9" tone="accent" aspect="square" />
      <MediaCard title="Refund requests" description="Grouped for support review before close." eyebrow="Care" meta="3" tone="neutral" aspect="square" />
    </Gallery>
    <Grid columns="2" gap="md" collapse="true">
      <Section title="Find an order" description="Operational inputs sit inside the page without turning the page into a form." tone="neutral">
        <Stack gap="md" align="stretch" padding="none">
          <Field name="orderSearch" label="Order or customer" value="1009" placeholder="Order number" />
          <Button label="Open order" action="agent:openOrder" collect="orderSearch" tone="primary" />
        </Stack>
      </Section>
      <StatStrip title="Queue" columns="2" tone="neutral">
        <Metric label="Packed" value="128" />
        <Metric label="Delayed" value="9" />
      </StatStrip>
    </Grid>
    <Alert title="Exception queue" description="Delayed shipments and refund requests are ready for review." tone="warning">
      <Button label="Review exceptions" action="agent:reviewOrderExceptions" tone="secondary" />
    </Alert>
    <Section title="Recent orders" description="The table is supporting evidence, not the visual identity of the screen." tone="muted">
      <Table rows="data:orderRows" caption="Order queue" />
    </Section>
    <CTA title="Resolve the afternoon queue" description="Package customer updates and fulfillment notes in one pass." tone="inverse">
      <Button label="Prepare updates" action="agent:prepareOrderUpdates" tone="primary" />
    </CTA>
  </Screen>
</Facet>`,
    ORDER_DATA,
  ),
  patternSource(
    "booking-reservation-manager",
    "Booking reservation manager",
    "Reservation page with service positioning, a compact booking form, waitlist status and schedule data.",
    [
      "Screen",
      "Split",
      "Nav",
      "ProfileHeader",
      "Gallery",
      "MediaCard",
      "StatStrip",
      "Field",
      "Progress",
      "Table",
      "CTA",
    ],
    `<Facet entry="preview">
  <Screen name="preview" maxWidth="wide" padding="lg">
    <Nav brand="Studio North" mark="SN" label="Appointment house" tone="neutral">
      <Button label="Services" action="agent:viewServices" tone="quiet" />
      <Button label="Reserve" action="agent:createBooking" tone="primary" />
    </Nav>
    <ProfileHeader name="Reserve a quieter appointment." role="Studio North" summary="Service availability, booking intake and waitlist pressure in one polished customer-facing screen." align="start" tone="neutral">
      <Row gap="sm" align="center" justify="start" wrap="true">
        <Badge label="4 seats left" tone="warning" />
        <Button label="Create booking" action="agent:createBooking" tone="primary" />
      </Row>
    </ProfileHeader>
    <Gallery title="Service rhythm" columns="3" rhythm="even">
      <MediaCard title="Morning focus" description="First visits are grouped before lunch." eyebrow="Service" meta="AM" tone="brand" aspect="square" />
      <MediaCard title="Waitlist care" description="Deposit holds stay visible without crowding the page." eyebrow="Care" meta="Wait" tone="neutral" aspect="square" />
      <MediaCard title="Prepared handoff" description="Prep notes attach to each booking." eyebrow="Ops" meta="Ready" tone="accent" aspect="square" />
    </Gallery>
    <Split ratio="50:50" gap="md" align="stretch" collapse="true">
      <Section title="Add guest" description="The intake feels like part of the service, not a spreadsheet." tone="neutral">
        <Stack gap="md" align="stretch" padding="none">
          <Field name="guestName" label="Guest" value="Taylor" placeholder="Guest name" />
          <Field name="guestTime" label="Time" value="15:30" placeholder="Time" />
          <Button label="Hold appointment" action="agent:holdAppointment" collect="guestName guestTime" tone="primary" />
        </Stack>
      </Section>
      <StatStrip title="Waitlist pressure" columns="2" tone="neutral">
        <Progress label="Afternoon capacity" value="78" tone="warning" />
        <Progress label="Deposit confirmations" value="64" tone="accent" />
      </StatStrip>
    </Split>
    <Card title="Move flexible guests first" tone="warning" padding="lg">
        <Stack gap="md" align="stretch" padding="none">
          <Text value="Move flexible guests into the first cancellation before adding a new slot." tone="muted" />
        </Stack>
    </Card>
    <Section title="Today schedule" description="Schedule data remains inspectable after the service story is clear." tone="muted">
      <Table rows="data:bookingRows" caption="Today bookings" />
    </Section>
    <CTA title="Confirm the next guest" description="Check in Mina and prepare the room before the 10:30 appointment." tone="accent">
      <Button label="Check in" action="agent:checkInBooking" tone="primary" />
    </CTA>
  </Screen>
</Facet>`,
    BOOKING_DATA,
  ),
  patternSource(
    "subscription-billing-center",
    "Subscription billing center",
    "Billing service screen with revenue metrics, payment recovery, plan changes and invoice table data.",
    ["Screen", "Grid", "Card", "Metric", "Field", "Table", "Badge", "Button"],
    `<Facet entry="preview">
  <Screen name="preview" title="Billing center" maxWidth="full" padding="lg">
    <Row gap="md" align="center" justify="between" wrap="true">
      <Text value="Subscription billing status across invoices, failed payments and plan changes." tone="muted" />
      <Badge label="Billing cycle active" tone="neutral" />
    </Row>
    <Grid columns="2" gap="md" collapse="true">
      <Card tone="accent" padding="md">
        <Metric label="MRR" value="48200" unit="USD" />
      </Card>
      <Card tone="danger" padding="md">
        <Metric label="Failed" value="12" />
      </Card>
      <Card tone="neutral" padding="md">
        <Metric label="Trials" value="38" />
      </Card>
      <Card tone="success" padding="md">
        <Metric label="Recovered" value="9" />
      </Card>
    </Grid>
    <Grid columns="2" gap="md" collapse="true">
      <Card title="Payment recovery" tone="warning" padding="lg">
        <Stack gap="md" align="stretch" justify="between" grow="true" padding="none">
          <Badge label="Action needed" tone="warning" />
          <Text value="Failed invoices are ready for one recovery pass with account owners and next steps." />
          <Button label="Run recovery" action="agent:runPaymentRecovery" tone="secondary" />
        </Stack>
      </Card>
      <Card title="Plan change" tone="neutral" padding="lg">
        <Stack gap="md" align="stretch" padding="none">
          <Field name="accountName" label="Account" value="Northwind" placeholder="Account name" />
          <Field name="newPlan" label="Plan" value="Scale" placeholder="Plan" />
        </Stack>
      </Card>
    </Grid>
    <Card title="Invoices" tone="neutral" padding="md">
      <Table rows="data:invoiceRows" caption="Invoice status" />
    </Card>
  </Screen>
</Facet>`,
    BILLING_DATA,
  ),
  patternSource(
    "personal-finance-wallet",
    "Personal finance wallet",
    "Consumer wallet screen with an expressive hero, saving progress, action list and supporting transaction data.",
    [
      "Screen",
      "Nav",
      "VisualPanel",
      "MediaCard",
      "StatStrip",
      "LinkList",
      "Progress",
      "Alert",
      "Table",
      "Footer",
    ],
    `<Facet entry="preview">
  <Screen name="preview" maxWidth="wide" padding="lg">
    <Nav brand="Roundup" mark="R" label="Personal wallet" tone="inverse">
      <Button label="Wallet" action="agent:openWallet" tone="secondary" />
      <Button label="Adjust goal" action="agent:adjustSavingGoal" tone="primary" />
    </Nav>
    <VisualPanel title="Your saving goal" value="+18.4%" caption="This month is ahead of plan, with learning spend flagged for review." tone="inverse" scale="hero">
      <Badge label="Synced" tone="positive" />
    </VisualPanel>
    <StatStrip title="Goal progress" columns="3" tone="neutral">
      <Progress label="This week" value="78" tone="success" />
      <Progress label="This month" value="62" tone="accent" />
      <Progress label="This year" value="41" tone="neutral" />
    </StatStrip>
    <Grid columns="2" gap="md" collapse="true">
      <LinkList title="Wallet actions" density="comfortable">
        <Button label="Learn" action="agent:learnBudget" tone="secondary" />
        <Button label="Refer a friend" action="agent:referFriend" tone="secondary" />
        <Button label="Review spend" action="agent:reviewSpend" tone="secondary" />
      </LinkList>
      <MediaCard title="Balance snapshot" description="USD available after posted transactions." eyebrow="Wallet" meta="40,535" tone="brand" aspect="wide" />
    </Grid>
    <Alert title="Spending review" description="Learning and grocery spend rose this week. Review the latest transactions before Friday." tone="warning">
      <Button label="Review categories" action="agent:reviewSpendCategories" tone="secondary" />
    </Alert>
    <Section title="Recent activity" description="Transaction data supports the wallet story without taking over the whole page." tone="muted">
      <Table rows="data:transactionRows" caption="Recent activity" />
    </Section>
    <Footer title="Roundup" description="Spend, save and review in one calm wallet." tone="inverse">
      <Button label="Set next goal" action="agent:setNextGoal" tone="primary" />
    </Footer>
  </Screen>
</Facet>`,
    WALLET_DATA,
  ),
  patternSource(
    "resume-bio-profile",
    "Resume bio profile",
    "Personal bio and resume page with a link-in-bio structure, focused profile cards and supporting experience data.",
    [
      "Screen",
      "ProfileHeader",
      "Avatar",
      "SocialLinks",
      "Gallery",
      "MediaCard",
      "Timeline",
      "Testimonial",
      "Footer",
      "Table",
    ],
    `<Facet entry="preview">
  <Screen name="preview" maxWidth="medium" padding="lg">
    <ProfileHeader name="Alex Morgan" role="Available for product systems" summary="Product designer focused on brand systems, launch storytelling and AI-assisted product workflows." align="center" tone="neutral">
      <Avatar label="Alex Morgan" initials="AM" size="lg" tone="accent" />
      <SocialLinks title="Start here" align="center" density="comfortable" tone="neutral">
        <Button label="Contact" action="agent:contactProfile" tone="primary" />
        <Button label="Resume" action="agent:downloadResume" tone="secondary" />
        <Button label="Work" action="agent:viewSelectedWork" tone="secondary" />
        <Button label="Writing" action="agent:viewWriting" tone="secondary" />
      </SocialLinks>
    </ProfileHeader>
    <Gallery title="Selected directions" columns="3" rhythm="even">
      <MediaCard title="Brand systems" description="Identity, palette and launch rhythm." eyebrow="01" meta="Brand" tone="accent" aspect="square" />
      <MediaCard title="Product UI" description="Detail pages and operating workflows." eyebrow="02" meta="UI" tone="brand" aspect="square" />
      <MediaCard title="Direction" description="Concept decks and product narrative." eyebrow="03" meta="Story" tone="neutral" aspect="square" />
    </Gallery>
    <Testimonial quote="Alex can make a product surface feel clear before the first meeting is over." source="Northstar" role="Product team" tone="accent" />
    <Timeline title="Project rhythm" tone="accent">
      <Card title="Concept"><Text value="Clarify the story, audience and first screen." /></Card>
      <Card title="System"><Text value="Turn the story into tokens, sections and repeatable components." /></Card>
      <Card title="Ship"><Text value="Package the surface for product and launch teams." /></Card>
    </Timeline>
    <Section title="Experience data" description="A compact data block remains useful for scanning the resume." tone="muted">
      <Table rows="data:experienceRows" caption="Selected roles" />
    </Section>
    <Footer title="Need a calmer product system?" description="Send a short brief and get a focused design-system review." tone="inverse">
      <Button label="Start a project" action="agent:startProject" tone="primary" />
    </Footer>
  </Screen>
</Facet>`,
    PROFILE_DATA,
  ),
]);

function patternSource(
  id: string,
  label: string,
  description: string,
  roles: readonly string[],
  source: string,
  data: DataModel,
): ScreenPatternSource {
  return Object.freeze({
    id,
    label,
    description,
    roles: Object.freeze([...roles]),
    source,
    data,
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
  if (!parsed.ok) {
    return reject(source, "parse", parsed.error.code, parsed.error.cause);
  }

  const validated = validateAuthorMarkup(parsed.ast, catalog, source.data);
  if (!validated.ok) {
    return reject(source, "validate", validated.error.code, validated.error.cause);
  }

  const targetNodeId = screenNodeId(validated.document);
  if (targetNodeId === null) {
    return reject(source, "target", "target-screen-missing", "No entry screen exists.");
  }

  const fixture: ComponentPreviewFixture = Object.freeze({
    tag: "Screen",
    source: source.source,
    data: source.data,
    document: validated.document as ComponentDocument,
    targetNodeId,
  });

  return Object.freeze({ ok: true, tag: "Screen", fixture });
}

function screenNodeId(document: ComponentDocument): string | null {
  for (const [nodeId, node] of Object.entries(document.nodes)) {
    if (node.tag === "Screen") return nodeId;
  }
  return null;
}

export function screenPatterns(catalog: FacetCatalog = DEFAULT_CATALOG): readonly ScreenPattern[] {
  return Object.freeze(
    SCREEN_PATTERN_SOURCES.map((source) =>
      Object.freeze({
        id: source.id,
        label: source.label,
        description: source.description,
        roles: source.roles,
        result: fixtureFor(source, catalog),
      }),
    ),
  );
}
