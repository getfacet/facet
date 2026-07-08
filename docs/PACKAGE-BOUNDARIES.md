# Package Boundaries

Facet is a neutral OSS technology layer. It provides the protocol, runtime,
renderer, reference transports, and agent integration tools. It does not provide
a hosted control plane: tenant/project auth, API keys, billing, usage metering,
rate limits, abuse operations, admin dashboards, audit logs, secrets management,
or custom-domain routing.

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

## Public Surface Tiers

These tiers are semantic. They describe what a user should depend on, not where
the package happens to live in the repo. `Self-host` is a deployment style for
the reference implementations, not a separate package tier.

### Foundation

These packages are the reusable core of Facet:

| Package | Role | Current gap |
| --- | --- | --- |
| `@facet/core` | Brick spec, token vocabulary, RFC 6902 patch helpers, validation, and session/event contracts. | Needs a stable versioning story for protocol changes before 1.0. |
| `@facet/runtime` | Session event loop plus `StageStore`, `Sink`, and `AssetsStore` interfaces and memory/file references. | Deliberately no tenant/project policy, quotas, or distributed orchestration. Hosted platforms must wrap it. |
| `@facet/react` | Renderer, theme-to-CSS mapping, `useFacet`, `ChatDock`, and browser-side interaction handling. | Needs more end-user examples and visual docs, not more platform logic. |
| `@facet/assets` | Default theme/stamp value maps. | Theme/stamp schemas need fuller authoring docs and editor-facing examples. |

### Agent Authoring

These packages help developers make an agent produce Facet stage changes without
manually assembling JSON Patch arrays. They still do not own the agent's
business logic, provider choice, customer tools, or production policy.

| Package | Role | Current gap |
| --- | --- | --- |
| `@facet/agent-tools` | LLM/tool-loop mechanism: provider-agnostic stage tool specs, executor, inspection helpers, observations, local stage shadow, and reusable Facet prompt kit. | Useful as-is; provider-specific schema adapter helpers would make custom loops easier. |
| `@facet/agent` | In-process TypeScript authoring SDK with `Stage`, `defineAgent`, and `defineStreamingAgent`. | Keep it for code-authored agents, tests, rules engines, and demos; it is not the LLM tool schema package. |

`@facet/agent` stays separate for now. Removing it would force in-process users
to hand-write patches or import the reference agent stack just to get a fluent
`Stage` API. If future usage proves it is only a test helper, it can move down
to Local Tools before 1.0, but it should not be deleted while it remains
the small code-authored agent surface.

### Reference Implementations

These packages show working implementations of Facet transport, persistence, and
brain boundaries. They are useful for local/self-hosted single-operator setups,
tests, and as implementation references. They are not a hosted-platform service
surface.

| Package | Role | Current gap |
| --- | --- | --- |
| `@facet/server` | Reference SSE/POST transport for local/self-hosted single-operator use. | Not a public multi-tenant edge: no tenant/project isolation, browser auth, default agent auth, metering, rate limits, billing, abuse controls, admin auth, audit log, secrets handling, or custom-domain routing. |
| `@facet/client` | Reference browser transports for `@facet/server` plus the `FacetTransport` usage pattern. | `SseTransport` has no credential seam by design; sensitive or multi-tenant deployments should implement their own `FacetTransport`. |
| `@facet/agent-client` | Reference external-agent dial-in SDK for the reference SSE/POST agent channel. | Uses reference server auth semantics; hosted platforms should add project-scoped tokens or provide a platform-specific client. |
| `@facet/store-postgres` | Reference durable `StageStore`, `Sink`, and `AssetsStore` adapter backed by Postgres. | This is Facet persistence only, not a platform schema; hosted products need their own tenant/project/page/token/usage/audit schema. |
| `@facet/reference-agent` | Reference LLM brain: providers, prompt policy, bounded harness, and deterministic test fixture. | Not a customer production brain. It should stay a reference harness and test surface. |

### Local Tools

These packages optimize first-run experience and local operator workflows. They
can stay published, but they should not be presented as the core integration
surface for hosted products.

| Package | Role | Current gap |
| --- | --- | --- |
| `@facet/quickstart` | Local first-run CLI/server/page wrapper around `@facet/reference-agent`. | No spend caps, per-visitor rate limits, or production hosting policy. Keep it local. |
| `@facet/bridge` | Local bridge from Claude/Codex-style coding agents to a Facet link. | Local/operator tool only; not a hosted worker fleet. |
| `@facet/cli` | Local command surface used by `@facet/bridge`. | Bin publish metadata exists; still needs a package-level pack/install smoke before npm release. |

## Cross-Package Gaps

- **Publish smoke:** packages use dev-time `src` entrypoints plus
  `publishConfig` overrides for built `dist` output. Before npm publishing, run
  package-level `pnpm pack` / install smoke tests for library exports and bins.
- **Hosted wrappers:** Facet intentionally does not provide project-scoped API
  keys, billing, metering, admin auth, or tenant isolation. Those belong outside
  this repo.
- **Docs:** package README files should say which tier they belong to and when
  a hosted platform should wrap or replace them.
- **Examples:** the repo needs examples for custom agent loops using
  `@facet/agent-tools` without importing `@facet/reference-agent`.
- **Prompt ownership:** `@facet/agent-tools` may provide generic Facet prompt
  guidance for stage authoring and tool-result recovery. Page briefs, business
  policy, provider message assembly, history, budgets, retries, and production
  stop policy belong to the consuming agent or to `@facet/reference-agent` as a
  reference implementation.
