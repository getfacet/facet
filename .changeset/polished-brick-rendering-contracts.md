---
"@facet/core": minor
"@facet/assets": minor
"@facet/react": minor
"@facet/agent-tools": minor
"@facet/reference-agent": minor
"@facet/quickstart": minor
---

Add polished built-in brick rendering contracts. `@facet/core` now validates
token-only recipe parts for renderer-owned affordances, `@facet/assets` ships
default polished recipes and catalog-backed variants, and `@facet/react` renders
high-level bricks plus `field` through those recipes, including active tabs and
display-only table/chart affordances. Agent prompt guidance and executor catalog
policy now prefer compositions and polished bricks while rejecting disallowed
tone-only recipe selectors before patch emission. Quickstart now starts from a
compact polished default stage for the built-in guide.
