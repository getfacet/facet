# Agent Integration

Facet does not provide the agent's brain. A host can use any provider or rules
engine that can read observations, call the nine Facet tools, and return one
turn outcome to runtime.

## Responsibilities

The host agent loop owns:

- provider requests and retries;
- conversation memory and summary policy;
- product-domain tools and authorization;
- tool-call dispatch;
- deciding what UI should be shown; and
- deciding what assistant text, if any, should be sent.

Facet owns only the safe UI surface: component-markup authoring, bounded data
publication, screen/data reads, event forwarding, patch folding, and revisions.

## Tool loop

`@facet/agent-tools` gives a provider-neutral loop these primitives:

- `FACET_PROMPT_KIT` — reusable prompt contract text;
- `FACET_TOOL_SPECS` — the closed nine-tool schema list;
- `createMarkupBuffer` — streaming markup accumulation;
- `executeFacetTool` — one tool-call executor against a `FacetToolSession`; and
- `buildTurnObservation` — bounded state summary for the next model step.

```ts check-docs
import {
  FACET_TOOL_SPECS,
  buildTurnObservation,
  executeFacetTool,
} from "@facet/agent-tools";
import type { FacetToolSession } from "@facet/agent-tools";

declare const session: FacetToolSession;

const result = await executeFacetTool("read_screen", { screen: "home" }, session);
const observation = buildTurnObservation(session);

console.log(FACET_TOOL_SPECS.length, result.ok, observation.stageRevision);
```

The model should receive every tool result as data. If a mutation returns an
author error, ask the model to repair that one reported fault and retry.
Before first-page rendering, use the compact catalog roles and semantic signals
to choose a small intended visible component set, then read each unknown
contract. A provider that supports multiple tool calls can return those
independent `read_component_spec` requests in one tool-only response; the host
remains responsible for bounded admission and should execute independent reads
concurrently.

## Rendering a page

`render_page` accepts a complete component-markup document. Targeted mutation
tools require an existing page and a generated node id from a prior read. All
successful visible mutations produce runtime patch messages; after initial page
creation, document changes still travel as patches.

The complete document has exactly one `<Facet entry="...">` root. Its direct
children are uniquely named `<Screen name="...">` roots, and `entry` matches one
of those names. A valid service-neutral minimum is
`<Facet entry="main"><Screen name="main" /></Facet>`. Registered components go
inside screens, and Facet owns generated node ids.

That minimum demonstrates the envelope grammar only. It is not a completed
user-facing page: read the specs for the visible component tags you intend to
use, and put task-relevant visible components inside every requested screen.

## Publishing data

`publish_data` writes one bounded JSON value at a named-key path. The host must
fetch, authorize, and project the data before publishing. The agent can then
bind declared component props to `data:` paths or read bounded projections with
`read_data`.

## Visitor events

Trusted components report interactions to the renderer. `nav:` stays
browser-local. `agent:` becomes a validated event with event name, source node,
screen, stage revision, optional argument, and the requested collection fields.

Each collected field is explicit: value, omitted sensitive, or source
unavailable. The agent never infers a missing field from an absent key.

## Conversation

Conversation output is separate from the tool roster. A turn may return one
assistant message alongside stage patches, but no UI tool sends chat text and no
component prop becomes an arbitrary message channel.

## Provider guidance

Keep the model prompt focused on the active catalog and current screen. Let the
model discover component details only when needed. Preserve rejected tool output
verbatim enough for repair, and never claim completion until the runtime accepts
the turn.
