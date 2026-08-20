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

export const SERVICE_PREVIEW_OPERATIONS: readonly ServicePreviewSource[] = Object.freeze([
  servicePreviewSource(
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
      "Text",
      "ActionBar",
      "Button",
    ],
    `<Facet entry="preview">
  <Screen name="preview" maxWidth="full" padding="md">
    <AppShell gap="lg" collapse="true"><Navigation slot="navigation" label="Operations" orientation="vertical" tone="inverse"><Text slot="brand" value="Launch Ops" variant="heading" /><NavigationItem slot="items" label="Board" action="nav:preview" active="true" /><NavigationItem slot="items" label="Archive" action="agent:archive" /></Navigation><Stack slot="main" gap="lg"><Header title="Launch operations" description="Move each work item through review without losing owner context." /><Board title="Current cycle"><BoardColumn slot="columns" title="Ready" tone="accent"><Card title="Creative brief"><Badge label="Mina" /><Text value="Final copy and proof are attached." /></Card></BoardColumn><BoardColumn slot="columns" title="Review"><Card title="Partner proof"><Badge label="Today" tone="warning" /><Text value="Legal approval is the final dependency." /></Card></BoardColumn><BoardColumn slot="columns" title="Done"><Card title="Release notes"><Badge label="Approved" tone="positive" /></Card></BoardColumn></Board><ActionBar align="between" tone="accent"><Text slot="context" value="2 items selected" /><Button slot="actions" label="Assign owner" action="agent:assign" /><Button slot="actions" label="Move to review" action="agent:move" tone="primary" /></ActionBar></Stack></AppShell>
  </Screen>
</Facet>`,
  ),
  servicePreviewSource(
    "education",
    "Education",
    "Learning schedule with session selection, preparation context, and course actions.",
    [
      "Screen",
      "Header",
      "Calendar",
      "Collection",
      "ItemCard",
      "Badge",
      "Text",
      "Select",
      "ActionBar",
      "Button",
    ],
    `<Facet entry="preview">
  <Screen name="preview" maxWidth="wide" padding="lg">
    <Header eyebrow="Learning plan" title="Week of August 21" description="Review the course schedule and prepare each upcoming session." />
    <Calendar name="event" title="Upcoming lessons" events="data:events" view="agenda" />
    <Collection title="Preparation queue" layout="list" columns="1"><Select slot="controls" name="owner" label="Instructor" options="data:options" /><ItemCard slot="items" title="Discovery workshop" description="Confirm learning goals and attendees." meta="Friday, 10:00"><Badge slot="content" label="Ready" tone="positive" /></ItemCard><ItemCard slot="items" title="Design review" description="Attach the latest study notes." meta="Saturday, 14:00"><Badge slot="content" label="Needs notes" tone="warning" /></ItemCard></Collection>
    <ActionBar align="between"><Text slot="context" value="Select a lesson to manage its preparation." /><Button slot="actions" label="Create lesson" action="agent:createEvent" tone="primary" /></ActionBar>
  </Screen>
</Facet>`,
  ),
  servicePreviewSource(
    "knowledge",
    "Knowledge",
    "Knowledge surface with expert identity, evidence messages, question input, and follow-up actions.",
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
    <Header title="Launch knowledge base" description="Evidence review with Mina Park" tone="neutral"><Icon slot="leading" name="message" label="Knowledge discussion" size="lg" tone="accent" /><Badge slot="meta" label="Expert online" tone="positive" /></Header>
    <Alert title="Evidence preserved" description="Questions include the current source context and revision." tone="info" />
    <MessageThread messages="data:messages" />
    <Form layout="stacked"><Field slot="fields" name="message" label="Reply" placeholder="Write a message" /><Button slot="actions" label="Send" action="agent:sendMessage" collect="message" tone="primary" /></Form>
    <ActionGroup title="Conversation actions" layout="row"><Button label="Add note" action="agent:addNote" /><Button label="Escalate" action="agent:escalate" tone="quiet" /></ActionGroup>
  </Screen>
</Facet>`,
  ),
  servicePreviewSource(
    "finance",
    "Finance",
    "Financial request and outcome surface with structured fields, guidance, empty state, and a clear result.",
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
      "Badge",
      "Text",
      "Empty",
      "Modal",
    ],
    `<Facet entry="preview">
  <Screen name="preview" maxWidth="wide" padding="lg">
    <Header eyebrow="Finance request" title="Create a budget review" description="Collect the minimum financial context, then show the submitted outcome." tone="accent" />
    <Split ratio="60:40" gap="lg" collapse="true"><Form slot="primary" layout="stacked"><Field slot="fields" name="project" label="Project" placeholder="Northstar launch" /><Select slot="fields" name="channel" label="Primary channel" options="data:options" /><ChoiceGroup slot="fields" name="reviewers" label="Reviewers" options="data:options" value="data:selections" /><Toggle slot="fields" name="urgent" label="Urgent review" /><Button slot="actions" label="Submit request" action="agent:submitRequest" collect="project channel reviewers urgent" tone="primary" /></Form><Result slot="secondary" title="Draft ready" description="The request has all required fields." tone="success"><Badge slot="summary" label="Complete" tone="positive" /><Text slot="details" value="Reference LF-2048" /><Button slot="actions" label="Open draft" action="agent:openDraft" /></Result></Split>
    <Divider label="Supporting states" />
    <Empty title="No previous requests" description="Submitted reviews will appear here."><Button slot="actions" label="Refresh" action="agent:refresh" /></Empty>
    <Modal triggerLabel="What should I include?" title="Request guidance"><Text slot="body" value="Name the audience, decision, and desired delivery date." /><Button slot="actions" label="Got it" action="agent:closeHelp" /></Modal>
  </Screen>
</Facet>`,
  ),
]);
