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

Facet Lab adds a built-bundle deterministic tier and keeps its required-provider
and optional-visual outcomes separate. The deterministic tier is always blocking
when a Lab or shared Lab seam changed. A missing required provider key is FAIL;
a missing optional visual capability is an explicit non-blocking SKIP.

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
`packages/tools/quickstart/`, is
`packages/agents/reference-agent/package.json`, or is
`packages/agents/reference-agent/src/agent.ts`, or starts with
`packages/agents/reference-agent/src/provider/` (the top-level
`src/provider.ts` compatibility barrel is included as well).

**lab-deterministic-required** ⇔ any candidate path starts with
`apps/facet-lab/`, is `scripts/check-lab-gates.mjs`, is
`scripts/check-lab-gates.test.mjs`, or changes one of the shared diagnostic,
accepted-frame, or replay-view seams in `@facet/reference-agent`,
`@facet/server`, or `@facet/react`.

**lab-provider-required** ⇔ a candidate changes Lab provider/agent/server/live
journey code, `@facet/reference-agent` provider or diagnostic-loop code, or the
corresponding package metadata. If diff detection is unclear, require both the
Quickstart provider smoke and the Lab provider tier.

## Step 2 — Tier 1 (ALWAYS run, blocking)

**1a — deterministic journey verdict policy** (no keys, no I/O):

```bash
pnpm exec vitest run --config packages/tools/quickstart/e2e/vitest.config.ts packages/tools/quickstart/e2e/journey/verdict.test.ts
```

This pins the HARD/SOFT/quorum aggregation rule. Any failure ⇒ Tier 1 FAIL.

**1b — deterministic stub E2E** (no keys, no network beyond localhost):

```bash
pnpm exec vitest run packages/tools/quickstart/src/quickstart.e2e.test.ts
pnpm exec vitest run packages/tools/quickstart/src/quickstart.e2e.test.ts   # run TWICE
```

Run it **twice**; both runs must pass with identical results (determinism,
DC-008). Any failure or run-to-run difference ⇒ Tier 1 FAIL.

**1c — the REAL page bundle executes** (build first — 1c tests the artifact):

```bash
pnpm --filter @facet/quickstart build
pnpm exec vitest run --config packages/tools/quickstart/e2e/vitest.config.ts packages/tools/quickstart/e2e/bundle.test.ts
```

**1d — deterministic journey harness** (uses the build from 1c, localhost only):

```bash
pnpm exec vitest run --config packages/tools/quickstart/e2e/vitest.config.ts packages/tools/quickstart/e2e/journey/harness.test.ts
```

This exercises boot/teardown, bind retry, provider resolution without keys, and
the built-bin smoke result contract. Any failure ⇒ Tier 1 FAIL.

Tier 1 failing blocks everything — do not proceed to a verdict of PASS, fix
the cause and rerun from Step 2.

When `lab-deterministic-required`, install Chromium and run the isolated Lab
built-bundle gate twice. Both runs must pass:

```bash
pnpm --filter @facet/lab exec playwright install chromium
node scripts/check-lab-gates.mjs --mode deterministic
node scripts/check-lab-gates.mjs --mode deterministic
```

The policy script removes provider keys from the deterministic child process and
uses distinct external data and artifact directories. Any failure is blocking.

## Step 3 — Tier 2 (blocking iff provider-smoke-required)

Requires a real key in the environment: `OPENAI_API_KEY` or
`ANTHROPIC_API_KEY` (never echo values; presence check only).

```bash
pnpm exec vitest run --config packages/tools/quickstart/e2e/vitest.config.ts packages/tools/quickstart/e2e/smoke.test.ts
```

- **Provider smoke required + key present** → run it; failure ⇒ FAIL.
- **Provider smoke required + no key** → report Tier 2 as **FAIL** with the reason
  `SKIPPED = FAIL for quickstart/reference-agent provider-loop changes (DC-009): no provider key in the environment`.
  Do not soften this to a skip.
- **Not touched** → Tier 2 may be skipped; report `SKIPPED (diff does not
  require provider smoke)` — that skip is OK and non-blocking.

When `lab-provider-required`, also run:

```bash
node scripts/check-lab-gates.mjs --mode required-provider
```

This is blocking. It fails before starting the journey when neither provider key
is present. When Lab provider surfaces were not touched, report this Lab tier as
`SKIPPED (diff does not require Lab provider smoke)`.

## Step 4 — Tier 3 (pre-merge / release, on request)

Both providers, missing either key = explicit failure (the test file enforces
it):

```bash
FACET_SMOKE_PROVIDERS=both pnpm exec vitest run --config packages/tools/quickstart/e2e/vitest.config.ts packages/tools/quickstart/e2e/smoke.test.ts
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
2. Install Chromium if needed, then run the deterministic browser preflight:
   ```bash
   pnpm exec playwright install chromium
   pnpm exec vitest run --config packages/tools/quickstart/e2e/vitest.config.ts packages/tools/quickstart/e2e/journey/journey.selftest.test.ts
   ```
   A preflight failure makes the journey tier FAIL; do not start a paid provider
   run until it passes.
3. Start the real-provider quickstart on a free port:
   ```bash
   pnpm exec tsx packages/tools/quickstart/src/cli.ts --provider <openai|anthropic> --port <port>
   ```
4. Use Playwright or the in-app browser to open the page, send at least three
   fresh-visitor messages, and capture screenshots.
5. Judge the screenshots and interaction logs for blocking failures:
   - render failure or blank page
   - unsafe/broken UI
   - no response to user input
   - agent/provider crash
6. Tear down the server even on failure.

Report `PASS`, `FAIL`, `WARNING`, or `SKIPPED(why)`. Missing provider key is
`SKIPPED`, not a Tier-2-style failure, because this tier is owner-run.

For Facet Lab's advisory visual journey, run:

```bash
node scripts/check-lab-gates.mjs --mode optional-visual
```

This result never rewrites the deterministic contract verdict. No key is
`SKIPPED(optional visual key missing)`; an invoked command failure is reported
as a visual-tier failure/warning without converting a contract PASS to PASS.

## Output contract

Report a per-tier table, then the overall verdict:

```
| Tier | What                          | Result                     |
|------|-------------------------------|----------------------------|
| 1a   | journey verdict policy        | PASS / FAIL                |
| 1b   | stub E2E (run twice)          | PASS / FAIL                |
| 1c   | real bundle in jsdom          | PASS / FAIL                |
| 1d   | journey harness               | PASS / FAIL                |
| Lab D | built-bundle deterministic (twice) | PASS / FAIL / SKIPPED(why) |
| 2    | provider smoke (required=yes) | PASS / FAIL / SKIPPED(why) |
| Lab P | provider journey (required=yes) | PASS / FAIL / SKIPPED(why) |
| 3    | both providers (pre-merge)    | PASS / FAIL / SKIPPED(why) |
| Lab V | advisory visual journey      | PASS / FAIL / WARNING / SKIPPED(why) |
| journey | live browser + LLM (owner-run) | PASS / FAIL / WARNING / SKIPPED(why) |
```

- State the tier-detection decision explicitly (base used,
  provider-smoke-required, lab-deterministic-required, and
  lab-provider-required yes/no, and why).
- **Overall verdict: any blocking FAIL ⇒ FAIL.** Blocking = Tier 1 always;
  Lab D when required; Tier 2 and Lab P when their provider smoke is required;
  Tier 3 when invoked pre-merge/release.
  A SKIPPED is only acceptable where this skill explicitly allows it, and must
  carry its reason.
