# @facet/react

The Facet React renderer: `StageRenderer` turns the declarative stage spec into a
sandboxed component tree built from the closed Facet vocabulary: primitive
bricks plus intrinsic components from the active catalog.
`useFacet(transport)` keeps that tree in sync by applying patches live. It also
ships token→CSS and recipe resolution for color, spacing, typography, component
variants, tones, and renderer-owned recipe parts
(`boxStyle`/`textStyle`/`mediaStyle`/…, `resolveTheme`, `resolveRecipe`),
`ChatDock`, and `useFacet`.
(`browserVisitorId` lives in `@facet/client`, next to the transport that needs
it.)

```bash
npm install @facet/react @facet/client @facet/core react
```

`StageRenderer` is the security + fail-safe boundary: only known brick/component types are
rendered, no node carries raw HTML/JS/CSS, and unresolvable ids are skipped
rather than thrown on. Intrinsic components render through token-only theme recipes;
unknown recipes, variants, tones, parts, or theme names fall back to defaults.
The renderer owns the internal DOM for components such as `section`, `card`,
`button`, `tabs`, `nav`, `table`, `chart`, `metric`, `keyValue`, `badge`,
`progress`, `alert`, `list`, `divider`, `form`, `search`, `filterBar`,
`emptyState`, and `loading`; recipe parts style their internal labels,
controls, rows, tracks, fills, and rules without exposing those part names as
stage node fields. Primitive nodes remain the base rendering path for custom
composition. Wire it to a transport with `useFacet` and pass `send` through
`onAction`.

```tsx
import { SseTransport } from "@facet/client";
import { StageRenderer, useFacet } from "@facet/react";
import { browserVisitorId } from "@facet/client";

const transport = new SseTransport("http://localhost:5291", {
  visitorId: browserVisitorId(),
});

export function App() {
  const { tree, send, record, transition } = useFacet(transport);
  return (
    <StageRenderer
      tree={tree}
      onAction={(action) => send({ kind: "tap", action })}
      onRecord={record}
      transition={transition}
    />
  );
}
```

`useFacet(...).transition` is local renderer metadata for the current folded
patch revision. Pass it to `<StageRenderer transition={transition} />` so root
document replacements use the renderer's exact stage crossfade path. Omitting
the prop is compatible with existing consumers and still renders the latest
tree, but disables exact root-replace crossfade.

See the [Facet docs](https://github.com/getfacet/facet) and
[ARCHITECTURE.md](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md).
