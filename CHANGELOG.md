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
initial `0.1.0` line establishes the component-markup contract: parser and
catalog validation, authorized RFC 6902 patching, the runtime session loop and
storage seams, the provider-neutral agent SDK/tool surface, the React renderer,
the reference SSE + POST transports, default catalog/assets, and the zero-setup
Quickstart experience. Release automation verifies the workspace and installs
packed tarballs in a token-free clean consumer job before the publish job can
start. From the first published version onward, see each package's own
`CHANGELOG.md`.
