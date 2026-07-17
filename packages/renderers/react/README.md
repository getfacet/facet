# @facet/react

The native React renderer for Facet. `StageRenderer` turns a declarative Facet
tree into a sandboxed React tree from the closed 11-Brick vocabulary, while
`useFacet(transport)` folds RFC 6902 patches into the live stage.

Role: **Renderers**. Use this package to display a Facet Document in React. It
does not provide a transport, runtime, or agent brain.

React `>=18` is a peer dependency. A reference live-browser setup uses:

```bash
npm install @facet/react @facet/client @facet/core react react-dom
```

If your application already implements `FacetTransport`, `@facet/client` is
optional. Follow the canonical
[React wiring guide](https://github.com/getfacet/facet/blob/main/docs/GETTING-STARTED.md#embed-the-react-renderer)
for a complete, typechecked example.

## Live wiring contract

`useFacet` subscribes to one transport and exposes `tree`, `chat`, `send`,
`record`, and `transition`. A complete host must also:

1. create or memoize the transport once for a stable visitor;
2. send the initial `visit` exactly once—the hook does not send it automatically,
   and development Strict Mode may run effects twice;
3. preserve the optional `fields` argument from `StageRenderer.onAction`;
4. attach the latest `onViewSnapshot` value to outgoing events; and
5. pass locally resolved navigate/toggle events from `onRecord` to the
   transport's best-effort record channel.

The canonical example uses only public exports from `@facet/react`,
`@facet/client`, and `@facet/core`. Do not copy a smaller render-only snippet and
mistake it for a complete live integration.

`useFacet(...).transition` identifies the current folded patch revision. Passing
it to `StageRenderer` enables the root-replacement crossfade; omitting it keeps
the latest tree visible without that crossfade.

## Rendering and style resolution

`StageRenderer` is the browser fail-safe boundary. Unknown Brick kinds,
dangling ids, invalid styles, and unsafe media/link values are skipped or
reduced without throwing; valid siblings continue rendering. This fallback does
not make invalid agent authoring successful—the authoring boundary must reject
and repair it first.

The renderer accepts one complete operator Theme through `theme` and resolves
each Brick in this order:

1. Theme default for that Brick;
2. the same-Brick Preset named by `style.preset`;
3. direct values in the Brick's `style`.

`colorMode` is host/browser view state (`light`, `dark`, or `system`), not Facet
Document syntax. Invalid Theme input falls back to `DEFAULT_THEME` as a whole.
Patterns stay agent-side reference data and are never needed by the renderer.

## View-state ownership

The renderer owns browser-local screen, toggle, table-sort, viewport, and
effective color-mode state. `onViewSnapshot` publishes a read-only snapshot for
the host to attach to the next event; it does not write the Facet Document.
Likewise, local navigate/toggle actions update view state and use `onRecord`
rather than causing a second document writer.

Read next:

- [Getting Started](https://github.com/getfacet/facet/blob/main/docs/GETTING-STARTED.md)
- [Design System](https://github.com/getfacet/facet/blob/main/docs/DESIGN-SYSTEM.md)
- [Architecture](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md)
