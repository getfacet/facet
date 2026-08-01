/**
 * The deterministic stub brain (spec Decision 6) — the fixture agent behind
 * local tests and the quickstart deterministic E2E gate.
 *
 * The fixture authors the same component markup every time, never executable
 * code and never the retired tree model. It has no network, randomness, or
 * clock read, so the same event sequence produces deep-equal turn text.
 */
import { type VisitorEvent, type FacetToolSession } from "@facet/core";

type CollectedEntry = VisitorEvent["collect"][string];

interface RuntimeStubContext {
  readonly event: VisitorEvent;
  readonly session: FacetToolSession;
}

export interface StubAgent {
  run(context: RuntimeStubContext): Promise<{ readonly text: string }>;
}

/**
 * The fixture page as authored markup: a home form, a submit event that collects
 * exactly `name email`, and a second screen reached through `nav:about`.
 */
export const STUB_MARKUP = `<Facet entry="home">
  <Screen name="home" title="Facet quickstart">
    <Stack gap="lg">
      <Text value="Facet quickstart — stub stage" variant="title" />
      <Card title="Signup">
        <Stack gap="md">
          <Text value="Tell us who should receive the launch plan." />
          <Field name="name" label="Name" />
          <Field name="email" label="Email" />
          <Row gap="sm">
            <Button label="Send" action="agent:submit" collect="name email" tone="primary" />
            <Button label="About" action="nav:about" tone="secondary" />
          </Row>
        </Stack>
      </Card>
    </Stack>
  </Screen>
  <Screen name="about" title="About this stub">
    <Stack gap="md">
      <Text value="About this stub" variant="heading" />
      <Text value="This deterministic fixture proves the quickstart can render component markup." />
      <Button label="Home" action="nav:home" />
    </Stack>
  </Screen>
</Facet>`;

function describeCollectedEntry(entry: CollectedEntry): string {
  switch (entry.kind) {
    case "value":
      return entry.value;
    case "omitted_sensitive":
      return "omitted_sensitive";
    case "collect_source_unavailable":
      return "collect_source_unavailable";
  }
}

function describeEvent(event: VisitorEvent): string {
  const pairs = Object.keys(event.collect)
    .sort()
    .map(
      (key) =>
        `${key}=${describeCollectedEntry(event.collect[key] ?? { kind: "collect_source_unavailable" })}`,
    );
  if (pairs.length === 0) {
    return event.arg === undefined
      ? `stub: ${event.eventName}`
      : `stub: ${event.eventName} ${event.arg}`;
  }
  return [`${event.eventName}:`, ...pairs].join(" ");
}

export function createStubAgent(): StubAgent {
  return Object.freeze({
    async run({ event, session }: RuntimeStubContext) {
      if (session.document === null) {
        await session.applyAuthorMutation(STUB_MARKUP);
      }
      return { text: describeEvent(event) };
    },
  });
}
