# Package Boundaries

For the framework overview and package-selection entrypoint, start with the
[Facet README](../README.md). This document owns package placement and hosted
platform boundaries.

Facet is a neutral OSS technology layer. It provides the protocol, runtime,
renderer, reference transports, and agent integration tools. It does not provide
a hosted control plane: tenant/project auth, API keys, billing, usage metering,
rate limits, abuse operations, admin dashboards, audit logs, secrets management,
or custom-domain routing.

The design-system surface is part of that neutral technology layer. It consists
of the closed 11-Brick contract, closed style properties and values, one
host-selected Theme with same-Brick Presets, and an exact list of optional
read-only Patterns. It is not tenant/project or billing policy. Hosted products
that need domain-specific references should provide validated native-Brick
Patterns through their per-agent assets rather than adding runtime node kinds.
The agent authors Bricks and unresolved style names; it neither selects the
Theme nor emits concrete CSS values.

For task-oriented adoption guidance, start with [Getting Started](GETTING-STARTED.md).
Use [Design System](DESIGN-SYSTEM.md) for Theme and asset authoring, and
[Agent Integration](AGENT-INTEGRATION.md) for a custom LLM loop. This document
remains the authority for package placement and hosted-platform scope.

Production hosted platforms should wrap Facet primitives with their own edge/API
and operations layer:

```text
public traffic
  -> platform edge/API
     - project lookup
     - auth and authorization
     - session policy
     - rate limits and abuse controls
     - usage metering and audit logs
     - secrets and custom domains
  -> Facet runtime primitives
     - stage state
     - patch application
     - event loop
     - renderer protocol
```

## Package Roles

Facet uses one package classification axis: the package's primary role. The
physical directories and this documentation use the same five names. Traits
such as reference implementation, optional adapter, local/self-hosted usage, or
production readiness stay in package prose rather than becoming another group.

### Core

Core owns the Facet contract, runtime, and bundled default design data.

| Package | Role | Boundary and collaborators |
| --- | --- | --- |
| `@facet/core` | Closed stage contract: 11 native Bricks, each Brick's owned style vocabulary, token/fixed-choice metadata, complete Theme and Preset types, validated Pattern references, strict author validation, fail-soft sanitation, RFC 6902 patch helpers, and session/event contracts. | Dependency-free contract package. It does not render, persist, transport, or call an LLM. Every other public package consumes this authority. |
| `@facet/runtime` | Session event loop plus `StageStore`, `Sink`, `AssetsStore`, and `SummaryStore` interfaces and browser-safe memory references for one Theme, an exact Pattern list, an optional initial tree, and opaque rolling-summary records. | The root export is browser-safe; Node file stores are intentionally isolated at `@facet/runtime/node`. Pair it with an authoring package and transport. It owns no tenant/project policy, quota, or distributed orchestration. |
| `@facet/assets` | Default data only: one complete `DEFAULT_THEME` and validated native-Brick `DEFAULT_PATTERNS`. | Custom assets enter through an `AssetsStore` and runtime `loadAssets`; this package is neither a registry nor a per-user catalog service. |

### Renderers

Renderers turn a Facet Document into concrete UI while preserving the closed,
fail-safe contract.

| Package | Role | Boundary and collaborators |
| --- | --- | --- |
| `@facet/react` | React renderer, Theme-to-CSS resolution for Theme defaults → same-Brick Preset → direct style → active/state layers, Brick-owned target rendering, `useFacet`, `ChatDock`, and browser-side interaction handling. | Requires React 18 or newer. Pair `useFacet` with a `FacetTransport` from `@facet/client`, `@facet/ag-ui`, or the host; the renderer does not own the agent, stage store, or hosted platform. |

### Agents

Agents packages help code or an LLM author Facet Documents. They do not own an
application's business logic, customer tools, identity, or production policy.

| Package | Role | Boundary and collaborators |
| --- | --- | --- |
| `@facet/agent-tools` | Provider-agnostic stage mutation/inspection tools; progressive `get_pattern`, `get_preset`, single-Brick `get_brick_spec`, and exact-path `get_style_choices` reads; structured observations; local stage shadow; and reusable Facet prompt guidance. | The host owns provider schema conversion, model calls, history, retry, budgets, and business tools. Use the public executor boundary; this package is not a network client. |
| `@facet/agent` | In-process TypeScript authoring SDK with `Stage`, `defineAgent`, and `defineStreamingAgent`. | Intended for code-authored agents, tests, rules engines, and demos. It is not the LLM tool-schema package or an external transport. |
| `@facet/reference-agent` | Reference LLM brain: providers, prompt policy, bounded harness, and deterministic test fixture. | A reference composition and test surface, not a customer production brain or an internal-module integration API. |

`@facet/agent` stays separate because in-process users need a fluent `Stage`
surface without hand-writing patches or importing the reference LLM loop.

### Adapters

Adapters connect Facet to transports, external protocols, and persistence while
keeping the Facet Document, patch validation, and renderer safety authoritative.
Protocol-specific dependencies stay here; `@facet/core` remains dependency-free.

| Package | Role | Boundary and collaborators |
| --- | --- | --- |
| `@facet/server` | Reference SSE/POST transport for local/self-hosted single-operator use. | Pair with `@facet/client` in the browser and optionally `@facet/agent-client` for an external agent. It is not a public multi-tenant edge and supplies no hosted control plane. |
| `@facet/client` | Reference browser transports for `@facet/server` plus the `FacetTransport` usage pattern. | `SseTransport` intentionally has no credential seam. Sensitive or multi-tenant deployments should implement their own `FacetTransport` or choose an authenticated adapter. |
| `@facet/agent-client` | Reference external-agent dial-in SDK for the reference SSE/POST agent channel. | It transports an already-assembled `FacetAgent`; it does not define LLM tools. Hosted platforms should add project-scoped credentials or provide a platform-specific client. |
| `@facet/ag-ui` | Official AG-UI adapter/event layer: browser `FacetTransport` over AG-UI plus Node `@facet/ag-ui/server` handlers around `FacetRuntime`. | The root and `/server` are the only public entrypoints. AG-UI remains an envelope around the one Facet stage; it does not add a second state authority or execute tools. |
| `@facet/store-postgres` | Optional durable `StageStore`, `Sink`, `AssetsStore`, and `SummaryStore` adapter backed by Postgres. | Requires the `pg >= 8` peer. It is Facet persistence only, not a platform schema; hosted products need their own tenant/project/page/token/usage/audit model. |

The native `@facet/client`/`@facet/server` route remains a reference fallback
for local/self-hosted Facet deployments. It is not a hosted-platform service
surface or a replacement for a platform edge.

### Tools

Tools are human-run local commands and development workflows. They can remain
published without becoming the hosted integration surface.

| Package | Role | Boundary and collaborators |
| --- | --- | --- |
| `@facet/quickstart` | Local first-run CLI/server/page wrapper around `@facet/reference-agent`, with a provider-backed native-Brick seed for the default path. | A local learning and smoke path, not production hosting policy. It supplies no spend caps, per-visitor rate limits, or tenant boundary. |
| `@facet/bridge` | Local bridge from Claude/Codex-style coding agents to a Facet link. | Local/operator tool only; it composes the native reference agent channel and is not a hosted worker fleet. |
| `@facet/cli` | Local command surface used by `@facet/bridge`. | Operates a running link; it is not an embeddable renderer, runtime, or LLM brain. |

`@facet/quickstart` and `apps/playground` continue to use the native reference
transports for first-run demos and live-link fixtures. External AG-UI interop
goes through `@facet/ag-ui`.

`apps/playground` is an unpublished demo and integration surface. Root `labs/`
is an unpublished experimental area; neither creates another public package
role, and `labs/` is not included in workspace or publish discovery.

### Unpublished applications

`apps/facet-lab` is the complete local maintainer workbench for inspecting the
package-defined Brick, Preset, Pattern, token, and fixed-choice truth; running
deterministic or provider-backed capability scenarios; and reviewing bounded
evidence, replay, comparison, and isolated Sandbox edits. It is a dependency
leaf: it may compose public `@facet/*` packages, while public packages and other
applications must not import from it. It is private workspace tooling, not an
npm package, hosted service, Quickstart replacement, or additional authoring
contract.

Lab-specific orchestration remains application policy. This includes scenario
expectations, contract and advisory visual evaluation, screenshot capture,
evidence retention/export/import, provider availability, and the single-process
loopback UI. Reusable mechanisms enter published packages only through explicit,
additive public APIs such as the reference-agent diagnostic observer, the server
accepted-frame observer, and the renderer's one-shot replay view.

## Cross-Package Rules

- **Publish smoke:** packages use dev-time `src` entrypoints plus
  `publishConfig` overrides for built `dist` output. `pnpm package:smoke` builds,
  packs, installs, and exercises every public package in a clean consumer,
  including ESM/CJS/type surfaces and published bins. The release workflow
  requires that token-free gate before publishing.
- **Hosted wrappers:** Facet intentionally does not provide project-scoped API
  keys, billing, metering, admin auth, or tenant isolation. Those belong outside
  this repo.
- **Design-system scope:** an `AssetsStore` resolves one complete Theme and one
  exact compatible Pattern list for an agent. Absence selects bundled defaults;
  an explicit empty Pattern list exposes none. This asset selection is not
  authentication, authorization, billing, tenant isolation, moderation, or
  platform routing.
- **Docs:** package README files state when to use a package, when not to use it,
  required peers or collaborators, and link to the task-oriented guides. Package
  README links use repository URLs that continue to work when rendered on npm.
- **Public paths:** package root barrels are the default integration surface.
  The intentional environment-specific exceptions are `@facet/runtime/node`
  and `@facet/ag-ui/server`; package `src/*` paths are private.
- **Prompt ownership:** `@facet/agent-tools` may provide generic Facet prompt
  guidance for stage authoring and tool-result recovery. Page briefs, business
  policy, provider message assembly, history, budgets, retries, and production
  stop policy belong to the consuming agent or to `@facet/reference-agent` as a
  reference implementation.
