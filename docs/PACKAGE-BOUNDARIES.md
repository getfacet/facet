# Package Boundaries

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

| Package | Role | Current gap |
| --- | --- | --- |
| `@facet/core` | Closed stage contract: 11 native Bricks, each Brick's owned style vocabulary, token/fixed-value metadata, complete Theme and Preset types, validated Pattern references, strict author validation, fail-soft sanitation, RFC 6902 patch helpers, and session/event contracts. | Needs a stable versioning story for protocol changes before 1.0. |
| `@facet/runtime` | Session event loop plus `StageStore`, `Sink`, `AssetsStore`, and `SummaryStore` interfaces and memory/file references for one Theme, an exact Pattern list, an optional initial tree, and opaque rolling-summary records. | Deliberately no tenant/project policy, quotas, or distributed orchestration. Hosted platforms must wrap it. |
| `@facet/assets` | Default data only: one complete `DEFAULT_THEME` and validated native-Brick `DEFAULT_PATTERNS`. | Theme, Preset, and Pattern authoring need fuller operator-facing examples. |

### Renderers

Renderers turn a Facet Document into concrete UI while preserving the closed,
fail-safe contract.

| Package | Role | Current gap |
| --- | --- | --- |
| `@facet/react` | React renderer, Theme-to-CSS resolution for Theme defaults → same-Brick Preset → direct style → active/state layers, Brick-owned target rendering, `useFacet`, `ChatDock`, and browser-side interaction handling. | Needs more end-user examples and visual docs, not more platform logic. |

### Agents

Agents packages help code or an LLM author Facet Documents. They do not own an
application's business logic, customer tools, identity, or production policy.

| Package | Role | Current gap |
| --- | --- | --- |
| `@facet/agent-tools` | Provider-agnostic stage mutation/inspection tools; progressive `get_pattern`, `get_preset`, single-Brick `get_brick_spec`, and exact-path `get_style_choices` reads; structured observations; local stage shadow; and reusable Facet prompt guidance. | Provider-specific schema adapter helpers would make custom loops easier. |
| `@facet/agent` | In-process TypeScript authoring SDK with `Stage`, `defineAgent`, and `defineStreamingAgent`. | Keep it for code-authored agents, tests, rules engines, and demos; it is not the LLM tool schema package. |
| `@facet/reference-agent` | Reference LLM brain: providers, prompt policy, bounded harness, and deterministic test fixture. | It is not a customer production brain; keep it as a reference harness and test surface. |

`@facet/agent` stays separate because in-process users need a fluent `Stage`
surface without hand-writing patches or importing the reference LLM loop.

### Adapters

Adapters connect Facet to transports, external protocols, and persistence while
keeping the Facet Document, patch validation, and renderer safety authoritative.
Protocol-specific dependencies stay here; `@facet/core` remains dependency-free.

| Package | Role | Current gap |
| --- | --- | --- |
| `@facet/server` | Reference SSE/POST transport for local/self-hosted single-operator use. | Not a public multi-tenant edge: no tenant/project isolation, browser auth, default agent auth, metering, rate limits, billing, abuse controls, admin auth, audit log, secrets handling, or custom-domain routing. |
| `@facet/client` | Reference browser transports for `@facet/server` plus the `FacetTransport` usage pattern. | `SseTransport` has no credential seam by design; sensitive or multi-tenant deployments should implement their own `FacetTransport`. |
| `@facet/agent-client` | Reference external-agent dial-in SDK for the reference SSE/POST agent channel. | Uses reference server auth semantics; hosted platforms should add project-scoped tokens or provide a platform-specific client. |
| `@facet/ag-ui` | Official AG-UI adapter/event layer: browser `FacetTransport` over AG-UI plus Node `@facet/ag-ui/server` handlers around `FacetRuntime`, while Facet still owns stage safety. | External NAT-safe AG-UI dial-out is deferred to future `@facet/ag-ui/agent`; native `@facet/agent-client` remains unchanged. |
| `@facet/store-postgres` | Optional durable `StageStore`, `Sink`, `AssetsStore`, and `SummaryStore` adapter backed by Postgres. | This is Facet persistence only, not a platform schema; hosted products need their own tenant/project/page/token/usage/audit schema. |

The native `@facet/client`/`@facet/server` route remains a reference fallback
for local/self-hosted Facet deployments. It is not a hosted-platform service
surface or a replacement for a platform edge.

### Tools

Tools are human-run local commands and development workflows. They can remain
published without becoming the hosted integration surface.

| Package | Role | Current gap |
| --- | --- | --- |
| `@facet/quickstart` | Local first-run CLI/server/page wrapper around `@facet/reference-agent`, with a provider-backed native-brick seed for the default path. | No spend caps, per-visitor rate limits, or production hosting policy. Keep it local. |
| `@facet/bridge` | Local bridge from Claude/Codex-style coding agents to a Facet link. | Local/operator tool only; not a hosted worker fleet. |
| `@facet/cli` | Local command surface used by `@facet/bridge`. | Bin and clean-consumer install behavior are covered by the repository package smoke gate. |

`@facet/quickstart` and `apps/playground` continue to use the native reference
transports for first-run demos and live-link fixtures. External AG-UI interop
goes through `@facet/ag-ui`.

`apps/playground` is an unpublished demo and integration surface. Root `labs/`
is an unpublished experimental area; neither creates another public package
role, and `labs/` is not included in workspace or publish discovery.

## Cross-Package Gaps

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
- **Docs:** package README files should state their role and explain when a
  hosted platform should wrap or replace them.
- **Examples:** the repo needs examples for custom agent loops using
  `@facet/agent-tools` without importing `@facet/reference-agent`.
- **Prompt ownership:** `@facet/agent-tools` may provide generic Facet prompt
  guidance for stage authoring and tool-result recovery. Page briefs, business
  policy, provider message assembly, history, budgets, retries, and production
  stop policy belong to the consuming agent or to `@facet/reference-agent` as a
  reference implementation.
