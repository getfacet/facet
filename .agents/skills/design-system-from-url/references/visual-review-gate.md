# Visual Review Gate

Use this reference before declaring a URL-derived overlay ready.

## Required Screenshots

Capture screenshots with a real browser and inspect the image files:

- Live page, first viewport.
- Live page, scrolled region that includes cards, badges, buttons, tables, or
  navigation.
- Assets > Design System with source filter `Imported`.
- Assets > Components with source filters `All`, `Imported`, and `Default`.
- Assets > Screens with source filters `All`, `Imported`, and `Default`.

Do not pass based only on server logs, DOM text, unit tests, or a single cropped
screenshot.

## Required Contrast Scan

Run `scripts/rendered-contrast-scan.mjs` through the Playwright CLI on the same
viewports used for screenshot review. Save JSON outputs next to the screenshots.

Minimum scans:

- Live page, first viewport.
- Live page, scrolled region.
- Assets > Design System with source filter `Imported`.
- Assets > Screens with source filter `All`.

Treat nonzero `failureCount` as blocking. If a failure is a false positive, note
the exact selector/text and inspect the matching screenshot before waiving it.
The scanner uses computed solid text/background colors; it cannot judge image or
gradient backgrounds, hierarchy, layout, or brand fit.

## Blocking Failures

Any of these require another fix pass:

- White or low-contrast text on bright accent backgrounds.
- Any non-waived rendered contrast scan failure.
- Invisible inactive navigation items, muted text, labels, table text, or badge
  text.
- Side navigation rendered as a detached card or short block when the screen is
  an app-shell layout.
- Badges/chips stretched to button width or styled like primary actions.
- Repeated card-level secondary buttons that compete with the actual action.
- Large blank regions caused by the retheme changing spacing or layout balance.
- Text overlapping, clipping, or resizing containers.
- Service-specific landing examples added when the task was only design-system
  import.

## Expected Result

The default Facet examples should look like they use the imported service's
design language. They should not look like the source site's homepage was copied,
and they should not retain obvious default-asset styling where token changes
should have affected the surface.
