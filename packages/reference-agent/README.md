# @facet/reference-agent

Reference Facet brain: provider adapters, prompt/tool definitions, the
streaming tool-loop agent, and the deterministic keyless stub.

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

## Exports

- `createReferenceAgent` plus compatibility alias `createQuickstartAgent`.
- `ReferenceAgentOptions` plus compatibility alias `QuickstartAgentOptions`.
- `ReferenceProvider` plus compatibility alias `QuickstartProvider`.
- Provider helpers: `resolveProvider`, `createOpenAiProvider`,
  `createAnthropicProvider`, model constants, and provider turn/tool types.
- Prompt/tools: `DEFAULT_GUIDE`, `buildSystem`, `TOOLS`, `describeEvent`,
  `buildInitialMessages`, `PromptAssets`.
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
