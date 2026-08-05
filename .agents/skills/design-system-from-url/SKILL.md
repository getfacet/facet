---
name: design-system-from-url
description: Create a Facet Quickstart design overlay from a service URL by extracting brand-like foundation/semantic token values, mapping them onto the default Facet design system, and verifying that default screens re-render with the imported look. Use when the user provides a URL and asks to import, copy, derive, or test a custom design system for Facet Quickstart; do not use for cloning the service's homepage or building service-specific landing screens unless explicitly requested.
---

# Design System From URL

## Overview

Turn a service URL into a trusted local Facet Quickstart `--design` overlay.
Prefer a theme-only overlay over the default Facet catalog: change token values
and recipes first, then add closed vocabulary or components only when evidence
shows the default design system cannot express a recurring source pattern.

## Required Inputs

- Service URL to inspect.
- Facet repo path, normally `/Users/hoon/workspace/apps/facet`.
- Output path under `.agents/work/<slug>/`, unless the user asks to commit a
  reusable sample. Do not commit `.agents/work/` outputs.

## Workflow

1. Capture the URL in a real browser at desktop and mobile widths. Save
   screenshots under `output/playwright/design-import/<slug>/`, and inspect the
   saved images before judging the result.
2. Extract evidence: computed body/display fonts, loaded font faces, CSS custom
   properties, repeated foreground/background pairs, border/radius/shadow
   patterns, button states, badge/chip treatments, density, and navigation
   proportions. Record evidence in `.agents/work/<slug>/source-evidence.md`.
3. Read the overlay contract before authoring:
   `packages/tools/quickstart/README.md`, `docs/DESIGN-SYSTEM.md`, and
   `packages/tools/quickstart/src/design-overlay.ts`.
4. Write a local overlay module such as
   `.agents/work/<slug>/<service>-design.tsx`. Start with:
   `theme.foundation`, `theme.semantic`, and `theme.recipes`. Leave
   `components`, `registry`, and `examples` absent unless the user asked for
   them or the default catalog cannot express a repeated source pattern.
5. Use exact token paths. Do not generate mappings from broad substring matches
   such as `fontSize`, because keys like `titleFontSize` and
   `subtitleFontSize` are distinct recipe tokens.
6. Run Quickstart with the overlay:

   ```bash
   pnpm exec tsx packages/tools/quickstart/src/cli.ts --port <free-port> --design .agents/work/<slug>/<service>-design.tsx
   ```

7. Validate with browser screenshots, not DOM assumptions. Capture and inspect
   at minimum:
   - Live page top and one scrolled region.
   - Assets > Design System with `Imported`.
   - Assets > Components with `All`, `Imported`, and `Default`.
   - Assets > Screens with `All`, `Imported`, and `Default`.
8. Run rendered contrast scans on the same Live/Assets viewports. Treat any
   text below contrast threshold as blocking unless it is non-content,
   intentionally decorative text and the screenshot confirms it is harmless.
9. Fix failures and repeat the visual gate until the result is visibly coherent.

## Design Rules

- Retheme default Facet examples; do not create a service homepage clone by
  default.
- Preserve the default component trust boundary. Quickstart rejects replacing
  default tags or registry entries; use additive components only for genuine new
  vocabulary.
- Treat bright accents as backgrounds only when paired text passes contrast.
  Neon or saturated accents often need dark text, not inverse/white text.
- Keep `Badge` visually compact and status-like. If badges stretch inside cards
  or look like buttons, fix the theme/fixture/component behavior before passing.
- Keep `Button` for real actions. Repeated secondary card actions make examples
  noisy; prefer status badges and body text when no primary action is needed.
- Navigation surfaces must look like navigation: full-height side navigation in
  app-shell screens, legible active/inactive items, no giant detached toolbar.
- Fonts must be reported precisely. If the source font name is known but no
  font file is loaded into Quickstart, say the CSS stack requests it and the
  browser may fall back; do not claim the exact font rendered.

## Resources

- Read `references/quickstart-design-module.md` before writing the overlay.
- Read `references/visual-review-gate.md` before declaring the overlay ready.
- Use `scripts/contrast-check.mjs` for quick foreground/background checks:

  ```bash
  node .agents/skills/design-system-from-url/scripts/contrast-check.mjs "accent:#d7ff00:#050505" "bad-accent:#d7ff00:#ffffff"
  ```

- Use `scripts/rendered-contrast-scan.mjs` with the Playwright CLI skill to scan
  actual computed text/background pairs in the rendered page:

  ```bash
  PWCLI="${CODEX_HOME:-$HOME/.codex}/skills/playwright/scripts/playwright_cli.sh"
  "$PWCLI" --raw run-code "$(node .agents/skills/design-system-from-url/scripts/rendered-contrast-scan.mjs --playwright-code --url http://localhost:5292)" > output/playwright/design-import/<slug>/contrast-top.json
  node .agents/skills/design-system-from-url/scripts/rendered-contrast-scan.mjs --assert output/playwright/design-import/<slug>/contrast-top.json
  "$PWCLI" --raw run-code "$(node .agents/skills/design-system-from-url/scripts/rendered-contrast-scan.mjs --playwright-code --url http://localhost:5292 --scroll-y 900)" > output/playwright/design-import/<slug>/contrast-scrolled.json
  node .agents/skills/design-system-from-url/scripts/rendered-contrast-scan.mjs --assert output/playwright/design-import/<slug>/contrast-scrolled.json
  ```

  The scanner catches solid-color contrast failures from rendered DOM state. It
  does not replace screenshot review for gradients, image backgrounds, layout,
  navigation shape, badge/button hierarchy, or overall polish.

## Completion Report

Report the source URL, overlay path, Quickstart URL, inspected screenshot paths,
manual token-pair contrast results, rendered contrast scan results, contrast
failures fixed, whether components/examples were added, and any tokens
intentionally left as defaults with evidence.
