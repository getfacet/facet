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
   types are `box`, `text`, `media`, `field` (`packages/core/src/nodes.ts`).
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

## Package map

| Package | Role |
| --- | --- |
| `@facet/core` | Contract: bricks, tokens, RFC 6902 patch, `validateTree`, session/event types. Depends on nothing. |
| `@facet/runtime` | Event loop + `StageStore` (page state, always Facet's) + `Sink` (conversation — store/forward/drop) + `AssetsStore` (per-agent theme/stamp/initial-tree registry; `MemoryAssets` + `loadAssets`, `withInitialStage`). File-backed Node references (`FileAssets`) via `@facet/runtime/node`. |
| `@facet/agent` | In-process agent SDK: the `Stage` control API + `defineAgent`. |
| `@facet/agent-client` | Dial-in SDK for an **external** agent (SSE + heartbeat + reconnect). |
| `@facet/client` | Browser-side transports (`SseTransport`, `LocalTransport`) — the visitor's counterpart of `@facet/agent-client`. |
| `@facet/cli` | The `facet` command — a running agent's action surface for the stage. |
| `@facet/server` | Reference transport: browser side + agent side (SSE + POST). |
| `@facet/react` | Renderer (`StageRenderer`), the token→CSS theme (`boxStyle`/`textStyle`/`mediaStyle`/…), `useFacet`, `ChatDock`. |
| `@facet/assets` | Node-free default-asset **data**: `DEFAULT_THEME` + `DEFAULT_STAMPS` (token/stamp value maps, not code). Depends only on `@facet/core`. |
| `@facet/store-postgres` | Durable `StageStore`/`Sink` backed by Postgres (`pg` peer dep). |
| `@facet/bridge` | `facet-bridge` — a local coding agent (Claude/Codex) owns a link, driving the page via the `facet` CLI. |
| `@facet/quickstart` | Reference LLM brain + zero-setup `facet-quickstart` bin — the `@facet/server` of brains (the brain stays pluggable). |
| `apps/playground` | Demos (not published). |

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
pnpm --filter @facet/quickstart build   # then: node packages/quickstart/dist/cli.js --stub
                                        # (published as the facet-quickstart bin, port 5292)
```

The `/live-test` tiers are vitest runs: Tier 1a
`pnpm exec vitest run packages/quickstart/src/quickstart.e2e.test.ts` (twice),
Tier 1b/2/3 use `--config packages/quickstart/e2e/vitest.config.ts` against
`e2e/bundle.test.ts` / `e2e/smoke.test.ts` — see
`.claude/skills/live-test/SKILL.md` for the exact commands and policy.

## Definition of Done (before you commit)

- **`/verify`** passes — typecheck, test, lint, format:check, build (or run those
  `pnpm` commands directly). Add/adjust tests for any behavior change; core logic
  (`validateTree`, `applyPatch`, `Stage` op-generation) must stay covered.
- **`/code-review`** on a non-trivial change — P0–P2 = 0 (P3 nits non-blocking).
- **`/live-test`** after `/code-review` — the live-link gate. The three fast
  vitest tiers: Tier 1 (deterministic stub E2E + real-bundle run) always blocks;
  Tier 2 (key-gated provider smoke) **blocks whenever `packages/quickstart/`
  changed** — a missing key is then a FAIL, not a skip; Tier 3 (both providers)
  runs pre-merge/release. Plus an **owner-run "live journey" tier** (real headless
  browser + real LLM + vision-judged screenshots, pre-merge/on-request, SKIP
  without a key) that the skill invokes after the vitest tiers.
- New public API is exported through the package's barrel `index.ts`.
- No new dependency without a clear reason (keep `@facet/core` dependency-free).

The gate is right-sized: `/verify` (mechanical), `/code-review` (evidence-based,
adversarially verified), and `/live-test` (a real boot) per change;
`/refactor-audit` for consolidation passes.
See [docs/REVIEW-RULES.md](docs/REVIEW-RULES.md) for the rubric and severity.

## Building a non-trivial feature (the pipeline)

For anything bigger than a quick fix, use the skill pipeline instead of coding
straight away:

```
/context-scout    (optional) gather docs + entrypoints + consumer sweep → GO/NO-GO
/feature-intake   rough idea → structured, testable, invariant-checked brief
/spec-bridge      brief → dev spec + execution manifest (Work Units, TDD red checks)
/implement        branch/worktree → run WUs TDD-first → inner-loop gates
   └─ inner loop:  /update-tests → /verify → /code-review → /live-test → /update-docs
/refactor-audit   periodic structure audit (owner-run, not per-feature)
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
