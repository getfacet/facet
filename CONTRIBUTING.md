# Contributing to Facet

Thanks for your interest! Facet is early — issues, discussion, and PRs are welcome.

## Setup

```bash
pnpm install
pnpm typecheck
pnpm test
```

Node ≥ 20 and pnpm 9 (`corepack enable`).

## Workflow

1. Branch from `main`.
2. Make your change. Keep it focused — one concern per PR.
3. Before pushing, make sure the **Definition of Done** passes (see
   [AGENTS.md](AGENTS.md)): `pnpm typecheck` and `pnpm test` are green, and any
   behavior change to core logic (`validateTree`, `applyPatch`, `Stage`) has a
   test.
4. Open a PR describing the change and why.

CI runs typecheck + tests on every PR.

## Design principles

Read [AGENTS.md](AGENTS.md) first — the two invariants (declarative bricks only;
patches-only with a fail-safe renderer) and the scope boundary (agent brain and
scale infra are out of scope) shape almost every decision. When in doubt, prefer
adding a brick/token deliberately over widening what an agent can emit.

## License

By contributing you agree your contributions are licensed under the [MIT License](LICENSE).
