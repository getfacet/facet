# Context Evidence: Composition Canonicalization

## Scope And Baseline

- Approved intake: `specs/feature-intake/composition-canonicalization.md`.
- Prepared worktree: `/Users/hoon/workspace/apps/facet-wt/component-model-and-layout-contract`.
- Branch: `feat/component-model-and-layout-contract`; clean before the planning
  artifacts, ahead of `origin/main` by the already-completed component-model work.
- This is a breaking pre-release cleanup. No compatibility aliases, old asset
  extensions, old catalog fields, or old Postgres adapter fields are retained.
- Affected published packages: `@facet/core`, `@facet/assets`, `@facet/runtime`,
  `@facet/agent-tools`, `@facet/reference-agent`, `@facet/quickstart`,
  `@facet/agent`, and `@facet/store-postgres`.
- Unaffected runtime surfaces: React rendering, client/server wire protocol,
  AG-UI, agent-client, CLI, bridge mechanics, and playground rendering. They
  continue to receive ordinary validated nodes and RFC 6902 patches.

## Required Docs And Package Entrypoints

- `AGENTS.md:14-29` — declarative closed vocabulary, patches-only, fail-safe.
- `docs/ARCHITECTURE.md:66-138` — primitive/intrinsic/composition ownership and
  renderer containment.
- `docs/ARCHITECTURE.md:164-245` — catalog policy, assets, server-side expansion.
- `docs/REVIEW-RULES.md:1-130` — P0-P2 blocking review model.
- `packages/core/core/src/index.ts:1-16` and `packages/core/core/README.md:1-103`.
- `packages/core/assets/src/index.ts:1-3` and `packages/core/assets/README.md:1-47`.
- `packages/core/runtime/src/index.ts:1-5` and `packages/core/runtime/README.md:1-75`.
- `packages/agent-stack/agent-tools/src/index.ts:1-64` and package README.
- `packages/agent-stack/reference-agent/src/index.ts:1-37` and package README.
- `packages/agent-stack/quickstart/src/index.ts:1-6` and package README.
- `packages/extensions/agent/src/index.ts:1-2` and package README.
- `packages/extensions/store-postgres/src/index.ts:1-2` and package README.

## Current Public And Runtime Shape

- `packages/core/core/src/validate.ts:1262-1367` owns `FacetStamp`, metadata,
  validation, slots, and node sanitization.
- `packages/core/core/src/component-definition.ts:14-130` adds a second
  forbidden-field/type preflight and delegates to `validateStamp`.
- `packages/core/core/src/expand-stamp.ts:6-38` exports the expansion type family
  and function; `src/index.ts:9-11` publishes both old modules.
- `packages/core/core/src/catalog.ts:38-63` exposes both stamp/composition policy
  and legacy/canonical orders; normalization dual-reads at `:562-588`.
- `packages/core/assets/src/stamps.ts:8` owns the 11 bundled reusable fragments;
  the barrel exports `stamps.js` at `src/index.ts:2`.
- `packages/core/runtime/src/assets.ts:123-131` accepts `stamps`,
  `componentDefinitions`, and `compositions`; `LoadedAssets` emits separate
  `stamps` and `componentDefinitions` at `:304-310`.
- Runtime executes two dedupe/validation paths at `assets.ts:492-584`.
- `FileAssets` reads `.stamp.json` and `.component.json`, but not
  `.composition.json`, at `packages/core/runtime/src/file-assets.ts:31-52`.
- Quickstart reads and forwards only `loaded.stamps` at
  `packages/agent-stack/quickstart/src/cli.ts:176-210`, so the newer composition
  definition collection never reaches the executable tool path.
- Tool names/types/errors live at `agent-tools/src/types.ts:26-112`, schemas at
  `specs.ts:23-78`, execution at `executor.ts:211-347`, and buffering at
  `buffer.ts:114-244`.
- Reference-agent options and prompt assets still expose stamps at
  `reference-agent/src/agent.ts:43-67` and `prompt/system.ts:42-45`.
- `Stage.useStamp` is public at `packages/extensions/agent/src/stage.ts:73-90`.
- Postgres creates and reads/writes `facet_assets.stamps` at
  `postgres-store.ts:41-50` and `postgres-assets.ts:4-75`.

## File Shape Evidence

Literal probe:

```bash
wc -l packages/core/core/src/validate.ts packages/core/core/src/validate.test.ts packages/core/core/src/component-definition.ts packages/core/core/src/expand-stamp.ts packages/core/core/src/catalog.ts packages/core/core/src/theme.ts packages/core/core/src/theme.test.ts packages/core/runtime/src/assets.ts packages/core/runtime/src/assets.test.ts packages/agent-stack/agent-tools/src/executor.ts packages/agent-stack/agent-tools/src/executor.test.ts packages/agent-stack/agent-tools/src/buffer.ts packages/agent-stack/agent-tools/src/prompt-kit.ts packages/agent-stack/reference-agent/src/agent.test.ts packages/agent-stack/reference-agent/src/prompt.test.ts packages/agent-stack/quickstart/src/agent.test.ts packages/agent-stack/quickstart/src/quickstart.e2e.test.ts packages/agent-stack/quickstart/src/guide.ts
```

Result: `validate.ts` 1515, `validate.test.ts` 1934,
`component-definition.ts` 130, `expand-stamp.ts` 574, `catalog.ts` 611,
`theme.ts` 1112, `theme.test.ts` 614, runtime `assets.ts` 763 and
`assets.test.ts` 1290, agent-tools `executor.ts` 1357 and `executor.test.ts`
1162, `buffer.ts` 398, `prompt-kit.ts` 333, reference `agent.test.ts` 1669 and
`prompt.test.ts` 951, quickstart `agent.test.ts` 1370,
`quickstart.e2e.test.ts` 1148, and `guide.ts` 745 lines.

Module-shape implications:

- Integrate both validator safety layers into one `validateComposition` path and
  delete the wrapper instead of retaining two validators.
- Keep shared node sanitization in `validate.ts`: extracting the full sanitizer
  graph solely for line count would move a broad tree-validation subsystem and
  increase this focused migration's risk. Lock ceilings of 1615 source lines and
  2150 test lines; crossing either requires re-planning. The large test stays
  single-owner because composition validation reuses its topology/security
  fixtures rather than duplicating them in a second suite.
- Rename the cohesive expander module/test; do not add a forwarding shim.
- Keep the 1112-line theme validator and 614-line theme suite with their current
  owners: WU-4 changes only one source comment and permits no source growth;
  WU-14 keeps the focused negative-test suite at or below 675.
- Preserve runtime `assets.ts`, replacing both composition-like loops with one
  role-specific loop; no generic asset helper module. Keep source at or below
  763 lines and the consolidated test at or below 1350; a focused new
  `file-assets.test.ts` owns file count/byte boundaries.
- Rename agent-tools behavior in place with no compatibility branches and no net
  executor growth beyond the 1357-line baseline. Keep existing package-local
  tests rather than duplicating the tool-loop suite in quickstart. Reference and
  quickstart large suites retain their distinct owners with ceilings of 1750
  (`reference-agent/agent.test.ts`), 1000 (`reference-agent/prompt.test.ts`),
  1450 (`quickstart/agent.test.ts`), 1225 (`quickstart.e2e.test.ts`), and 745
  (`guide.ts`).

## Consumer Sweep

Published-surface command:

```bash
git grep -n -E 'FacetStamp|StampMetadata|StampValidationResult|validateStamp|expandStamp|ExpandStamp|StampParams|UseStamp|DEFAULT_STAMPS|use_stamp|useStamp|invalid_stamp|componentDefinitions|FacetComponentDefinition|ComponentDefinitionValidationResult|validateComponentDefinition|component-definition|CatalogStampsPolicy|CatalogLegacyUsageOrder|componentOrder|MAX_STAMP_|\.stamp\.json|\.component\.json|stamps\.js' -- packages apps README.md AGENTS.md docs .changeset
rg -n -i 'stamp' packages apps README.md AGENTS.md docs .changeset
```

Consumer closure:

- Core: validation, component-definition wrapper, expansion, catalog, stage
  spec, issue comments, and their tests.
- Assets/runtime: default data/barrels, catalog test, memory/file loader, and
  runtime tests.
- Agent-tools: types, schemas, executor, buffer, observations, prompt kit,
  barrel, and corresponding tests.
- Reference-agent/quickstart: options, prompt assets, CLI/guide wiring, tests,
  and quickstart E2E.
- Agent/Postgres: Stage SDK, asset adapter/schema, and tests.
- Current public docs, package READMEs, package metadata, current component-model
  planning artifacts, and pending changesets. WU-15..20 assign these exact files
  uniquely; the prior planning quartet is rewritten as concise canonical
  composition-model summaries that preserve the intrinsic/layout/containment
  decisions, point to `composition-canonicalization`, and contain no `stamp`
  substring.
- `STAGE_SPEC` is also consumed by bridge (`bridge.ts:94`) and playground
  (`generator.ts:9`), so it remains tool-neutral; `use_composition` belongs only
  in agent-tools prompt/schema surfaces.

Expected unaffected matches are removed occurrence-by-occurrence rather than by
discarding a matching line. Globally safe exact lexemes are limited to
`timestamp`, `timestamps`, `timestamptz`, `StampedFrame`, `stamped`, `stamping`,
`unstamped`, and `stampedSeed`; ambiguous singular/plural `stamp`/`stamps`
occurrences require a `(relative path, exact local context, captured span)`
allow-list entry for the SSE sequence comments, DOM annotations, the unrelated
normalization verb in `core/core/src/nodes.ts:41`, and the journey's
`data-facet-field-id` annotation at
`quickstart/e2e/journey/journey.ts:208`. The scanner masks only the captured
five-character occurrence and then rejects residual `/stamp/i`; therefore a
line containing both `timestamp` and `stamps`, or `StampedFrame` and
`DEFAULT_STAMPS`, still fails. It covers all tracked/untracked text files under
`packages`, `apps`, `docs`, `.changeset`, plus `README.md` and `AGENTS.md`, while
excluding ignored generated output such as `dist`/`node_modules`. Current
planning artifacts and pending changesets are not historical release artifacts
and must be rewritten to the canonical vocabulary.

## Independent Risk Probes

### INV

- **RISK-INV-001:** Merging validators may lose either forbidden backend/code
  field rejection or tree/token/topology sanitization. One public
  `validateComposition` must preserve both test suites.
- **RISK-INV-002:** Expansion issue collection, caught errors, `existingIds`,
  mint attempts, raw node maps, directory entries, and asset files can expose
  hostile data or perform excessive work. Use bounded issues, a private
  never-throwing error-detail reader, composition/output caps, globally bounded
  id work, and FileAssets discovery/open/byte caps: caught detail is stripped of
  C0/DEL/C1 and capped at 256 characters (a throwing `message` getter becomes
  fixed `unknown error` without reading its thrown sentinel); 1023 raw/output
  nodes, 64 issues plus one suppression tail, 5000 existing ids, and 4096 total
  mint attempts; 4096 total directory entries discovered with the 4097th
  stopping enumeration and failing the whole directory closed before any asset
  open/decode/parse; 1024 sorted files per collection; and at most 1048577 bytes
  read from each file. Exactly 1048576 bytes may decode/parse, while byte
  1048577 rejects before UTF-8 decode/JSON parse even when an initial 1 MiB file
  grows during reading. Test hostile proxies/getters, oversized maps/files,
  malformed or over-cap iterables, and throwing/colliding mint functions; every
  failure is a bounded no-op through core, tool, buffer, and SDK state.
- **RISK-INV-003:** Shared fold salvage cannot guarantee composition atomicity.
  Validate/prune/remap/check parent and cumulative patch cap before mutating any
  SDK/buffer state; failures produce zero ops and success produces one closed
  batch.
- **RISK-INV-004:** Prompt and executor currently consume different catalog
  fields. Required `compositions` and canonical `policy.order` must be the only
  normalized/enforced policy.
- **RISK-INV-005:** Split runtime collections can place validated data on a dead
  path and old data on the executable path. Use one defaults+custom composition
  loop and one immutable downstream snapshot.
- **RISK-INV-006:** Browser expansion would break patches-only/two-writers.
  Prohibit composition protocol messages, browser globals, renderer resolvers,
  and client imports; assert full composition JSON never ships.
- **RISK-INV-007:** Composition must not become a backend/client DSL. Preserve
  `FacetAction` only; reject HTML/JS/CSS/fetch/binding/expression/resolver fields
  and strip external node targets.

### API

- **RISK-API-COMP-001:** Mechanical rename could discard one validator safety
  layer. Merge behavior and tests, then remove both old public APIs.
- **RISK-API-COMP-002:** `CompositionParams`, `ExpandAt`,
  `UseCompositionResult`, `ExpandCompositionResult`,
  `ExpandCompositionOptions`, and `expandComposition`, together with observable
  no-partial behavior, migrate as one family. Parse the expansion source and
  core barrel with the TypeScript AST: the module exports exactly those six
  declarations, with no star/default/extra export, and the barrel explicitly
  re-exports the function plus five types from `./expand-composition.js`.
- **RISK-API-COMP-003:** Remove every catalog dual-read/dual-write fallback,
  including runtime clones and prompt/executor fallbacks.
- **RISK-API-COMP-004:** Replace runtime `stamps` and `componentDefinitions`
  outputs with one `compositions` output preserving caps/dedupe/shadowing.
- **RISK-API-COMP-005:** Tool name and error code are serialized provider
  contracts; schema, dispatch, buffer, observation, fixtures, and E2E migrate as
  a locked serial block. Old names become unknown, never aliases.
- **RISK-API-COMP-006:** Reference-agent option types and quickstart re-exports
  propagate the break; typecheck all affected packages and CLI hook payloads.
- **RISK-API-COMP-007:** Existing pre-release Postgres tables need
  `ADD COLUMN IF NOT EXISTS compositions`; never copy/read the old field.
- **RISK-API-COMP-008:** Keep STAGE_SPEC composition-aware but tool-neutral.
- **RISK-API-COMP-009:** Run blocking exact-identifier checks plus the structural
  occurrence scanner above across packages, apps, root docs, docs, and pending
  release notes. Exact allow-listed spans are consumed once; allow-list entries
  that match zero/multiple times fail, mixed allowed+forbidden-line adversarial
  fixtures must fail, removed source paths must be absent, and the prior
  planning quartet must use only canonical composition vocabulary.

### PKG

- **RISK-PKG-001:** Core must remain dependency-free and browser-safe; preserve
  `globalThis.crypto`/fallback id minting and add no Node import.
- **RISK-PKG-002:** Preserve dependency direction: assets/runtime/agent-tools
  depend on core; no core/downstream or agent-tools/runtime edge.
- **RISK-PKG-003:** Wildcard barrels and quickstart's reference-agent re-export
  propagate public names. Assign every barrel and use AST checks for the exact
  expansion module/barrel surface. After building all nine packages (the eight
  affected packages plus `@facet/server`), pack all nine into one temporary root
  whose `packs/` and npm `consumer/` are both inside that root. The authoritative
  TypeScript consumer imports all eight affected APIs, imports/constructs
  `FileAssets` from `@facet/runtime/node`, and constructs `PostgresAssets` while
  type-checking real `load`/`putAssets` calls. Bundle packed `@facet/core` for the
  browser, and structurally assert its packed package has neither
  `dependencies` nor `peerDependencies`. Do not use declaration text grep; hash
  or diff root package/lock files before and after so temp npm setup cannot
  mutate the worktree.
- **RISK-PKG-004:** Runtime/FileAssets must expose exactly one compositions
  collection and only `.composition.json`.
- **RISK-PKG-005:** Postgres DDL, row type, query, upsert, issues, and output all
  migrate to compositions.
- **RISK-PKG-006:** Pending release notes still advertise removed APIs. Rewrite
  pending notes and parse the new file with the official `@changesets/parse`
  resolved through the already-declared `@changesets/cli`; require exactly the
  eight named affected packages at `minor`, no duplicates/extras, and exercise
  mixed/single-quoted extra, major, and patch fixtures so quoting cannot hide an
  entry. Only after semantic scanner, exact changeset validation, Changesets
  status, and formatting pass may the nine-package build, browser bundle, and
  packed-consumer smoke run.
- **RISK-PKG-007:** Quickstart/reference-agent changes make provider smoke
  blocking: Tier 1a twice, Tier 1b, and Tier 2 with a real key.
- **RISK-PKG-008:** Bridge/playground consume generic STAGE_SPEC but do not own
  composition assets/tools; do not advertise `use_composition` there.

### SHAPE

- **RISK-SHAPE-001:** Validator ownership is split across a 1515-line core file
  and wrapper. Resolve with one integrated validator in `validate.ts`; delete the
  wrapper, preserve private sanitizer ownership, and record the no-split
  rationale above.
- **RISK-SHAPE-002:** Rename the cohesive expander source/test and remove the old
  export; no shim.
- **RISK-SHAPE-003:** Collapse runtime duplicate paths in place; no generic
  loader abstraction.
- **RISK-SHAPE-004:** Preserve the Node-only FileAssets boundary and recognize
  only the canonical suffix.
- **RISK-SHAPE-005:** Rename executor/tool policy in place with no net growth or
  compatibility branch; defer broad executor extraction.
- **RISK-SHAPE-006:** Export only canonical public modules/symbols, keep private
  internals private, and keep tool-loop behavior tests with reference-agent.

## Test Obligations

- Core validation: forbidden fields, unknown types, tokens, topology,
  null-prototype output, slots/metadata caps, hostile input, and no old exports.
- Core expansion: fill/defaults, fresh ids, reachable pruning, target stripping,
  parent/cap/atomic failures, exact-six AST exports, and a 256-character
  control-free error normalizer that survives a throwing `message` getter.
- Catalog: canonical required policy/order, malformed fail-soft defaults, and
  legacy-only fields unable to affect normalized output.
- Assets/runtime/file: all 11 defaults, custom shadowing, duplicate first-wins,
  caps/issues, only canonical input/output/suffix, 4096/4097 bounded directory
  discovery with zero file opens/parses on overflow, and 1 MiB-to-cap+1 growth
  rejection before decode/parse.
- Agent tools/reference/quickstart: schema/dispatch/error/prompt privacy,
  immutable snapshots, cumulative patch caps, unknown old tool, CLI wiring, E2E,
  and hostile exception zero-op/zero-message/shadow+buffer unchanged behavior.
- Agent/Postgres: closed patch batch, existing-parent behavior, DDL/round-trip,
  malformed raw docs, no old field reads.
- Negative browser surface: no composition JSON/global/protocol/renderer path.
- Mechanical gate: exact occurrence scanner and semantic changeset parser pass;
  all nine closure packages build before pack; the temp packed consumer,
  runtime/node/Postgres calls, core metadata/browser bundle, and full feature
  hard gate pass without modifying root package/lock files.

## Stage 0 Decision

**GO** for spec drafting, conditional on resolving every risk above in the spec
and synchronized execution manifest. No invariant conflict remains.
