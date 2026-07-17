# Specs Are Historical Records

Files under `specs/feature-intake/`, `specs/context/`, and `specs/dev-specs/`
record decisions and evidence from a particular change. Completed specs are
kept for traceability, so they may contain retired terms, package paths, or
contracts. They are not current usage documentation and must not be rewritten
just to match a later architecture.

Use this reading order for the current system:

1. Start with the root [README](../README.md) when evaluating or integrating
   Facet.
2. Follow the task guide it selects: [Getting Started](../docs/GETTING-STARTED.md),
   [Design System](../docs/DESIGN-SYSTEM.md), or
   [Agent Integration](../docs/AGENT-INTEGRATION.md).
3. Use [Architecture](../docs/ARCHITECTURE.md) for current invariants and runtime
   behavior, and [Package Boundaries](../docs/PACKAGE-BOUNDARIES.md) for package
   ownership.
4. When authoring or changing Facet itself, follow [AGENTS.md](../AGENTS.md) and
   the executable Core contracts in
   [`packages/core/core/src`](../packages/core/core/src/).

If a historical spec conflicts with current Core code or Architecture, the
current contract wins. Use the old spec only to understand why a past change was
made.
