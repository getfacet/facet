# Feature Brief: Composition Reference Datasets

> Produced by `/feature-intake` from the owner's locked rewind request and
> `specs/context/composition-reference-datasets.md`. The owner's request to run
> the complete planning pipeline authorizes immediate `/spec-bridge`
> translation, but not implementation.

## 1. Outcome

Facet compositions become concrete, validated UI reference datasets instead of
callable templates. The LLM receives a small index of available examples, can
read one complete example with a single read-only tool, and then writes ordinary
native Facet nodes through the existing stage tools. The final stage contains no
composition reference, slot, parameter, expansion provenance, or new node kind.

Success means the full functional composition surface is removed in one
pre-1.0 cutover and every shipping consumer, fixture, guide, and release note
describes the new data-only contract.

## 2. Users and Jobs

### Primary user: LLM agent author

- Discover the operator-approved UI examples without paying prompt cost for all
  node JSON.
- Read one complete concrete example when it helps.
- Copy/adapt its native nodes using ordinary Facet write tools.
- Skip the lookup for a simple UI.

### Secondary user: Facet operator/maintainer

- Store themes, catalog policy, and concrete composition examples in the same
  assets pipeline.
- Validate each example once at load time with the normal closed native-node,
  token, topology, depth, and size rules.
- Restrict which examples the agent sees through the existing catalog
  composition allow policy.
- Receive bounded issues for invalid examples without crashing boot or mutating
  a visitor stage.

### Non-user / out of scope

- Browser and renderer do not fetch or receive composition assets.
- Facet does not generate product-specific content or interpret metadata as a
  product policy/DSL.
- This change does not redesign the existing native `FacetNode` vocabulary.

## 3. User-visible Flow

1. Host loads an `AssetsStore` once with `loadAssets`.
2. Every composition document is sanitized into a concrete
   `{name, metadata, root, nodes}` reference subtree or skipped with issues.
3. The public pure selector
   `selectCompositionReferences(compositions: readonly unknown[], catalog?: unknown): readonly FacetComposition[]`
   solely owns validation, first-valid dedupe, catalog filtering, caller
   detachment, and deep-freezing for the same snapshot used by prompt and tool
   executor. Omitted catalog exposes all valid references within a deterministic
   128-reference safety cap; a supplied malformed catalog exposes none.
4. The system prompt lists only each exposed composition's `name` and short
   `metadata.description`.
5. The model either:
   - skips lookup and authors native nodes directly; or
   - calls `get_composition({name})` and receives the complete concrete JSON.
6. The read call emits no patch/message and leaves the local stage shadow and
   pending edit buffer unchanged.
7. The model authors/copies/adapts native nodes with existing stage tools.
8. Only ordinary RFC 6902 stage patches reach runtime/client; the final document
   has no record that a reference example was consulted.

## 4. Inputs, Outputs, and Errors

### Asset input

```ts
interface FacetComposition {
  readonly name: string;
  readonly metadata: CompositionMetadata & {
    readonly description: string;
  };
  readonly root: NodeId;
  readonly nodes: Readonly<Record<NodeId, FacetNode>>;
}
```

- `metadata.description` is bounded, opaque, non-normative prose.
- Other existing metadata fields may remain optional and are visible only in
  the full lookup result.
- Root may be any retained native node (leaf or container).
- There is no `description` at top level, `slots`, `CompositionRef`, `use`,
  params, overrides, insertion target, or expansion option.

### Prompt output

```text
hero — A compact product intro with a primary action.
dashboard-summary — A metric, status, and progress summary.
```

No root, node IDs, node JSON, slot list, defaults, variants, or usage DSL appears
in the prompt index.

### Tool input

```json
{ "name": "hero" }
```

The JSON schema has exactly one required property (`name`) and
`additionalProperties: false`.

### Successful tool output

The standard structured observation reports `status: "ok"`,
`outcome: "no_stage_change"`, `stage_changed: false`, `patch_count: 0`, and
contains the exact complete serialized `FacetComposition` in `data`. The result
contains no minted IDs or insertion metadata, and `JSON.parse(data)` is
deep-equal to the selected validated composition with no field loss.

### Error outputs

- Unknown name: structured `invalid_composition` rejection, no throw, no stage
  effect.
- Catalog-disallowed name: same fail-safe rejection, with bounded policy
  guidance, no stage effect.
- Malformed input or extra fields: `invalid_input`, no stage effect.
- Invalid asset document: skipped during load with bounded issue; never appears
  in prompt or lookup.
- Full result cannot fit the next provider context: no partial/truncated JSON is
  sent; the reference loop stops with `context_limit`, emits its existing
  fail-safe response, and leaves the stage unchanged.

## 5. Done Criteria

| ID | Done criterion | Verification method |
|---|---|---|
| DC-001 | `FacetComposition` is exactly a named concrete native subtree with required `metadata.description`; top-level description, slots, and non-native refs are absent. | Core type/barrel tests plus validator unit tests for valid leaf/container roots and rejected legacy shapes. |
| DC-002 | Load validation preserves native node/token/topology/depth/size safety and skips malformed/dangling/cyclic native trees fail-safe; no composition graph semantics remain. | Core validator adversarial tests and runtime load integration tests. |
| DC-003 | The active prompt index contains only name + short description from the same detached, deeply frozen, validated/catalog-filtered selector snapshot that lookup uses. | Exact selector contract plus prompt/lookup parity tests for all/allow/empty/malformed policies, first-valid dedupe, serialization, freeze, and caller mutation. |
| DC-004 | `get_composition` is the only composition tool; input is exactly `{name}` and success returns the complete exact JSON with zero messages, patches, changed IDs, or shadow changes. | Tool spec/type/barrel tests, executor test with >2,048-char data, buffer no-mutation test. |
| DC-005 | A >4,000-character composition result reaches the next provider request byte-complete, including with zero configured recent-step retention; no truncation marker is present. Context overflow never sends a summary or partial result. | Reference transcript/loop/in-turn-compaction tests and deterministic provider integration test. |
| DC-006 | The LLM can consult an example and then author an equivalent/adapted native stage through ordinary tools; final tree contains no composition provenance. | Quickstart deterministic E2E (get then native writes) and live-link tiers. |
| DC-007 | Every default composition is self-contained concrete data with native nodes and concrete content; nested shared structures are inlined. | `@facet/assets` deep validation and negative marker/ref/slot searches. |
| DC-008 | All legacy public/runtime surfaces are gone with no compatibility aliases: graph/expand files and exports, `use_composition`, expansion input/result types, marker mode, registry fill hooks, and `Stage.useComposition`. | Negative public barrel tests, compile failures pinned through type assertions where possible, and shipping-surface search gate. |
| DC-009 | Composition is not an authoring node tier: catalog authoring order is `component -> primitive`; the composition allow-list remains only reference exposure policy. | Catalog validation/default tests, prompt copy tests, guide and playground checks. |
| DC-010 | Composition JSON stays provider/agent-side; browser shell/SSE and server/client protocols do not gain an asset route or payload. | Quickstart E2E frame/shell assertions plus no-diff/no-import verification in transport packages. |
| DC-011 | Raw File/Postgres adapters remain opaque; their concrete fixtures round-trip and `loadAssets` remains the sole semantic gate. | FileAssets and PostgresAssets focused tests; no SQL migration. |
| DC-012 | Product docs, package docs, guide golden, and unreleased changesets consistently describe the hard cutover. | `/update-docs`, guide hash test, changeset validation, and a tested deterministic shipping scanner that fails on unannotated matches or search errors. |

## 6. Constraints and Non-goals

### Constraints

- Pre-1.0 hard cutover; no deprecated alias, adapter, compatibility parser, or
  dual tool period.
- One atomic feature PR after approval/worktree preparation.
- Core stays dependency-free; assets stays dependent only on core; agent-tools
  does not import runtime/store/node APIs.
- Only ordinary stage patches travel to runtime/client.
- Renderer remains fail-safe and unchanged.
- The normal native `FacetNode` union is the allowed dataset vocabulary; this is
  not the later box-only node-model migration.
- A marker-looking string has no substitution semantics. Official assets/docs
  contain no marker examples.
- Historical `specs/**` records are archival and excluded from the shipping
  zero-hit search. User-owned untracked spec files are never modified.

### Non-goals

- No slot, param, override, insertion, location, patch, nesting, or expansion
  feature.
- No provenance field in the stage.
- No browser composition browser/gallery API.
- No hosted control plane, storage schema migration, asset admin API, or remote
  fetch.
- No model-side automatic selection policy beyond the optional reference
  guidance.
- No new node types, styling tokens, layout primitives, or renderer behavior.

## 7. Policy, Edge, and Concurrency Cases

| Case | Required behavior |
|---|---|
| Simple request | Model may author native UI without calling `get_composition`. |
| Duplicate composition names | Existing load layering/dedupe decides the winner once; for direct agent options the first valid occurrence wins. Prompt and lookup observe that one winner. |
| Catalog `mode: all` | Every valid loaded composition is indexed and retrievable. |
| Catalog allow-list | Only listed, valid loaded names are indexed/retrievable. |
| Empty/invalid restriction or malformed direct catalog | Fail closed: no composition is indexed/retrievable. |
| Caller mutates input arrays after agent creation | No change to prompt index or lookup result; agent uses an immutable validated clone. |
| Repeated reads | Deterministic identical data; no stage or buffer state change. |
| Read mixed with pending child edits | Pending queue remains intact and later resolves normally. |
| Unknown/disallowed read | Structured rejection; no emitted message/patch/shadow mutation. |
| Hostile getters/unknown node/style/raw CSS | Validation never throws; invalid composition is skipped and not exposed. |
| Leaf-root example | Accepted if the root is a retained native node. |
| Native child cycle/dangling/depth/size overflow | Existing fail-safe native topology policy applies; unusable root means document skipped. |
| Marker-looking literal | Treated as ordinary string content, never substituted; official examples avoid it. |
| Result over observation cap | Exact-data exception bypasses 2K and per-observation 4K/8K/12K truncation. |
| `minRecentStepsVerbatim: 0` | The newest composition-read group is still retained verbatim until its first provider handoff; it is never summarized before delivery. |
| Result over total provider context | Whole result retained internally; provider is not called with a partial result; loop exits `context_limit`. |
| Two concurrent visitors | Each agent turn reads the same immutable agent asset snapshot; visitor stages remain isolated. |
| Browser reconnect | Composition data is absent from reset/snapshot/SSE frames; only final native stage state rehydrates. |

## 8. Facet Invariant Audit

| Invariant | Fit |
|---|---|
| UI-out/UI-in responsibility | **TOUCHES, safe.** Read stays inside the provider tool loop; only later native patch writes leave the agent. |
| Mechanism not policy / no DSL | **TOUCHES, safe.** Concrete example data plus opaque prose only; no evaluated parameters, conditions, or templating. |
| Fail-safe | **TOUCHES, safe.** Invalid assets/read inputs/context overflow skip or stop with bounded errors and zero stage mutation. |
| Declarative + tokens only | **TOUCHES, safe.** All dataset nodes use the existing closed `FacetNode` and token validators. |
| Flow-only / overlay discipline | **OK.** No new layout surface; examples use existing validated flow/overlay contracts. |
| Two writers | **TOUCHES, safe.** Reads cannot write; final edits still use shared patch/fold ordering. |
| Backend via agent | **OK/TOUCHES.** Lookup reads injected assets only and accepts no backend/query/fetch input. |

## 9. Decision Lock

| Decision | Status | Reason / checkpoint |
|---|---|---|
| Functional composition is fully replaced, not deprecated. | OWNER-LOCKED | Pre-1.0, unshipped, atomic rewind. |
| Shape is `{name, metadata, root, nodes}` and every node is a current native `FacetNode`. | OWNER-LOCKED | No function/reference node tier. |
| `metadata.description` is required and bounded; top-level description is removed. | SPEC-LOCKED from owner wording | Approval of this brief/spec confirms the precise optionality. |
| Root retains fragment semantics (leaf or container). | SPEC-LOCKED | Avoids unrelated full-stage/container-only migration and preserves existing examples such as CTA button. |
| Prompt exposes only name + short description. | OWNER-LOCKED | JSON is on-demand only. |
| One read-only tool named `get_composition` with exact `{name}` input. | OWNER-LOCKED | No params/at/overrides/patch/insertion. |
| Known lookup returns exact complete serialized JSON in structured observation data. | OWNER + SPEC LOCK | Dedicated exact mode; no partial/truncated result. |
| Total-context overflow stops `context_limit`; no new paging/partial protocol. | SPEC-LOCKED | Preserves one-tool/name-only contract and fail-safe behavior. |
| Prompt and lookup use one validated, catalog-filtered immutable snapshot. | OWNER-LOCKED | No hardcoded secondary list. |
| The selector has the exact public signature above, is the sole exposure-policy owner, returns detached deeply frozen data, uses first-valid dedupe, treats omitted catalog as all within a deterministic 128-reference exposure cap, and supplied malformed catalog as none. | SPEC-LOCKED + HARD-GATE SAFETY AMENDMENT | Removes prompt/executor policy drift and mutable caller references while keeping the largest valid file collection inside the smallest reference-agent context profile. |
| Catalog composition allow policy remains; authoring order becomes `component -> primitive`. | SPEC-LOCKED | Keeps exposure control while removing composition as an authoring tier. |
| Marker-looking custom strings are literal, not actively rejected. | SPEC-LOCKED | Removes templating semantics instead of preserving a hidden marker language. |
| Graph/expansion APIs, registry hooks, tool, and Stage method are deleted with no shim. | OWNER-LOCKED | Hard cutoff. |
| File/Postgres storage remains raw/opaque; no database migration. | SPEC-LOCKED | Semantic validation belongs to `loadAssets`. |
| Historical `specs/**` remain archival; shipping code/tests/docs/changesets must be clean. | SPEC-LOCKED | Preserves historical evidence and user files while making release surfaces truthful. |
| No implementation/worktree/branch/push/merge before explicit dev-spec approval. | OWNER-LOCKED | Current pipeline stops at approval. |

No unresolved question blocks spec translation. Owner approval of the resulting
dev spec confirms the SPEC-LOCKED precision choices above.

Consistency checklist result: **PASS**. Scenarios, constraints, done criteria,
actors, edge cases, and all seven invariants are mutually consistent; there is
no unresolved invariant conflict or scope-affecting open question.
