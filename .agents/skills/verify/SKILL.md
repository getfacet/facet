---
name: verify
description: Run Facet's mechanical quality gate — typecheck, test, lint, format, build, documentation, package layout, and source checks — and report PASS/FAIL. Use before committing, and after any fix.
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
node --test scripts/check-docs.test.mjs
node scripts/check-docs.mjs
node --test scripts/check-package-layout.test.mjs
node scripts/check-package-layout.mjs
node scripts/check-source-nuls.mjs
```

- `typecheck` — `tsc --noEmit` across all packages.
- `test` — `vitest run` (unit tests in grouped `packages/{core,renderers,agents,adapters,tools}/*`
  workspaces and `apps/**`, including the `@facet/react` jsdom render tests —
  `.test.tsx` files with a
  `// @vitest-environment jsdom` docblock; this is Facet's render-loop "QA").
- `lint` — eslint.
- `format:check` — prettier.
- `build` — tsup builds every publishable package to `dist` (catches
  publish-time breakage the dev graph hides).
- **documentation** — `scripts/check-docs.test.mjs` pins the checker itself,
  then `scripts/check-docs.mjs` validates current-document links, anchors, and
  explicitly marked concrete TypeScript/TSX snippets. Run them in that order.
- **package layout** — the Node regression suite plus
  `scripts/check-package-layout.mjs` pin the exact 15
  package name-to-path map, workspace uniqueness, repository directories, role
  groups, root `labs/`, and the absence of current references to retired paths.
- **raw-NUL scan** — `scripts/check-source-nuls.mjs` must report PASS.
  A raw `0x00` byte in tracked source (use the `\x00` string escape instead) makes
  git treat the file as binary, hiding its whole diff from `/code-review`. This
  regressed twice; a non-empty result is a FAIL.

## Verdict

- **PASS** — every check is green. State it plainly with the test count.
- **FAIL** — list which check failed with the exact error output. Then fix the
  cause (not the symptom) and **re-run `/verify` from the top**. A skipped or
  ignored failure is a FAIL.

`/verify` is mechanical only — it does not judge design or correctness of intent.
That's `/code-review`.
