# @facet/react

The Facet React renderer: `StageRenderer` turns the declarative stage spec into a
sandboxed component tree built from the four bricks (`box`, `text`, `media`,
`field`), and `useFacet(transport)` keeps that tree in sync by applying patches
live. It also ships the token→CSS theme
(`boxStyle`/`textStyle`/`mediaStyle`/…), `ChatDock`, and `useFacet`.
(`browserVisitorId` lives in `@facet/client`, next to the transport that needs
it.)

```bash
npm install @facet/react @facet/client @facet/core react
```

`StageRenderer` is the security + fail-safe boundary: only known brick types are
rendered, no node carries raw HTML/JS, and unresolvable ids are skipped rather
than thrown on. Wire it to a transport with `useFacet` and pass `send` through
`onAction`.

```tsx
import { SseTransport } from "@facet/client";
import { StageRenderer, useFacet } from "@facet/react";
import { browserVisitorId } from "@facet/client";

const transport = new SseTransport("http://localhost:5291", {
  visitorId: browserVisitorId(),
});

export function App() {
  const { tree, send, record } = useFacet(transport);
  return (
    <StageRenderer
      tree={tree}
      onAction={(action) => send({ kind: "tap", action })}
      onRecord={record}
    />
  );
}
```

See the [Facet docs](https://github.com/getfacet/facet) and
[ARCHITECTURE.md](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md).
