# @facet/assets

Node-free default asset data for Facet. This package exports `DEFAULT_THEME` and
`DEFAULT_STAMPS` as validated data values and depends only on `@facet/core`.

```bash
npm install @facet/assets @facet/core
```

`DEFAULT_THEME` is the built-in token value map for colors, spacing, typography
(`fontFamily`/`fontSize`/`fontWeight`), radii, and media ratios.
`DEFAULT_STAMPS` is a small library of reusable `FacetStamp` fragments such as
`hero`, `card`, and `cta-button`; each stamp declares string slots and
whole-value `{{slot}}` markers so hosts can expand them with `expandStamp` or
quickstart's `use_stamp` tool.

```ts
import { DEFAULT_STAMPS, DEFAULT_THEME } from "@facet/assets";

const hero = DEFAULT_STAMPS.find((stamp) => stamp.name === "hero");
```

The package contains no renderer or Node runtime code. It is safe to use anywhere
that can consume the `@facet/core` contract.
