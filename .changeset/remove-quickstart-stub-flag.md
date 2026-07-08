---
"@facet/quickstart": patch
---

Remove the public `--stub` quickstart path so first-run usage requires a real
provider-backed reference agent. The deterministic stub remains available from
`@facet/reference-agent` as a test fixture for live-link gates.
