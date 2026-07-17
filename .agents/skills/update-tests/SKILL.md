---
name: update-tests
description: >
  Keep Facet's tests aligned with behavior changes. Detects changed files, maps
  each changed production file to a test obligation, adds/updates the covering
  vitest test, and runs the affected package suites. Use after code changes,
  before /verify, or when the user says "update tests".
---

# Update Tests (Facet)

> Don't let test evidence drift from behavior. Every changed production file must
> either gain/keep a covering test or be accounted for as intentionally untested.

Facet tests are **vitest**, one project per grouped package
(`packages/{core,agent-stack,extensions}/*/src/**/*.test.ts`). Run all:
`pnpm test`. Run one package from the repository root:
`pnpm exec vitest run packages/<group>/<name>/src`.

## Pass/Fail policy
- A changed production file with no covering test and no accountability row → FAIL.
- A required command not run, or a run command failing → FAIL.
- Any obligation row left `PENDING` at the end → FAIL.

## Detect changes
```
git diff --name-only HEAD
git diff --name-only --cached
git ls-files --others --exclude-standard
```
Merge the three lists.

## Skip conditions (skip to /verify with an explicit reason)
- Test files only.
- Docs/markdown only (`*.md`, `docs/**`).
- Comments/formatting only.
Any `packages/{core,agent-stack,extensions}/*/src/**` (non-test) or
config/build change → do NOT skip.

## Workflow
1. **Map to packages.** `packages/<group>/<name>/src/**` → that package.
   `apps/playground/**` → playground (integration/manual — note if no unit
   suite). `.agents/**`, `.claude/**`, `.codex/**`, root `*.md` → infra/docs (skip unit
   tests).
2. **Build an obligation ledger** — one row per changed non-test source file:
   `{ package, source_file, test_target, behavior, status: PENDING }`.
   Every changed source file must produce a row; an unmapped file needs an
   explicit manual row or it's a FAIL.
3. **Cover each row.** Add or update the vitest test that exercises the changed
   behavior. Prefer testing pure logic directly. The closed `@facet/core`
   vocabulary is exactly `box`, `text`, `media`, `input`, `richtext`, `table`,
   `chart`, `list`, `keyValue`, `progress`, and `loading`; patching,
   validation, tokens, Brick sanitizers, runtime stores/queues, agent Stage operations, CLI
   command builders, and agent-client SSE parsing are all unit-testable.
   For `@facet/react`, split by what the test needs:
   - static output + fail-safe (renders X, degrades to plain, never throws) →
     `renderToStaticMarkup` in a `.test.ts` (node env) — see `StageRenderer.test.ts`.
   - **interaction / hook behavior** (an agent action reaching `onAction`, the
     `useFacet` patch/say/fail-safe loop, input rendering/value capture, and
     browser-local `navigate`/`toggle` resolution plus tap recording) → a
     **jsdom render test** with
     `@testing-library/react` in a `.test.tsx` file that starts with
     `// @vitest-environment jsdom` — see `StageRenderer.interaction.test.tsx` and
     `useFacet.test.tsx`. This is Facet's "QA": the render loop unit tests can't
     otherwise reach. Only defer to manual/visual dogfood for genuinely
     pixel-visual concerns.
   - **Fail-safe obligations (Facet-specific):** if the change touches
     `@facet/core` validate/patch or `@facet/react` StageRenderer, include a
     boundary test (malformed / empty / deep / cyclic input, unsafe `media.src`) —
     the "never throws, degrades to plain" invariant must stay covered.
   - **Vocabulary obligation:** if the brick/token/action vocabulary changed
     (`nodes.ts`/`tokens.ts`/`protocol.ts`), ensure `validate.test.ts` covers the
     new/removed shape.
4. **Run the affected suites** (mandatory commands below). Mark each row PASS/FAIL.
5. **Report** the ledger + executed commands. Any FAIL → fix and re-run.

## Mandatory commands by change
| Changed | Command |
|---|---|
| `packages/<group>/<name>/src/**` | `pnpm exec vitest run packages/<group>/<name>/src` (from the repository root) |
| multiple packages | `pnpm test` (root — runs the whole vitest workspace) |
| `apps/playground/**` | note manual/integration check (no blocking unit gate) |

## Scale (optional)
Solo/default: the main agent does the mapping + edits inline. For a large change
spanning many packages, you MAY spawn one `general-purpose` subagent per package
with its filtered file list + obligation rows; otherwise keep it inline.

## Output contract
```
TEST UPDATE RESULT
Changed packages: [core, runtime, ...]
Obligation ledger:
  - <source_file> → <test_target> | behavior=<...> | status=PASS/FAIL
Tests added/updated:
  ✅ <path> — <what it covers>
Accountability (intentionally untested):
  ⏭️ <file> — reason + why a unit test adds little (e.g. React render → visual check)
Executed commands:
  - <command> [PASS/FAIL]
OVERALL: PASS / FAIL
```

## Next step
On PASS → `/verify`.
