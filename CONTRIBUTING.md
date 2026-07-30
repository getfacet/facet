# Contributing to Facet

Facet changes must preserve the component-markup hard cut: agents emit
declarative data, hosts register trusted components, and only validated patches
change the stage.

## Local setup

```bash
pnpm install
pnpm verify
```

Useful scoped commands:

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm format:check
pnpm build
pnpm package:smoke
```

## Feature flow

For non-trivial changes, use the agent workflow:

1. `/feature-intake`
2. `/spec-bridge`
3. `/worktree-prep`
4. `/implement`

The feature hard gate is:

`/update-tests` → `/verify` → `/code-review` → `/live-test` → `/update-docs`

`/live-test` blocks for Quickstart and reference-agent provider-loop risk as
defined in `AGENTS.md`.

## Pull request expectations

- Keep package boundaries intact and use public barrels.
- Add or update tests for behavior changes.
- Update docs when public behavior changes.
- Include a changeset for published package surface changes.
- Do not add compatibility aliases for the retired authoring model.
- Do not push or merge without owner approval.
