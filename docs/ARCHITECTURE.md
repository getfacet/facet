# Facet Architecture

Facet is a TypeScript framework for UI that a language model renders as data.
The model emits declarative component markup; Facet parses it, validates it
against a host-owned immutable catalog, folds only authorized patches into the
stage, and renders through trusted React components registered by the host.

The core boundary is deliberately small: Facet owns UI-out and UI-in. Product
data fetching, authorization, business actions, provider choice, tenancy,
secrets, billing, quotas, and operations remain outside Facet.

## Load-bearing invariants

1. Agents emit declarative component markup, never executable UI code.
2. The active catalog and React registry form one immutable trust boundary.
3. Only validated RFC 6902 patches change the stage.
4. Facet stores bounded UI data and forwards explicit visitor events; it does not
   perform browser-side domain fetches.
5. Layout remains flow-contained. Overlap exists only through the dedicated
   trusted Modal contract.
6. Stage revisions and compare-and-save persistence keep the browser, runtime,
   and agent from becoming competing writers.
7. All package dependency edges flow through the public barrels and toward
   `@facet/core`.

## Component markup

The author grammar admits one `<Facet entry="...">` envelope with named
`<Screen name="...">` children. Inside screens, the agent may use only registered
component tags, declared props, quoted scalar values, and explicit `data:path`,
`nav:screen`, and `agent:event` references.

The parser rejects raw HTML, JavaScript/JSX expressions, event-handler props,
imports, spreads, inline JSON, raw CSS, arbitrary style keys, and unsupported
reference schemes before catalog validation runs. The parser output is an AST,
not executable code.

Catalog validation is the second gate. The host supplies a `FacetCatalog` whose
component specs declare tags, props, scalar domains, data-bindable props,
collection addresses, and child support. `validateAuthorMarkup` rejects unknown
tags, undeclared props, invalid values, unauthorized bindings, and unresolved
action/collection contracts atomically with one deterministic author error.

## Catalog and registry trust boundary

The catalog is what an agent may author. The registry is trusted React code that
mounts those tags. `bootstrapRenderer` validates the catalog, validates the
theme, snapshots the registry, and requires exact tag-set equality before a
session can render.

Registration is pre-session only. There is no mid-session component
registration, compatibility adapter, alias table, or fallback that makes an
unknown authored tag render. Component crashes are isolated by subtree error
boundaries so a bad trusted component does not bring down unrelated siblings.

`Modal` is the only sanctioned overlap surface. If the host registers a Modal
component, it must conform to the framework frame contract; otherwise authored
overlap is unavailable.

## Data model and path grammar

Facet stores a bounded hierarchical data model for UI projection. Providers and
agent tools fetch and authorize domain data, then publish only the projected
values Facet should render or read.

The shared Facet identifier grammar is:

```text
/^[A-Za-z][A-Za-z0-9_-]*$/
```

B-06 is the identifier length bound. D-06 data path segments reuse that exact
grammar rather than defining a second regex. Paths add only dotted named keys;
numeric index segments are rejected. The rejected segment shapes include
`__proto__`, leading underscore, leading hyphen, numeric index segment, space,
intra-segment dot, and colon.

Arrays may be published only as bounded values. Rows past B-21 are unreachable
by design: they are not addressable by data paths and cannot be selected by an
agent-authored binding.

## Stage, patches, and revisions

Runtime stores a `FacetStage`: the current component document, bounded data
model, and stage revision. Agent-visible authoring operations are converted to
authorized RFC 6902 patch messages. Browser and server apply the same patch
fold, so a patch accepted in one environment has the same structural effect in
the other.

Every accepted mutation advances `stageRevision`. Runtime persistence uses
compare-and-save semantics, and browser transports stamp outgoing events with
the latest known revision. Stale or racing turns fail safe instead of silently
overwriting newer state.

The runtime event loop is single-flight per session. It loads the current stage,
calls the agent, folds each emitted batch, saves the result, and delivers frames
in order before pulling the next batch.

## Conversation channel

Conversation messages are protocol frames, not component nodes. A runtime or
transport can deliver assistant/visitor text alongside stage patches, but the
authoring tool roster remains about UI document/data operations. This keeps chat
history and page state related but separate.

## Fail-safe behavior

Facet has two fail-safe boundaries:

- Runtime load and patch folding degrade corrupt persisted input to a bounded
  safe subset or a safe empty document with structured issues.
- The React renderer isolates bad subtrees during mount and continues rendering
  valid siblings.

Invalid model-authored markup is not accepted through either boundary. The
authoring boundary rejects it before it becomes stage state.

## Package flow

`@facet/core` contains the dependency-free contract. Runtime, renderers, agent
packages, adapters, and tools build on that contract through public barrels.
Published packages do not depend on private apps or unexported package source
files. Browser-facing graphs stay free of Node built-ins.

See [Package Boundaries](PACKAGE-BOUNDARIES.md) for the package map.
