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
   types are `box`, `text`, `image`, `field` (`packages/core/src/nodes.ts`).
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
| `@facet/runtime` | Event loop + `StageStore` (page state, always Facet's) + `Sink` (conversation — store/forward/drop). |
| `@facet/agent` | In-process agent SDK: the `Stage` control API + `defineAgent`. |
| `@facet/agent-client` | Dial-in SDK for an **external** agent (SSE + heartbeat + reconnect). |
| `@facet/cli` | The `facet` command — a running agent's action surface for the stage. |
| `@facet/server` | Reference transport: browser side + agent side (SSE + POST). |
| `@facet/react` | Renderer (`StageRenderer`), token `theme`, `useFacet`, `ChatDock`. |
| `@facet/kit` | Optional presets (`page/hero/card/grid/…`) — sugar over the bricks. |
| `@facet/store-postgres` | Durable `StageStore`/`Sink` backed by Postgres (`pg` peer dep). |
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
```

## Definition of Done (before you commit)

- `pnpm typecheck` passes.
- `pnpm test` passes (add/adjust tests for any behavior change — core logic like
  `validateTree`, `applyPatch`, and `Stage` op-generation must stay covered).
- New public API is exported through the package's barrel `index.ts`.
- No new dependency without a clear reason (keep `@facet/core` dependency-free).

There is no heavy multi-agent review gate — this checklist plus CI is the bar.

## Conventions

- TypeScript strict (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
  `verbatimModuleSyntax`). Use `import type` for types; import with `.js`
  extensions (bundler resolution).
- No `any`. Prefer `unknown` + narrowing (see `validate.ts`).
- Barrel exports only (`index.ts`); the `facet` bin is the one exception.
- Keep the four bricks minimal; grow the palette deliberately, never via raw markup.
