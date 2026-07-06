# Context: postgres-assets-v1

Evidence assembled by the context pass for the spec writer. Do not invent facts
beyond what is recorded here; every claim is anchored to `file:line`.

## Affected packages

- `@facet/store-postgres`
- `@facet/runtime`

## Code entrypoints

### @facet/store-postgres

- `packages/store-postgres/src/postgres-store.ts:15` — `initSchema(pool)` creates
  tables idempotently with `create table if not exists`. `PostgresAssets`
  extends it to add a `facet_assets` table (mirror `facet_stage`). **DC-005.**
- `packages/store-postgres/src/postgres-store.ts:41` —
  `PostgresStageStore implements StageStore` (pool ctor). The class shape
  `PostgresAssets` mirrors: `constructor(private readonly pool: Pool) {}`.
- `packages/store-postgres/src/postgres-store.ts:44` — `get()` returns
  `result.rows[0]?.session` (no row → `undefined`). `PostgresAssets.load`'s
  no-row → empty `AssetDocuments` mirrors this. **DC-002.**
- `packages/store-postgres/src/postgres-store.ts:56` — `save()` upsert via
  `insert ... on conflict (agent_id, visitor_id) do update` with
  `JSON.stringify(session)` as a jsonb param. The write method (bulk
  `putAssets`) mirrors this upsert-per-agent. **DC-003.**
- `packages/store-postgres/src/index.ts:1` — barrel
  `export * from "./postgres-store.js"`; `PostgresAssets` must be reachable
  through it. **DC-006**, barrel-only convention.
- `packages/store-postgres/src/postgres-store.test.ts:16` — `fakePool()`
  (records SQL + params, canned rows) + `roundTripPool()` (line 33, real jsonb
  write→read replay) are the pg-double test pattern **DC-001..005** reuse. Note:
  bigint `at` returned as string, jsonb parsed back to objects.
- `packages/store-postgres/package.json` — `pg` is a `peerDependency` (`>=8`),
  `@types/pg` is a dev dep; `publishConfig`/`exports`/`sideEffects` already set.
  **No new dependency needed.**

### @facet/runtime

- `packages/runtime/src/assets.ts:29` — `AssetDocuments` interface
  `{ themes: readonly unknown[]; stamps: readonly unknown[]; initialTree?: unknown; issues?: readonly string[] }`
  — the RAW (pre-validation) shape `PostgresAssets.load` must round-trip;
  confirms the exact fields the Decision-Lock assumption asked to verify.
- `packages/runtime/src/assets.ts:40` — `AssetsStore` interface with a single
  `load(agentId): Promise<AssetDocuments>`; `PostgresAssets` implements it. MUST
  stay unchanged (the write API is a concrete method, not on the interface).
- `packages/runtime/src/assets.ts:88` — `loadAssets(store, agentId)` is the
  single validation / fail-safe gate: guards `store.load` in try/catch (reject →
  empty docs + issue), coerces non-array `themes`/`stamps`, runs
  `validateTheme`/`validateStamp`/`validateTree`, drops malformed docs with
  recorded issues, and never throws. The store returns raw; this owns
  **DC-002 / DC-004.**
- `packages/runtime/src/file-assets.ts:17` — `FileAssets implements AssetsStore`
  returning RAW docs with skip-and-log issues (never throws past a file). The
  read-side sibling adapter whose posture `PostgresAssets.load` follows.

## Risk register

### RISK-INV-1 (INV) — INV #1: responsibility boundary / single fail-safe gate

Seam: the `AssetsStore` contract is read-only RAW-docs — `AssetDocuments` is
documented as *RAW documents straight from the backend, BEFORE any @facet/core
validation* (`packages/runtime/src/assets.ts:20-35`) and the interface is just
`load(agentId): Promise<AssetDocuments>` (`assets.ts:40-42`). `loadAssets`
(`assets.ts:88-244`) is the SINGLE validation gate
(`validateTheme`/`validateStamp`/`validateTree`).

Risk: if `PostgresAssets` validates in the store, it duplicates the gate and
drifts (double-validation, Decision Lock line 129).

Resolution the spec MUST implement: `PostgresAssets.load` returns raw jsonb
columns as `{ themes, stamps, initialTree? }` and calls NONE of the core
validators; mirror the existing precedent `PostgresStageStore.get` returning
`result.rows[0]?.session` (`packages/store-postgres/src/postgres-store.ts:44-50`).

### RISK-INV-2 (INV) — INV #1/#3 fail-safe: no-row and malformed-jsonb must not break the shape contract

Seam: `loadAssets` coerces non-array theme/stamp fields (`assets.ts:106-109`:
`Array.isArray(docs.themes) ? docs.themes : []`) and only reads `initialTree`
when defined (`assets.ts:221-235`).

Risk: a Postgres row with NULL `stamps`/`themes` jsonb, or missing
`initial_tree`, would yield `null`/`undefined` fields; DC-002 (`no row → empty
AssetDocuments`) requires the store to normalize these.

Resolution the spec MUST implement: `PostgresAssets.load` maps missing row →
`{ themes: [], stamps: [] }`, maps null jsonb columns to `[]`, and only sets
`initialTree` when the column is non-null (mirror
`packages/runtime/src/file-assets.ts:47-50`, which sets `initialTree` only when
present). Note: jsonb columns return already-parsed JSON from `pg`, so there is
no store-side `JSON.parse` throw — malformed shape is left to `loadAssets`'
array-coercion (`assets.ts:106-109`), never thrown at the store.

### RISK-INV-3 (INV) — INV #6 two-writers coherence: nominally N/A but one live seam via the initialTree seed path

The `initialTree` field in `AssetDocuments` (`assets.ts:32`) flows `loadAssets`
→ `validateTree` + `isSeedableTree` EMPTY_TREE trap (`assets.ts:221-235`) →
`withInitialStage` (`packages/quickstart/src/server.ts:322-326`), which seeds
the stage the SERVER solely owns under the runtime's per-(agent,visitor) serial
queue.

Risk: if `PostgresAssets` pre-validated or pre-seeded the tree it would bypass
the `isSeedableTree`/EMPTY_TREE trap and the single-writer serialized seed path,
introducing a second stage writer.

Resolution the spec MUST implement: `PostgresAssets` returns `initial_tree`
jsonb RAW only; it never seeds/writes the stage and never calls
`validateTree`/`isSeedableTree` — the single-writer property and the EMPTY_TREE
trap are preserved because all seed validation stays in `loadAssets`. With that
held, INV #6 stays N/A (no second writer).

### RISK-INV-4 (INV) — INV #1/#3 fail-safe boundary: DB errors stop at `loadAssets`

The intake brief and dev spec now agree with the runtime gate: `loadAssets` wraps
`store.load` in try/catch and converts a rejection into
`{ themes: [], stamps: [], issues: [...] }` so defaults still resolve
(`assets.ts:92-101`), and the quickstart caller only logs issues then continues
boot (`packages/quickstart/src/cli.ts:182-187`). So a Postgres-down boot does
NOT propagate past `loadAssets` — it falls back to the default asset layer with
an operator-visible issue.

Resolution the spec MUST preserve: accept the fail-safe swallow (matches the
existing single-gate `Never throws` contract at `assets.ts:89-91`). Operators who
need a loud boot failure should inspect `loaded.issues` at the caller, NOT make
`PostgresAssets.load` throw past `loadAssets`' guard.

### RISK-API-1 (API) — CHANGED PUBLISHED SURFACE (behavior): initSchema now provisions a third table

The exported `initSchema(pool)` at
`packages/store-postgres/src/postgres-store.ts:15` currently creates exactly two
tables (`facet_stage` + `facet_event`) plus one index; the brief (line 119)
extends it to also create `facet_assets`. This is ADDITIVE and safe by
construction only if it stays a `create table if not exists` (idempotent,
mirroring the existing statements) — but it silently changes what every current
caller of `initSchema` provisions.

Consumer proof: `packages/store-postgres/README.md:12-22` documents
`initSchema(pool)` as the setup call and `PostgresStageStore`/`PostgresSink` as
its consumers; no cross-package/app caller exists (grep of packages/apps/
examples finds `initSchema` only in this package's src/dist/README).

Resolution the spec must implement:
- (a) DECIDE explicitly — extend the shared `initSchema` (simplest, matches
  Decision Lock *mirror PostgresSink/StageStore*) vs. add a separate exported
  `initAssetsSchema(pool)` so an assets-only deployment need not create
  stage/event tables; the brief's Decision Lock picks *mirror*, so extend the
  shared one.
- (b) Keep it strictly `create table if not exists facet_assets (...)` —
  idempotent, DC-005.
- (c) Update `packages/store-postgres/README.md` (the *to create the tables*
  line) so the documented surface does not drift to say two tables when it now
  creates three.

### RISK-API-2 (API) — BREAKING-if-violated guardrail on the @facet/runtime published interface

`AssetsStore` at `packages/runtime/src/assets.ts:60` is
`{ load(agentId: string): Promise<AssetDocuments> }`. The brief adds a WRITE
method to `PostgresAssets`; if that write method were added to the `AssetsStore`
INTERFACE it would be a breaking change to three consumers that would then fail
typecheck: `MemoryAssets` (`packages/runtime/src/assets.ts:~48`), `FileAssets`
(`packages/runtime/src/file-assets.ts:17`), and the structurally-typed
`let store: AssetsStore` assignment in `packages/quickstart/src/cli.ts:161`
(assigned `MemoryAssets`/`FileAssets`, neither of which would implement a
write).

Resolution the spec must implement (matches Decision Lock *Write API = concrete
PostgresAssets method, NOT on the interface*): declare the write (e.g.
`putAssets(agentId, docs)`) ONLY as a concrete method on the `PostgresAssets`
class, leave the `AssetsStore` interface byte-for-byte unchanged (DC-006 asserts
*interface is unchanged*), and add a typecheck/export test that
`PostgresAssets implements AssetsStore` while `MemoryAssets`/`FileAssets` remain
valid `AssetsStore` implementers.

### RISK-API-3 (API) — ADDITIVE new export on the @facet/store-postgres barrel

The barrel is `packages/store-postgres/src/index.ts` =
`export * from "./postgres-store.js"` (single entry `.` in package.json
`exports`; `publishConfig` ships `dist/index.*`). Adding `PostgresAssets` (and,
if a new file is used, its `initAssetsSchema`) requires it to be re-exported
through this barrel or DC-006 (*exported via the package barrel*) fails.

Migration for existing consumers: NONE — grep proves no external importer of
`@facet/store-postgres` exists (only its own README + `postgres-store.test.ts`),
so this is purely additive with no downstream migration.

Resolution: if `PostgresAssets` lands in a new file (e.g. `postgres-assets.ts`),
add `export * from "./postgres-assets.js"` to `index.ts`; if it lands in
`postgres-store.ts` it is exported automatically. Add an export-presence test
mirroring the existing `PostgresStageStore`/`PostgresSink` import in
`postgres-store.test.ts:5`.
