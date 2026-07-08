---
"@facet/agent-tools": patch
"@facet/reference-agent": patch
"@facet/quickstart": patch
---

Make Facet stage tool observations structured and LLM-readable. Tool results now
carry explicit outcomes such as `applied_visible`, `applied_not_visible`,
`applied_with_warnings`, `pending`, and `rejected`, with bounded warnings and a
concrete `next_action` for repair loops.

The reference-agent prompt now teaches the model to use those outcomes before
claiming a page change is complete, and quickstart documents the structured
tool-loop feedback.
