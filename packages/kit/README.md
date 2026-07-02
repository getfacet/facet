# @facet/kit

Optional presets — `hero` / `card` / `row` / `stack` / `page` / … — that
compose the four low-level bricks into common shapes. One call for a common
layout, raw bricks when you need something custom. Sugar over `@facet/core`; it
adds no new node types.

```bash
npm install @facet/kit @facet/core
```

`page(blocks)` assembles Blocks into a complete `FacetTree` with a root box. Each
preset (`hero`, `card`, `heading`, `text`, …) returns a `Block` you drop into
that list.

```ts
import { hero, card, text, page } from "@facet/kit";

const tree = page([
  hero({ title: "Facet", subtitle: "UI a model renders itself" }),
  card([text("A preset is just bricks — nothing you couldn't hand-build.")]),
]);
```

See the [Facet docs](https://github.com/getfacet/facet) and
[ARCHITECTURE.md](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md).
