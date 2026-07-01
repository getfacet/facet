---
"@facet/bridge": minor
---

Add `@facet/bridge` — a local bridge (`facet-bridge`) that lets a local coding
agent (Claude Code, Codex, …) own a Facet link and drive the page. Two modes:
`spawn` (a CLI per event — any CLI, e.g. claude/codex) and `persistent` (one
always-on Claude session, via the Agent SDK, that owns the link and drives it
through in-process `facet_*` tools). Both use the local Claude Code auth (no API
key). Configurable server URL, agent id, mode, method, brain command, and model.
