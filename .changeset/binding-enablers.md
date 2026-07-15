---
"@facet/core": minor
"@facet/react": minor
---

Binding enablers: two closed, read-only capabilities so agents can author
store-bound values and self-highlighting UI from native bricks.

- **Store binding on `text`** — a `text` brick gains `from`/`column`/`row` and
  reads ONE scalar cell of the `data` warehouse, projected
  by the one shared `resolveNodeData`; `from` wins over inline `value`,
  dangling/absent → empty (never throws). Both the renderer and the agent-tools
  shadow use the same projection, so the brain's view can't drift from the
  visitor's. This lets a data-bound summary value be authored as a
  `box`+`text` composition.

- **View-state (active-look) binding** — `box`/`text` gain `activeVariant`/
  `activeStyle` + a closed `active` view-predicate (`{ screen }` | `{ toggled }`),
  so a brick highlights itself when that browser view-state holds, with no agent
  turn. `@facet/core` adds the closed `ViewPredicate` union +
  `sanitizeViewPredicate`/`evaluateViewPredicate`. The renderer evaluates it against
  the already-threaded snapshot view-state (the inert previous-screen clone keeps
  its old highlight through a crossfade) and folds the active look into the same
  pure token merge — read-only (writes no view-state/data), `activeStyle` passes the
  identical token allowlist as base `style`, and an unknown predicate kind degrades
  to the default look (no DSL). The predicate union is extensible (`viewport`/`sort`
  kinds can be added additively). This is the brick-level capability that lets
  segmented/navigation-style active highlighting be authored from `box`+`text`.

All fields are additive optionals; existing trees are byte-identical.
