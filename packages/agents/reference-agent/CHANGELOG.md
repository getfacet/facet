# @facet/reference-agent

## 1.0.0

### Major Changes

- 0adffe9: Replace the retired authoring model with the atomic component-markup hard cut.
  Agents now author declarative component markup validated against the immutable
  catalog/registry boundary, with browser and server surfaces rebuilt around the
  new protocol, tool contract, renderer bootstrap, and quickstart flow.
- e578285: Replace the pre-release default component contract with the 47-component V1
  catalog. Components now declare one closed content mode, structured components
  receive named slots, structured data may carry shallow shapes, hosts may pin
  safe image assets, and collected values support strings, booleans, and bounded
  string arrays. Every default component also carries concise discovery guidance
  that distinguishes its visitor purpose from its nearest alternatives.
  Component-spec reads now derive exact element and direct-child authoring rules,
  and rejected markup may return catalog-derived repair coordinates without
  echoing authored markup or invalid values.

### Patch Changes

- Updated dependencies [2a18382]
- Updated dependencies [0adffe9]
- Updated dependencies [4feae21]
- Updated dependencies [e578285]
  - @facet/agent-tools@1.0.0
  - @facet/core@1.0.0
  - @facet/runtime@1.0.0
  - @facet/agent@1.0.0
