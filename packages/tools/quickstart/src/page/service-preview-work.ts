import { SERVICE_PREVIEW_DATA } from "./service-preview-discovery.js";
import type { ServicePreviewSource } from "./service-preview-discovery.js";

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

export const SERVICE_PREVIEW_WORK: readonly ServicePreviewSource[] = Object.freeze([
  servicePreviewSource(
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
  servicePreviewSource(
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
  servicePreviewSource(
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
  servicePreviewSource(
    "collaboration",
    "Collaboration",
    "Shared workspace setup with progress, a team checklist, preferences, and one continuation action.",
    [
      "Screen",
      "Header",
      "Progress",
      "List",
      "Text",
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
    <Header eyebrow="Team setup" title="Prepare the shared workspace" description="Choose the defaults collaborators need on day one." tone="accent" />
    <Progress label="Setup progress" value="66" tone="accent" />
    <List title="Before you continue" marker="number"><Text value="Name the workspace" /><Text value="Choose a primary channel" /><Text value="Confirm notification preferences" /></List>
    <Form layout="stacked"><Field slot="fields" name="workspace" label="Workspace name" placeholder="Northstar" /><Select slot="fields" name="channel" label="Primary channel" options="data:options" /><ChoiceGroup slot="fields" name="updates" label="Update channels" options="data:options" value="data:selections" /><Toggle slot="fields" name="digest" label="Send a weekly digest" value="true" /><Button slot="actions" label="Continue" action="agent:continueSetup" collect="workspace channel updates digest" tone="primary" /></Form>
    <ActionBar align="between"><Text slot="context" value="You can change these settings later." /><Button slot="actions" label="Save draft" action="agent:saveDraft" tone="quiet" /></ActionBar>
  </Screen>
</Facet>`,
  ),
]);
