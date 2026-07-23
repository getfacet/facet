# @facet/assets

Node-free default design-system data for Facet. This package depends only on
`@facet/core` and exports exactly two values:

- `DEFAULT_THEME` — one complete, validated Theme.
- `DEFAULT_PATTERNS` — 21 exact, validated Pattern trees.

Role: **Core**.

```bash
npm install @facet/assets @facet/core
```

Start with the practical
[Design System guide](https://github.com/getfacet/facet/blob/main/docs/DESIGN-SYSTEM.md).
Use this package when the host wants Facet's bundled design data unchanged or
as the complete base for an operator-owned Theme and Pattern list.

## Default Theme

`DEFAULT_THEME` contains the complete concrete design system used when an
operator does not supply one:

- closed token maps for spacing, typography, radii, borders, layout sizes, and
  renderer measurements;
- light and dark paint maps for semantic color, shadow, gradient, scrim, and
  highlight names;
- one default Brick style for every native Brick; and
- optional same-Brick Presets with `description`, `useWhen`, optional
  `avoidWhen`, and an unresolved token/fixed-name style bundle.

Agents author only the closed names in Brick `style`, such as
`{ "preset": "panel", "gap": "lg" }`. Concrete CSS values remain operator
Theme data. The renderer resolves Theme default, then same-Brick Preset, then
direct Brick style.

The default sans stack is `Nunito, sans-serif`. This package exports data only;
a host that wants the exact Nunito face must load the font in its own shell.

The bundled Theme is a neutral baseline, not the ceiling for a brand. Product
surfaces that need tighter density, stronger brand color, or exact repeated
composition should extend `DEFAULT_THEME` into an operator-owned Theme/Preset
set and pair it with an exact Pattern list. The package defaults stay generic
and validated; service-specific benchmark assets live outside this package.

## Default Patterns

`DEFAULT_PATTERNS` contains these reusable references: `hero`, `card`,
`section`, `empty-state`, `cta-button`, `form`, `fixed-filter`, `metric`,
`tabs`, `nav`, `pricing-section`, `faq-section`, `feature-grid`,
`dashboard-summary`, `settings-panel`, `support-triage`, `chart-table-view`,
and the box-layout structures `app-shell`, `split-pane`, `product-grid`, and
`media-shelf`.

Each Pattern is an ordinary Facet tree plus discovery metadata:

```ts check-docs
import { DEFAULT_PATTERNS, DEFAULT_THEME } from "@facet/assets";

const hero = DEFAULT_PATTERNS.find((pattern) => pattern.name === "hero");
const panel = DEFAULT_THEME.presets?.box?.panel;
```

A Pattern has `name`, `description`, `useWhen`, optional `avoidWhen`, `root`,
and `nodes`, plus the same optional `screens`, `entry`, and `data` fields as a
Facet tree. Its Bricks already use the active Theme's Presets and direct style
names. An agent may inspect a relevant Pattern, adapt its structure and style
ideas, and then author ordinary Bricks. Reading a Pattern never inserts it or
changes the stage.

The package contains no renderer, runtime, filesystem access, or provider code.

## Documentation

- [Design System guide](https://github.com/getfacet/facet/blob/main/docs/DESIGN-SYSTEM.md) —
  default assets, custom Theme/Preset/Pattern examples, and validation behavior.
- [Architecture](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md) —
  asset ownership and runtime boundaries.
- [Getting Started](https://github.com/getfacet/facet/blob/main/docs/GETTING-STARTED.md) —
  supported adoption paths.
