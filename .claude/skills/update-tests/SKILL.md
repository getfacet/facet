---
name: update-tests
description: >
  Keep Facet's tests aligned with behavior changes. Detects changed files, maps
  each changed production file to a test obligation, adds/updates the covering
  vitest test, and runs the affected package suites. Use after code changes,
  before /verify, or when the user says "update tests".
allowed-tools: Bash(git diff:*), Bash(git status:*), Bash(git ls-files:*), Bash(pnpm:*), Read, Edit, Write, Glob, Grep, Agent
---

# Update Tests (Facet)

> Don't let test evidence drift from behavior. Every changed production file must
> either gain/keep a covering test or be accounted for as intentionally untested.

Facet tests are **vitest**, one project per grouped package
(`packages/{core,renderers,agents,adapters,tools}/*/src/**/*.test.ts`). Run all:
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
Any `packages/{core,renderers,agents,adapters,tools}/*/src/**` (non-test) or
config/build change → do NOT skip.

## Workflow
1. **Map to packages.** `packages/<group>/<name>/src/**` → that package.
   `.agents/**`, `.claude/**`, `.codex/**`, root `*.md` → infra/docs
   (skip unit tests).
2. **Build an obligation ledger** — one row per changed non-test source file:
   `{ package, source_file, test_target, behavior, status: PENDING }`.
   Every changed source file must produce a row; an unmapped file needs an
   explicit manual row or it's a FAIL.
3. **Cover each row.** Add or update the vitest test that exercises the changed
   behavior. Prefer testing pure logic directly. Markup parsing, catalog/prop
   validation, document/data bounds, authorized patch/fold behavior, immutable
   catalog/registry bootstrap, runtime stores/queues, agent tool operations, CLI
   command builders, and transport parsing are all unit-testable.
   For `@facet/react`, split by what the test needs:
   - static output + fail-safe (renders X, degrades to plain, never throws) →
     `renderToStaticMarkup` in a `.test.ts` (node env) — see `StageRenderer.test.ts`.
   - **interaction / hook behavior** (an agent action reaching `onAction`, the
     `useFacet` patch/message/fail-safe loop, input rendering/value capture,
     `nav:` screen navigation, and `agent:` event collection) → a
     **jsdom render test** with
     `@testing-library/react` in a `.test.tsx` file that starts with
     `// @vitest-environment jsdom` — see `StageRenderer.interaction.test.tsx` and
     `useFacet.test.tsx`. This is Facet's "QA": the render loop unit tests can't
     otherwise reach. Only defer to manual/visual dogfood for genuinely
     pixel-visual concerns.
   - **Fail-safe obligations (Facet-specific):** if the change touches Core
     parser/catalog/document/data/patch boundaries or React registry/rendering,
     include malformed, empty, deep, cyclic, mismatched-registry, and throwing
     trusted-component coverage as applicable.
   - **Agent-surface obligation:** if markup/catalog/action/data/tool vocabulary
     changes, cover the compact index, lazy component-spec read, tool schema, and
     prompt/observation consumers.
4. **Run the affected suites** (mandatory commands below). Mark each row PASS/FAIL.
5. **Report** the ledger + executed commands. Any FAIL → fix and re-run.

## Mandatory commands by change
| Changed | Command |
|---|---|
| `packages/<group>/<name>/src/**` | `pnpm exec vitest run packages/<group>/<name>/src` (from the repository root) |
| multiple packages | `pnpm test` (root — runs the whole vitest workspace) |

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
