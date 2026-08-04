import { DEFAULT_CATALOG } from "@facet/assets";
import { parseMarkup, validateAuthorMarkup } from "@facet/core";
import type { ComponentDocument, ComponentSpec, DataModel, FacetCatalog } from "@facet/core";

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

const PREVIEW_DATA: DataModel = Object.freeze({
  previewRows: Object.freeze([
    Object.freeze({ component: "Text", state: "Ready" }),
    Object.freeze({ component: "Table", state: "Bound" }),
  ]),
});

const PREVIEW_SOURCE_BY_TAG: Readonly<Record<string, string>> = Object.freeze({
  Screen: `<Facet entry="preview">
  <Screen name="preview" title="Preview screen" maxWidth="medium" padding="md">
    <Text value="A screen frames one named view." />
  </Screen>
</Facet>`,
  AppShell: `<Facet entry="preview">
  <Screen name="preview" padding="md" maxWidth="wide">
    <AppShell gap="md">
      <SideNav title="Facet" label="Workspace" tone="inverse">
        <SideNavItem label="Overview" action="agent:overview" mark="01" active="true" />
        <SideNavItem label="Assets" action="agent:assets" mark="02" />
      </SideNav>
      <Stack gap="md" align="stretch" padding="none">
        <Card title="Main content" tone="neutral" padding="md">
          <Text value="The shell owns rail and main layout." />
        </Card>
      </Stack>
    </AppShell>
  </Screen>
</Facet>`,
  Stack: `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <Stack gap="sm" align="stretch" padding="sm">
      <Text value="Stack item one" />
      <Badge label="Second" tone="neutral" />
    </Stack>
  </Screen>
</Facet>`,
  Row: `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <Row gap="sm" align="center" justify="between" wrap="true">
      <Text value="Inline summary" />
      <Button label="Stay here" action="nav:preview" />
    </Row>
  </Screen>
</Facet>`,
  Split: `<Facet entry="preview">
  <Screen name="preview" padding="md" maxWidth="wide">
    <Split ratio="60:40" gap="md" align="stretch">
      <Hero title="Split layout" subtitle="A larger story column paired with a focused action." tone="accent" />
      <Card title="Book a call" tone="neutral" padding="md">
        <Field name="email" label="Email" placeholder="you@example.com" />
        <Button label="Request" action="agent:request" tone="primary" />
      </Card>
    </Split>
  </Screen>
</Facet>`,
  Grid: `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <Grid columns="3" gap="sm" collapse="true">
      <Metric label="Open" value="18" />
      <Metric label="Closed" value="42" />
      <Metric label="SLA" value="97" unit="%" />
    </Grid>
  </Screen>
</Facet>`,
  Modal: `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <Modal triggerLabel="Open details" title="Preview modal" description="Facet owns the modal frame.">
      <Text value="Modal content stays inside the trusted frame." />
    </Modal>
  </Screen>
</Facet>`,
  Card: `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <Card title="Preview card" tone="accent" padding="md">
      <Text value="Cards group related content." />
      <Badge label="Live" tone="positive" />
    </Card>
  </Screen>
</Facet>`,
  Empty: `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <Empty title="No records" description="Add content to fill this space.">
      <Button label="Refresh" action="agent:refresh" />
    </Empty>
  </Screen>
</Facet>`,
  LogoMark: `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <LogoMark label="Solar Pop Studio" mark="SP" size="lg" tone="brand" shape="soft" />
  </Screen>
</Facet>`,
  Nav: `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <Nav brand="Solar Pop Studio" mark="SP" label="Launch desk" tone="neutral">
      <Button label="Work" action="agent:work" tone="quiet" />
      <Button label="Contact" action="agent:contact" tone="primary" />
    </Nav>
  </Screen>
</Facet>`,
  SideNav: `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <SideNav title="Facet" label="Workspace" tone="neutral">
      <SideNavItem label="Overview" action="agent:overview" mark="01" active="true" />
      <SideNavItem label="Assets" action="agent:assets" mark="02" />
      <SideNavItem label="Settings" action="agent:settings" mark="03" meta="New" />
    </SideNav>
  </Screen>
</Facet>`,
  SideNavItem: `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <SideNav title="Facet" label="Workspace" tone="neutral">
      <SideNavItem label="Overview" action="agent:overview" mark="01" active="true" />
      <SideNavItem label="Assets" action="agent:assets" mark="02" meta="12" />
    </SideNav>
  </Screen>
</Facet>`,
  Section: `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <Section title="Preview section" description="A named content area with its own rhythm." tone="muted">
      <Text value="Section content stays in normal document flow." />
    </Section>
  </Screen>
</Facet>`,
  Divider: `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <Text value="Before the divider" />
    <Divider label="Next" emphasis="strong" />
    <Text value="After the divider" />
  </Screen>
</Facet>`,
  Hero: `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <Hero title="Launch-ready surface" subtitle="A first impression with clear action." eyebrow="Preview" tone="accent">
      <Button label="Start" action="agent:start" tone="primary" />
    </Hero>
  </Screen>
</Facet>`,
  Avatar: `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <Avatar label="Alex Morgan" initials="AM" size="lg" tone="accent" />
  </Screen>
</Facet>`,
  ProfileHeader: `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <ProfileHeader name="Alex Morgan" role="Product systems" summary="A personal surface with identity, proof and action." tone="accent">
      <Avatar label="Alex Morgan" initials="AM" size="lg" tone="accent" />
      <Button label="Contact" action="agent:contact" tone="primary" />
    </ProfileHeader>
  </Screen>
</Facet>`,
  ProductShowcase: `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <ProductShowcase title="Northstar Audio" description="A product page can open with story, proof and a graphic panel." eyebrow="Launch" meta="20 hour battery" tone="inverse">
      <Button label="Open brief" action="agent:brief" tone="primary" />
    </ProductShowcase>
  </Screen>
</Facet>`,
  VisualPanel: `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <VisualPanel title="Creative concept deck" value="78%" caption="A graphic block without external media." tone="accent" scale="hero" />
  </Screen>
</Facet>`,
  MediaCard: `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <MediaCard title="Citrus launch" description="An image-like product card without external media." eyebrow="Work" meta="01" tone="accent" aspect="square">
      <Badge label="Featured" tone="positive" />
    </MediaCard>
  </Screen>
</Facet>`,
  LinkList: `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <LinkList title="Profile links" density="comfortable">
      <Button label="Portfolio" action="agent:portfolio" />
      <Button label="Resume" action="agent:resume" />
    </LinkList>
  </Screen>
</Facet>`,
  SocialLinks: `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <SocialLinks title="Find me" align="center" density="comfortable" tone="neutral">
      <Button label="Portfolio" action="agent:portfolio" tone="secondary" />
      <Button label="Writing" action="agent:writing" tone="secondary" />
      <Button label="Contact" action="agent:contact" tone="primary" />
    </SocialLinks>
  </Screen>
</Facet>`,
  FeatureList: `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <FeatureList title="Launch pieces" columns="2">
      <Card title="Identity"><Text value="Palette, type and core rhythm." /></Card>
      <Card title="Proof"><Text value="Cards, quotes and conversion copy." /></Card>
    </FeatureList>
  </Screen>
</Facet>`,
  StatStrip: `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <StatStrip title="Launch numbers" columns="3" tone="accent">
      <Metric label="Projects" value="42" />
      <Metric label="Conversion" value="18" unit="%" />
      <Metric label="Markets" value="5" />
    </StatStrip>
  </Screen>
</Facet>`,
  Gallery: `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <Gallery title="Selected work" columns="3" rhythm="editorial">
      <VisualPanel title="Citrus launch" caption="Campaign" tone="accent" />
      <VisualPanel title="Blue system" caption="Product" tone="brand" />
      <VisualPanel title="Studio story" caption="Editorial" tone="warm" />
    </Gallery>
  </Screen>
</Facet>`,
  Testimonial: `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <Testimonial quote="The surface finally felt like one product." source="Mina Park" role="Founder" tone="accent" />
  </Screen>
</Facet>`,
  Timeline: `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <Timeline title="Milestones" tone="accent">
      <Card title="Concept"><Text value="Name the product point of view." /></Card>
      <Card title="Launch"><Text value="Publish a focused surface." /></Card>
    </Timeline>
  </Screen>
</Facet>`,
  CTA: `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <CTA title="Build the next screen" description="A focused action band closes the section." align="center" tone="accent">
      <Button label="Create brief" action="agent:createBrief" tone="primary" />
    </CTA>
  </Screen>
</Facet>`,
  Alert: `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <Alert title="Review needed" description="One important message stays visible in the flow." tone="warning" />
  </Screen>
</Facet>`,
  Progress: `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <Progress label="Launch target" value="74" tone="accent" />
  </Screen>
</Facet>`,
  Footer: `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <Footer title="Facet" description="Default assets for expressive safe UI." tone="inverse">
      <Button label="Start" action="agent:start" tone="primary" />
    </Footer>
  </Screen>
</Facet>`,
  Text: `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <Text value="Readable body copy for the preview." variant="body" tone="default" />
  </Screen>
</Facet>`,
  Metric: `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <Metric label="Conversion" value="42" unit="%" />
  </Screen>
</Facet>`,
  Badge: `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <Badge label="Healthy" tone="positive" />
  </Screen>
</Facet>`,
  Button: `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <Button label="Go to preview" action="nav:preview" tone="primary" />
  </Screen>
</Facet>`,
  Field: `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <Field name="email" label="Email" value="hello@example.com" placeholder="you@example.com" secret="false" />
  </Screen>
</Facet>`,
  Table: `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <Table rows="data:previewRows" caption="Preview component states" />
  </Screen>
</Facet>`,
});

interface PreviewSpecimenSource {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly source: string;
  readonly recipeTokens: readonly string[];
  readonly display: "standard" | "wide";
}

const PREVIEW_SPECIMENS_BY_TAG: Readonly<Record<string, readonly PreviewSpecimenSource[]>> =
  Object.freeze({
    Screen: Object.freeze([
      specimenSource(
        "screen-medium",
        "Medium page",
        "Default reading width, title scale, background, text and content gap.",
        `<Facet entry="preview">
  <Screen name="preview" title="Overview" maxWidth="medium" padding="md">
    <Text value="A medium screen frames ordinary product content." />
    <Card title="Surface" tone="accent" padding="md">
      <Text value="Content sits inside the screen rhythm." />
    </Card>
  </Screen>
</Facet>`,
        ["background", "text", "contentGap", "titleColor", "titleFontSize"],
      ),
      specimenSource(
        "screen-narrow",
        "Narrow page",
        "A tighter reading column with smaller outer padding.",
        `<Facet entry="preview">
  <Screen name="preview" title="Narrow" maxWidth="narrow" padding="sm">
    <Text value="Focused flows keep a shorter line length." />
  </Screen>
</Facet>`,
        ["background", "text", "contentGap"],
      ),
      specimenSource(
        "screen-full",
        "Full surface",
        "A full-width frame for dashboard-like layouts.",
        `<Facet entry="preview">
  <Screen name="preview" title="Dashboard" maxWidth="full" padding="lg">
    <Grid columns="3" gap="sm" collapse="true">
      <Metric label="Open" value="18" />
      <Metric label="Closed" value="42" />
      <Metric label="SLA" value="97" unit="%" />
    </Grid>
  </Screen>
</Facet>`,
        ["background", "text", "contentGap", "titleFontSize"],
      ),
    ]),
    AppShell: Object.freeze([
      specimenSource(
        "app-shell-start",
        "Start rail",
        "A stable app frame with rail first and main content filling the rest.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm" maxWidth="wide">
    <AppShell gap="md" sidebar="start">
      <SideNav title="Facet" label="Workspace" tone="inverse">
        <SideNavItem label="Overview" action="agent:overview" mark="01" active="true" />
        <SideNavItem label="Assets" action="agent:assets" mark="02" />
      </SideNav>
      <Card title="Main content" tone="neutral" padding="md">
        <Text value="Main content stretches beside the rail." />
      </Card>
    </AppShell>
  </Screen>
</Facet>`,
        ["defaultGap", "mainMinWidth", "minHeight"],
        "wide",
      ),
      specimenSource(
        "app-shell-end",
        "End rail",
        "The same app frame with the rail visually placed after main content.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm" maxWidth="wide">
    <AppShell gap="md" sidebar="end" collapse="true">
      <SideNav title="Review" label="Queue" tone="neutral">
        <SideNavItem label="Open" action="agent:open" mark="01" active="true" />
        <SideNavItem label="Done" action="agent:done" mark="02" />
      </SideNav>
      <Card title="Review queue" tone="accent" padding="md">
        <Text value="Rail order can change without authored positioning." />
      </Card>
    </AppShell>
  </Screen>
</Facet>`,
        ["defaultGap", "mainMinWidth", "minHeight"],
        "wide",
      ),
    ]),
    Stack: Object.freeze([
      specimenSource(
        "stack-gap-sm",
        "Small gap",
        "Vertical reading order with compact space.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <Stack gap="sm" align="stretch" padding="sm">
      <Text value="First item" />
      <Text value="Second item" tone="muted" />
      <Badge label="Ready" tone="positive" />
    </Stack>
  </Screen>
</Facet>`,
        ["defaultGap", "padding"],
      ),
      specimenSource(
        "stack-gap-lg",
        "Large gap",
        "The same children with a looser rhythm.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <Stack gap="lg" align="stretch" padding="sm">
      <Text value="First item" />
      <Text value="Second item" tone="muted" />
      <Badge label="Ready" tone="positive" />
    </Stack>
  </Screen>
</Facet>`,
        ["defaultGap", "padding"],
      ),
      specimenSource(
        "stack-center",
        "Centered stack",
        "Cross-axis alignment changes how children occupy the container.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <Stack gap="sm" align="center" padding="md">
      <Text value="Centered copy" />
      <Button label="Action" action="agent:preview" tone="secondary" />
    </Stack>
  </Screen>
</Facet>`,
        ["defaultGap", "padding"],
      ),
    ]),
    Row: Object.freeze([
      specimenSource(
        "row-start",
        "Start",
        "Inline content starts at the leading edge.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <Row gap="sm" align="center" justify="start" wrap="true">
      <Badge label="Draft" tone="neutral" />
      <Text value="Invoice summary" />
    </Row>
  </Screen>
</Facet>`,
        ["defaultGap", "padding"],
      ),
      specimenSource(
        "row-between",
        "Between",
        "Space distributes between label and action.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <Row gap="sm" align="center" justify="between" wrap="true">
      <Text value="Invoice summary" />
      <Button label="Open" action="agent:open" tone="secondary" />
    </Row>
  </Screen>
</Facet>`,
        ["defaultGap", "padding"],
      ),
      specimenSource(
        "row-baseline",
        "Baseline",
        "Mixed text sizes align by their text baseline.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <Row gap="sm" align="baseline" justify="start" wrap="true">
      <Text value="42" variant="title" />
      <Text value="active accounts" tone="muted" />
    </Row>
  </Screen>
</Facet>`,
        ["defaultGap", "padding"],
      ),
    ]),
    Split: Object.freeze([
      specimenSource(
        "split-60-40",
        "60 / 40",
        "A story column paired with a narrower action column.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm" maxWidth="wide">
    <Split ratio="60:40" gap="md" align="stretch">
      <Hero title="Service launch" subtitle="The larger column carries the primary story." tone="accent" />
      <Card title="Request access" tone="neutral" padding="md">
        <Field name="email" label="Email" placeholder="you@example.com" />
        <Button label="Join" action="agent:join" tone="primary" />
      </Card>
    </Split>
  </Screen>
</Facet>`,
        ["defaultGap", "minColumnWidth"],
      ),
      specimenSource(
        "split-40-60",
        "40 / 60",
        "A compact summary beside a larger detail area.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm" maxWidth="wide">
    <Split ratio="40:60" gap="md" align="center">
      <Card title="Summary" tone="accent" padding="md">
        <Metric label="Ready" value="78" unit="%" />
      </Card>
      <ProductShowcase title="Launch dossier" description="The larger side can carry product or editorial detail." tone="neutral" />
    </Split>
  </Screen>
</Facet>`,
        ["defaultGap", "minColumnWidth"],
      ),
    ]),
    Grid: Object.freeze([
      specimenSource(
        "grid-two",
        "Two columns",
        "A compact repeated metric layout.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <Grid columns="2" gap="sm" collapse="true">
      <Metric label="Open" value="18" />
      <Metric label="Closed" value="42" />
    </Grid>
  </Screen>
</Facet>`,
        ["defaultGap", "minColumnWidth"],
      ),
      specimenSource(
        "grid-three",
        "Three columns",
        "The default dashboard rhythm.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <Grid columns="3" gap="sm" collapse="true">
      <Metric label="Open" value="18" />
      <Metric label="Closed" value="42" />
      <Metric label="SLA" value="97" unit="%" />
    </Grid>
  </Screen>
</Facet>`,
        ["defaultGap", "minColumnWidth"],
      ),
      specimenSource(
        "grid-four",
        "Four columns",
        "Denser repeated content, still bounded by the min column.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <Grid columns="4" gap="xs" collapse="true">
      <Badge label="A" tone="neutral" />
      <Badge label="B" tone="positive" />
      <Badge label="C" tone="warning" />
      <Badge label="D" tone="danger" />
    </Grid>
  </Screen>
</Facet>`,
        ["defaultGap", "minColumnWidth"],
      ),
    ]),
    Modal: Object.freeze([
      specimenSource(
        "modal-trigger",
        "Trigger",
        "The authored component supplies the trigger and content; the frame is Facet-owned.",
        `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <Modal triggerLabel="Open details" title="Preview modal" description="Facet owns the modal frame.">
      <Text value="Modal content stays inside the trusted frame." />
    </Modal>
  </Screen>
</Facet>`,
        ["triggerBg", "triggerText", "frameBg", "frameRadius", "framePadding"],
      ),
    ]),
    Card: Object.freeze(
      ["neutral", "accent", "success", "warning", "danger"].map((tone) =>
        specimenSource(
          `card-${tone}`,
          titleCase(tone),
          `Card tone="${tone}" uses the same surface recipe with a different semantic edge.`,
          `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <Card title="${titleCase(tone)} card" tone="${tone}" padding="md">
      <Text value="A bounded surface groups related content." />
    </Card>
  </Screen>
</Facet>`,
          ["background", "text", "border", "radius", "shadow", "padding"],
        ),
      ),
    ),
    Empty: Object.freeze([
      specimenSource(
        "empty-basic",
        "Basic empty",
        "The quiet empty surface with title and description.",
        `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <Empty title="No records" description="Add content to fill this space." />
  </Screen>
</Facet>`,
        ["background", "text", "border", "radius", "padding", "titleColor"],
      ),
      specimenSource(
        "empty-action",
        "Empty with action",
        "The same empty surface carrying a next step as children.",
        `<Facet entry="preview">
  <Screen name="preview" padding="md">
    <Empty title="No records" description="Add content to fill this space.">
      <Button label="Refresh" action="agent:refresh" tone="primary" />
    </Empty>
  </Screen>
</Facet>`,
        ["background", "text", "border", "radius", "padding", "titleColor"],
      ),
    ]),
    LogoMark: Object.freeze(
      ["neutral", "brand", "accent", "inverse"].map((tone) =>
        specimenSource(
          `logo-mark-${tone}`,
          titleCase(tone),
          `LogoMark tone="${tone}" gives a brand or personal mark without external media.`,
          `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <LogoMark label="Solar Pop Studio" mark="SP" size="lg" tone="${tone}" shape="soft" />
  </Screen>
</Facet>`,
          ["background", "text", "border", "radius", "size", "fontSize", "fontWeight"],
        ),
      ),
    ),
    Nav: Object.freeze([
      specimenSource(
        "nav-mark",
        "With mark",
        "Brand mark, label and actions share the same navigation rhythm.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <Nav brand="Citrus Supply" mark="CS" label="Fresh market desk" tone="neutral">
      <Button label="Orders" action="agent:orders" tone="quiet" />
      <Button label="Pack now" action="agent:pack" tone="primary" />
    </Nav>
  </Screen>
</Facet>`,
        ["background", "text", "mutedText", "paddingInline", "markBg", "markText", "markSize"],
      ),
      specimenSource(
        "nav-inverse",
        "Inverse",
        "A high-contrast top bar for product or app surfaces.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <Nav brand="Roundup" mark="R" label="Wallet" tone="inverse">
      <Button label="Wallet" action="agent:wallet" tone="secondary" />
      <Button label="Adjust goal" action="agent:goal" tone="primary" />
    </Nav>
  </Screen>
</Facet>`,
        ["background", "text", "mutedText", "border", "radius", "paddingInline"],
      ),
    ]),
    SideNav: Object.freeze([
      specimenSource(
        "side-nav-neutral",
        "Neutral rail",
        "A vertical app navigation rail for workspace screens.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <SideNav title="Facet" label="Workspace" tone="neutral">
      <SideNavItem label="Overview" action="agent:overview" mark="01" active="true" />
      <SideNavItem label="Assets" action="agent:assets" mark="02" />
      <SideNavItem label="Settings" action="agent:settings" mark="03" meta="New" />
    </SideNav>
  </Screen>
</Facet>`,
        ["background", "text", "mutedText", "border", "radius", "padding", "gap"],
      ),
      specimenSource(
        "side-nav-inverse",
        "Inverse rail",
        "The same vertical structure with high contrast.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <SideNav title="Northstar" label="Launch" tone="inverse">
      <SideNavItem label="Specs" action="agent:specs" mark="S" active="true" />
      <SideNavItem label="Review" action="agent:review" mark="R" meta="3" />
    </SideNav>
  </Screen>
</Facet>`,
        ["background", "text", "mutedText", "border", "radius", "titleFontSize"],
      ),
    ]),
    SideNavItem: Object.freeze([
      specimenSource(
        "side-nav-item-active",
        "Active row",
        "A full-width navigation row with selected state and optional count.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <SideNav title="Facet" label="Workspace" tone="neutral">
      <SideNavItem label="Overview" action="agent:overview" mark="01" active="true" meta="12" />
      <SideNavItem label="Assets" action="agent:assets" mark="02" />
    </SideNav>
  </Screen>
</Facet>`,
        ["activeBg", "activeText", "activeBorder", "paddingInline", "markSize"],
      ),
      specimenSource(
        "side-nav-item-inverse",
        "Inverse row",
        "The same navigation row inside a high-contrast rail.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <SideNav title="Revenue" label="Command" tone="inverse">
      <SideNavItem label="Overview" action="agent:overview" mark="01" active="true" />
      <SideNavItem label="Forecast" action="agent:forecast" mark="02" meta="Live" />
    </SideNav>
  </Screen>
</Facet>`,
        ["inverseText", "inverseActiveBg", "inverseActiveBorder", "radius", "gap"],
      ),
    ]),
    Section: Object.freeze([
      specimenSource(
        "section-neutral",
        "Neutral",
        "A named section keeps related content together without adding heavy emphasis.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <Section title="Plan" description="Grouped content with heading and copy." tone="neutral">
      <Text value="The section recipe controls the band, border and heading scale." />
    </Section>
  </Screen>
</Facet>`,
        ["background", "text", "mutedText", "border", "radius", "padding", "titleFontSize"],
      ),
      specimenSource(
        "section-muted",
        "Muted",
        "A quieter section can hold secondary context.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <Section title="Notes" description="Secondary supporting detail." tone="muted">
      <Text value="Muted sections lower the visual pressure without changing markup shape." />
    </Section>
  </Screen>
</Facet>`,
        ["background", "text", "mutedText", "border", "radius", "padding"],
      ),
    ]),
    Divider: Object.freeze([
      specimenSource(
        "divider-subtle",
        "Subtle",
        "A quiet rule separates neighboring sections.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <Text value="Above" />
    <Divider label="Next" emphasis="subtle" />
    <Text value="Below" />
  </Screen>
</Facet>`,
        ["color", "text", "gap"],
      ),
      specimenSource(
        "divider-strong",
        "Strong",
        "A stronger divider creates a clearer chapter break.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <Text value="Before" />
    <Divider label="Chapter" emphasis="strong" />
    <Text value="After" />
  </Screen>
</Facet>`,
        ["color", "text", "gap"],
      ),
    ]),
    Hero: Object.freeze([
      specimenSource(
        "hero-neutral",
        "Neutral",
        "A calm first impression with headline, supporting copy and action.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <Hero title="Product surface" subtitle="A clear opening statement." eyebrow="Preview" tone="neutral">
      <Button label="Continue" action="agent:continue" />
    </Hero>
  </Screen>
</Facet>`,
        ["background", "text", "mutedText", "border", "radius", "padding", "titleFontSize"],
      ),
      specimenSource(
        "hero-accent",
        "Accent",
        "The same structure with stronger brand emphasis.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <Hero title="Launch system" subtitle="Brand-led page rhythm." eyebrow="Preview" tone="accent">
      <Button label="Start" action="agent:start" tone="primary" />
    </Hero>
  </Screen>
</Facet>`,
        ["background", "text", "mutedText", "border", "radius", "padding", "subtitleFontSize"],
      ),
      specimenSource(
        "hero-inverse",
        "Inverse",
        "A high-contrast hero for stronger first-viewport signal.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <Hero title="Bold opening" subtitle="Inverse tone changes the mood without custom CSS." eyebrow="Preview" tone="inverse">
      <Button label="Open" action="agent:open" tone="primary" />
    </Hero>
  </Screen>
</Facet>`,
        ["background", "text", "mutedText", "border", "radius", "padding"],
      ),
    ]),
    Avatar: Object.freeze(
      ["sm", "md", "lg"].map((size) =>
        specimenSource(
          `avatar-${size}`,
          titleCase(size),
          `Avatar size="${size}" uses the same identity recipe with a different scale.`,
          `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <Avatar label="Alex Morgan" initials="AM" size="${size}" tone="accent" />
  </Screen>
</Facet>`,
          ["background", "text", "border", "radius", "size", "fontSize", "fontWeight"],
        ),
      ),
    ),
    LinkList: Object.freeze([
      specimenSource(
        "link-list-comfortable",
        "Comfortable",
        "A link-in-bio action stack with ordinary spacing.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <LinkList title="Selected links" density="comfortable">
      <Button label="Portfolio" action="agent:portfolio" />
      <Button label="Resume" action="agent:resume" />
      <Button label="Contact" action="agent:contact" />
    </LinkList>
  </Screen>
</Facet>`,
        ["background", "border", "radius", "padding", "gap", "titleColor"],
      ),
      specimenSource(
        "link-list-compact",
        "Compact",
        "A tighter action stack for denser surfaces.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <LinkList title="Actions" density="compact">
      <Button label="Open" action="agent:open" />
      <Button label="Share" action="agent:share" />
    </LinkList>
  </Screen>
</Facet>`,
        ["background", "border", "radius", "padding", "gap"],
      ),
    ]),
    MediaCard: Object.freeze([
      specimenSource(
        "media-card-wide",
        "Wide",
        "An image-like editorial card with a wide visual area.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <MediaCard title="Citrus launch" description="Launch artwork and campaign proof without external media." eyebrow="Work" meta="01" tone="accent" aspect="wide" />
  </Screen>
</Facet>`,
        ["background", "text", "mutedText", "border", "radius", "visualBg", "visualText"],
      ),
      specimenSource(
        "media-card-square",
        "Square",
        "A product, portfolio or social tile ratio.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <MediaCard title="Blue system" description="A compact product story card." eyebrow="Product" meta="02" tone="brand" aspect="square" />
  </Screen>
</Facet>`,
        ["background", "text", "mutedText", "padding", "titleFontSize"],
      ),
      specimenSource(
        "media-card-tall",
        "Tall",
        "A taller editorial frame for portfolio and campaign pages.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <MediaCard title="Studio story" description="A vertical card changes page rhythm." eyebrow="Editorial" meta="03" tone="neutral" aspect="tall" />
  </Screen>
</Facet>`,
        ["background", "text", "mutedText", "border", "radius"],
      ),
    ]),
    SocialLinks: Object.freeze([
      specimenSource(
        "social-links-centered",
        "Centered",
        "A compact centered profile action group.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <SocialLinks title="Find me" align="center" density="comfortable" tone="neutral">
      <Button label="Portfolio" action="agent:portfolio" tone="secondary" />
      <Button label="Writing" action="agent:writing" tone="secondary" />
      <Button label="Contact" action="agent:contact" tone="primary" />
    </SocialLinks>
  </Screen>
</Facet>`,
        ["background", "text", "border", "radius", "padding", "gap", "titleColor"],
      ),
      specimenSource(
        "social-links-inverse",
        "Inverse",
        "A high-contrast social link group for footers and bio pages.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <SocialLinks title="Social" align="start" density="compact" tone="inverse">
      <Button label="LinkedIn" action="agent:linkedin" tone="secondary" />
      <Button label="Portfolio" action="agent:portfolio" tone="secondary" />
      <Button label="Email" action="agent:email" tone="primary" />
    </SocialLinks>
  </Screen>
</Facet>`,
        ["background", "text", "border", "radius", "padding", "gap"],
      ),
    ]),
    FeatureList: Object.freeze([
      specimenSource(
        "feature-list-two",
        "Two columns",
        "Even repeated proof cards with section-level title.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <FeatureList title="Features" columns="2">
      <Card title="Identity"><Text value="Palette and type." /></Card>
      <Card title="Launch"><Text value="Story and proof." /></Card>
    </FeatureList>
  </Screen>
</Facet>`,
        ["gap", "markerBg", "markerText", "titleColor"],
      ),
      specimenSource(
        "feature-list-three",
        "Three columns",
        "A wider marketing or service list.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <FeatureList title="Services" columns="3">
      <Card title="Brand"><Text value="Direction." /></Card>
      <Card title="Product"><Text value="Surface." /></Card>
      <Card title="Launch"><Text value="Proof." /></Card>
    </FeatureList>
  </Screen>
</Facet>`,
        ["gap", "markerBg", "markerText", "titleColor"],
      ),
    ]),
    Testimonial: Object.freeze([
      specimenSource(
        "testimonial-neutral",
        "Neutral",
        "Proof that sits with the page rather than dominating it.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <Testimonial quote="The system made the page feel coherent." source="Mina Park" role="Founder" tone="neutral" />
  </Screen>
</Facet>`,
        ["background", "text", "sourceText", "border", "radius", "padding", "quoteFontSize"],
      ),
      specimenSource(
        "testimonial-accent",
        "Accent",
        "A featured proof point with stronger emphasis.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <Testimonial quote="The first screen finally had a point of view." source="Romi K." role="Marketing lead" tone="accent" />
  </Screen>
</Facet>`,
        ["background", "text", "sourceText", "border", "radius", "padding"],
      ),
    ]),
    CTA: Object.freeze([
      specimenSource(
        "cta-start",
        "Start aligned",
        "A clear call to action at the end of a section.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <CTA title="Create the brief" description="Send the next event to the agent." align="start" tone="accent">
      <Button label="Create" action="agent:create" tone="primary" />
    </CTA>
  </Screen>
</Facet>`,
        ["background", "text", "mutedText", "border", "radius", "padding", "titleFontSize"],
      ),
      specimenSource(
        "cta-center",
        "Centered",
        "A centered CTA works for landing-page endings.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <CTA title="Ready to launch" description="Close with one clear next step." align="center" tone="neutral">
      <Button label="Start" action="agent:start" tone="primary" />
    </CTA>
  </Screen>
</Facet>`,
        ["background", "text", "mutedText", "border", "radius", "padding"],
      ),
    ]),
    Alert: Object.freeze(
      ["info", "success", "warning", "danger"].map((tone) =>
        specimenSource(
          `alert-${tone}`,
          titleCase(tone),
          `Alert tone="${tone}" maps the message to semantic status color.`,
          `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <Alert title="${titleCase(tone)} alert" description="A short visible message in the flow." tone="${tone}" />
  </Screen>
</Facet>`,
          ["background", "text", "border", "radius", "padding", "titleColor"],
        ),
      ),
    ),
    Progress: Object.freeze(
      ["accent", "success", "warning"].map((tone, index) =>
        specimenSource(
          `progress-${tone}`,
          titleCase(tone),
          `Progress tone="${tone}" keeps the same bounded 0-100 contract.`,
          `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <Progress label="${titleCase(tone)} progress" value="${[72, 86, 38][index]}" tone="${tone}" />
  </Screen>
</Facet>`,
          ["labelText", "valueText", "track", "fill", "radius", "height"],
        ),
      ),
    ),
    Text: Object.freeze(
      ["title", "heading", "body", "caption"].map((variant) =>
        specimenSource(
          `text-${variant}`,
          titleCase(variant),
          `Text variant="${variant}" maps to a type scale role.`,
          `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <Text value="${titleCase(variant)} text" variant="${variant}" tone="default" />
    <Text value="Muted secondary copy" variant="${variant}" tone="muted" />
  </Screen>
</Facet>`,
          textRecipeTokens(variant),
        ),
      ),
    ),
    Metric: Object.freeze([
      specimenSource(
        "metric-count",
        "Count",
        "Headline number, label and optional unit.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <Metric label="Accounts" value="42000" />
  </Screen>
</Facet>`,
        ["valueColor", "valueFontSize", "valueFontWeight", "labelColor", "labelFontSize"],
      ),
      specimenSource(
        "metric-percent",
        "Percent",
        "A unit sits on the same baseline as the number.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <Metric label="Conversion" value="42" unit="%" />
  </Screen>
</Facet>`,
        ["valueColor", "valueFontSize", "valueFontWeight", "labelColor", "labelFontSize"],
      ),
    ]),
    Badge: Object.freeze(
      ["neutral", "positive", "warning", "danger"].map((tone) =>
        specimenSource(
          `badge-${tone}`,
          titleCase(tone),
          `Badge tone="${tone}" uses shared status semantics.`,
          `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <Badge label="${titleCase(tone)}" tone="${tone}" />
  </Screen>
</Facet>`,
          ["background", "text", "border", "radius", "paddingInline", "paddingBlock"],
        ),
      ),
    ),
    Button: Object.freeze(
      ["primary", "secondary", "quiet"].map((tone) =>
        specimenSource(
          `button-${tone}`,
          titleCase(tone),
          `Button tone="${tone}" selects its recipe colors while sharing shape and focus tokens.`,
          `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <Button label="${titleCase(tone)} action" action="agent:${tone}" tone="${tone}" />
  </Screen>
</Facet>`,
          buttonRecipeTokens(tone),
        ),
      ),
    ),
    Field: Object.freeze([
      specimenSource(
        "field-value",
        "With value",
        "Label, input text, border and radius as one collectable control.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <Field name="email" label="Email" value="hello@example.com" placeholder="you@example.com" secret="false" />
  </Screen>
</Facet>`,
        ["labelText", "inputBg", "inputText", "inputBorder", "inputRadius", "inputPadding"],
      ),
      specimenSource(
        "field-placeholder",
        "Placeholder",
        "An empty control shows the placeholder inside the same input recipe.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <Field name="email" label="Email" placeholder="you@example.com" secret="false" />
  </Screen>
</Facet>`,
        ["labelText", "inputBg", "inputText", "inputBorder", "inputRadius", "inputPadding"],
      ),
      specimenSource(
        "field-secret",
        "Secret",
        "The same field recipe masks its value when secret is true.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <Field name="password" label="Password" value="hidden value" secret="true" />
  </Screen>
</Facet>`,
        ["labelText", "inputBg", "inputText", "inputBorder", "inputRadius", "inputPadding"],
      ),
    ]),
    Table: Object.freeze([
      specimenSource(
        "table-records",
        "Records",
        "Header, cell padding, row border and caption over bound rows.",
        `<Facet entry="preview">
  <Screen name="preview" padding="sm">
    <Table rows="data:previewRows" caption="Preview component states" />
  </Screen>
</Facet>`,
        ["captionText", "text", "headerText", "headerBg", "rowBorder", "cellPadding"],
      ),
    ]),
  });

function reject(
  tag: string,
  source: string | null,
  phase: ComponentPreviewFixtureErrorPhase,
  code: string,
  detail: string,
): ComponentPreviewFixtureResult {
  return Object.freeze({
    ok: false,
    tag,
    source,
    data: PREVIEW_DATA,
    error: Object.freeze({ phase, code, detail }),
  });
}

function specimenSource(
  id: string,
  label: string,
  description: string,
  source: string,
  recipeTokens: readonly string[],
  display: "standard" | "wide" = "standard",
): PreviewSpecimenSource {
  return Object.freeze({
    id,
    label,
    description,
    source,
    recipeTokens: Object.freeze(recipeTokens),
    display,
  });
}

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function textRecipeTokens(variant: string): readonly string[] {
  if (variant === "title") {
    return Object.freeze(["titleFontSize", "titleFontWeight", "defaultText", "mutedText"]);
  }
  if (variant === "heading") {
    return Object.freeze(["headingFontSize", "headingFontWeight", "defaultText", "mutedText"]);
  }
  if (variant === "body") {
    return Object.freeze(["bodyFontSize", "defaultText", "mutedText"]);
  }
  return Object.freeze(["captionFontSize", "defaultText", "mutedText"]);
}

function buttonRecipeTokens(tone: string): readonly string[] {
  if (tone === "primary") {
    return Object.freeze([
      "primaryBg",
      "primaryText",
      "primaryBorder",
      "radius",
      "paddingInline",
      "paddingBlock",
      "focusRing",
    ]);
  }
  if (tone === "secondary") {
    return Object.freeze([
      "secondaryBg",
      "secondaryText",
      "secondaryBorder",
      "radius",
      "paddingInline",
      "paddingBlock",
      "focusRing",
    ]);
  }
  return Object.freeze(["quietText", "radius", "paddingInline", "paddingBlock", "focusRing"]);
}

function targetNodeId(document: ComponentDocument, tag: string): string | null {
  for (const [nodeId, node] of Object.entries(document.nodes)) {
    if (node.tag === tag) {
      return nodeId;
    }
  }
  return null;
}

function buildFixtureFromSource(
  spec: ComponentSpec,
  catalog: FacetCatalog,
  source: string,
): ComponentPreviewFixtureResult {
  const parsed = parseMarkup(source);
  if (!parsed.ok) {
    return reject(spec.tag, source, "parse", parsed.error.code, parsed.error.cause);
  }

  const validated = validateAuthorMarkup(parsed.ast, catalog, PREVIEW_DATA);
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

function buildFixture(spec: ComponentSpec, catalog: FacetCatalog): ComponentPreviewFixtureResult {
  const source = PREVIEW_SOURCE_BY_TAG[spec.tag];
  if (source === undefined) {
    return reject(spec.tag, null, "missing", "missing-preview-source", "No preview source exists.");
  }
  return buildFixtureFromSource(spec, catalog, source);
}

export function deriveComponentPreviewFixtures(
  catalog: FacetCatalog = DEFAULT_CATALOG,
): readonly ComponentPreviewFixtureResult[] {
  return Object.freeze(catalog.components.map((spec) => buildFixture(spec, catalog)));
}

export function previewFixtureForTag(
  tag: string,
  catalog: FacetCatalog = DEFAULT_CATALOG,
): ComponentPreviewFixtureResult {
  const spec = catalog.components.find((candidate) => candidate.tag === tag);
  if (spec === undefined) {
    return reject(tag, null, "missing", "missing-catalog-tag", "No catalog spec exists.");
  }
  return buildFixture(spec, catalog);
}

export function previewSpecimensForTag(
  tag: string,
  catalog: FacetCatalog = DEFAULT_CATALOG,
): readonly ComponentPreviewSpecimen[] {
  const spec = catalog.components.find((candidate) => candidate.tag === tag);
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

  const sources = PREVIEW_SPECIMENS_BY_TAG[tag];
  if (sources === undefined || sources.length === 0) {
    return Object.freeze([
      Object.freeze({
        id: "default",
        label: "Default",
        description: "Default component fixture.",
        display: "standard",
        recipeTokens: Object.freeze(Object.keys(spec.themeRecipe?.tokens ?? {})),
        result: buildFixture(spec, catalog),
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
        recipeTokens: source.recipeTokens,
        result: buildFixtureFromSource(spec, catalog, source.source),
      }),
    ),
  );
}
