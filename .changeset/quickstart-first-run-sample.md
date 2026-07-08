---
"@facet/quickstart": patch
"@facet/reference-agent": patch
---

Make the quickstart first-run path provider-backed and sample-service oriented:
the default brief now renders a neutral agent service page instead of a Facet
demo, the documented workspace command uses the source CLI path that works in
the monorepo, and the wrapper returns clean HEAD `/app.js` and favicon
responses.
