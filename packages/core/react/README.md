# @facet/react

The Facet React renderer. `StageRenderer` turns a declarative Facet tree into a
sandboxed React tree built from the closed eleven-Brick vocabulary, while
`useFacet(transport)` keeps that tree live by folding RFC 6902 patches.

```bash
npm install @facet/react @facet/client @facet/core react
```

## Rendering and style resolution

`StageRenderer` is the browser fail-safe boundary. Unknown Brick kinds,
dangling ids, invalid styles, and unsafe media/link values are skipped or
reduced without throwing; valid siblings continue rendering. No authored Brick
can carry raw HTML, JavaScript, or CSS.

The renderer accepts one complete operator Theme through its `theme` prop. It
resolves every Brick in this order:

1. the Theme default for that Brick;
2. the same-Brick Preset named by `style.preset`;
3. direct values in the Brick's `style`.

Every value is checked against the owning Brick's Core contract before it is
mapped to CSS. Nested targets remain Brick-owned authoring paths: for example,
an input may use `style.control`, and a progress Brick may use `style.track`
and `style.fill`. The renderer owns the DOM those targets affect, while the
Facet Document owns only the closed target/property names.

`resolveTheme(theme, colorMode)` validates the singular Theme and selects its
light or dark paint branch. Invalid Theme input falls back to `DEFAULT_THEME`
as a whole. The `colorMode` prop is host/client view state (`light`, `dark`, or
`system`), never Facet Document syntax.

The package also exports `DEFAULT_THEME`, `COLOR`, `ResolvedTheme`, and small
token-to-CSS helpers such as `boxStyle`, `textStyle`, `mediaStyle`, and
`fieldStyle`. Full per-Brick target resolution remains an internal renderer
responsibility so it cannot drift from `StageRenderer`.

Patterns are agent-side reference data. They are never needed by the renderer,
never inserted automatically, and should not be shipped to the browser.

## Example

```tsx
import { SseTransport, browserVisitorId } from "@facet/client";
import { DEFAULT_THEME, StageRenderer, useFacet } from "@facet/react";

const transport = new SseTransport("http://localhost:5291", {
  visitorId: browserVisitorId(),
});

export function App() {
  const { tree, send, record, transition } = useFacet(transport);
  return (
    <StageRenderer
      tree={tree}
      theme={DEFAULT_THEME}
      colorMode="system"
      onAction={(action) => send({ kind: "tap", action })}
      onRecord={record}
      transition={transition}
    />
  );
}
```

`useFacet(...).transition` identifies the current folded patch revision. Pass
it to `StageRenderer` to enable the exact root-replacement crossfade. Omitting
it still renders the latest tree but disables that crossfade.

See the [Facet docs](https://github.com/getfacet/facet) and
[ARCHITECTURE.md](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md).
