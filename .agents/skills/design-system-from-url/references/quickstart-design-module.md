# Quickstart Design Module

Use this reference when writing the local design module.

## Default-First Shape

Create a trusted local TypeScript module that exports `QuickstartDesignOverlay`:

```tsx
import type { QuickstartDesignOverlay } from "@facet/quickstart";

export default {
  theme: {
    foundation: {
      palette: {
        brand500: "#000000",
      },
    },
    semantic: {
      action: {
        primaryBg: "var(--facet-foundation-palette-brand500)",
      },
    },
    recipes: {
      button: {
        primaryBg: "var(--facet-semantic-action-primary-bg)",
      },
    },
  },
  notes: [
    {
      id: "source",
      title: "Source",
      body: "Theme-only overlay derived from the inspected service URL.",
    },
  ],
} satisfies QuickstartDesignOverlay;
```

Omit `components`, `registry`, and `examples` until there is clear evidence that
the default catalog cannot express a repeated source pattern. If new components
are necessary, add component specs and matching registry entries together; never
replace default tags or default registry entries.

## Token Mapping

Map explicit paths, not fuzzy key names. Inspect `DEFAULT_THEME` and update
specific values under `foundation`, `semantic`, and `recipes`. Avoid broad
transformers that match any key containing `fontSize`, `background`, `text`, or
`border`; recipe keys have distinct semantics such as `titleFontSize`,
`mutedText`, `visualBg`, `primaryBg`, and `rowBorder`.

Use the source site's computed styles as evidence, but map into Facet roles:

- Raw colors, type sizes, spacing, radius, borders, and shadow go to
  `foundation`.
- Canvas/surface/text/action/status/state/focus/selection meanings go to
  `semantic`.
- Component-specific choices go to `recipes`.

## Fonts

Record the source font family and whether the font file actually loaded. If the
source site uses a hosted font that is unavailable to Quickstart, set a stack
that starts with the source font but report that rendering may fall back to the
next available family. Do not claim exact font rendering from the CSS family
name alone.

## Generated Output

Keep generated overlays in `.agents/work/<slug>/`. Commit only reusable skill
files unless the user explicitly asks to ship a sample overlay.
