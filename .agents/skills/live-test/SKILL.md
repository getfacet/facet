---
name: live-test
description: Run Facet's live-link hard gate — the 3-tier quickstart E2E (deterministic stub run, real-bundle execution, key-gated provider smoke) — and report a per-tier PASS/FAIL verdict. Use after /code-review in the feature hard gate, for refactors that touch live-link surfaces, and always before a release or owner-requested live run.
---

# /live-test

The live-link hard gate. `/verify` proves the code compiles and unit tests
pass; `/live-test` proves a **real boot** works: the quickstart server comes
up, a page is served, SSE flows through the proxy, and (when required) a real
LLM turn produces a valid stage. It runs **after `/code-review`** in the feature
hard gate, and in the refactor hard gate only when a live-link surface was
touched or the owner requests a live run.

Never declare PASS with a blocking tier failed or silently skipped. For
quickstart or reference-agent provider-loop changes, **SKIPPED = FAIL**
(DC-009): a missing key does not excuse the smoke tier — it fails it.

## Step 1 — Tier detection (robust, conservative)

Build the **candidate diff** as the union of:

1. Uncommitted paths: `git status --porcelain` (both staged and unstaged).
2. Committed delta vs the base — first of these that succeeds:

```bash
git merge-base HEAD origin/main   # preferred base
git merge-base HEAD main          # fallback
git rev-parse HEAD~1              # last resort
```

then `git diff --name-only <base>..HEAD`.

**If every base candidate errors** (shallow clone, detached HEAD, first
commit) **or the result is unclear** (e.g. merge-base equals HEAD with a clean
tree while the gate is being invoked for a change — nothing to diff), **assume
provider-smoke-required**. Conservative on purpose: over-verifying costs one
smoke turn; under-verifying defeats the gate.

**provider-smoke-required** ⇔ any candidate path starts with
`packages/agent-stack/quickstart/`, is
`packages/agent-stack/reference-agent/package.json`, or is
`packages/agent-stack/reference-agent/src/agent.ts` or
`packages/agent-stack/reference-agent/src/provider.ts`.

## Step 2 — Tier 1 (ALWAYS run, blocking)

**1a — deterministic stub E2E** (no keys, no network beyond localhost):

```bash
pnpm exec vitest run packages/agent-stack/quickstart/src/quickstart.e2e.test.ts
pnpm exec vitest run packages/agent-stack/quickstart/src/quickstart.e2e.test.ts   # run TWICE
```

Run it **twice**; both runs must pass with identical results (determinism,
DC-008). Any failure or run-to-run difference ⇒ Tier 1 FAIL.

**1b — the REAL page bundle executes** (build first — 1b tests the artifact):

```bash
pnpm --filter @facet/quickstart build
pnpm exec vitest run --config packages/agent-stack/quickstart/e2e/vitest.config.ts packages/agent-stack/quickstart/e2e/bundle.test.ts
```

Tier 1 failing blocks everything — do not proceed to a verdict of PASS, fix
the cause and rerun from Step 2.

## Step 3 — Tier 2 (blocking iff provider-smoke-required)

Requires a real key in the environment: `OPENAI_API_KEY` or
`ANTHROPIC_API_KEY` (never echo values; presence check only).

```bash
pnpm exec vitest run --config packages/agent-stack/quickstart/e2e/vitest.config.ts packages/agent-stack/quickstart/e2e/smoke.test.ts
```

- **Provider smoke required + key present** → run it; failure ⇒ FAIL.
- **Provider smoke required + no key** → report Tier 2 as **FAIL** with the reason
  `SKIPPED = FAIL for quickstart/reference-agent provider-loop changes (DC-009): no provider key in the environment`.
  Do not soften this to a skip.
- **Not touched** → Tier 2 may be skipped; report `SKIPPED (diff does not
  require provider smoke)` — that skip is OK and non-blocking.

## Step 4 — Tier 3 (pre-merge / release, on request)

Both providers, missing either key = explicit failure (the test file enforces
it):

```bash
FACET_SMOKE_PROVIDERS=both pnpm exec vitest run --config packages/agent-stack/quickstart/e2e/vitest.config.ts packages/agent-stack/quickstart/e2e/smoke.test.ts
```

Run this when the change is about to merge to main or ship a release. Missing
either key ⇒ Tier 3 FAIL.

## Step 5 — Live journey tier (owner-run / on request)

This is not a CI gate. Run it only for pre-merge, release, or explicit owner
requests, and only when `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` is present.

Codex runs this directly; do not invoke `.claude/workflows/live-journey.js`.

1. Build quickstart:
   ```bash
   pnpm --filter @facet/quickstart build
   ```
2. Start the real-provider quickstart on a free port:
   ```bash
   pnpm exec tsx packages/agent-stack/quickstart/src/cli.ts --provider <openai|anthropic> --port <port>
   ```
3. Use Playwright or the in-app browser to open the page, send at least three
   fresh-visitor messages, and capture screenshots.
4. Judge the screenshots and interaction logs for blocking failures:
   - render failure or blank page
   - unsafe/broken UI
   - no response to user input
   - agent/provider crash
5. Tear down the server even on failure.

Report `PASS`, `FAIL`, `WARNING`, or `SKIPPED(why)`. Missing provider key is
`SKIPPED`, not a Tier-2-style failure, because this tier is owner-run.

## Output contract

Report a per-tier table, then the overall verdict:

```
| Tier | What                          | Result                     |
|------|-------------------------------|----------------------------|
| 1a   | stub E2E (run twice)          | PASS / FAIL                |
| 1b   | real bundle in jsdom          | PASS / FAIL                |
| 2    | provider smoke (required=yes) | PASS / FAIL / SKIPPED(why) |
| 3    | both providers (pre-merge)    | PASS / FAIL / SKIPPED(why) |
| journey | live browser + LLM (owner-run) | PASS / FAIL / WARNING / SKIPPED(why) |
```

- State the tier-detection decision explicitly (base used,
  provider-smoke-required yes/no, and why).
- **Overall verdict: any blocking FAIL ⇒ FAIL.** Blocking = Tier 1 always;
  Tier 2 when provider smoke is required; Tier 3 when invoked pre-merge/release.
  A SKIPPED is only acceptable where this skill explicitly allows it, and must
  carry its reason.
