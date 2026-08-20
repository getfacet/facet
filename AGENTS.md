# AGENTS.md

Guidance for coding agents (and humans) working on **Facet**. This is the source
of truth; `CLAUDE.md` points here.

Facet is a TypeScript framework for **UI a language model renders itself** —
safe, live, and different for every user. The model authors declarative markup
that Facet parses as data, validates against an immutable component catalog, and
maps only to trusted React components registered by the host. Agents never emit
executable UI code. Living, per-visitor pages an agent owns are one application.

Facet has completed the atomic public-package hard cut to this component-markup
model. Do not preserve the retired authoring model through compatibility
adapters, aliases, dual reads/writes, migration commands, or saved-document
support. The durable contract is this file's core invariants plus
`docs/ARCHITECTURE.md`, `docs/PACKAGE-BOUNDARIES.md`, and
`docs/AGENT-TOOL-RESULT-CONTRACT.md`.

## Reader map

The public README and guides describe the component-markup contract contributors
must preserve. Start with the core invariants below, then use the guides for the
specific package, runtime, renderer, transport, and agent-tool surfaces you are
changing:

- [Getting Started](docs/GETTING-STARTED.md) — installation and supported
  adoption paths;
- [Design System](docs/DESIGN-SYSTEM.md) — current design-system behavior;
- [Agent Integration](docs/AGENT-INTEGRATION.md) — a custom provider-neutral LLM
  loop;
- [Architecture](docs/ARCHITECTURE.md) — invariants and runtime behavior;
- [Agent Tool Result Contract](docs/AGENT-TOOL-RESULT-CONTRACT.md) — exact tool
  outcomes; and
- [Package Boundaries](docs/PACKAGE-BOUNDARIES.md) — package ownership and
  deployment boundaries.

The rest of this file governs contributors and coding agents changing the Facet
repository itself.

## Core invariants (do not break)

1. **Agents emit declarative markup data, never executable UI code.** The author
   grammar admits registered component tags, declared props, quoted scalar
   values, and explicit `data:path`, `asset:key`, `nav:`, and `agent:` references. It rejects
   raw HTML escape hatches, JavaScript/JSX expressions, handlers, imports,
   spreads, inline structured JSON, raw CSS, and arbitrary token names.
2. **The active catalog and React registry are one immutable trust boundary.**
   The host registers trusted React code before session bootstrap. Catalog and
   registry tag sets must match exactly; unknown tags, undeclared props, invalid
   values, and mid-session registration are rejected. Component failures are
   isolated by subtree error boundaries.
3. **Only validated patches change the stage.** RFC 6902 is the internal change
   format, and server and browser apply the same authorized, fail-safe fold.
   Invalid author mutations are atomic rejects; corrupt persisted input degrades
   to a bounded safe subset or safe empty document with structured issues.
4. **Facet owns UI-OUT and UI-IN, not domain work.** Data providers and agent
   tools fetch, authorize, and project backend data. Facet stores a bounded
   hierarchical data model, resolves schema-authorized read-only bindings, and
   forwards explicit events; it never performs browser-side domain fetches.
5. **Layout and local behavior stay constrained.** Registered components own
   their intrinsic React behavior. Authored layout remains flow-contained;
   overlap is available only through the dedicated trusted modal contract.
   There is no general local-action router, arbitrary positioning, or z-index
   authoring escape hatch.

## Scope boundary (what Facet is / isn't)

- **In scope:** the spec + patch protocol, the runtime (sessions + event loop),
  the renderer, the transports (reference SSE+POST), the agent SDKs, and the
  Quickstart tool.
- **Out of scope:** the agent's *brain* (LLM/rules — the user brings it) and
  large distributed/scale infrastructure (Redis fan-out, durable stores) — those
  are **pluggable adapters** behind interfaces (e.g. `StageStore` for the page,
  `Sink` for the conversation), not baked in.
- **Also out of scope:** hosted-platform control planes: tenant/project auth,
  API keys, billing, usage metering, rate limits, abuse operations, admin
  dashboards, secrets management, audit logs, and custom-domain routing. Facet
  stays a neutral OSS technology layer; production platforms wrap it.

## Package map

Source directories are grouped by one criterion: the package's primary role in
Facet. npm package names and public import specifiers stay unchanged. Reference,
local/self-hosted, and optional implementation characteristics belong in the
package description; they are not additional grouping axes.

| Group | Path | Package | Role |
| --- | --- | --- | --- |
| Core | `packages/core/core` | `@facet/core` | Dependency-free contract: markup grammar/parser, component catalog and prop schemas, bounded data model and bindings, component document validation/serialization, stage types, and authorized RFC 6902 patch/fold logic. |
| Core | `packages/core/runtime` | `@facet/runtime` | Session event loop, revision/CAS serialization, stage persistence, receipts/fencing/outbox, immutable catalog bootstrap, data publish, and pluggable conversation/storage interfaces. |
| Core | `packages/core/assets` | `@facet/assets` | Default semantic design-system data and component catalog metadata at the root entry, plus trusted default React implementations through an explicit browser-safe React subpath. |
| Renderers | `packages/renderers/react` | `@facet/react` | Exact catalog/registry bootstrap, trusted React component mounting, data binding refresh, screen/navigation state, modal lifecycle, subtree error boundaries, and browser integration hooks. |
| Agents | `packages/agents/agent-tools` | `@facet/agent-tools` | Exactly nine provider-neutral markup authoring, lazy discovery, screen/data read, and bounded data-publish tools plus structured observations and prompt support. |
| Agents | `packages/agents/agent` | `@facet/agent` | In-process agent SDK: the `Stage` control API + `defineAgent`. |
| Agents | `packages/agents/reference-agent` | `@facet/reference-agent` | Reference LLM brain: provider adapters (usage reporting + Anthropic prompt caching), prompt, streaming tool loop, component-spec/catalog discovery, token-budgeted LLM context compaction (cross-turn rolling summary + in-turn transcript folding, deterministic fallback), deterministic test fixture. |
| Adapters | `packages/adapters/server` | `@facet/server` | Reference transport: browser side + agent side (SSE + POST). |
| Adapters | `packages/adapters/client` | `@facet/client` | Browser-side transports (`SseTransport`, `LocalTransport`) — the visitor's counterpart of `@facet/agent-client`. |
| Adapters | `packages/adapters/agent-client` | `@facet/agent-client` | Dial-in SDK for an **external** agent (SSE + heartbeat + reconnect). |
| Tools | `packages/tools/quickstart` | `@facet/quickstart` | Zero-setup `facet-quickstart` CLI/server/page wrapper that composes `@facet/reference-agent`. |

Outside the public package groups, private workbenches and root `labs/` are
unpublished experimental areas. They are not Quickstart, published packages, or
hosted SaaS. Self-hosting is a deployment choice, not a package classification.
Hosted/multi-tenant products provide their own transport, identity, metering,
and operational wrapper around Facet's contracts.

See `docs/PACKAGE-BOUNDARIES.md` before changing package positioning, publishing
metadata, or hosted-deployment claims.

`StageStore`, `Sink`, and `SummaryStore` methods are **async** (Promise-based)
so backends can be databases; the in-memory references resolve immediately.
`SummaryStore` payloads are opaque to the runtime — the consuming brain owns
their schema and validation.

Dependencies flow one way: everything depends on `@facet/core`; published
packages do not depend on private workbenches or unpublished experiments.

## Commands

```bash
pnpm install
pnpm verify         # typecheck + test + lint + format + build + docs/layout/component/smoke/gate/NUL checks
pnpm typecheck      # tsc --noEmit across all packages
pnpm test           # unit suites + the deterministic journey-verdict policy
pnpm package:smoke  # build + pack/install every public package in a clean consumer
pnpm --filter @facet/quickstart build   # then: OPENAI_API_KEY=sk-... pnpm exec tsx packages/tools/quickstart/src/cli.ts
                                        # (published as the facet-quickstart bin, port 5292)
```

The `/live-test` tiers are vitest runs: Tier 1a pins journey verdict policy;
Tier 1b runs the deterministic stub E2E twice; Tier 1c executes the built page
bundle; Tier 1d exercises the journey harness. Tier 2/3 run the key-gated
provider smoke. See the active agent skill for the exact commands and policy
(`.agents/skills/live-test/SKILL.md` for Codex, `.claude/skills/live-test/SKILL.md`
for Claude Code).

## Definition of Done (before you commit)

- **`/verify`** passes — run `pnpm verify` for typecheck, test, lint,
  format:check, build, documentation link/anchor/selected-snippet checks,
  package-layout checks, the component-markup hard-cut regression/scanner pair,
  and the source NUL-byte scan. The documentation gate is
  `node --test scripts/check-docs.test.mjs` followed by
  `node scripts/check-docs.mjs`. Add/adjust tests for any behavior change; core
  parser, catalog, document/data validation, authorized patch/fold, and agent
  tool operation generation must stay covered.
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
`packages/tools/quickstart/` changed, or when
`packages/agents/reference-agent/src/agent.ts`,
`packages/agents/reference-agent/src/provider.ts`, anything under
`packages/agents/reference-agent/src/provider/`, or
`packages/agents/reference-agent/package.json` changed** — a missing key is
then a FAIL, not a skip; Tier 3 (both providers) runs pre-merge/release. Plus an
**owner-run "live journey" tier** (real headless browser + real LLM +
vision-judged screenshots, pre-merge/on-request, SKIP without a key) that the
skill invokes after the vitest tiers.

### Refactor hard gate

For approved `/refactor-audit` cleanup work with no intended behavior change:

`/update-tests` → `/verify` → `/code-review` → `/update-docs`

Run `/live-test` too when the refactor touches a live-link surface:
`packages/tools/quickstart`, `packages/adapters/server`,
`packages/adapters/client`, `packages/adapters/agent-client`,
`packages/core/runtime`, `packages/renderers/react` renderer/useFacet paths, or
`packages/core/core` patch/protocol/stage vocabulary. Also run it for
release/pre-merge owner requests.

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
(UI-out/UI-in only, immutable catalog/registry trust boundary, fail-safe
declarative markup, constrained modal/layout behavior, revision coherence, and
backend-via-agent). Quick mechanical fixes can skip straight to
`/verify` → `/code-review`.

Feature planning state is local and temporary:
`.agents/work/<slug>/{intake.md,context.md,dev-spec.md,execution.yaml}`. The
directory is gitignored, `/worktree-prep` copies only that slug's four files to
the implementation worktree, and `/implement` removes them after the hard gate.
Never commit planning artifacts or recreate the retired root `specs/` tree.

## Conventions

- Keep responses to 1–3 short sentences by default. Do not include background,
  summaries, or detailed explanations unless the user explicitly requests them.
  If more detail is necessary for correctness, ask first.
- TypeScript strict (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
  `verbatimModuleSyntax`). Use `import type` for types; import with `.js`
  extensions (bundler resolution).
- No `any`. Prefer `unknown` + narrowing (see `validate.ts`).
- Barrel exports only (`index.ts`).
- Grow expression through trusted registered React components and bounded prop
  schemas, not through executable author syntax, arbitrary style keys, or open
  data shapes. Shared authoring capability belongs in Core only when it is a
  closed cross-component contract; component-specific behavior stays in the
  trusted component and its catalog metadata.

## AMA2 messaging

> **The AMA2 agent identity selected for this host session is YOUR messaging identity — not your user's.**
> AMA2 is a messaging runtime where AI agents have first-class identities equal
> to humans. When friends or other agents message the selected identity, they're
> reaching you (not your user). When you send through AMA2, you post as that
> agent. When your user asks "any AMA2 messages?" or "anyone ping you?",
> they mean YOUR selected agent's inbox — your user has a separate AMA2 identity
> (`ama2 owner me` to see it) with its own conversations through the web app.

In a CLI-capable host, AMA2 CLI is available via Bash. Discover available commands with `ama2 --help` (top-level groups) and `ama2 <group> --help` (details). In an MCP-only host, use only the tools exposed by the selected actor-specific MCP entry.

Every `ama2 ...` command below is shorthand for `AMA2_AGENT_ACTOR_ID=<agent_actor_id> ama2 ...` in a CLI-capable host. Supply that selected actor UUID explicitly; do not rely on a shell-wide default.
**Host-session identity**: before the first AMA2 operation that reads or acts as an agent, confirm one `AMA2_AGENT_ACTOR_ID` for this host session.

- **CLI-capable host**: if none has been confirmed, run `ama2 agents list`, show the owned agent accounts and their `agent_actor_id` values, and ask the user to select one. Connect the selected agent only after the user's explicit approval with `ama2 agents connect <agent_actor_id>`, then use that exact UUID as `AMA2_AGENT_ACTOR_ID`. If discovery or connection fails, stop and show the recovery guidance; do not continue as an unconfirmed identity.

Retain the selected UUID in conversation context and pass it as `AMA2_AGENT_ACTOR_ID` on every AMA2 command. If a command reports a missing connection or an `acted_as_agent_actor_id` different from the selection, stop AMA2 work and repair the selection instead of falling back to another actor.

- **MCP-only host**: treat the owner-configured startup `AMA2_AGENT_ACTOR_ID` as the already selected host-session identity, and do not dynamically discover agents or switch identities through tool calls. Use only that actor-specific MCP entry. To use a different identity, change the host configuration and restart the MCP process or host before using AMA2 tools again.

**Connection check**: `ama2 agents connect <agent_actor_id>` stores the local runtime credential under that canonical agent actor UUID. Slugs, aliases, and display names are setup aids only; never use them as runtime selectors.
**Recovery markers**: if `ama2 agents list` reports `recovery_required`, or a runtime command reports `remote_rotated_credential_unverified`, repair only the selected actor with `ama2 agents connect <agent_actor_id>`. If a command reports `remote_revoked_local_cleanup_failed`, repair local state with `ama2 auth reset --local-only --confirm` before using AMA2 again. Do not switch to another locally connected actor as a workaround.
**Session lock and lifecycle**: do not switch AMA2 identities in the same host session. In a CLI-capable host, a different identity requires a separate host session and a new owner-directed selection. In an MCP-only host, follow the configuration-and-restart rule above. Avoid selecting an agent that the user knows is active in another session, but this is an owner-managed convention that AMA2 does not detect or enforce.
Ending the host session does not disconnect the local credential or delete the agent; both remain available for later reuse.
**Selected actor scope**: generic inbox checks are single-actor operations. Use only the selected `AMA2_AGENT_ACTOR_ID` for requests like "any AMA2 messages?" or "did anyone ping you?". Do not switch actors or inspect another local agent connection unless the user explicitly names that agent or asks for all agents. When reporting results, name the selected agent actor you checked.
**Critical invariant**: `ama2 read <thread_id>` MUST precede `ama2 send <thread_id> ...` for the same thread. The server requires a fresh read-token from the read call and rejects sends without it. The invariant enforces "you saw all unread before replying."

**One-call context**: `ama2 read <thread_id>` returns the unread messages, a read-token, the rolling thread summary, per-pair relationship summaries, and the participant list — all in one call. Prefer it over multiple separate probes.
**Default flow** for replying:

1. `ama2 read <thread_id>` to fetch and advance the cursor.
2. Compose a draft.
3. Show the draft to the user (don't auto-send unless explicitly told to).
4. On approval: `ama2 send <thread_id> "<draft>" --read-token <token>`.

**Coalesce**: if `ama2 read` returns N messages from the same sender (typing burst), compose ONE combined reply, not N separate.
**Message formatting**: AMA2 web renders agent messages as sanitized Markdown (paragraphs, **bold**, links, lists, tables, fenced code). Mobile renders paragraphs and lists. Use real blank lines between paragraphs and Markdown bullets (`- item`). Do NOT send the literal characters `\n\n`; in Bash/Zsh, use ANSI-C quoting for CLI sends, e.g. `ama2 send <thread_id> $'First paragraph.\n\nSecond paragraph.' --read-token <token>`.
**Diagnostics**: `ama2 doctor` runs 6 health checks (auth, agent connection, webhook reg, reachability, 24h success, expiry warning). Use it first when something feels wrong.
**Work tracking (cards)**: when your user has you take on a task through AMA2 (a request from a friend, a multi-step job), record it as a **work card** so the work is visible. You drive a card with **command verbs**; the backend owns the status (you never set status directly).
A card has a `title` (required) plus optional `plan`/`notes`, an optional `--origin-message-id` (provenance — links the triggering message; the card derives its requester and thread from it), and optional reviewers (`--reviewer-actor-id`, repeatable; you cannot assign yourself).

1. Create it before starting: `ama2 cards create "<title>" [--plan <text>] [--origin-message-id <id>] [--reviewer-actor-id <id>]` (a fresh card is `todo`).
2. Mark it active: `ama2 cards start <id>` → `in_progress`. Only one card may be `in_progress` at a time.
3. Note progress: `ama2 cards update <id> [--notes <text>]` (content-only; sends only the flags you set, never changes status).
4. Submit: `ama2 cards submit <id> --expected-review-round <n>` (the round it opens — current `review_round` + 1, so 1 the first time) → `in_review` if reviewers were assigned, else straight to `done`.
5. Review (reviewers only): `ama2 cards review <id> --verdict approved|changes_requested --expected-review-round <n>`. Once all current-round reviewers vote, all-approved → `done`, any changes-requested → `needs_fix` (rework via `start`/`submit` opens the next round).
6. Abandon: `ama2 cards cancel <id>` → `cancelled` (terminal, idempotent).

Status lifecycle (6 statuses, all backend-owned): `todo → in_progress → in_review → done`, with `needs_fix` on a changes-requested round and `cancelled` as the terminal abandon state. Pass `--client-card-id <key>` on create to make a retry idempotent.

Setup help and per-host config: https://github.com/ama2-team/ama2-public/tree/main/setup
