# Package Boundaries

Facet's public package set is organized by role, not by deployment style. The
published import names stay stable, but each package has one primary
responsibility and uses public barrels rather than private source imports.

## Groups

| Group | Path | Public surface | Role |
| --- | --- | --- | --- |
| Core | `packages/core/core` | `@facet/core` | Dependency-free grammar, catalog, data model, document, patch, stage, and protocol contract. |
| Core | `packages/core/runtime` | `@facet/runtime` | Session event loop, persistence seams, revision/CAS handling, outbox delivery, and runtime fail-safe loading. |
| Core | `packages/core/assets` | `@facet/assets` plus the React subpath | Default catalog/theme data at the root and trusted default React implementations behind the explicit subpath. |
| Renderers | `packages/renderers/react` | `@facet/react` | Catalog/registry bootstrap, React mounting, data binding refresh, local view state, Modal frame, and subtree boundaries. |
| Agents | `packages/agents/agent-tools` | `@facet/agent-tools` | The nine provider-neutral markup/data/screen tools, prompt kit, executor, buffer, and observations. |
| Agents | `packages/agents/agent` | `@facet/agent` | In-process code-authored `Stage` helper and `defineAgent` wrapper. |
| Agents | `packages/agents/reference-agent` | `@facet/reference-agent` | Reference LLM brain, provider adapters, prompt handling, compaction, and deterministic fixtures. |
| Adapters | `packages/adapters/server` | `@facet/server` | Reference browser and agent transport over server-sent events and POST. |
| Adapters | `packages/adapters/client` | `@facet/client` | Browser-side reference transports for visitors. |
| Adapters | `packages/adapters/agent-client` | `@facet/agent-client` | External-agent dial-in transport and heartbeat client. |
| Tools | `packages/tools/quickstart` | `@facet/quickstart` | Zero-setup runnable reference experience composing the reference agent, runtime, server, renderer, and default assets. |

The repository may contain private experiments or local workspaces, but they are
not part of the published package graph and cannot be prerequisites for a
published package.

## Dependency direction

All public packages may depend on `@facet/core`. Other edges must preserve the
role boundary:

- runtime depends on Core only;
- default assets root depends on Core only;
- default React assets may depend on Core and React;
- React renderer depends on Core and React;
- agent packages depend on Core and, where appropriate, runtime-facing
  contracts;
- transports depend on Core protocol types and their direct transport peers; and
- Quickstart composes public packages as the executable reference experience.

Browser-facing package graphs must not import Node built-ins. Server-only
behavior belongs behind package-owned server code, not in browser entry graphs.

## Assets root and React subpath

The default assets package has a split surface by design. The root exports plain
catalog and theme data, so a server can validate authoring contracts without
loading React. The React subpath exports the trusted default registry. Renderer
bootstrap closes the trust boundary by comparing the active catalog and registry
tag sets exactly.

Do not move the mount contract into the renderer package to make assets depend
on renderer internals. That creates a cycle: renderer needs components to mount,
while assets would need renderer types to define components.

## Public API rules

- Export public API through each package's root barrel or explicit subpath
  barrel.
- Do not import another package's `src/*` files.
- Do not add compatibility aliases for the retired authoring model.
- Do not add package, Node-only, or runtime-specific dependencies to
  `@facet/core`; it stays the dependency-free root contract.
- Do not make a private app, local workbench, or generated fixture part of the
  published package graph.

## Documentation rule

Package docs describe the component-markup model only. Historical migration
inputs may remain in ignored planning artifacts, but committed docs must not
advertise deleted packages, retired subpaths, or private workbench commands as
current adoption paths.
