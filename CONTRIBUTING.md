# Contributing to Facet

Thanks for your interest! Facet is early — issues, discussion, and PRs are welcome.

## Setup

```bash
pnpm install
pnpm verify
```

Node ≥ 20 and pnpm 9 (`corepack enable`).

## Workflow

1. Branch from `main`.
2. Make your change. Keep it focused — one concern per PR.
3. Before pushing, make sure the **Definition of Done** passes (see
   [AGENTS.md](AGENTS.md)): `pnpm verify` is green, and any behavior change to
   core logic (`validateTree`, `applyPatch`, `Stage`) has a test.
4. Open a PR describing the change and why.

CI runs the same `pnpm verify` gate on every PR, in this order: typecheck, tests,
lint, format-check, build, the documentation checker test followed by the full
documentation check, the package-layout test followed by the full layout check,
and the source NUL-byte scan. The documentation check covers current-document
links and anchors plus explicitly marked concrete TypeScript/TSX snippets.

## Design principles

Read [AGENTS.md](AGENTS.md) first — the two invariants (declarative bricks only;
patches-only with a fail-safe renderer) and the scope boundary (agent brain and
scale infra are out of scope) shape almost every decision. When in doubt, prefer
adding a brick/token deliberately over widening what an agent can emit.

## Releases

Facet uses [Changesets](https://github.com/changesets/changesets). If your PR
changes a published `@facet/*` package, add a changeset:

```bash
pnpm changeset   # pick a bump type + write a one-line summary
```

All `@facet/*` packages are versioned together (a fixed group), so they always
share one version. On merge to `main`, a bot opens/updates a "Version Packages"
PR. A separate token-free release job builds and packs every published package,
installs the tarballs in a clean consumer, and checks ESM/CJS/types/bin entry
points before the credentialed publish job can start. Run `pnpm package:smoke`
locally when changing package metadata or release wiring. You don't publish
manually.

Changesets are the changelog source of truth: each package's `CHANGELOG.md` is
generated from the changeset entries, so write the summary for the reader of that
package — not the root `CHANGELOG.md`, which only points at the per-package logs.

## License

By contributing you agree your contributions are licensed under the [MIT License](LICENSE).
