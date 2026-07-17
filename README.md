<h1 align="center">Facet</h1>

<p align="center">
  <strong>The UI layer for LLMs and agents — interfaces your model draws.</strong>
</p>

Facet is a TypeScript framework for UI a language model renders itself: safe,
live, and different for every visitor. The model authors a declarative Facet
Document from 11 native Bricks and a closed style vocabulary. It never emits raw
HTML, JavaScript, or CSS. Optional Patterns show complete worked structures; one
operator Theme supplies tokens, defaults, and same-Brick Presets.

> Status: **pre-1.0.** The current style system is an intentional hard cut. Old
> asset shapes, selectors, and tool inputs are rejected rather than translated.
> See [Style system migration](docs/STYLE-SYSTEM-MIGRATION.md).

Facet is a neutral open-source technology layer: contract, patch protocol,
runtime, renderer, reference transports, and agent tools. Hosted identity,
billing, metering, abuse operations, and tenant control planes belong in a
platform around Facet.

## Quickstart: one command

```bash
OPENAI_API_KEY=sk-… npx facet-quickstart
```

This starts a live page at `http://localhost:5292`. The built-in reference agent
reads `./facet.md` when present, otherwise uses the bundled tour brief, and edits
the page with RFC 6902 patches. `ANTHROPIC_API_KEY` also works. See
[`@facet/quickstart`](packages/tools/quickstart/README.md) for flags and
provider options.

## Why Facet

An agent usually has two bad UI choices: return only prose, or generate open-ended
web code. The first cannot build a real interface; the second is unsafe and easy
to break. Facet takes the middle path:

- the agent can freely arrange a small set of native Bricks;
- every authored field and style choice is closed and validated by Core;
- Theme data, not agent-authored CSS, controls the concrete design;
- only patches travel after the initial state;
- the renderer skips invalid remnants instead of crashing the page.

## The mental model

Facet has two layers:

1. **The brain** decides what the visitor should see and calls tools. Facet ships
   a reference brain, but applications may provide their own.
2. **The stage** stores, validates, patches, and renders the Facet Document. This
   is the framework contract.

The stage vocabulary has exactly 11 Bricks:

- `box` — the only container; flow layout, actions, bounded overlays/backdrops
- `text` — plain text
- `media` — gated image or video
- `input` — renderer-owned named controls
- `richtext` — closed blocks, runs, marks, and gated links
- `table`, `chart` — bounded data views
- `list`, `keyValue`, `progress`, `loading` — compact product-state views

Tables and charts do not fetch data or execute authored logic. Data may be
authored inline or stored once in the document's named `data` map and referenced
with `from` where the Brick contract permits it.

## The design system

### Theme

Each agent has one complete operator-owned Theme. If none is supplied, Facet uses
`DEFAULT_THEME`. A Theme contains:

- complete token definitions, including separate light and dark paint maps;
- one default style for every Brick;
- optional Presets, each scoped to one Brick and documented with `description`
  and `useWhen`.

Concrete values such as pixels, colors, font stacks, and shadows appear only in
validated Theme data. They never appear in a Facet Document or an agent tool
call.

The Theme is host configuration, not document state. The agent cannot select or
mutate it. The host passes `colorMode` to `StageRenderer`; `system` resolves in
the browser, and the renderer selects the Theme's light or dark paint map. The
effective mode is browser view-state and may ride the next visitor event. It is
not a document field and does not create a patch.

### Brick-owned style vocabularies

Every Brick owns a closed list of style targets, properties, states, and allowed
values. Similar names do not create a global target. For example,
`progress.style.label` and another Brick's `style.label` are separate contracts.

Values come from two closed sources:

- **tokens** are Theme-sensitive names such as `md`, `accent`, or `success`;
- **fixed choices** are renderer semantics such as `row`, `column`, `auto`, or
  `full`.

The agent sees names and guidance, never the Theme's concrete values. New Bricks
or new style capabilities are added once to the Core contract, which drives
types, validation, discovery, and rendering.

### Four authoring forms

Each Brick has one optional `style` object. There are exactly four normal forms:

```json
{ "id": "panel", "type": "box", "children": [] }
```

Omit `style` to use the Theme default.

```json
{
  "id": "panel",
  "type": "box",
  "children": [],
  "style": { "preset": "panel" }
}
```

Use a same-Brick Preset for a repeatable visual role.

```json
{
  "id": "panel",
  "type": "box",
  "children": [],
  "style": { "gap": "lg" }
}
```

Use direct style for a deliberate local choice.

```json
{
  "id": "panel",
  "type": "box",
  "children": [],
  "style": { "preset": "panel", "gap": "lg" }
}
```

Use a Preset plus a small direct adjustment when the reusable role is right but
one local detail should differ.

Resolution is always:

```text
Theme default → same-Brick Preset → direct style
```

Later layers override only the exact allowed properties they provide. Renderer
states such as hover, focus, checked, sorted, or alternate live under the
Brick-owned targets that declare them. `box` and `text` may also use
`activeWhen` with `style.active` for browser-local selected looks.

## Patterns and progressive discovery

A Pattern is a validated ordinary Facet tree plus bounded `name`, `description`,
`useWhen`, and optional `avoidWhen` metadata. It adds no node kind, parameters,
or insertion mechanism. The agent reads a useful Pattern, then authors an
adapted native-Brick tree itself. It must not blindly copy sample content or
actions.

The reference prompt keeps the initial context small and teaches this order:

1. inspect the Pattern index and call `get_pattern` when a worked structure fits;
2. inspect the Preset index and call `get_preset` when a same-Brick role fits;
3. inspect the Brick index and call `get_brick_spec` for one unfamiliar Brick;
4. call `get_style_choices` only for one unfamiliar property value that the
   agent intends to author.

Pattern and Preset styles already supplied by the validated asset snapshot are
known-valid and may be re-authored. Exact asset reads do not mutate the stage.
The agent must still call `render_page`, `set_node`, `append_node`, or
`remove_node` to satisfy a page-change request.

## Strict authoring, fail-soft rendering

Facet uses different policies at the two safety boundaries:

- **Agent authoring is strict and atomic.** An invalid mutation rejects the
  entire call, emits no patch, and returns bounded structured errors with paths,
  allowed choices, and a retry action.
- **Rendering is fail-soft.** If stale, persisted, or bypassed data reaches the
  renderer, invalid style fragments are ignored and unknown or dangling nodes
  are skipped. Valid siblings continue to render.

The renderer fallback is not reported as authoring success. Agents are expected
to repair rejected calls and retry until the requested change is actually
visible.

## Assets

The per-agent asset boundary accepts only:

```text
theme.json
patterns.json
initial.tree.json   # optional
```

`loadAssets` validates and deeply freezes one complete Theme, an exact compatible
Pattern list, and an optional strict initial tree. Invalid custom Theme data
falls back as a whole to `DEFAULT_THEME`; invalid Patterns are omitted with
bounded issues. `FileAssets` is available through `@facet/runtime/node`, while
`MemoryAssets` is browser-safe.

## Patches and renderer safety

After the initial state, only RFC 6902 JSON Patch operations travel. The same
pure `applyPatch` implementation runs on server and client. The server owns
document content; the browser owns local view-state such as current screen,
toggles, table sort, viewport class, and `colorMode`. Keeping those writers
separate prevents patch races.

Layout is flow-only. Parents place immediate children, children own only their
internal layout, and renderer roots enforce containment. There is no arbitrary
positioning, z-index, authored selector, or CSS escape hatch.

## Packages

### Core

| Path | Package | Role |
| --- | --- | --- |
| `packages/core/core` | `@facet/core` | Closed Brick/style contract, Theme/Preset/Pattern types and validators, strict author validation, fail-soft tree validation, RFC 6902 patch protocol. |
| `packages/core/runtime` | `@facet/runtime` | Event loop, stores, per-agent assets, summaries, and initial-stage support. |
| `packages/core/assets` | `@facet/assets` | `DEFAULT_THEME` and `DEFAULT_PATTERNS` data. |

### Renderers

| Path | Package | Role |
| --- | --- | --- |
| `packages/renderers/react` | `@facet/react` | React renderer, style resolution, token-to-CSS lookup, browser view-state. |

### Agents

| Path | Package | Role |
| --- | --- | --- |
| `packages/agents/agent-tools` | `@facet/agent-tools` | Provider-neutral tool schemas/executor, progressive discovery, observations, prompt kit. |
| `packages/agents/agent` | `@facet/agent` | In-process `Stage` API and `defineAgent`. |
| `packages/agents/reference-agent` | `@facet/reference-agent` | Reference LLM brain and streaming tool loop. |

### Adapters

| Path | Package | Role |
| --- | --- | --- |
| `packages/adapters/server` | `@facet/server` | Reference SSE + POST transport. |
| `packages/adapters/client` | `@facet/client` | Browser-side transports. |
| `packages/adapters/agent-client` | `@facet/agent-client` | Dial-in SDK for an external agent. |
| `packages/adapters/ag-ui` | `@facet/ag-ui` | AG-UI adapter that preserves Facet validation and patch semantics. |
| `packages/adapters/store-postgres` | `@facet/store-postgres` | Optional durable-store adapter backed by Postgres. |

### Tools

| Path | Package | Role |
| --- | --- | --- |
| `packages/tools/quickstart` | `@facet/quickstart` | Zero-setup CLI/server/page wrapper. |
| `packages/tools/cli` | `@facet/cli` | Command-line stage control. |
| `packages/tools/bridge` | `@facet/bridge` | Local coding-agent bridge. |

`apps/playground` is an unpublished demo app. Root `labs/` is an unpublished
experimental area and is not a workspace or publish target.

See [Architecture](docs/ARCHITECTURE.md) for the full data flow and
[Package boundaries](docs/PACKAGE-BOUNDARIES.md) for package responsibilities.

## Bring your own brain

An external brain can use `@facet/agent-client` to receive visitor events and
send stage messages, or use `@facet/agent-tools` inside its own provider loop.
Facet deliberately does not prescribe the model, memory strategy, backend
tools, or business policy. It does prescribe the document and patch contract.

## Development

```bash
pnpm install
pnpm verify
pnpm package:smoke
```

See [AGENTS.md](AGENTS.md) for repository rules and
[CONTRIBUTING.md](CONTRIBUTING.md) for contribution and release workflow.

## License

MIT
