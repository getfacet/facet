# Facet

Facet is a TypeScript framework for UI that a language model renders itself.
Agents emit declarative component markup. Facet parses it as data, validates it
against an immutable host catalog, applies only authorized RFC 6902 patches, and
renders through trusted React components registered by the host.

Agents never emit executable UI code. Hosts keep control of product data,
business actions, provider choice, authorization, secrets, and operations.

## Why Facet exists

Most agent UI systems either render static chat text or ask the model to produce
code. Facet gives the model a safe middle path:

- UI is live and personalized per visitor.
- The model writes only declarative markup and bounded data.
- The host decides which components exist and what React code mounts.
- Invalid output rejects atomically with repair guidance.
- Runtime and browser use the same patch fold and revision contract.

## Quickstart

Use Quickstart for the complete reference stack:

```bash
npm create facet
```

Quickstart composes the reference agent, runtime, reference server, React
renderer, and default component assets in one runnable experience.

## Packages

| Group | Package | Role |
| --- | --- | --- |
| Core | `@facet/core` | Grammar, catalog, data model, document, patch, stage, and protocol contract. |
| Core | `@facet/runtime` | Session event loop, persistence seams, revision handling, and runtime fail-safe loading. |
| Core | `@facet/assets` | Default catalog/theme data and trusted default React registry subpath. |
| Renderers | `@facet/react` | React bootstrap, mounting, local view state, Modal frame, and subtree boundaries. |
| Agents | `@facet/agent-tools` | Nine provider-neutral tools for markup authoring, reads, and data publication. |
| Agents | `@facet/agent` | In-process code-authored `Stage` helper. |
| Agents | `@facet/reference-agent` | Reference provider loop, prompt, compaction, and fixtures. |
| Adapters | `@facet/server` | Reference server-side transport. |
| Adapters | `@facet/client` | Visitor-side reference transport package. |
| Adapters | `@facet/agent-client` | External-agent dial-in transport. |
| Tools | `@facet/quickstart` | Zero-setup runnable reference experience. |

## Adoption paths

| Goal | Start with | Guide |
| --- | --- | --- |
| Try the complete reference stack | `@facet/quickstart` | [Try it first](docs/GETTING-STARTED.md#try-it-first) |
| Embed the renderer in React | `@facet/react` | [Embed the React renderer](docs/GETTING-STARTED.md#embed-the-react-renderer) |
| Build an in-process rules agent | `@facet/agent` | [Use an in-process agent](docs/GETTING-STARTED.md#use-an-in-process-agent) |
| Build a provider-neutral LLM loop | `@facet/agent-tools` | [Agent Integration](docs/AGENT-INTEGRATION.md) |
| Run an external agent process | `@facet/agent-client` | [Connect an external agent](docs/GETTING-STARTED.md#connect-an-external-agent) |
| Use the default component set | `@facet/assets` | [Use the default assets](docs/DESIGN-SYSTEM.md#use-the-default-assets) |
| Use the reference server transport | `@facet/server` | [Run the reference transport](docs/GETTING-STARTED.md#run-the-reference-transport) |

## Core invariants

1. Agents emit declarative component markup, never executable UI code.
2. Catalog and registry tag sets must match exactly before a session renders.
3. Only validated patches change the stage.
4. Facet owns UI-out/UI-in only; domain work stays with the host and agent tools.
5. Layout remains flow-contained; overlap is only the dedicated Modal contract.

See [Architecture](docs/ARCHITECTURE.md) and
[Package Boundaries](docs/PACKAGE-BOUNDARIES.md) for the full contract.

## Development

```bash
pnpm install
pnpm verify
```

`pnpm verify` runs typecheck, tests, lint, format, build, docs checks, package
layout checks, hard-cut scanners, and source integrity checks.

See [Contributing](CONTRIBUTING.md) for the contributor workflow.
