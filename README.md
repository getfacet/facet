<h1 align="center">Facet</h1>

<p align="center">
  <strong>The UI layer for LLMs and agents — interfaces your model draws.</strong>
</p>

Facet is a TypeScript framework for UI a language model renders itself. An agent
authors a declarative Facet Document from 11 native Bricks and a closed style
vocabulary; Facet validates it, stores it per visitor, sends live changes as RFC
6902 patches, and renders it safely. The agent never emits raw HTML, JavaScript,
or CSS.

> **Status: pre-1.0.** Facet currently makes intentional hard cuts instead of
> carrying compatibility layers. Check the
> [migration guide](docs/STYLE-SYSTEM-MIGRATION.md) before upgrading an older
> integration.

## Try it

Facet requires Node.js 20 or newer. With an OpenAI or Anthropic API key:

```bash
OPENAI_API_KEY=sk-… npx --package=@facet/quickstart -- facet-quickstart
```

Open `http://localhost:5292`. The command starts the reference brain, runtime,
transport, and React page together. See [Getting Started](docs/GETTING-STARTED.md)
for provider flags and supported integration paths.

## Why Facet

Returning only prose cannot build a live interface. Generating open-ended web
code gives a model too much authority and is easy to break. Facet keeps the
useful middle:

- the agent can compose and update a real interface;
- Core accepts only known Bricks, fields, actions, and style choices;
- an operator-owned Theme controls concrete design values;
- the browser receives patches after initial state, not generated application
  code; and
- stale or malformed render input degrades safely instead of crashing the page.

Facet is the UI contract and runtime, not the agent's brain or a hosted platform.
Your application still owns model selection, business logic, identity,
authorization, billing, rate limits, and deployment policy.

## How it works

```text
visitor event → Runtime → agent brain → validated messages
                                      ├─ chat text
                                      └─ RFC 6902 patches → Renderer → live UI
```

The Runtime owns the Facet Document for each agent/visitor pair. The browser
owns local view state such as the current screen, toggles, table sort, viewport,
and color mode. Keeping those writers separate avoids patch races.

Two invariants define the system:

1. **Declarative, closed authoring.** Agents emit only Core-defined Bricks and
   their Brick-owned style vocabulary—never raw HTML, JavaScript, CSS, arbitrary
   style keys, or absolute positioning.
2. **Patches only after initial state.** Server and client fold the same RFC 6902
   operations with the same pure patch logic. The renderer skips invalid or
   dangling remnants and keeps valid siblings visible.

The essential nouns are small:

- A **Facet Document** is the agent-authored tree and named data.
- A **Brick** is one of 11 native nodes: `box`, `text`, `media`, `input`,
  `richtext`, `table`, `chart`, `list`, `keyValue`, `progress`, or `loading`.
  Only `box` contains other Bricks.
- A **Theme** is operator configuration: concrete token definitions, one default
  per Brick, and optional same-Brick Presets.
- A **Pattern** is a validated worked tree an agent may read and adapt. It is not
  a node kind or an insertion mechanism.
- A **Patch** is the only stage mutation sent after initial state; the
  **Runtime** stores and applies it, and the **Renderer** displays the safe
  result.

For styling terminology and asset ownership, use the
[Design System guide](docs/DESIGN-SYSTEM.md). For complete data-flow and safety
behavior, use [Architecture](docs/ARCHITECTURE.md).

## Choose an integration path

“Primary entrypoint” means where to begin, not a one-package installation. Most
paths intentionally compose several roles.

| You want to… | Primary entrypoint | Collaborators | Next guide |
| --- | --- | --- | --- |
| Try the complete reference stack | `facet-quickstart` | Reference brain, runtime, server/client, React | [Try it first](docs/GETTING-STARTED.md#try-it-first) |
| Embed the live stage in React | `@facet/react` | A `FacetTransport`, usually `@facet/client`; a runtime and brain behind it | [Embed the React renderer](docs/GETTING-STARTED.md#embed-the-react-renderer) |
| Author an in-process rules/code agent | `@facet/agent` | `@facet/runtime`; optionally the reference server/client | [Use an in-process agent](docs/GETTING-STARTED.md#use-an-in-process-agent) |
| Build your own LLM tool loop | `@facet/agent-tools` | Your provider/history policy plus runtime or transport handoff | [Agent Integration](docs/AGENT-INTEGRATION.md) |
| Run an agent outside the server process | `@facet/agent-client` | A `FacetAgent` and the reference `@facet/server` agent channel | [Connect an external agent](docs/GETTING-STARTED.md#connect-an-external-agent) |
| Use the bundled Theme and Patterns | `@facet/assets` | Runtime asset loading, renderer, and agent discovery as needed | [Use the default assets](docs/DESIGN-SYSTEM.md#use-the-default-assets) |
| Use the native reference browser transport | `@facet/server` + `@facet/client` | `@facet/runtime`, a brain, and a renderer | [Run the reference transport](docs/GETTING-STARTED.md#run-the-reference-transport) |
| Carry Facet through AG-UI | `@facet/ag-ui` | `@facet/runtime` and a Facet renderer | [`@facet/ag-ui`](packages/adapters/ag-ui/README.md) |
| Persist stages, events, assets, and summaries in Postgres | `@facet/store-postgres` | `pg`, `@facet/runtime`, and usually a server | [`@facet/store-postgres`](packages/adapters/store-postgres/README.md) |

Do not confuse the three agent-facing packages: `@facet/agent-tools` is the LLM
tool mechanism, `@facet/agent` is a TypeScript stage-authoring SDK, and
`@facet/agent-client` is a network connection for an external agent.

## Package roles

Source packages are grouped by one primary role:

- **Core** — contract, patch/runtime mechanics, stores, and default asset data.
- **Renderers** — turn a validated Facet tree into platform UI.
- **Agents** — author stage changes in code or through provider-neutral tools.
- **Adapters** — connect browsers, external agents, protocols, and persistence.
- **Tools** — runnable Quickstart, CLI, and local coding-agent bridge.

See [Package Boundaries](docs/PACKAGE-BOUNDARIES.md) for the complete package map,
dependencies, public subpaths, and reference/official/optional labels.

## Read next

- [Getting Started](docs/GETTING-STARTED.md) — supported adoption paths and
  known-good wiring.
- [Design System](docs/DESIGN-SYSTEM.md) — Documents, Brick-owned styles,
  tokens, Themes, Presets, Patterns, and custom assets.
- [Agent Integration](docs/AGENT-INTEGRATION.md) — a custom LLM loop,
  progressive discovery, strict execution, and retries.
- [Architecture](docs/ARCHITECTURE.md) — invariants, ownership, validation,
  patch flow, and renderer behavior.
- [Package Boundaries](docs/PACKAGE-BOUNDARIES.md) — package responsibilities and
  deployment limits.
- [Security](SECURITY.md) — the reference transport trust model.

Repository contributors should also read [AGENTS.md](AGENTS.md) and
[CONTRIBUTING.md](CONTRIBUTING.md).

## Development

```bash
pnpm install
pnpm verify
pnpm package:smoke
```

## License

MIT
