# @facet/assets

Node-free default asset data for Facet. This package exports `DEFAULT_THEME`,
`DEFAULT_STAMPS`, and `DEFAULT_CATALOG` as validated data values and depends
only on `@facet/core`.

```bash
npm install @facet/assets @facet/core
```

`DEFAULT_THEME` is the built-in token value map for colors, spacing, typography
(`fontFamily`/`fontSize`/`fontWeight`), radii, shadows, media ratios, and
component recipes. Recipes are named style bundles for primitive bricks and
intrinsic components, such as `button.primary`, `section.surface`, `card.interactive`, and
`badge.success`; agents still emit recipe or token names, not CSS values.
Component recipes also carry token-only `parts` for internal affordances such as
field labels and controls, button labels, tabs, table cells, chart plots,
progress tracks/fills, list items, and divider rules. Those parts are default
renderer data, not new stage syntax.
Its default sans stack is `Nunito, sans-serif`; this package only exports the
data value, so hosts that want the exact Nunito face must load that font in
their own shell.
`DEFAULT_STAMPS` is a small library of reusable composition fragments such as
`hero`, `card`, `pricing-section`, and `dashboard-summary`; each stamp declares
string slots and whole-value `{{slot}}` markers so hosts can expand them with
`expandStamp` or quickstart's `use_stamp` tool. Stamps also carry bounded
metadata for agent authoring: category, use/avoid guidance, tags, variants,
repeatability, preferred parent, and optional composition/data/follow-up hints.
Prompt layers expose that metadata, names, descriptions, and slot names only;
stamp node JSON stays server-side.

`DEFAULT_CATALOG` is the default UI authoring policy. It locks the active theme
to `default`, allows the built-in intrinsic component set, advertises the compact
recipe variants backed by `DEFAULT_THEME`, allows all advertised compositions,
permits primitive fallback, and teaches the order
`composition -> component -> primitive` with edit-before-append and
compact-screen guidance. This catalog is
about what UI the agent may author; it is not hosted platform policy for tenant
isolation, authentication, billing, metering, spend caps, or custom domains.

```ts
import { DEFAULT_CATALOG, DEFAULT_STAMPS, DEFAULT_THEME } from "@facet/assets";

const hero = DEFAULT_STAMPS.find((stamp) => stamp.name === "hero");
const lockedTheme = DEFAULT_CATALOG.theme.switchPolicy === "locked";
```

The package contains no renderer or Node runtime code. It is safe to use anywhere
that can consume the `@facet/core` contract.
