# @facet/react

The Facet React renderer: `StageRenderer` turns the declarative stage spec into a
sandboxed React tree built from Facet's closed eleven-brick vocabulary.
`useFacet(transport)` keeps that tree in sync by applying patches live. It also
ships token→CSS and recipe resolution for color, spacing, typography, brick
variants, tones, and renderer-owned recipe parts
(`boxStyle`/`textStyle`/`mediaStyle`/…, `resolveTheme`, `resolveRecipe`),
`ChatDock`, and `useFacet`.
(`browserVisitorId` lives in `@facet/client`, next to the transport that needs
it.)

```bash
npm install @facet/react @facet/client @facet/core react
```

`StageRenderer` is the security + fail-safe boundary: only known brick types are
rendered, no node carries raw HTML/JS/CSS, and unresolvable ids are skipped
rather than thrown on. Bricks render through token-only theme recipes;
unknown recipes, variants, tones, parts, or theme names fall back to defaults.
The renderer owns the internal DOM for data/display bricks such as `table`,
`chart`, `keyValue`, `progress`, `list`, and `loading`; recipe parts style their
internal labels, controls, rows, tracks, and fills without exposing those part
names as stage node fields. Actions, navigation, grouped inputs, summaries,
cards, sections, empty states, badges, and alerts are ordinary `box`/`text`/
`input` composition patterns—not renderer-owned node types. Optional composition
references may inform their design but never insert them. A stale raw node using
one of the retired discriminants blank-degrades as a whole subtree while valid
siblings continue rendering. Wire it to a transport with
`useFacet` and pass `send` through `onAction`.

`StageRenderer` delegates safe-tree handling, motion, hold/press collection, and
brick rendering to private responsibility modules. These modules do not add
deep-import APIs; the supported surface remains the package root exports.

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
