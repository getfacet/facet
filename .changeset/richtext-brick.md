---
"@facet/core": minor
"@facet/react": minor
---

Add the `richtext` native brick — a closed, fail-safe leaf for a flowing block
of prose with MIXED inline formatting the single-string `text` node cannot express.

- **Shape (closed):** `richtext` holds `blocks[]`, each a
  `{ type: paragraph|heading|listItem|quote, runs[] }`; a `run` is
  `{ text, marks? }` and a `mark` is a closed tagged union
  `{ kind: bold|italic|underline|strike|code }` or
  `{ kind: "link", target }`. Heading `level` (1–3) and list `depth` (0–5) are
  renderer-owned flow indent, clamped — never author pixels or positioning.
  It is a LEAF: no child ids, no `from` binding; its blocks/runs are its own data.

- **Marks are semantic names, not markup.** The theme owns the concrete look; an
  unknown mark drops and the run text is kept. No HTML/markdown/CSS DSL ever
  enters the tree (invariants #2/#4).

- **Links.** A `link` mark's `target` is either an INTERNAL `FacetAction`
  (navigate/agent/toggle — the same union as `onPress`, dispatched through the
  single press writer) or a gated EXTERNAL `{ href }`. The external href passes a
  strict `isSafeHref` allowlist (http(s)/protocol-relative/local paths only;
  `javascript:`, all `data:`, and every other scheme are rejected) at BOTH
  validate and render time, and renders as a plain `<a rel="noopener noreferrer">`
  — navigated, never fetched (invariants #1/#7). `isSafeHref` is exported from
  `@facet/core`.

- **Fail-safe.** Malformed blocks/runs/marks degrade (unknown block → paragraph,
  text-less run skipped, unknown mark dropped, all-invalid → empty); the validator
  and renderer never throw. On the inert previous-screen clone every link renders
  inert (no anchor/href/dispatch).

All fields are additive; existing trees are byte-identical.
