# @facet/assets

Node-free default asset data for Facet. This package exports `DEFAULT_THEME`,
`DEFAULT_COMPOSITIONS`, and `DEFAULT_CATALOG` as validated data values and
depends only on `@facet/core`.

```bash
npm install @facet/assets @facet/core
```

`DEFAULT_THEME` is the built-in token value map for colors, spacing, typography
(`fontFamily`/`fontSize`/`fontWeight`), radii, shadows, media ratios, and
component recipes. Recipes are named style bundles for primitive bricks and
intrinsic components, such as `button.primary`, `media.hero`, and
`input.default`; agents still emit recipe or token names, not CSS values.
Component recipes also carry token-only `parts` for internal affordances such as
field labels and controls, button labels, tabs, table cells, chart plots,
progress tracks/fills, and list items. Those parts are default
renderer data, not new stage syntax. Badges, alerts, cards, sections, and empty
states ship as native reference datasets in `DEFAULT_COMPOSITIONS`, not
component recipes.
Its default sans stack is `Nunito, sans-serif`; this package only exports the
data value, so hosts that want the exact Nunito face must load that font in
their own shell.
`DEFAULT_COMPOSITIONS` is a library of 22 concrete reference datasets such as
`hero`, `card`, `section`, `empty-state`, `pricing-section`, and
`dashboard-summary`. Every entry
is self-contained native Facet data with `name`, required
`metadata.description`, a fragment `root`, and a node map that uses the same
closed node/token vocabulary as a stage. The root may be a leaf or a container.
There are no placeholders, parameters, hidden renderer behaviors, or
cross-dataset dependencies.

These examples are optional reading material for an agent, not templates or a
third authoring layer. A prompt can list only each exposed name and description;
an agent that needs a complex example can request one complete dataset, inspect
it, and then copy or adapt the native node ideas using its normal stage tools.
Reading a dataset does not modify the stage. Bounded metadata such as category,
use/avoid guidance, tags, variants, repeatability, preferred parent, and
optional composed-of/data/follow-up hints remains operator data; it is not new
stage syntax.

`DEFAULT_CATALOG` is the default UI authoring policy. It locks the active theme
to `default`, allows the built-in intrinsic component set, advertises the compact
recipe variants backed by `DEFAULT_THEME`, allows all advertised compositions,
permits primitive fallback, and teaches the order
`component -> primitive` with edit-before-append and compact-screen guidance.
Its composition policy controls only which optional reference datasets may be
inspected. This catalog is
about what UI the agent may author; it is not hosted platform policy for tenant
isolation, authentication, billing, metering, spend caps, or custom domains.

```ts
import { DEFAULT_CATALOG, DEFAULT_COMPOSITIONS, DEFAULT_THEME } from "@facet/assets";

const hero = DEFAULT_COMPOSITIONS.find((composition) => composition.name === "hero");
const lockedTheme = DEFAULT_CATALOG.theme.switchPolicy === "locked";
```

The package contains no renderer or Node runtime code. It is safe to use anywhere
that can consume the `@facet/core` contract.

Token maps, recipe data, and larger composition records live in private source
modules so each data file stays reviewable. `@facet/assets` still exposes only
the same root data values and preserves their ordering.
