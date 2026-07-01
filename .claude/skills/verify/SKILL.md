---
name: verify
description: Run Facet's mechanical quality gate — typecheck, test, lint, format, build — and report PASS/FAIL. Use before committing, and after any fix.
---

# /verify

Run every mechanical check from the repo root and report a clear PASS/FAIL. Do
not skip a check. Do not declare PASS if any check fails.

## Steps

Run these (stop reporting nothing — capture each result):

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm format:check
pnpm build
```

- `typecheck` — `tsc --noEmit` across all packages.
- `test` — `vitest run` (unit tests in `packages/**` and `apps/**`).
- `lint` — eslint.
- `format:check` — prettier.
- `build` — tsup builds every publishable package to `dist` (catches
  publish-time breakage the dev graph hides).

## Verdict

- **PASS** — all five green. State it plainly with the test count.
- **FAIL** — list which check failed with the exact error output. Then fix the
  cause (not the symptom) and **re-run `/verify` from the top**. A skipped or
  ignored failure is a FAIL.

`/verify` is mechanical only — it does not judge design or correctness of intent.
That's `/code-review`.
