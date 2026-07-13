---
"@facet/core": minor
"@facet/react": minor
---

Local table sort: a visitor can click a `sortable` table column header to reorder
the rows in the browser — ascending → descending → unsorted — with no agent turn
and no transport, the same two-writers-safe discipline as `navigate`/`toggle`.

`@facet/core` gains an additive `TableColumn.sortable?: boolean` (bounded-boolean
validated, drop-with-issue on non-boolean), a closed `SortDirection` /
`SORT_DIRECTIONS` enum, an optional `ViewSnapshot.sort` map (per-table
`{ column, direction }`) sanitized in `sanitizeView` (bounded by
`MAX_VIEW_SORT_KEYS`, drop-oldest, never throws), and teaches the flag in
`STAGE_SPEC`. `@facet/react` holds the sort as pure browser view-state beside
`screen`/`toggled`, applies a renderer-owned TOTAL, STABLE comparator
(`applySort`: numeric < string < boolean < empty, ties by original index; reads
cells through the same `safeOwnValue` guard as the cell renderer so a hostile
throwing getter can never unwind the render) to the freshly-resolved rows at
render time, and rides the current spec on the `view` snapshot. The browser never
writes `data`/`rows`; the server stays the sole content writer and a later data
patch re-applies the current spec. The agent authors no sort logic — only the
opt-in flag. Local filtering is deliberately deferred.
