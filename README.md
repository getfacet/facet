<h1 align="center">Facet</h1>

<p align="center">
  <strong>The UI layer for LLMs and agents — interfaces your model draws.</strong>
</p>

Facet is a TypeScript framework for UI a language model renders itself — safe,
live, and different for every user. You give the model a small set of safe visual
primitives; it composes whatever interface the moment calls for, keeps changing
it as the conversation goes, and can build a different one for each person — all
without ever emitting unsafe or broken markup.

> Status: **pre-1.0.** The spec, patch protocol, runtime, renderer, the SSE/POST
> transport (browser + external agents), a browser playground, durable stores,
> and a Postgres adapter are all in place and tested. APIs may still change.

Facet is the neutral open-source technology layer: protocol, runtime,
renderer, reference transports, and agent integration tools. It does **not**
include a hosted control plane, tenant/project auth, billing, metering, abuse
operations, admin dashboards, or custom-domain routing. Production platforms
should wrap these primitives with their own operational layer.

## Quickstart: one command

```bash
OPENAI_API_KEY=sk-… npx facet-quickstart --guide ./my-page.md
```

That boots a live Facet server at `http://localhost:5292` whose page is drawn by
a **built-in LLM agent**: it reads your guide markdown (what the page is about),
paints a first stage for each visitor, and keeps patching it as they chat.
`ANTHROPIC_API_KEY` works too (OpenAI is the default when both are set). Flags
and details: [`@facet/quickstart`](packages/agent-stack/quickstart/README.md).
To plug in *your own* model instead, see
[Advanced: bring your own brain](#advanced-bring-your-own-brain).

## Why

Today, when an AI wants to *show* you something, there are three options — and
they all hurt:

- **Text / markdown only** — the model can't really build UI; you get a wall of words.
- **Let the model emit HTML/React** — unlimited, but **unsafe** (injection),
  **fragile** (broken layouts), and **unreliable** (hallucinated markup).
- **A fixed catalog of your components** (today's "generative UI") — safe, but the
  model can only assemble what you pre-built. **Rigid.**

Facet is the missing middle: the model composes **anything** from low-level
bricks, it **can't inject or break the layout**, and it updates **live, per user**
— you don't pre-build a component for every case, and you don't hand a model raw
markup.

## The mental model: two layers

A Facet page is two layers stacked together:

- **The Stage** — the body of the page. The model rebuilds this per user and
  mutates it as you talk. Everything visible is built here.
- **The Chat dock** — always present (floating or pinned). It is *not* generated;
  it's the control surface the user drives the Stage with.

```
the user speaks in the Chat  →  the model rebuilds the Stage
```

The Stage can also diverge *before* anyone says a word: who showed up (referrer,
locale, prior context) is enough to make the first paint different.

## Low-level bricks, not finished widgets

The model builds the Stage from **four low-level bricks** — not a catalog of
pre-made components:

| Brick   | It is…                                                                           |
| ------- | -------------------------------------------------------------------------------- |
| `box`   | the universal container. Flow layout, token styles, optional `onPress`/`onHold`. |
| `text`  | text with token styles (family/size/weight/color).                               |
| `media` | image or video media with a static, safe URL.                                    |
| `field` | a native text/select/checkbox/radio/switch input.                                |

A *card* is a `box` with a border. A *button* is a `box` with `onPress`. A
*heading* is a big `text`. Everything is composed from these four, so the set of
producible interfaces is unbounded — yet it stays safe and unbreakable because:

An `onPress` can also be declarative — `{kind:"navigate", to}` to switch between
pre-drawn **screens** or `{kind:"toggle", target}` to show/hide a node — and the
browser runs those **instantly with no round-trip to the model**; `{kind:"agent"}`
is the path back to the model for anything open-ended. A box can also declare an
`onHold` (a long-press secondary gesture, same action union), an `appear` token
(a bounded enter animation — `fade`/`slide`, the theme owns the timing), a
`scroll` axis (`x`/`y`, with legacy `true` normalized to `y`), and a `columns`
token (`2`/`3`/`4`) — all still tokens, never raw values.

1. **Bricks are typed data, never raw HTML/JS** → nothing can be injected.
2. **Style values are tokens, not raw scalars** (`gap: "md"`, not `gap: 23`) →
   any combination lands on a coherent scale; the model can't produce visual
   chaos, and good output comes out in one shot.
3. **Layout is flow-only** (row/col, no absolute positioning) → children stack or
   wrap; they can't overlap or fall off the page.
4. **The renderer is fail-safe** → unknown or dangling nodes are skipped, so a
   partial stage renders as "plain", never broken.

Higher-level shapes (`card()`, `hero()`, `row()`) can live in optional preset
packages — they're just functions that emit box compositions, giving one-shot
convenience without giving up the low-level foundation.

## Reskin with data, not code

A page's look is **operator data, not model output**. Hand `facet-quickstart` an
assets directory and it reskins and pre-seeds the page — the model still never
deals in pixels:

```bash
OPENAI_API_KEY=sk-… npx facet-quickstart --assets ./assets
```

where `./assets` holds any mix of:

- **`*.theme.json`** — a named palette/type/scale document mapping token names
  to CSS values, e.g. `{ "name": "midnight", "color": { "bg": "#0b1020", "fg": "#e8ecff" }, "fontFamily": { "sans": "Inter, system-ui, sans-serif" } }`.
  The model **selects** a theme by name (via a `set_theme` tool); **it never
  authors the CSS values** and never writes one into the tree. An unknown or
  missing name simply falls back to the default look — nothing throws.
- **`*.stamp.json`** — a reusable `{ root, nodes, slots? }` brick fragment (a
  hero, a card) offered to the model by name. The quickstart model calls
  `use_stamp` with string slot params and the server expands the stamp into
  ordinary patches with fresh ids, under a known box parent and within the patch
  batch cap; there is **no client-side stamp expansion**.
- **`initial.tree.json`** — a starting stage the first visit opens on *before*
  the model's first turn: a fast, non-blank first paint the agent then refines.

Every document passes one validator at boot (`validateTheme` / `validateStamp` /
`validateTree`): a value that smuggles CSS (`url()`, `var()`, `expression()`,
`javascript:`) is refused, dimensions are clamped so a theme can't push content
off-screen, and a low-contrast text/background pair is **flagged as a warning,
never rejected** (Facet measures the WCAG ratio; you decide the policy). An
invalid document is skipped with a logged issue and boot proceeds. Raw CSS enters
Facet exactly here, as operator data behind one gate — the model-facing surface
only ever names a theme or chooses style tokens such as `family: "mono"`.

## What you can build

- **An AI that answers with UI, not text** — "compare these three" → a real
  table; "I need your details" → a real form; "show me the plan" → a live
  dashboard, assembled on the spot.
- **Living pages** — a link that assembles itself for each visitor and keeps
  changing as they talk. (An agent that owns its own public page is one case of
  this.)
- **Copilot canvases** — an agent that manipulates a live panel — adds a chart,
  updates a card — as it reasons.

## How it works

```
 [ user's browser ]
   Stage (dynamic)  +  Chat dock (persistent)
        │  ClientEvent: visit / message / tap
        ▼
 [ @facet/server ]    reference SSE/POST transport (swap or wrap for production)
        │
 [ @facet/runtime ]   one isolated session per (agent, visitor)
        │  calls your model, applies streamed batches, persists the session
        ▼
 [ your model ]   drives the Stage via @facet/agent + your LLM
        │  ServerMessage: stage patches (RFC 6902) + chat replies
        ▼
 [ @facet/react ]   renders the brick spec to safe DOM; applies patches live
```

**"Your model" defaults to the reference one:** `facet-quickstart` composes
`@facet/reference-agent`, which fills the model slot with an OpenAI/Anthropic
tool-calling loop. It is a reference implementation of a pluggable boundary;
`@facet/quickstart` is the one-command wrapper around it. To connect your own
model instead, there are three jacks — see
[Advanced: bring your own brain](#advanced-bring-your-own-brain).

**Persistence has three pluggable seams.** The *stage* (the page) is always
Facet's, kept in a `StageStore` (in-memory, file, or Postgres). The
*conversation* is a `Sink` you choose: store it for replay, forward it to your
own system (e.g. a chat platform that already keeps it), or drop it. The
per-agent asset library (themes, stamps, and an optional initial tree) is an
`AssetsStore` (memory, file, or Postgres).

**Each visitor is a `visitorId`, and you decide where it comes from.** For an
anonymous page, `browserVisitorId()` stores an unguessable id in the browser so a
refresh or return visit re-hydrates the same page. When your app already knows
who the visitor is — a logged-in user, an actor id — pass *that* id instead;
Facet keys sessions by whatever id you give it (bring-your-own-identity, same as
the stores). In a public or multi-tenant deployment, project lookup,
authentication, rate limits, abuse controls, and usage metering belong in the
platform layer in front of Facet.

Two engineering choices keep "constantly re-rendering" cheap and correct:

- **Stage changes travel as [RFC 6902 JSON Patch](https://datatracker.ietf.org/doc/html/rfc6902)**
  (the IETF standard, also used by AG-UI). Only diffs move, and the *same* pure
  `applyPatch` runs on server and client so they never drift.
- **The tree is a flat map of nodes with a `root` id** (the A2UI shape), so the
  model can stream and patch one node at a time.
- **Agent results may stream as batches.** A normal agent returns one
  `ServerMessage[]`; a streaming agent returns `AsyncIterable<ServerMessage[]>`.
  The runtime folds, saves, and delivers each batch before pulling the next one,
  while the conversation record is still written once for the whole turn.

## Packages

Source directories are grouped for maintainability; npm package names stay
unchanged. The public surface is intentionally narrower than the source tree:
use the Foundation packages as the stable Facet contract, then pick authoring or
reference packages only when they match your integration shape.

### Foundation

| Path | Package | Role |
| --- | --- | --- |
| `packages/core/core` | `@facet/core` | The contract: bricks, style tokens, RFC 6902 patch, `validateTree`, `expandStamp`, session/event types. |
| `packages/core/runtime` | `@facet/runtime` | Event loop + `StageStore` (page state) + `Sink` (conversation) + `AssetsStore` (`loadAssets`, `withInitialStage`). File-backed Node references via `@facet/runtime/node`. |
| `packages/core/react` | `@facet/react` | Brick renderer (`StageRenderer`), the token→CSS theme (`boxStyle`/`textStyle`/`mediaStyle`/…), `useFacet`, `ChatDock`. |
| `packages/core/assets` | `@facet/assets` | Node-free default-asset data — `DEFAULT_THEME` + `DEFAULT_STAMPS` (value maps, not code). Depends only on `@facet/core`. |

### Agent Authoring

| Path | Package | Role |
| --- | --- | --- |
| `packages/agent-stack/agent-tools` | `@facet/agent-tools` | Provider-agnostic stage tool specs, executor, inspection helpers, and local shadow folding for custom LLM/tool loops. |
| `packages/extensions/agent` | `@facet/agent` | In-process TypeScript authoring SDK — the `Stage` control API (`render`/`append`/`useStamp`/…) + `defineAgent`; useful when your code, not an LLM tool schema, emits stage changes. |

### Reference Implementations

| Path | Package | Role |
| --- | --- | --- |
| `packages/core/server` | `@facet/server` | Reference SSE/POST transport for local/self-hosted single-operator use; not a production multi-tenant edge. |
| `packages/core/client` | `@facet/client` | Reference browser-side transports (`SseTransport`, `LocalTransport`) for `useFacet`; hosted platforms usually implement their own `FacetTransport`. |
| `packages/extensions/agent-client` | `@facet/agent-client` | Reference external-agent dial-in client for `@facet/server`'s agent channel (SSE + heartbeat + reconnect). |
| `packages/extensions/store-postgres` | `@facet/store-postgres` | Reference durable `StageStore`/`Sink`/`AssetsStore` adapter backed by Postgres; not a hosted-platform product schema. |
| `packages/agent-stack/reference-agent` | `@facet/reference-agent` | Reference brain package: providers, prompt, streaming tool loop, and deterministic test fixture. |

### Local Tools

| Path | Package | Role |
| --- | --- | --- |
| `packages/agent-stack/quickstart` | `@facet/quickstart` | `facet-quickstart` — local first-run CLI/server/page wrapper that composes `@facet/reference-agent`. |
| `packages/extensions/cli` | `@facet/cli` | The `facet` command — a running agent's action surface. |
| `packages/extensions/bridge` | `@facet/bridge` | `facet-bridge` — a local coding agent (Claude/Codex) owns a link, driving via the `facet` CLI. |

### Labs

`packages/labs` is reserved for experiments; nothing there is part of the
supported package contract.

See [docs/PACKAGE-BOUNDARIES.md](docs/PACKAGE-BOUNDARIES.md) for the package
support tiers, hosting boundary, and known package gaps.

## Advanced: bring your own brain

The reference agent is just a default. Your model connects through the authoring
or reference layer that fits your setup:

- **custom LLM/tool loop** — use `@facet/agent-tools` to expose safe stage tools
  to your provider and fold a local stage shadow.
- **in-process TypeScript** — a JS function inside the server (`@facet/agent`),
  useful for tests, rules engines, or code-authored agents.
- **local CLI** — a running agent (e.g. Claude Code or Codex) calls
  `facet append/theme/say/…` and a local bridge forwards it (`@facet/cli`).
- **reference dial-in** — an external agent connects out over SSE, NAT-safe, and
  is served events to answer (`@facet/agent-client`). Hosted platforms usually
  wrap or replace this reference client with their own scoped credentials and
  transport.

The model (the LLM/rules) is always yours; Facet is the surface it draws on.

To poke at the repo itself:

```bash
pnpm install
pnpm demo                                # in-process terminal demo (no browser, no LLM)
pnpm --filter @facet/playground dev      # browser playground — http://localhost:5290
pnpm --filter @facet/playground serve    # live server on :5291 (uses your local Claude)
```

Authoring a model's logic looks like this:

```ts
import { defineAgent } from "@facet/agent";

export const agent = defineAgent(({ event, stage }) => {
  if (event.kind === "visit") {
    stage.render(/* a brick tree tailored to event.visitor */);
  }
  if (event.kind === "message") {
    stage
      .append("root", { id: "price", type: "text", value: "$20/mo" })
      .say("Added it below.");
  }
});
```

For live construction, use `defineStreamingAgent` and yield whenever the current
batch should reach the browser; `defineAgent` remains the one-flush-at-the-end
back-compatible helper.

## Roadmap

- [x] Core spec (low-level bricks + tokens) + RFC 6902 patches + in-process demo
- [x] SSE/POST transport + a browser playground
- [x] External-agent dial-in (NAT-safe) + local `facet` CLI bridge
- [x] Durable `StageStore`/`Sink`/`AssetsStore` + a Postgres adapter
- [x] `@facet/assets` default theme + stamp data (node-free value maps)
- [x] One-command quickstart (`facet-quickstart`) composing `@facet/reference-agent`
- [ ] Docs site + examples
- [ ] Caching & static skeleton for fast first paint
- [ ] Content-safety / moderation hooks
- [ ] More adapters and deployment examples around the runtime seams

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the longer write-up and
[AGENTS.md](AGENTS.md) if you're contributing.

## License

[MIT](LICENSE)
