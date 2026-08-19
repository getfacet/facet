# @facet/agent-tools

Provider-neutral Facet tools for a host building its own LLM loop. The package
turns model tool calls into validated component-markup mutations, bounded data
publication, screen/data reads, and structured observations.

Role: **Agents**.

```bash
npm install @facet/agent-tools
```

Use this package when the host already owns provider calls, prompts outside the
Facet contract, conversation memory, authorization, and business logic. It does
not select a model provider, contact a Facet server, or execute product-domain
work.

## Tool surface

`FACET_TOOL_SPECS` describes the exact nine tools in the provider-neutral
surface:

- read the current screen;
- read one authorized data path;
- read one component spec;
- publish bounded data;
- render a complete page;
- insert a subtree;
- replace a subtree;
- update one node; and
- remove a subtree.

`FACET_TOOL_NAMES` pins the same list for host dispatch. `FACET_PROMPT_KIT`
contains the reusable contract text a host can include in its system prompt. It
teaches the complete first-page envelope, active-catalog discovery, generated-id
ownership, non-empty user-facing completion, and result-driven repair without
prescribing a service or component composition. When a provider supports
multiple tool calls in one response, the kit directs it to request independent
`read_component_spec` calls together; the host may still execute those reads
serially and enforce every per-call admission bound.
The kit also teaches composition-first authoring: decide spatial relationships,
use only the layout components that express them, then fill the structure.
`formatCatalogIndex` renders the compact catalog as Screen root, Layout,
Surface, Content, Interaction, and Unclassified groups. These groups guide
discovery only; they do not require a layout wrapper.

```ts check-docs
import {
  FACET_PROMPT_KIT,
  FACET_TOOL_NAMES,
  FACET_TOOL_SPECS,
  createMarkupBuffer,
} from "@facet/agent-tools";
import type { FacetToolName, FacetToolSpec } from "@facet/agent-tools";

const names: readonly FacetToolName[] = FACET_TOOL_NAMES;
const specs: readonly FacetToolSpec[] = FACET_TOOL_SPECS;
const buffer = createMarkupBuffer();
const chunk = buffer.append(
  `<Facet entry="home"><Screen name="home"><Text value="Hi" /></Screen></Facet>`,
);

console.log(FACET_PROMPT_KIT, names.length, specs.length, chunk.ready.length);
```

## Execution

`createMarkupBuffer` lets a streaming provider accumulate markup until a full
parseable document is available. `executeFacetTool` runs one validated tool call
against a `FacetToolSession`, `buildTurnObservation` shapes the response the
model should see next, and `formatCatalogIndex` turns its component index into
grouped prompt text.

Strict authoring is atomic. Unknown tags, undeclared props, invalid scalar
values, disallowed references, unsafe markup syntax, and invalid tree operations
return a rejected observation and leave the shadow stage unchanged. Successful
visible mutations return patch messages for runtime delivery.

## Host boundaries

Facet tools are UI-in/UI-out only. Product data is fetched and authorized by the
host, then published into Facet as bounded data. Visitor events are forwarded
explicitly to the host agent loop. Browser-side domain fetches, arbitrary local
actions, executable UI code, and open-ended component props stay outside this
package.

## Documentation

- [Agent Integration](https://github.com/getfacet/facet/blob/main/docs/AGENT-INTEGRATION.md) —
  complete provider-neutral loop.
- [Agent Tool Result Contract](https://github.com/getfacet/facet/blob/main/docs/AGENT-TOOL-RESULT-CONTRACT.md) —
  exact observations and recovery behavior.
- [Architecture](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md) —
  Facet stage and safety invariants.
