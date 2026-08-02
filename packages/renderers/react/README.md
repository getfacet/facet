# @facet/react

Trusted React renderer for Facet component documents. It mounts only components
registered by the host, keeps browser-local view state local, applies transport
frames through the shared patch fold, and isolates component failures at the
subtree boundary.

Role: **Renderers**.

```bash
npm install @facet/react @facet/assets react react-dom
```

Use this package to display a Facet stage in React. It does not provide an
agent brain, runtime process, product-domain fetch layer, or hosted control
plane.

## Bootstrap

`bootstrapRenderer({ catalog, registry, theme, themeExtensions? })` closes the browser trust
boundary before a session renders. The catalog is what an agent may author; the
registry is the trusted React code that mounts those tags. The two tag sets must
match exactly, the catalog must pass Core validation, and the returned boundary
is frozen for the session.

`createRegistry` is a helper for hosts assembling a custom registry. The default
catalog/registry/theme trio is available from `@facet/assets` and
`@facet/assets/react`.

## Rendering

`StageRenderer` receives a validated component document and renders the selected
screen. It skips or reduces unsafe persisted fragments without throwing, while
valid siblings continue to render. That fail-safe behavior is not an authoring
acceptance path: invalid model-authored markup must still be rejected before it
reaches runtime or renderer state.

The renderer owns modal framing, neutral empty/error states, data-binding
refresh, subtree error boundaries, and local browser state such as selected
screen and interaction snapshots. Components own their intrinsic React behavior;
authored markup never supplies executable handlers, imports, raw CSS, or JSX.

## Live hook

`useFacet(transport)` subscribes to a browser transport and returns the current
stage, conversation items, send helpers, record helpers, and transition state. A
complete host still sends the initial visit, preserves collected field payloads,
and forwards explicit visitor events through its chosen transport.

```tsx
import { DEFAULT_CATALOG, DEFAULT_THEME } from "@facet/assets";
import { DEFAULT_REGISTRY } from "@facet/assets/react";
import { bootstrapRenderer, StageRenderer, useFacet } from "@facet/react";
import type { FacetTransport } from "@facet/core";

const boundary = bootstrapRenderer({
  catalog: DEFAULT_CATALOG,
  registry: DEFAULT_REGISTRY,
  theme: DEFAULT_THEME,
});

if (!boundary.ok) throw new Error(boundary.detail);

declare const transport: FacetTransport;

function FacetView() {
  const facet = useFacet({ transport });

  return (
    <StageRenderer
      bootstrap={boundary}
      document={facet.stage.document}
      data={facet.stage.data}
      onEvent={facet.sendEvent}
    />
  );
}
```

## Conversation surface

`ConversationSurface` renders transport-neutral conversation items. It is kept
separate from `StageRenderer` so hosts can place chat chrome wherever their
application needs it without giving authored markup control over browser shell
layout.

## Documentation

- [Getting Started](https://github.com/getfacet/facet/blob/main/docs/GETTING-STARTED.md) —
  complete React embedding flow.
- [Architecture](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md) —
  renderer trust boundary and fail-safe behavior.
- [Package Boundaries](https://github.com/getfacet/facet/blob/main/docs/PACKAGE-BOUNDARIES.md) —
  renderer package ownership.
