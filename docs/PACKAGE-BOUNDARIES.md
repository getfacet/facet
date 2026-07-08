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

## Support Tiers

### Facet Foundation

These packages are the reusable core of Facet:

| Package | Role | Current gap |
| --- | --- | --- |
| `@facet/core` | Brick spec, token vocabulary, RFC 6902 patch helpers, validation, and session/event contracts. | Needs a stable versioning story for protocol changes before 1.0. |
| `@facet/runtime` | Session event loop plus `StageStore`, `Sink`, and `AssetsStore` interfaces and memory/file references. | Deliberately no tenant/project policy, quotas, or distributed orchestration. Hosted platforms must wrap it. |
| `@facet/react` | Renderer, theme-to-CSS mapping, `useFacet`, `ChatDock`, and browser-side interaction handling. | Needs more end-user examples and visual docs, not more platform logic. |
| `@facet/client` | Browser transports implementing the `FacetTransport` interface. | `SseTransport` has no credential seam by design; sensitive or multi-tenant deployments should wrap or replace it. |
| `@facet/assets` | Default theme/stamp value maps. | Theme/stamp schemas need fuller authoring docs and editor-facing examples. |

### Agent Integration

These packages help an agent use Facet without taking over the agent's business
logic:

| Package | Role | Current gap |
| --- | --- | --- |
| `@facet/agent-tools` | Provider-agnostic stage tool specs, executor, inspection helpers, and local stage shadow. | Useful as-is, but provider-specific schema adapter helpers would make custom loops easier. |
| `@facet/agent-client` | External agent dial-in SDK for the reference SSE/POST agent channel. | Uses reference server auth semantics; hosted platforms should add project-scoped tokens or provide a wrapper client. |
| `@facet/agent` | In-process agent authoring SDK with `Stage` and `defineAgent`. | Good local authoring surface; needs clearer guide docs for when to choose it vs `@facet/agent-tools`. |

### Reference, Demo, And Local Tools

These packages prove the protocol and make local development easy. They are not
the production service surface.

| Package | Role | Current gap |
| --- | --- | --- |
| `@facet/server` | Reference SSE/POST transport for local/self-hosted single-operator use. | Not a public multi-tenant edge: no tenant/project isolation, browser auth, default agent auth, metering, rate limits, billing, abuse controls, admin auth, audit log, secrets handling, or custom-domain routing. |
| `@facet/quickstart` | Local first-run CLI/server/page wrapper around `@facet/reference-agent`. | No spend caps, per-visitor rate limits, or production hosting policy. Keep it local/demo. |
| `@facet/reference-agent` | Reference LLM/stub brain: providers, prompt policy, bounded harness, and stub. | Not a customer production brain. It should stay a reference harness and test surface. |
| `@facet/bridge` | Local bridge from Claude/Codex-style coding agents to a Facet link. | Local/operator tool only; not a hosted worker fleet. |
| `@facet/cli` | Local command surface used by `@facet/bridge`. | Bin publish metadata exists; still needs a package-level pack/install smoke before npm release. |

### Adapters

| Package | Role | Current gap |
| --- | --- | --- |
| `@facet/store-postgres` | Durable `StageStore`, `Sink`, and `AssetsStore` backed by Postgres. | Needs migration/versioning guidance, pool sizing notes, and operational examples before serious production use. |

## Cross-Package Gaps

- **Publish smoke:** packages use dev-time `src` entrypoints plus
  `publishConfig` overrides for built `dist` output. Before npm publishing, run
  package-level `pnpm pack` / install smoke tests for library exports and bins.
- **Hosted wrappers:** Facet intentionally does not provide project-scoped API
  keys, billing, metering, admin auth, or tenant isolation. Those belong outside
  this repo.
- **Docs:** the next docs pass should add package-level "choose this when..."
  pages for `@facet/agent`, `@facet/agent-tools`, and `@facet/agent-client`.
- **Examples:** the repo needs examples for custom agent loops using
  `@facet/agent-tools` without importing `@facet/reference-agent`.
