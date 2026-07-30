# @facet/reference-agent

Reference LLM brain for Facet. It composes a provider adapter, a prompt kit, the
nine provider-neutral Facet tools, bounded transcript compaction, and a
deterministic stub fixture.

Role: **Agents**.

```bash
npm install @facet/reference-agent @facet/runtime
```

Use this package when you want Facet's maintained model loop instead of writing
your own provider integration. It is still only the agent brain: the runtime,
server, renderer, and browser transport stay in their own packages.

```ts
import { createReferenceAgent, resolveProvider } from "@facet/reference-agent";
import { MemorySink } from "@facet/runtime";

const provider = resolveProvider({ provider: "openai" }, process.env);
if (provider === null) {
  throw new Error("Set OPENAI_API_KEY before starting the reference agent.");
}

export const agent = createReferenceAgent({
  provider,
  sink: new MemorySink(),
  agentId: "reference",
});
```

## Tool loop

The reference agent exposes exactly nine Facet tools to the provider:

- `render_page`, `insert_subtree`, `replace_subtree`, `update_node`, and
  `remove_subtree` for visible component-markup mutations;
- `read_component_spec`, `read_screen`, and `read_data` for bounded discovery;
  and
- `publish_data` for host-authorized data publication.

There is no conversation tool. Provider prose becomes the turn's optional
assistant message, and the runtime enforces the zero-or-one message rule.

Every tool result is structured with outcome, visibility, issues, and next
action. Rejected markup, unknown components, undeclared props, invalid
references, stale revisions, and bounded-data failures are observations for the
next model step, not partial UI commits.

## Prompt and discovery

The prompt starts from `FACET_PROMPT_KIT`, the current screen summary, data
summary, and compact component index. The model can read a full component spec
only through `read_component_spec`, keeping catalog discovery progressive and
bounded. Component implementations and theme values remain host-side trusted
inputs; they are never executable model output.

## Context compaction

Pass a `summaryStore` to enable model-assisted cross-turn compaction. In-turn
transcript folding is character-budgeted and deterministic fallback is used
when summarization throws, times out, produces invalid output, or cannot save
enough space. Compaction never makes a visitor turn fail.

## Provider adapters

The package includes OpenAI and Anthropic adapters plus `resolveProvider`.
Provider calls accept an optional abort signal, bounded retry policy, and model
override. Keys remain in provider request headers and are never logged,
persisted, or sent to the browser.

## Deterministic fixture

`createStubAgent` and `STUB_MARKUP` are deterministic test fixtures for local
gates. They author default-catalog component markup and avoid network, time, and
randomness so repeated runs are stable.

## Read next

- [Agent Integration](https://github.com/getfacet/facet/blob/main/docs/AGENT-INTEGRATION.md)
- [Agent Tool Result Contract](https://github.com/getfacet/facet/blob/main/docs/AGENT-TOOL-RESULT-CONTRACT.md)
- [Architecture](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md)
