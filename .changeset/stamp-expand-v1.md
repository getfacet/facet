---
"@facet/core": minor
"@facet/agent": minor
"@facet/quickstart": minor
"@facet/assets": minor
---

Add server-side stamp expansion with slot filling. `@facet/core` now exposes
`expandStamp` and optional `FacetStamp.slots`, `@facet/agent` adds
`Stage.useStamp`, quickstart exposes the `use_stamp` tool and advertises stamp
names/slots instead of copying full JSON into the prompt, and default stamps now
ship slot declarations.
