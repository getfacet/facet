---
name: live-test
description: Run Facet's live-link hard gate — the 3-tier quickstart E2E (deterministic stub run, real-bundle execution, key-gated provider smoke) — and report a per-tier PASS/FAIL verdict. Use after /code-review, before commit/merge of any change, and always before a release.
---

# /live-test

The live-link hard gate. `/verify` proves the code compiles and unit tests
pass; `/live-test` proves a **real boot** works: the quickstart server comes
up, a page is served, SSE flows through the proxy, and (when required) a real
LLM turn produces a valid stage. It joins the Definition of Done **after
`/code-review`**.

Never declare PASS with a blocking tier failed or silently skipped. For
quickstart-touching changes, **SKIPPED = FAIL** (DC-009): a missing key does
not excuse the smoke tier — it fails it.

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
quickstart-touched**. Conservative on purpose: over-verifying costs one smoke
turn; under-verifying defeats the gate.

**quickstart-touched** ⇔ any candidate path starts with `packages/quickstart/`.

## Step 2 — Tier 1 (ALWAYS run, blocking)

**1a — deterministic stub E2E** (no keys, no network beyond localhost):

```bash
cd /Users/hoon/workspace/apps/facet
pnpm exec vitest run packages/quickstart/src/quickstart.e2e.test.ts
pnpm exec vitest run packages/quickstart/src/quickstart.e2e.test.ts   # run TWICE
```

Run it **twice**; both runs must pass with identical results (determinism,
DC-008). Any failure or run-to-run difference ⇒ Tier 1 FAIL.

**1b — the REAL page bundle executes** (build first — 1b tests the artifact):

```bash
pnpm --filter @facet/quickstart build
pnpm exec vitest run --config packages/quickstart/e2e/vitest.config.ts packages/quickstart/e2e/bundle.test.ts
```

Tier 1 failing blocks everything — do not proceed to a verdict of PASS, fix
the cause and rerun from Step 2.

## Step 3 — Tier 2 (blocking iff quickstart-touched)

Requires a real key in the environment: `OPENAI_API_KEY` or
`ANTHROPIC_API_KEY` (never echo values; presence check only).

```bash
pnpm exec vitest run --config packages/quickstart/e2e/vitest.config.ts packages/quickstart/e2e/smoke.test.ts
```

- **Touched + key present** → run it; failure ⇒ FAIL.
- **Touched + no key** → report Tier 2 as **FAIL** with the reason
  `SKIPPED = FAIL for quickstart-touching changes (DC-009): no provider key in the environment`.
  Do not soften this to a skip.
- **Not touched** → Tier 2 may be skipped; report `SKIPPED (diff does not
  touch packages/quickstart/)` — that skip is OK and non-blocking.

## Step 4 — Tier 3 (pre-merge / release, on request)

Both providers, missing either key = explicit failure (the test file enforces
it):

```bash
FACET_SMOKE_PROVIDERS=both pnpm exec vitest run --config packages/quickstart/e2e/vitest.config.ts packages/quickstart/e2e/smoke.test.ts
```

Run this when the change is about to merge to main or ship a release. Missing
either key ⇒ Tier 3 FAIL.

## Step 5 — Live journey tier (owner-run, pre-merge; real browser + real LLM)

The heaviest tier — it proves the actual EXPERIENCE renders and responds in a
**real headless browser** driven by a **real LLM**, which the jsdom/stub tiers
cannot. **Owner-run / on-request only — NOT CI** (real LLM cost + Playwright).

Precondition: a provider key (`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`). With no
key this tier is **SKIP-with-reason** — this is explicitly NOT the Tier-2
`SKIPPED=FAIL` rule; the journey tier is owner-run, not a per-change gate.

The skill (main agent, durable bash) owns the SERVER lifecycle; the workflow owns
the journeys + judging:

1. `pnpm --filter @facet/quickstart build`; once: `pnpm exec playwright install chromium`.
2. Boot the real-LLM quickstart on a free port in the background and capture the URL:
   `pnpm exec tsx packages/quickstart/src/cli.ts --provider <p> --port <n>`.
3. Invoke the workflow with the URL:
   `Workflow({ name: 'live-journey', args: { url: '<url>', keyPresent: true, artifactsDir: 'packages/quickstart/e2e/journey/artifacts' } })`
   — 3 fresh-visitor Playwright journeys → per-(visitor × lens) vision judges →
   synthesized through the tested `verdict.ts` (HARD/SOFT/quorum).
4. **Tear down the server** (kill the process) regardless of outcome.

It returns `{ verdict: 'PASS'|'FAIL'|'SKIP', warnings, blocking, binSmoke, artifactsDir }`.
HARD lenses (safety, render, responsiveness) failing ⇒ tier **FAIL**; SOFT lenses
(request-fidelity, cross-visitor diversity) failing ⇒ **WARNING**, not FAIL.
Screenshots + an optional GIF land in the gitignored artifacts dir.

## Output contract

Report a per-tier table, then the overall verdict:

```
| Tier | What                          | Result                     |
|------|-------------------------------|----------------------------|
| 1a   | stub E2E (run twice)          | PASS / FAIL                |
| 1b   | real bundle in jsdom          | PASS / FAIL                |
| 2    | provider smoke (touched=yes)  | PASS / FAIL / SKIPPED(why) |
| 3    | both providers (pre-merge)    | PASS / FAIL / SKIPPED(why) |
| journey | live browser + LLM, judged (owner-run) | PASS / FAIL / WARNING / SKIPPED(why) |
```

- State the tier-detection decision explicitly (base used, quickstart-touched
  yes/no, and why).
- **Overall verdict: any blocking FAIL ⇒ FAIL.** Blocking = Tier 1 always;
  Tier 2 when quickstart-touched; Tier 3 when invoked pre-merge/release.
  A SKIPPED is only acceptable where this skill explicitly allows it, and must
  carry its reason.
