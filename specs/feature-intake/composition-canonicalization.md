# Feature Intake: Composition Canonicalization

Status: APPROVED by owner on 2026-07-10. This is a focused follow-up to
`component-model-and-layout-contract` on the same feature branch and PR.

## Goal

Remove the unreleased stamp compatibility model completely and make composition
the only public/runtime/agent-facing name for reusable declarative component
definitions.

The canonical surface is:

- `FacetComposition`
- `CompositionMetadata`
- `validateComposition`
- `CompositionParams`
- `ExpandAt`
- `UseCompositionResult`
- `ExpandCompositionResult`
- `ExpandCompositionOptions`
- `expandComposition`
- `DEFAULT_COMPOSITIONS`
- `AssetDocuments.compositions` / `LoadedAssets.compositions`
- `StageToolAssets.compositions`
- `use_composition`
- `Stage.useComposition`
- `*.composition.json`
- `FacetCatalog.compositions`
- Postgres `facet_assets.compositions`

No stamp-named compatibility alias, input field, tool, file extension, catalog
fallback, or database adapter field remains. There are no external users, so a
clean breaking surface is preferred over carrying a migration layer into the
first release.

## Why

The preceding component-model work made composition the documented concept but
kept the old stamp implementation as the operational path. That leaves three
asset inputs (`stamps`, `componentDefinitions`, and `compositions`) and two
loaded outputs (`stamps` and `componentDefinitions`). Quickstart still passes
only `loaded.stamps` into `use_stamp`, so newly loaded component definitions do
not reach the execution path. The release surface should have one noun and one
end-to-end path.

## User And Operator Scenarios

1. An operator places `pricing.composition.json` in an assets directory. Facet
   validates it once, advertises only bounded metadata to the model, and expands
   it server-side when the model calls `use_composition`.
2. A TypeScript agent calls `Stage.useComposition` with a validated
   `FacetComposition`; expansion mints fresh ids and emits one closed patch
   batch.
3. A catalog allows all compositions or a bounded name allow-list through its
   single `compositions` field and single authoring order
   `composition -> component -> primitive`.
4. Empty, malformed, hostile, deep, cyclic, duplicate, or oversized composition
   documents are rejected or sanitized with bounded issues and never crash boot
   or emit partial patches.
5. Default reusable examples remain available as `DEFAULT_COMPOSITIONS`; they
   are explicit data assets, not intrinsic component vocabulary or renderer
   plugins.

## Constraints And Non-Goals

- Do not change primitive or intrinsic node shapes.
- Do not add raw HTML, JS, CSS, scalar styling, fetch, bindings, expressions, or
  renderer plugins to compositions.
- Do not expand compositions in the browser. The visitor receives ordinary
  validated nodes and RFC 6902 patches only.
- Do not rename unrelated uses of the English verb “stamp” for SSE sequence ids,
  DOM annotations, or timestamps.
- Do not preserve `FacetStamp`, `validateStamp`, `expandStamp`, `DEFAULT_STAMPS`,
  `use_stamp`, `Stage.useStamp`, `stamps`, `.stamp.json`, legacy catalog stamp
  policy, or the Postgres `stamps` adapter surface.
- Do not preserve `componentDefinitions` as a parallel asset collection; the
  single collection name is `compositions`.
- Do not push, open a new PR, or create a new branch for this follow-up.

## Done Criteria

- **DC-001 — Canonical core API:** `@facet/core` exports only the composition
  type, metadata, validator, expansion types, and `expandComposition`; no
  composition-related Stamp export or barrel remains.
- **DC-002 — Validation safety:** composition validation preserves all existing
  bounds, null-prototype output, cycle/depth handling, token/node sanitization,
  metadata caps, slot validation, and never-throw behavior.
- **DC-003 — Expansion safety:** expansion preserves slot fill, reachable-subtree
  pruning, external action-target removal, fresh-id remapping, parent checks,
  patch caps, and atomic/no-partial failure behavior. Caught exception details
  are read through a never-throwing accessor, have C0/DEL/C1 controls removed,
  and are capped at 256 characters; an exception whose `message` getter throws
  is reported only as a fixed generic error and never exposes the getter's
  original sentinel.
- **DC-004 — Single catalog model:** `FacetCatalog` has one required
  `compositions` policy and one `policy.order` equal to
  `composition -> component -> primitive`; stamp policy/order fallback is gone.
- **DC-005 — Default assets:** `@facet/assets` exports
  `DEFAULT_COMPOSITIONS`; all bundled definitions validate and no
  `DEFAULT_STAMPS` export/file remains.
- **DC-006 — Single runtime path:** `AssetDocuments` and `LoadedAssets` expose
  only `compositions`; defaults and custom compositions share one validation,
  deduplication, shadowing, and bounded-issue path.
- **DC-007 — File assets:** `FileAssets` reads sorted
  `*.composition.json` documents only; `.stamp.json` and `.component.json` are
  not recognized composition formats. Directory discovery examines at most
  4097 entries for a 4096-entry cap and fails closed before opening/parsing any
  asset on overflow. Each theme/composition collection opens at most its first
  1024 sorted files, and every file read stops at 1048577 bytes so a file that
  grows past 1 MiB is rejected before decode or `JSON.parse`.
- **DC-008 — Agent tool contract:** the only reusable-component tool is
  `use_composition`; tool input/result/error/observation/buffer/prompt contracts
  use composition terminology and enforce catalog allow-lists.
- **DC-009 — Reference and quickstart wiring:** loaded compositions flow through
  reference-agent options, prompt metadata, stage-tool assets, quickstart hooks,
  and provider E2E without leaking full node JSON or slot defaults.
- **DC-010 — TypeScript agent SDK:** `Stage.useComposition` is the sole expansion
  method and preserves closed-batch behavior for existing and newly created
  parents.
- **DC-011 — Postgres adapter:** new schema and adapter reads/writes use only the
  `compositions` JSONB column and `AssetDocuments.compositions`.
- **DC-012 — Documentation and release surface:** current docs, package READMEs,
  STAGE_SPEC, current component-model planning artifacts, and a changeset teach
  only composition terminology. A structural occurrence scanner covers
  `packages`, `apps`, `README.md`, `AGENTS.md`, `docs`, and `.changeset`, removes
  only exact allow-listed sequence/timestamp occurrences, and rejects every
  residual `/stamp/i` match including mixed allowed+forbidden lines. The new
  changeset is parsed with Changesets' YAML/frontmatter parser and contains
  exactly the eight affected packages at `minor`.
- **DC-013 — Full regression gate:** affected package tests, full verify,
  adversarial code review, quickstart live-test tiers, and docs gate pass.

## Invariant Fit

| Invariant | Status | Safe design |
|---|---|---|
| UI-out/UI-in responsibility | Touched | Composition remains UI data; no domain or backend capability is added. |
| Mechanism vs policy | Touched | Core owns validation/expansion; operators own composition documents and catalog policy. |
| Fail-safe | Touched | Existing sanitizer, caps, no-partial expansion, and bounded issue behavior are retained under canonical names. |
| Declarative and token-only | Touched | Definitions contain only closed Facet nodes and token styles. |
| Flow-only | Touched | Expanded nodes pass normal validation and the renderer layout contract. |
| Two writers | Touched | Expansion remains server-side and emits one referentially closed patch batch. |
| Backend via agent | Touched | Browser never fetches or resolves a composition; agent actions remain the backend route. |

## Public API Impact

This is an intentional breaking cleanup across `@facet/core`, `@facet/assets`,
`@facet/runtime`, `@facet/agent-tools`, `@facet/reference-agent`,
`@facet/quickstart`, `@facet/agent`, and `@facet/store-postgres`. Every in-repo
consumer must migrate in the same change. No compatibility aliases are allowed.

## Decision Lock

- The canonical noun is `composition`; theme `recipes` remain style-only.
- Composition documents use `FacetComposition`, not a parallel
  `FacetComponentDefinition` collection.
- The 11 bundled reusable examples remain as `DEFAULT_COMPOSITIONS` data.
- Existing local Postgres rows and old asset files receive no automatic stamp
  compatibility migration; pre-release development data may be recreated.
- The current prepared branch/worktree and PR are reused.
