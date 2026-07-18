# Changelog

Facet is released **per package**. Each published `@facet/*` package carries its
own `CHANGELOG.md` (generated from [Changesets](https://github.com/changesets/changesets)),
so the authoritative, version-by-version history for a package lives alongside it
— in that package's directory and on its npm page — once the first version ships.
Pending changes awaiting a release live as changeset entries under
[`.changeset/`](.changeset/).

All `@facet/*` packages are versioned together as a fixed group, so they always
share one version.

## Pre-release history

Nothing has been published to npm yet, so there are no released versions. The
initial `0.1.0` line establishes the closed native Brick and style vocabularies,
RFC 6902 patching, `validateTree`, the runtime (session store + event
loop, `StageStore` / `Sink` seams), the agent SDKs and `facet` CLI, the React
renderer, the reference SSE + POST server and browser client, the Postgres store
adapter, default assets, and the local bridge. Release automation verifies the
workspace and installs packed tarballs in a token-free clean consumer job before
the publish job can start. From the first published version onward, see each
package's own `CHANGELOG.md`.
