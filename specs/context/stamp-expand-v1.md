# Context: stamp-expand-v1

Context-pass evidence for the `stamp-expand-v1` feature (server-side stamp
reference-expansion via a `use_stamp` tool + slot-fill). This document captures
only the evidence gathered by the context pass; it invents no new facts. It is
the input for the spec writer.

## Affected packages

- `@facet/core`
- `@facet/agent`
- `@facet/runtime`
- `@facet/quickstart`
- `@facet/assets`

## Code entrypoints (file:line)

### @facet/core

- `packages/core/src/validate.ts:755` — `FacetStamp` interface (add optional
  `slots`).
- `packages/core/src/validate.ts:775` — `validateStamp` is the fail-safe
  boundary (BoundedIssues, `sanitizeNodeMap` / `pruneDanglingChildren` /
  `breakCycles`, never-throws) to **mirror** for the new expand helper
  (slot-fill + id-remap + validate).
- `packages/core/src/spec.ts:8` — `STAGE_SPEC` single-source vocab; DC-009
  advertises stamp names + slots + desc here (append a section or wire from the
  assets set).
- `packages/core/src/protocol.ts:39` — `MAX_FIELD_VALUE_CHARS=2000` /
  `protocol.ts:47` `MAX_FIELDS_KEYS` caps to **reuse** for the slot-value
  sanitizer; `patch.ts:35` `MAX_PATCH_OPS=1024` is the cap precedent for an
  optional node-count cap on expansion.
- `packages/core/src/index.ts:8` — barrel `export * from ./validate.js`
  (+ `spec.js:13`); the new expand helper + `use_stamp` param/tool types export
  through here (additive).

### @facet/agent

- `packages/agent/src/stage.ts:24` — `Stage` control API; add
  `useStamp(name, params, at)` alongside `append` (`stage.ts:41`) / `set`
  (`stage.ts:35`), reusing `nodePath` / `childrenPath`; must **return new ids**
  (existing methods return `this`, so this is a new shape). NOTE: `append` only
  appends the last child (`childrenPath` uses `/-`) — `at={parent, index?}`
  needs index support not present today.
- `packages/agent/src/define-agent.ts:23` — `Stage` is constructed fresh per
  turn (`new Stage()`) with NO stamp registry and
  `AgentContext = {event, session, stage}`; wiring the loaded stamps into
  `Stage.useStamp` (or having quickstart call a core expand helper and feed
  nodes through the closure) is the unresolved boundary/wiring gap.

### @facet/runtime

- `packages/runtime/src/assets.ts:55` — `LoadedAssets { stamps: readonly
  FacetStamp[] }` snapshot produced once at boot by `loadAssets` (Decision Lock:
  no hot reload); this is the turn's stamp source. The runtime serial-lane
  (`runtime.ts` per-`(agent, visitor)` queue) is the single-writer guarantee the
  expansion coalesces into.

### @facet/quickstart

- `packages/quickstart/src/agent.ts:299` — `executeTool` switch +
  `createClosureBuffer` (`agent.ts:206`, the referential-closure buffer with
  render/set/append/remove); add a `use_stamp` case that expands into set/append
  ops **through the closure** so the subtree stays referentially-closed in its
  batch (DC-010). The `stamps` option is already threaded (`agent.ts:48`, from
  `cli.ts:184`).
- `packages/quickstart/src/prompt.ts:98` — `stampsSection` is the prompt-copy
  path (full `{root, nodes}` JSON, `MAX_STAMP_PROMPT_CHARS=4000` drop at
  `prompt.ts:76`) to **replace** with a names+slots+desc advertisement
  (BREAKING); the `TOOLS` array (`prompt.ts:148`) is where the `use_stamp`
  `ToolSpec` is added.

### @facet/assets

- `packages/assets/src/stamps.ts:18` — `DEFAULT_STAMPS` (hero / card /
  cta-button) literal `FacetStamp` trees; add named slots and keep the id-prefix
  convention documented at `stamps.ts:14` (`hero.title`) so remapping stays
  collision-free.

## Risk register

### RISK-INV-1 (INV) — Invariant #6 (two-writers coherence / streaming referential closure)

Seam: `packages/quickstart/src/agent.ts:455` yields ONE batch per tool step, and
`packages/runtime/src/runtime.ts:328-338` folds EACH streamed batch separately
(not the whole turn) — the runtime's per-turn coalescing at
`runtime.ts:431-499` only applies to a single flush, while `foldPatchIntoStage`
runs `validateTree` dangling-ref pruning on each batch (`runtime.ts:421-424`
comment). A `use_stamp` expansion emits a whole subtree (root box + internal
child-node adds + parent child-ref adds, cf. `DEFAULT_STAMPS` hero has children
`[hero.title, hero.subtitle, hero.cta]` in `stamps.ts`). If `Stage.useStamp`
emits its subtree straight through `stage.append` / `stage.set`
(`packages/agent/src/stage.ts:41-45`) and a `yield` step boundary lands
mid-expansion, or if a parent child-ref is emitted in one batch while the child
node is still buffered, the intermediate fold orphans the forward child-ref →
broken partial paint.

RESOLUTION the spec must implement: route the entire expanded subtree through
the SAME `createClosureBuffer` (`packages/quickstart/src/agent.ts:206-282`) that
already holds child-ref appends until the child is known, and require the
expansion to complete WITHOUT an interleaved `yield` — so the whole stamp lands
as one referentially-closed batch (DC-010). Do not bypass the closure buffer
with direct `stage.append`.

### RISK-INV-2 (INV) — Invariant #6 (single-writer id coherence) + DC-004 id-remap

Seam: `DEFAULT_STAMPS` node ids are STATIC literals
(`packages/assets/src/stamps.ts:25-55` — `'hero.root'`, `'hero.title'`, …), and
the agent tracks live + turn ids in a single `knownIds` set seeded from
`session.stage.nodes` (`packages/quickstart/src/agent.ts:435`) that the closure
mutates on every emit (`agent.ts:212`). A second `use_stamp('hero')` that reuses
the stamp's literal ids issues `add /nodes/hero.title` (RFC6902 upsert =
silently overwrites the first instance, `stage.ts:36`) and duplicate child-refs
→ collision, not the DC-004 'disjoint fresh ids'.

RESOLUTION: the new `@facet/core` expand helper must mint fresh ids disjoint from
(a) `session.stage` ids, (b) ids already created this turn, (c) other same-turn
expansions — via a turn-scoped counter/uuid — AND register every minted id into
`knownIds` so the closure's parent-existence gate (`agent.ts:257`) and
`append_node`'s `knownIds.has(parentId)` check (`agent.ts:331`) stay coherent.
The `at.parent` must be validated against `knownIds` with a fail-safe no-op when
unknown, mirroring `append_node`'s reject at `agent.ts:331-341`.

### RISK-INV-3 (INV) — Invariant #3 (fail-safe: never throw, degrade to no-op)

Seams: the existing precedent is `set_theme` — unknown/malformed name → error
observation + no-op, never a mutation
(`packages/quickstart/src/agent.ts:387-404`; `stage.ts:70-73`), and
`validateStamp` is the never-throws sanitizer for a stamp doc
(`packages/core/src/validate.ts:775-830`). `executeTool`'s contract is 'a bad
tool argument becomes an error observation' (`agent.ts:294` comment, `fail()`
path). The new expand helper is on this same never-throws seam and must: unknown
stamp name → no-op + issue (DC-003, like unknown theme); malformed stamp doc →
run through `validateStamp` / `sanitizeNodeMap` so an invalid node can't be
injected, drop with issue (DC-005); bad/oversized slot params → sanitize with
the existing field-value caps (`MAX_FIELD_VALUE_CHARS` per the brief's own
assumption, `validate.ts`) or drop with issue; missing slot → default/empty.

RESOLUTION: the expand helper must be a pure, never-throwing function returning
`{ops, ids, issues}` and the expanded subtree must pass `validateTree`-grade
sanitization BEFORE any op is emitted, so a throw or an invalid node never
crosses into the turn flush (DC-005/DC-006).

### RISK-INV-4 (INV) — Invariant #1/#7 (backend-via-agent, UI-out; no live fetch on the render path) + #6 determinism

The policy table says expansion 'reads the turn's loaded assets snapshot' and
'server single writer'. Seam: stamps are threaded as an immutable snapshot into
the agent at construction — `createQuickstartAgent` passes `options.stamps` into
`buildSystem` and the loop (`packages/quickstart/src/agent.ts:414-421,435-436`),
and `loadAssets` / `MemoryAssets` snapshot them once
(`packages/runtime/src/assets.ts:169-175`). RISK: if `use_stamp` resolves the
stamp by re-reading a live `AssetsStore` mid-turn (an async store read) instead
of this snapshot, a concurrent asset write between steps yields
non-deterministic expansion and injects a backend fetch onto the mutation path —
breaking single-writer determinism and the no-live-fetch posture.

RESOLUTION: the expand path must resolve the stamp ONLY from the same immutable
per-turn stamps snapshot already passed to the agent (`agent.ts:416`), never a
fresh `StageStore` / `AssetsStore` read during the turn.

### RISK-API-1 (API) — CORE SURFACE SHAPE CHANGE: `FacetStamp`

`FacetStamp` (exported from `@facet/core` barrel via `export * from
./validate.js`) is defined at `packages/core/src/validate.ts:755` as
`{name, description?, root, nodes}`. The brief adds 'slot support on
FacetStamp'. The load-bearing decision is the slot MARKER convention (brief Open
Q, line 148): a dedicated `slot` field on `FacetNode` would be a BREAKING change
to the 4-node union at `packages/core/src/nodes.ts:203`
(`BoxNode|TextNode|MediaNode|FieldNode`) and would ripple into `validateTree`,
the renderer (`@facet/react` `StageRenderer`), and `STAGE_SPEC` — violating
invariant #1.

RESOLUTION the spec MUST implement: keep slots as a bounded, validate-able
text/attr marker (e.g. `{{name}}`) recognized only inside `validateStamp`
(`validate.ts:775`), NOT a new `FacetNode` field; if a slot DECLARATION is added
to `FacetStamp` (slot→default), make it an OPTIONAL field so the type stays
additive. Consumers that must keep compiling/passing: `DEFAULT_STAMPS` literal
(`packages/assets/src/stamps.ts:18` — currently no markers, DC-008 data change
is additive) and its test (`packages/assets/src/stamps.test.ts`). CONFIRMED via
grep.

### RISK-API-2 (API) — BREAKING BEHAVIOR of a PUBLIC barrel export: `buildSystem`

`buildSystem(guide, assets?)` (exported, `packages/quickstart/src/prompt.ts:125`)
composes the prompt via internal `stampsSection` (`prompt.ts:98`) which today
serializes each stamp's FULL `{root, nodes}` JSON (`prompt.ts:101`) and DROPS
oversized stamps via the internal `MAX_STAMP_PROMPT_CHARS=4000` cap
(`prompt.ts:76`, NOT exported). DC-009 replaces this prompt-copy path with a
names+slots+desc advertisement. The type signature of `buildSystem` and the
exported `PromptAssets` interface (`prompt.ts:66`, `stamps: readonly
FacetStamp[]`) are UNCHANGED, so this is a behavioral-only break, but the drift
test at `packages/quickstart/src/prompt.test.ts` (pins the STAMPS section
format) will fail.

RESOLUTION: rewrite `stampsSection` to emit `name + slot names + description` per
stamp, delete/repurpose `MAX_STAMP_PROMPT_CHARS` (no prompt cap needed now —
expansion is server-side), and update `prompt.test.ts`. Sole consumer of
`buildSystem`: `createQuickstartAgent` (`agent.ts:414`).

### RISK-API-3 (API) — TOOL-SET SURFACE + EXECUTION COUPLING

The exported `TOOLS: readonly ToolSpec[]`
(`packages/quickstart/src/prompt.ts:148`) is the model's action surface; adding
a `use_stamp` entry is ADDITIVE (`TOOL_NAMES` at `agent.ts:177` derives from it,
no drift). BUT the executor `executeTool(call, stage, knownIds, closure)`
(`packages/quickstart/src/agent.ts:299`, called at `agent.ts:450`) has NO access
to the resolved stamp library — stamps are baked into the prompt string ONCE at
`buildSystem` time (`agent.ts:414-417`) and never reach execution. Server-side
expansion (slot-fill + id-remap + validate) needs the `FacetStamp[]` at execute
time.

RESOLUTION the spec MUST implement: thread the resolved stamps snapshot into
`executeTool`'s signature (and the `createQuickstartAgent` closure), add a
`use_stamp` case that resolves name→stamp (unknown → no-op observation, DC-003),
calls a pure `@facet/core` expand helper, and emits the resulting ops through
`closure` (`agent.ts:206` `ClosureBuffer`) so the subtree stays referentially
closed in its streaming batch (DC-010, invariant #6). CONFIRMED: `executeTool`
signature at `agent.ts:299` takes no assets.

### RISK-API-4 (API) — NEW @facet/agent PUBLIC METHOD + STATE COUPLING

`Stage` (exported from `@facet/agent` barrel, `packages/agent/src/stage.ts:24`)
is STATELESS: it holds only `out` / `pending` and every method (`theme()`,
`append()`, `set()`…) just pushes ops; it has NO reference to the `AssetsStore`
or a stamp library. The brief's `@facet/agent` row promises
`Stage.useStamp(name, params, at)` that 'expands via the loaded assets' — but
`Stage` cannot resolve a bare NAME without the library, so a naive
`useStamp(name,...)` would force `Stage` to gain an assets dependency (coupling
`@facet/agent` → runtime `AssetsStore`, breaking its current zero-coupling).

RESOLUTION the spec MUST fix the signature: put the pure expand helper in
`@facet/core` (`expandStamp(stamp, params, at) → {ops, ids}`) and have
`Stage.useStamp` accept the ALREADY-RESOLVED `FacetStamp` object (caller
resolves the name from its assets), OR inject a stamp registry explicitly. This
keeps the new method purely ADDITIVE and `Stage` decoupled from `AssetsStore`.
The method must return `{root id, slot→id map}` (DC-007) via `this.pending` ops.

### RISK-API-5 (API) — SHARED CORE STRING EMBEDDED BY MULTIPLE CONSUMERS: `STAGE_SPEC`

`STAGE_SPEC` (exported `@facet/core`, `packages/core/src/spec.ts:8`) is embedded
VERBATIM by four surfaces: quickstart `prompt.ts:128`, `bridge.ts:97`,
`persistent.ts:37`, and `apps/playground` `generator.ts:11`, and a
verbatim-inclusion drift test pins it (`prompt.test.ts:29`). DC-009 lists
`spec.ts` as a change target, but per-agent stamp names/slots CANNOT live in the
static `STAGE_SPEC` — and adding a generic `use_stamp` capability line to
`STAGE_SPEC` would advertise a tool the BRIDGE and PLAYGROUND paths do not
implement (only quickstart wires the tool), producing a prompt that promises an
unimplemented action.

RESOLUTION the spec MUST pin WHERE the DC-009 advertisement lives: keep the
concrete per-agent stamp names+slots+desc in prompt.ts's assets section
(RISK-API-2), and leave `STAGE_SPEC` either untouched or amended ONLY with
vocabulary the bridge/playground can honor (or gate any `use_stamp` mention to
the quickstart-only prompt). Verify no bridge/playground prompt gains an
unbacked tool. CONFIRMED via grep of `STAGE_SPEC` consumers.

### RISK-PKG-1 (PKG) — CENTRAL coupling gap

The brief puts `Stage.useStamp(name, params, at)` in `@facet/agent` and says it
"expands via the loaded assets", but `@facet/agent` depends ONLY on `@facet/core`
(`packages/agent/package.json`: dependencies = `{"@facet/core"}`). The `Stage`
class (`packages/agent/src/stage.ts`) is a pure patch recorder with no assets
reference — its `theme()` method (`stage.ts:70`) just pushes an `add /theme`
name op, never resolving anything. Stamp DEFINITIONS live in two places the
agent cannot reach: `DEFAULT_STAMPS` in `@facet/assets`
(`packages/assets/src/stamps.ts:1`) and runtime-loaded custom stamps behind
`@facet/runtime`'s `loadAssets` / `AssetsStore`
(`packages/runtime/src/assets.ts:11,182`). If the spec resolves this by adding
`@facet/agent -> @facet/assets` (for `DEFAULT_STAMPS`) or
`@facet/agent -> @facet/runtime` (for `loadAssets`), it introduces a NEW
cross-package import that inverts the layering: the SDK the runtime calls would
reach back up into the orchestrator; and the `@facet/assets` edge still cannot
see runtime-loaded custom stamps.

RESOLUTION the spec must implement: keep `@facet/agent`'s dependency =
`@facet/core` ONLY; place the pure expand helper (slot-fill + id-remap +
validate, data→patches) in `@facet/core`; INJECT the resolved stamp snapshot
into the `Stage` from the host that already loaded assets (runtime/quickstart),
never via a new package dependency edge.

### RISK-PKG-2 (PKG) — Injection-seam blast radius

For RISK-PKG-1's injection to work, stamps must reach the `Stage`, but
`FacetSession = {agentId, visitor, stage}` carries no stamps
(`packages/core/src/protocol.ts:27`) and the core `FacetRuntime` never loads or
forwards assets — `runtime.ts` has no `@facet/assets` import and simply calls
`this.agent(event, session)` (`packages/runtime/src/runtime.ts:241`). So the
spec must either (a) add a data-only `stamps` field to
`FacetContext` / `FacetSession` (a `@facet/core` type change that must stay
declarative data, no node types), or (b) add a `stamps` param to the `Stage`
constructor. Either way `new Stage()` has 4 construction sites across 3 packages
that a required-arg change would break: `packages/agent/src/define-agent.ts:23`
and `:46`, `packages/cli/src/commands.ts:22`,
`packages/bridge/src/persistent.ts:216` (`@facet/cli` deps = agent+core;
`@facet/bridge` deps = agent+agent-client+cli+core).

RESOLUTION: the stamps param/field MUST be OPTIONAL (absent ⇒ `useStamp`
degrades to the fail-safe no-op the brief already mandates), so cli/bridge keep
compiling and are NOT forced to acquire a stamps source or a new dependency.

### RISK-PKG-3 (PKG) — Core node-free invariant + barrel

The `@facet/core` expand helper must remap stamp node ids to fresh unique ids
(DC-004), but `@facet/core` has NO id-generation utility today (grep for
`randomUUID` / `crypto` / `nanoid` / `uuid` in `packages/core/src` returns
nothing).

RESOLUTION: mint ids using the platform-global `crypto.randomUUID` or a pure
counter — the helper MUST NOT `import ... from "node:crypto"` (or any `node:`
builtin), preserving `@facet/core`'s node-free guarantee (mirrors
`packages/assets/src/stamps.ts:11` 'stays node-free with deps = the core
contract only'). The new expand helper plus the `use_stamp` tool/param and
`FacetStamp` slot types must be exported through the
`packages/core/src/index.ts` barrel (the current barrel already re-exports
`FacetStamp` / `validateStamp`), per the barrel-exports-only convention.

### RISK-PKG-4 (PKG) — Do-not-add-an-edge guard for @facet/quickstart

`@facet/quickstart` already obtains the resolved stamp library from
`@facet/runtime`'s `loadAssets` (`packages/quickstart/src/cli.ts:15` imports
`MemoryAssets` / `loadAssets` from `@facet/runtime`; `cli.ts:182`
`const loaded = await loadAssets(...)` yields `loaded.stamps`) and does NOT
depend on `@facet/assets` directly. The brief's quickstart changes (`use_stamp`
tool + prompt advertising names+slots+desc, replacing the prompt-copy path in
`packages/quickstart/src/prompt.ts:76` `MAX_STAMP_PROMPT_CHARS` /
`stampsSection`) can be implemented entirely with the stamps it already receives
plus the `@facet/core` expand helper.

RESOLUTION: the spec must have `@facet/quickstart` call the `@facet/core` expand
helper directly with the `loaded.stamps` snapshot it already holds; it must NOT
introduce a new `@facet/quickstart -> @facet/assets` import (default stamps
arrive through the existing `@facet/runtime -> @facet/assets` edge at
`packages/runtime/src/assets.ts:11`).
