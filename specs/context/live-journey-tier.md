# Context: live-journey-tier

Context evidence gathered for the `live-journey-tier` feature — a new
owner-run live-link tier that boots one shared real-LLM quickstart server and
runs multiple simulated visitor journeys through semantic (non-golden-image)
judges.

## Affected packages

- `@facet/quickstart`

## Code entrypoints

### `@facet/quickstart`

- **`packages/quickstart/e2e/smoke.test.ts:74`** — boot pattern the journey
  harness must follow: `resolveProvider` + `createQuickstartAgent` +
  `startQuickstart` on a random free port with `EADDRINUSE` retry. The new
  live-journey tier boots ONE shared real-LLM server this same way.
- **`packages/quickstart/e2e/smoke.test.ts:50`** — `waitForPatch(stream)`: read
  the SSE stream until a `patch` frame. The journey's post-chat "UI updated"
  settle must poll for a settled DOM (OQ-1) rather than reuse this raw-stream
  wait, but this is the existing wait-for-frame precedent.
- **`packages/quickstart/e2e/smoke.test.ts:116`** — LOOSE-assertions-only
  convention (machinery pinned, content never matched) that the semantic
  (non-golden-image) judges must mirror.
- **`packages/quickstart/e2e/bundle.test.ts:1`** — real-artifact execution
  pattern (execute the built dist, not a fixture); the DC-005
  `node dist/cli.js` standalone-run smoke follows this build-then-run-the-artifact
  posture.
- **`packages/quickstart/e2e/vitest.config.ts:19`** — e2e include glob
  (`e2e/**/*.test.ts`, root pinned to package, 120s timeout) that the fast
  unit-tested verdict-aggregation helper (DC-003/DC-004) and any journey vitest
  must slot into so `pnpm test` never touches it.
- **`packages/quickstart/src/server.ts:351`** — `startQuickstart(...)` →
  `RunningQuickstart` (interface at `server.ts:69`, with `.url` and `.close()`);
  the preflight owns boot+teardown via this, `close()` guarantees no orphan
  process (teardown policy / DC-006).
- **`packages/quickstart/src/cli.ts:1`** — the `facet-quickstart` bin (bin maps
  to `./src/cli.ts`; built to `dist/cli.js` via tsup); DC-005 preflight runs
  `node dist/cli.js` standalone to gate the documented dev-monorepo resolution
  gap.

### `.claude` tooling

- **`.claude/workflows/spec-bridge.js:33`** — the fan-out (parallel independent
  probes) → gate-panel → bounded-loop Workflow shape that the new
  `.claude/workflows/live-journey.js` (fan-out 3 visitors → parallel per-lens
  judges → synthesize verdict) must follow; `code-review.js` is the other
  precedent for a judge/vote panel.
- **`.claude/skills/live-test/SKILL.md`** — the tier-orchestration + per-tier
  PASS/FAIL/SKIPPED output contract; the new live-journey tier is invoked here
  AFTER the unchanged vitest Tiers 1a/1b/2 (additive; SKIP-with-reason when
  `OPENAI_API_KEY` absent, since this tier is owner-run / not-CI).

### root

- **`package.json:devDependencies`** — Playwright (+ `playwright install
  chromium`) added dev-only; today's devDeps carry no Playwright, so this is a
  purely additive dev dependency.

## Risk register

(no RISK items raised)
