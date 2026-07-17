# Context Evidence: Coding-Agent Documentation Entrypoint

> Stage 0 evidence for `/spec-bridge`. This file records current repository
> facts and stable `RISK-*` identifiers; it is not the implementation plan.

## Verdict

- **GO with mitigations.** The feature is documentation-first and requires no
  runtime, protocol, Facet Document, or published API change.
- The main risks are not architectural invention. They are publishing an
  incomplete integration example, duplicating a live contract into several
  prose sources, and leaving links or code snippets without a drift gate.
- The approved intake remains the scope boundary:
  `specs/feature-intake/coding-agent-documentation-entrypoint.md`.

## Current shape

- The root `README.md` is already 294 lines with 20 headings. It explains the
  design system, discovery, validation, assets, packages, and bring-your-own-brain
  path in one file (`README.md:46-279`). It is accurate but is closer to a compact
  reference manual than a decision-oriented first page.
- Detailed current authorities already exist:
  - architecture and invariants: `docs/ARCHITECTURE.md`;
  - package roles: `docs/PACKAGE-BOUNDARIES.md`;
  - exact stage-tool outcomes: `docs/AGENT-TOOL-RESULT-CONTRACT.md`;
  - pre-cutover replacement instructions: `docs/STYLE-SYSTEM-MIGRATION.md`.
- There is no canonical Getting Started, Design System, or custom Agent
  Integration guide. Operator-facing Theme examples and a complete custom
  `@facet/agent-tools` loop are explicitly listed as gaps in
  `docs/PACKAGE-BOUNDARIES.md:48-72,129-136`.
- All 15 published packages have a README, but their navigation is inconsistent.
  Some use repository-relative links that do not work from npm, some use GitHub
  links, and some have no canonical guide link.
- There is no `specs/README.md`. Historical specs are excluded intentionally by
  the hard-cut scanner (`docs/REVIEW-RULES.md:103-110`), so repository search has
  no nearby authority notice when it finds a retired term.
- Root verification has no Markdown link, anchor, or selected snippet check
  (`package.json:12-22`). Existing `pnpm package:smoke` verifies published package
  entrypoints, a bounded set of exports, and fixed type fixtures, not Markdown
  examples.

## Invariant lens

### RISK-INV-001 — examples can bypass the strict author boundary

- Evidence: strict authored mutations reject atomically with zero patches
  (`docs/ARCHITECTURE.md:240-252`), while rendering stale/bypassed data is
  deliberately fail-soft (`docs/ARCHITECTURE.md:254-262`).
- Mitigation: custom-agent guidance must use the public asset snapshot, buffer,
  and executor surfaces, handle `outcome: "rejected"`, and require a visible
  applied outcome before claiming success.

### RISK-INV-002 — Pattern or Preset prose can accidentally become stage syntax

- Evidence: Patterns are read-only examples that add no node kind or insertion
  mechanism (`docs/ARCHITECTURE.md:178-199`); Presets can style only their owning
  Brick (`docs/REVIEW-RULES.md:43-47`).
- Mitigation: Design System and Agent Integration guides must state that agents
  re-author native Bricks and styles after reads; neither asset is a runtime
  component reference or behavior layer.

### RISK-INV-003 — Theme concrete values can leak into authored examples

- Evidence: concrete CSS values exist only in Theme data
  (`docs/ARCHITECTURE.md:104-141`); client `colorMode` does not enter the Facet
  Document (`docs/ARCHITECTURE.md:168-176`).
- Mitigation: Facet Document and tool-call examples use only tokens or fixed
  choices. Theme examples are clearly host/operator configuration.

### RISK-INV-004 — integration docs can cross Facet's scope boundary

- Evidence: browser data references are not fetch expressions
  (`docs/ARCHITECTURE.md:78-85`), and identity, billing, provider policy, and
  business tools are outside Facet (`docs/ARCHITECTURE.md:370-376`).
- Mitigation: provider calls and domain tools stay explicitly host-owned; the
  docs do not add browser fetch or platform-control-plane guidance as Facet API.

### RISK-INV-005 — the intake inherited stale overlay wording

- Evidence: current Core has 11 Bricks; `box` owns bounded backdrop/modal/drawer
  behavior (`docs/ARCHITECTURE.md:27-49,264-277`). There is no dedicated overlay
  Brick.
- Mitigation: treat the intake phrase “dedicated overlay brick” as template
  drift. Current docs must use “bounded `box` backdrop/modal/drawer behavior” and
  must not change the Brick roster.

### RISK-INV-006 — view state can be described as a second document writer

- Evidence: navigation, toggles, sort, viewport, and color mode remain browser
  view-state (`docs/ARCHITECTURE.md:51-58,298-301`).
- Mitigation: Getting Started preserves the `withView`/view-snapshot boundary and
  never presents local state as a patch-producing Facet Document mutation.

### RISK-INV-007 — three fallback policies can be collapsed into one

- Evidence: authored mutation rejection is atomic
  (`docs/ARCHITECTURE.md:240-252`), stale persisted/render input is fail-soft
  (`docs/ARCHITECTURE.md:254-262`), and invalid custom Theme data falls back as a
  whole (`docs/ARCHITECTURE.md:137-141,317-321`).
- Mitigation: the new guides name these three boundaries separately and do not
  imply that renderer fallback is agent-tool success.

### RISK-INV-008 — Design System prose can become a second contract source

- Evidence: `BRICK_CONTRACT` is the source for Brick-owned fields and styles
  (`docs/ARCHITECTURE.md:99-102`), while review rules gate terminology drift
  (`docs/REVIEW-RULES.md:79-84`).
- Mitigation: explain concepts and operator workflows, but do not hand-maintain
  an exhaustive Brick/property/token table. Progressive discovery and Core
  remain authoritative.

### RISK-INV-009 — `render_page` can be confused with the wire protocol

- Evidence: mutation tools may accept a complete tree, but after initial state
  only RFC 6902 patches travel (`docs/ARCHITECTURE.md:16-21,279-301`).
- Mitigation: Agent Integration distinguishes tool input from runtime messages.

## Public API and consumer lens

### RISK-API-001 — current React examples omit required wiring

- Evidence: `packages/renderers/react/README.md:52-67` and
  `packages/adapters/client/README.md:25-40` do not send the initial `visit`, and
  their action callbacks drop optional collected `fields`. `useFacet` does not
  send `visit` automatically (`packages/renderers/react/src/useFacet.ts:68-125`).
  The renderer callback includes `fields`
  (`packages/renderers/react/src/StageRenderer.tsx:45-55`).
- Known-good consumers: `packages/tools/quickstart/src/page/main.tsx:95-183` and
  `apps/playground/src/live.tsx:38-110` preserve the transport, initial visit,
  collected fields, local record, and view snapshot.
- Mitigation: derive the canonical React path from those working consumers and
  update both package READMEs rather than copying their incomplete snippets.

### RISK-API-002 — `@facet/agent-tools` can be mistaken for a complete brain

- Evidence: its README states that provider selection, model requests, business
  logic, and environment policy are not owned by the package
  (`packages/agents/agent-tools/README.md:8-15`). The executor requires a Theme,
  Pattern snapshot, and shadow and returns messages, patches, and a new shadow
  (`packages/agents/agent-tools/src/types.ts:103-139,199-224`).
- Mitigation: use only root exports, show the snapshot/buffer/executor/result
  handoff, and mark provider invocation and history policy as host-owned
  pseudocode. Never import `@facet/reference-agent/src/*`.

### RISK-API-003 — a package decision table can imply one-package integration

- Evidence: `@facet/agent` is an in-process TypeScript authoring SDK, not LLM
  tool schemas; `@facet/agent-client` is transport for an external `FacetAgent`;
  `@facet/react` needs a `FacetTransport`; `@facet/assets` exports only default
  data.
- Mitigation: README columns are purpose, primary entrypoint, collaborating
  roles, and next guide. It must distinguish `agent`, `agent-tools`, and
  `agent-client` explicitly.

### RISK-API-004 — Markdown examples and links have no drift gate

- Evidence: root scripts contain no Markdown check (`package.json:12-22`), and
  package smoke does not inspect fenced Markdown examples.
- Mitigation: add one repository-native `check-docs` script plus tests. It checks
  repository-local paths and anchors, maps the repository's canonical GitHub
  document URLs back to local files, and typechecks only explicitly marked
  concrete TypeScript/TSX examples. Unchecked algorithmic fragments must be
  labeled pseudocode. Do not build a general Markdown execution framework.

### RISK-API-005 — README restructuring can break an existing anchor consumer

- Evidence: `packages/tools/quickstart/README.md:259-260` links directly to
  `README.md#bring-your-own-brain`.
- Mitigation: update that package README in the same change and make the new
  checker validate package-README anchors.

### RISK-API-006 — archived specs can look authoritative

- Evidence: `specs/README.md` does not exist and the approved intake explicitly
  forbids rewriting historical specs.
- Mitigation: add the authority order once at `specs/README.md`; leave completed
  spec bodies unchanged.

### Current public surfaces for examples

- `@facet/assets`: `DEFAULT_THEME`, `DEFAULT_PATTERNS`.
- `@facet/react`: `StageRenderer`, `useFacet`, Theme helpers, `ChatDock`, view
  helpers.
- `@facet/agent-tools`: tool specs, prompt builder, asset snapshot, buffer,
  executor, observation/shadow helpers, and public types from the root barrel.
- `@facet/client`: `SseTransport`, `LocalTransport`, `browserVisitorId`,
  `withView`, and persisted-view helpers.
- `@facet/runtime`: root runtime/store/assets surface plus the intentional
  `@facet/runtime/node` subpath.
- `@facet/ag-ui`: browser root plus the intentional `@facet/ag-ui/server`
  subpath.
- No documentation example may import an unpublished `src/*` path.

## Package-boundary lens

### RISK-PKG-001 — primary package is not a complete install set

- Evidence: renderer, transports, runtime, and persistence READMEs rely on
  collaborators and peers that are not necessarily direct dependencies.
- Mitigation: decision guidance calls out the primary entrypoint and required
  roles separately. Install commands are derived from actual imports and peer
  requirements rather than from the package table alone.

### RISK-PKG-002 — three agent packages have confusable names

- Evidence: `@facet/agent-tools`, `@facet/agent`, and `@facet/agent-client` own
  different authoring and transport jobs (`docs/PACKAGE-BOUNDARIES.md:63-75,83-89`).
- Mitigation: every relevant entry says both what the package does and what it
  does not provide.

### RISK-PKG-003 — reference implementations can be presented as production

- Evidence: reference agent, native server/client transport, agent-client, and
  Quickstart all have bounded reference/local roles
  (`docs/PACKAGE-BOUNDARIES.md:68-72,83-108`).
- Mitigation: label reference/local/optional characteristics in prose. Keep
  AG-UI as the official protocol adapter and Postgres as persistence, not a
  hosted platform.

### RISK-PKG-004 — package README links have two rendering contexts

- Evidence: npm cannot resolve repository-relative `../../../docs/...` links,
  while repository navigation can. Current packages mix both forms.
- Mitigation: root/docs use relative links; published package READMEs use stable
  `https://github.com/getfacet/facet/blob/main/...` links. The checker validates
  those canonical repository URLs locally.

### RISK-PKG-005 — examples can invent subpaths or omit peers

- Evidence: only `@facet/runtime/node` and `@facet/ag-ui/server` are intentional
  public subpaths; React requires React `>=18`, Postgres requires `pg >=8`, and
  the repository requires Node `>=20`.
- Mitigation: audit examples against package exports, peers, and the Node engine;
  run `pnpm package:smoke` as an extra final check.

### RISK-PKG-006 — package maps are already duplicated

- Evidence: exhaustive role tables exist in `AGENTS.md`,
  `docs/PACKAGE-BOUNDARIES.md`, and `README.md:226-269`.
- Mitigation: README keeps only a use-case decision table and five-role mental
  summary, then links to Package Boundaries for physical paths and details.

## Module-shape lens

### RISK-SHAPE-001 — adding sections makes the entrypoint worse

- Evidence: root README is already 294 lines and carries most deep concepts.
- Mitigation: restructure and move details; do not append three new manuals to
  the existing file. No arbitrary line-count target is required.

### RISK-SHAPE-002 — new guides can overlap existing authorities

- Evidence: Architecture (385 lines), Style Migration (201), Tool Result Contract
  (204), and Package Boundaries (137) already own deep subjects.
- Mitigation: use this responsibility split:
  - README: decide and route;
  - Getting Started: runnable adoption paths and wiring;
  - Design System: concepts, authoring choices, assets, and fallback boundaries;
  - Agent Integration: custom LLM loop and progressive discovery;
  - Architecture: invariants and complete system behavior;
  - Tool Result Contract: exact executor outcomes;
  - Package Boundaries: roles and deployment claims;
  - Style Migration: pre-cutover replacement only.

### RISK-SHAPE-003 — 15 package READMEs create a wide change

- Evidence: package READMEs range from 32 to 260 lines and all need consistent
  role/navigation treatment.
- Mitigation: split them into disjoint role-based work units of at most five
  files. Do not introduce a generated README template in this pass.

### RISK-SHAPE-004 — no documentation checker exists

- Evidence: `scripts/` has package-layout, style-hard-cut, package-smoke, and NUL
  checks only.
- Mitigation: one focused sibling script and test own link/anchor/selected-snippet
  validation and are added to `pnpm verify`.

### RISK-SHAPE-005 — archival authority has no local home

- Evidence: approximately 157 existing spec files have no `specs/README.md`.
- Mitigation: add one short archive/authority guide. Do not edit historical
  artifacts.

### RISK-SHAPE-006 — example validation can grow into a second build system

- Evidence: package smoke already validates published packages and fixed type
  fixtures; the approved scope excludes a new runnable example app.
- Mitigation: typecheck only explicitly marked, self-contained concrete snippets
  through the focused docs checker. Keep all other fragments pseudocode and run
  package smoke for the real published surfaces.

## Existing gates and consumers

- Mechanical gate: `pnpm verify`.
- Published-package gate: `pnpm package:smoke`.
- Retired style/package claims:
  `node scripts/check-style-hard-cut.mjs` and
  `node scripts/check-package-layout.mjs`.
- Existing working React integration consumers:
  `packages/tools/quickstart/src/page/main.tsx` and
  `apps/playground/src/live.tsx`.
- Future drift routing is duplicated intentionally for the two supported coding
  agent environments in `.agents/skills/update-docs/SKILL.md` and
  `.claude/skills/update-docs/SKILL.md`; both must learn the same new canonical
  guide ownership.

## Stage 0 decision

- Add `docs/GETTING-STARTED.md`, `docs/DESIGN-SYSTEM.md`, and
  `docs/AGENT-INTEGRATION.md`.
- Add a narrow `scripts/check-docs.mjs` and its Node test, integrated into root
  verification. It validates links/anchors and only opt-in concrete TS/TSX
  snippets.
- Keep current package names, exports, protocol, runtime behavior, and Facet
  Document syntax unchanged.
- Preserve historical specs and add only `specs/README.md` as their authority
  boundary.
