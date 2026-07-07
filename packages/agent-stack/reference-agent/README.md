# @facet/reference-agent

Reference Facet brain: provider adapters, prompt policy, the streaming tool-loop
agent, and the deterministic keyless stub.

The reusable Facet stage tool layer lives in `@facet/agent-tools`. That package
owns the canonical tool specs, `executeStageTool`, inspection helpers, result
types, and local stage-shadow helpers without choosing a provider or reference
policy. `@facet/reference-agent` consumes those shared tools and adds the
OpenAI/Anthropic adapters, system prompt, bounded tool loop, and stub.

`@facet/quickstart` composes this package for `facet-quickstart` provider and
`--stub` modes. You can import it directly when you want the reference agent
without the quickstart CLI/server/page wrapper.

```ts
import { MemorySink } from "@facet/runtime";
import { createReferenceAgent, resolveProvider } from "@facet/reference-agent";

const provider = resolveProvider({}, process.env);
if (provider === null) throw new Error("Set OPENAI_API_KEY or ANTHROPIC_API_KEY");

const agent = createReferenceAgent({
  provider,
  sink: new MemorySink(),
  agentId: "reference",
  guide: "# My Facet page",
});
```

## Tool Layer

Use `@facet/agent-tools` directly when you are writing your own provider loop
and only need the safe Facet stage tool surface:

```ts
import { FACET_STAGE_TOOL_SPECS, executeStageTool } from "@facet/agent-tools";
```

Use `@facet/reference-agent` when you want Facet's runnable reference brain. For
compatibility, this package re-exports the stage tool specs and related types
from `@facet/agent-tools` through its prompt module.

## Exports

- `createReferenceAgent` plus compatibility alias `createQuickstartAgent`.
- `ReferenceAgentOptions` plus compatibility alias `QuickstartAgentOptions`.
- `ReferenceProvider` plus compatibility alias `QuickstartProvider`.
- Provider helpers: `resolveProvider`, `createOpenAiProvider`,
  `createAnthropicProvider`, model constants, and provider turn/tool types.
- Prompt/tool compatibility: `DEFAULT_GUIDE`, `buildSystem`, `TOOLS`,
  `describeEvent`, `buildInitialMessages`, `PromptAssets`, and the Facet stage
  tool types re-exported from `@facet/agent-tools`.
- Stub: `createStubAgent`, `STUB_TREE`.

## Provider keys

Provider keys are read from environment variables by `resolveProvider`:

| Provider | Key env var | Default model |
| --- | --- | --- |
| `openai` | `OPENAI_API_KEY` | `gpt-5.4-mini` |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-5` |

An explicit provider flag requires its matching key. Without a flag, OpenAI wins
when both keys are present, then Anthropic, then `null`.

Keys are never logged, persisted, or placed in the browser bundle. They travel
only in the provider request auth header. The adapters use raw `fetch`; no
provider SDK dependency is bundled here.

## Stub

`createStubAgent()` is deterministic: no network, no randomness, and no clock
reads. It renders `STUB_TREE` on visit, echoes messages into the stage and chat,
responds to `theme <name>`, and echoes collected tap fields in sorted order.

Use it for keyless local tests and the quickstart live-test Tier 1 path.
