# AGENTS.md

Guidance for coding agents (and humans) working on **Facet**. This is the source
of truth; `CLAUDE.md` points here.

Facet is a TypeScript framework for **UI a language model renders itself** —
safe, live, and different for every user. The model composes interfaces from a
small set of safe primitives and mutates them live as the conversation goes.
(Living, per-visitor pages an agent "owns" are one application.) See
[README.md](README.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Two invariants (do not break)

1. **Agents emit a declarative brick spec, never raw HTML/JS.** The only node
   types are `box`, `text`, `media`, `field`
   (`packages/core/core/src/nodes.ts`).
   Style values are **tokens**, not raw scalars. Layout is **flow-only** (no
   absolute positioning). Adding a capability means adding a node type or token
   *on purpose* — never letting a model emit arbitrary code.
2. **Only patches travel** — [RFC 6902](https://datatracker.ietf.org/doc/html/rfc6902)
   JSON Patch — and the *same* pure `applyPatch` runs on server and client so
   they never drift. The renderer is **fail-safe**: unknown/dangling nodes are
   skipped, never thrown on.

## Scope boundary (what Facet is / isn't)

- **In scope:** the spec + patch protocol, the runtime (sessions + event loop),
  the renderer, the transports (reference SSE+POST), the agent SDKs/CLI.
- **Out of scope:** the agent's *brain* (LLM/rules — the user brings it) and
  large distributed/scale infrastructure (Redis fan-out, durable stores) — those
  are **pluggable adapters** behind interfaces (e.g. `StageStore` for the page,
  `Sink` for the conversation), not baked in.
- **Also out of scope:** hosted-platform control planes: tenant/project auth,
  API keys, billing, usage metering, rate limits, abuse operations, admin
  dashboards, secrets management, audit logs, and custom-domain routing. Facet
  stays a neutral OSS technology layer; production platforms wrap it.

## Package map

Source directories are grouped by role; npm package names and public import
specifiers stay unchanged. The physical source groups are not the same thing as
product support tiers: `@facet/server` lives under `packages/core/server`, but
it is a reference transport, not a hardened public edge.

| Group | Path | Package | Role |
| --- | --- | --- | --- |
| Core | `packages/core/core` | `@facet/core` | Contract: bricks, tokens, RFC 6902 patch, `validateTree`, session/event types. Depends on nothing. |
| Core | `packages/core/runtime` | `@facet/runtime` | Event loop + `StageStore` (page state, always Facet's) + `Sink` (conversation — store/forward/drop) + `AssetsStore` (per-agent theme/stamp/initial-tree registry; `MemoryAssets` + `loadAssets`, `withInitialStage`). File-backed Node references (`FileAssets`) via `@facet/runtime/node`. |
| Core | `packages/core/server` | `@facet/server` | Reference transport: browser side + agent side (SSE + POST). |
| Core | `packages/core/client` | `@facet/client` | Browser-side transports (`SseTransport`, `LocalTransport`) — the visitor's counterpart of `@facet/agent-client`. |
| Core | `packages/core/react` | `@facet/react` | Renderer (`StageRenderer`), the token→CSS theme (`boxStyle`/`textStyle`/`mediaStyle`/…), `useFacet`, `ChatDock`. |
| Core | `packages/core/assets` | `@facet/assets` | Node-free default-asset **data**: `DEFAULT_THEME` + `DEFAULT_STAMPS` (token/stamp value maps, not code). Depends only on `@facet/core`. |
| Agent Stack | `packages/agent-stack/agent-tools` | `@facet/agent-tools` | Provider-agnostic stage tool specs, executor, inspection helpers, and local shadow folding. |
| Agent Stack | `packages/agent-stack/reference-agent` | `@facet/reference-agent` | Reference LLM/stub brain: provider adapters, prompt, streaming tool loop, deterministic stub. |
| Agent Stack | `packages/agent-stack/quickstart` | `@facet/quickstart` | Zero-setup `facet-quickstart` CLI/server/page wrapper that composes `@facet/reference-agent`. |
| Extensions | `packages/extensions/agent` | `@facet/agent` | In-process agent SDK: the `Stage` control API + `defineAgent`. |
| Extensions | `packages/extensions/agent-client` | `@facet/agent-client` | Dial-in SDK for an **external** agent (SSE + heartbeat + reconnect). |
| Extensions | `packages/extensions/cli` | `@facet/cli` | The `facet` command — a running agent's action surface for the stage. |
| Extensions | `packages/extensions/bridge` | `@facet/bridge` | `facet-bridge` — a local coding agent (Claude/Codex) owns a link, driving the page via the `facet` CLI. |
| Extensions | `packages/extensions/store-postgres` | `@facet/store-postgres` | Durable `StageStore`/`Sink`/`AssetsStore` backed by Postgres (`pg` peer dep). |
| Labs | `packages/labs` | unpublished | Reserved for experiments; nothing here is part of the supported package contract. |
| App | `apps/playground` | unpublished | Demos (not published). |

Semantic tiers for documentation and support:

- **Facet Foundation:** `@facet/core`, `@facet/runtime`, `@facet/react`,
  `@facet/client`, `@facet/assets`.
- **Agent Integration:** `@facet/agent-tools`, `@facet/agent-client`,
  `@facet/agent`.
- **Reference / Demo / Local:** `@facet/server`, `@facet/quickstart`,
  `@facet/reference-agent`, `@facet/bridge`, `@facet/cli`.
- **Adapters:** `@facet/store-postgres`.

See `docs/PACKAGE-BOUNDARIES.md` before changing package positioning, publishing
metadata, or hosted-deployment claims.

`StageStore` and `Sink` methods are **async** (Promise-based) so backends can be
databases; the in-memory and file references resolve immediately.

Dependencies flow one way: everything depends on `@facet/core`; nothing depends
on `apps/playground`.

## Commands

```bash
pnpm install
pnpm typecheck      # tsc --noEmit across all packages
pnpm test           # vitest run (unit tests live in packages/**/src/*.test.ts)
pnpm demo           # in-process terminal demo
pnpm --filter @facet/playground dev     # browser playground (port 5290)
pnpm --filter @facet/playground serve   # live server (port 5291)
pnpm --filter @facet/quickstart build   # then: node packages/agent-stack/quickstart/dist/cli.js --stub
                                        # (published as the facet-quickstart bin, port 5292)
```

The `/live-test` tiers are vitest runs: Tier 1a
`pnpm exec vitest run packages/agent-stack/quickstart/src/quickstart.e2e.test.ts`
(twice), Tier 1b/2/3 use
`--config packages/agent-stack/quickstart/e2e/vitest.config.ts` against
`e2e/bundle.test.ts` / `e2e/smoke.test.ts` — see the active agent skill for the
exact commands and policy (`.agents/skills/live-test/SKILL.md` for Codex,
`.claude/skills/live-test/SKILL.md` for Claude Code).

## Definition of Done (before you commit)

- **`/verify`** passes — typecheck, test, lint, format:check, build (or run those
  `pnpm` commands directly). Add/adjust tests for any behavior change; core logic
  (`validateTree`, `applyPatch`, `Stage` op-generation) must stay covered.
- **`/code-review`** on a non-trivial change — P0–P2 = 0 (P3 nits non-blocking).
- Run the gate profile for the flow: **feature development** and **refactoring**
  have different hard gates (below).
- New public API is exported through the package's barrel `index.ts`.
- No new dependency without a clear reason (keep `@facet/core` dependency-free).

### Feature hard gate

For new feature work or any approved `/spec-bridge` implementation:

`/update-tests` → `/verify` → `/code-review` → `/live-test` → `/update-docs`

`/live-test` runs after `/code-review` as the live-link gate. The three fast
vitest tiers: Tier 1 (deterministic stub E2E + real-bundle run) always blocks;
Tier 2 (key-gated provider smoke) **blocks whenever
`packages/agent-stack/quickstart/` changed, or when
`packages/agent-stack/reference-agent/src/{agent,provider}.ts` or
`packages/agent-stack/reference-agent/package.json` changed** — a missing key is
then a FAIL, not a skip; Tier 3 (both providers) runs pre-merge/release. Plus an
**owner-run "live journey" tier** (real headless browser + real LLM +
vision-judged screenshots, pre-merge/on-request, SKIP without a key) that the
skill invokes after the vitest tiers.

### Refactor hard gate

For approved `/refactor-audit` cleanup work with no intended behavior change:

`/update-tests` → `/verify` → `/code-review` → `/update-docs`

Run `/live-test` too when the refactor touches a live-link surface:
`packages/agent-stack/quickstart`, `packages/core/server`,
`packages/core/client`, `packages/extensions/agent-client`,
`packages/core/runtime`, `packages/extensions/bridge`, `packages/core/react`
renderer/useFacet/ChatDock paths, or core patch/protocol/stage vocabulary. Also
run it for release/pre-merge owner requests.

The gates are right-sized: `/verify` is mechanical, `/code-review` is
evidence-based and adversarially verified, `/live-test` proves a real boot for
feature/live-link risk, and `/refactor-audit` is the owner-run consolidation
entrypoint.
See [docs/REVIEW-RULES.md](docs/REVIEW-RULES.md) for the rubric and severity.

## Building a non-trivial feature (the pipeline)

For anything bigger than a quick fix, use the skill pipeline instead of coding
straight away:

```
/context-scout    (optional) gather docs + entrypoints + consumer sweep → GO/NO-GO
/feature-intake   rough idea → structured, testable, invariant-checked brief
/spec-bridge      brief → dev spec + execution manifest (Work Units, TDD red checks)
/worktree-prep    create isolated worktree + branch, carry plan artifacts, baseline
/implement        in the prepared worktree, run WUs TDD-first → feature hard gate

Refactor flow:
/refactor-audit   structural audit → owner approves cleanup scope
/worktree-prep    create isolated refactor worktree + branch, baseline
execute scope     apply only the approved cleanup → refactor hard gate
```

`/feature-intake` and `/spec-bridge` both enforce Facet's invariants as gates
(UI-out/UI-in only, mechanism-vs-policy, fail-safe, declarative-only, flow-only
overlay discipline, two-writers coherence, backend-via-agent). Quick mechanical
fixes can skip straight to `/verify` → `/code-review`.

## Conventions

- TypeScript strict (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
  `verbatimModuleSyntax`). Use `import type` for types; import with `.js`
  extensions (bundler resolution).
- No `any`. Prefer `unknown` + narrowing (see `validate.ts`).
- Barrel exports only (`index.ts`); the `facet` bin is the one exception.
- Keep the four bricks minimal; grow the palette deliberately, never via raw markup.
