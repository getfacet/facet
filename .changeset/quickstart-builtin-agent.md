---
"@facet/core": minor
"@facet/react": minor
"@facet/server": minor
"@facet/quickstart": minor
---

One-command quickstart with a built-in reference brain, and forms that reach the
agent. Agent actions gain a declarative `collect: "<box id>"`: at press time the
renderer snapshots the visible field values under that box and delivers them as
`fields` on the action event (string-coerced, capped at `MAX_FIELD_VALUE_CHARS`,
never written into the tree); `onAction` is widened to `(action, fields?)`. The
server validates `fields` at the boundary (400 on non-string or over-cap values)
and gains an additive `host` bind option. New `@facet/quickstart`: the
`facet-quickstart` bin boots a live page owned by a built-in LLM agent — a
tool-calling loop whose five tools (`append_node`/`set_node`/`remove_node`,
`render_page`, `say`) map onto the `Stage` API via OpenAI function-calling /
Anthropic tool-use behind a `QuickstartProvider` interface (or a deterministic
`--stub`), serving the page shell + bundled client and proxying the protocol to
an internal loopback server. The public wrapper binds `127.0.0.1`
by default (its `/event` is unauthenticated and drives paid provider calls), the
renderer never collects `password` fields, request handlers reject malformed
request-targets instead of crashing, and the visitor's session-bearer id is kept
out of provider prompts. The repo gate chain gains `/live-test`, a 3-tier
stub/bundle/provider-smoke E2E. (`@facet/*` are versioned together as a fixed
group.)
