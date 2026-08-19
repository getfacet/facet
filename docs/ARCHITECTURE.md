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
optional shallow structured shapes, typed collection addresses, asset props,
and one closed content mode. `validateAuthorMarkup` rejects unknown tags,
undeclared props, invalid values, unauthorized bindings, invalid slot placement,
unresolved assets, and action/collection contract failures atomically with one
deterministic author error.

## Component content and composition

Every component spec declares exactly one content branch:

- `none` accepts no children and derives the discovery class `Leaf`;
- `children` accepts ordered direct children and derives `Container`; and
- `slots` declares named regions and derives `Structured`.

A slot declares bounded guidance, minimum and maximum child counts, and an
optional allowlist whose tags must all exist in the same catalog. Author markup assigns a direct child with one
literal `slot="name"`; Core stores that value as `ComponentNode.slot` rather
than an ordinary prop, and component specs cannot redeclare `slot` as a prop.
Document validation uses own-property slot lookup and checks unknown, missing, disallowed,
and over-capacity slots before state changes. The renderer then supplies frozen
named slot arrays to the trusted component.

These classes are derived discovery labels, not another policy axis. A
component is the host-owned unit of catalog metadata and trusted render code; a
composition is the agent-authored component tree in a screen. Facet does not
promote composed subtrees into catalog entries or media assets. The default
design system is a 47-component catalog, while custom hosts may supply a
different bounded catalog and exact matching registry.

## Catalog and registry trust boundary

The catalog is what an agent may author. The registry is trusted React code that
mounts those tags. `bootstrapRenderer` validates the catalog, validates any
host theme extension declarations, validates the theme against the fixed
foundation/semantic contract plus active catalog recipes and declared
extensions, validates and snapshots the optional host asset registry, snapshots
the component registry, and requires exact catalog/registry tag-set equality
before a session can render.

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

Structured `object` and `array` props are binding-only. A prop may declare one
closed shallow shape whose named fields are scalar `string`, `number`, or
`boolean` values with optional required flags. Objects and each array item must
match that shape; nesting, unions, and arbitrary schema keywords are not part of
the authoring contract. A structured prop with no shape remains a bounded open
record for trusted components that select fields through separately declared
scalar props.

Assets are a separate host trust input, not Data Model values. V1 admits an
immutable map of bounded keys to image descriptors containing a safe HTTPS or
image data URI and optional positive dimensions. Author markup can use only an
`asset:key` reference on a prop declared for image assets. URL literals, data
bindings, unknown keys, and kind mismatches reject before mount. Omitting the
registry produces an empty frozen registry.

## Collected values

Facet-collected visitor values are exactly `string | boolean | readonly
string[]`. Each collectable component declares its framework-injected value prop
and matching value kind. The browser field store and event validator enforce the
same type, freeze array values, and apply scalar-size and array-count bounds
before an event enters the runtime. Numbers, objects, and files are outside this
contract. Collection remains UI-IN only: a forwarded `agent:` event carries the
validated values, and customer business actions remain behind agent tools.

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
