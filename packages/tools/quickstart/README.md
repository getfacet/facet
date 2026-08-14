# @facet/quickstart

One-command local first run for a live Facet page. `facet-quickstart` composes
the reference agent, reference server, React renderer, default catalog, default
React registry, theme, and conversation surface so a provider key can drive a
working page immediately.

Role: **Tools**.

Quickstart is a local demo and development harness, not a production server or a
required layer in custom integrations. Start with the
[Getting Started guide](https://github.com/getfacet/facet/blob/main/docs/GETTING-STARTED.md)
when you need to choose between Quickstart, embedding the React renderer, a
custom provider loop, or a platform-specific transport.

Facet packages have not been published to npm yet. Run Quickstart from this
workspace until the first release.

## First run

Build the browser bundle first:

```bash
pnpm --filter @facet/quickstart build
OPENAI_API_KEY=sk-… pnpm exec tsx packages/tools/quickstart/src/cli.ts
```

On success:

```text
Facet quickstart running at http://localhost:5292
Brain: openai (gpt-5.4-mini)
```

With no `facet.md`, Quickstart starts from a validated four-screen product tour:
**What is Facet?**, **What can it build?**, **Design System**, and **Try It Live**.
The seed is ordinary default-catalog component markup that uses the service-surface
components to explain Facet and invite a live page change. The runtime validates
it before the wrapper listens, inlines the derived first-paint document into the
HTML shell, and passes the same author markup to the reference server bootstrap.
The Live view keeps chat in a right-attached bottom floating drawer that expands
from the launcher icon, so the page remains the primary answer surface. The
seeded tour uses one consistent top navigation treatment across its four
screens. The browser also includes an
**Assets** view where the active design system, component vocabulary, and
validated screen examples can be inspected without mutating the live stage.

## Flags

```text
facet-quickstart [--guide <path>] [--design <path>] [--port <n>] [--provider openai|anthropic] [--agent-id <id>]
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--guide <path>` | `./facet.md` | Deployer page brief. |
| `--design <path>` | none | Trusted local design module for active Assets inspection. |
| `--port <n>` | `5292` | Public loopback port. |
| `--provider openai\|anthropic` | auto | Force a provider and require its key. |
| `--agent-id <id>` | `quickstart` | Agent id used for sessions. |

An explicitly supplied guide must exist. If the default `./facet.md` is absent,
Quickstart uses the built-in page brief and built-in first-paint tour.

## Custom design module

Use `--design <path>` when you already have a local design module and want the
Quickstart Assets view to inspect it:

```bash
OPENAI_API_KEY=sk-... pnpm exec tsx packages/tools/quickstart/src/cli.ts --design ./facet-design.tsx
```

Quickstart does not inspect service URLs and does not generate design files.
If you want to model an existing service, inspect that URL outside Quickstart,
then write a local design module and pass its path with `--design`.

The file passed to `--design` is trusted executable local TypeScript or
JavaScript: Quickstart imports it on your machine and bundles its registry code
for the browser. Review LLM-generated or third-party files before passing them
to this flag; untrusted design input should use a data-only host integration.

The design module contract is default-first. The default design system, catalog, and
React registry stay active; `theme` changes values inside the default theme,
`themeExtensions` adds closed token vocabulary when the default theme vocabulary
is insufficient, and `components`/`registry` may only add new trusted component
tags. Replacing default component tags or default registry entries is rejected.

Design module loading is fail-closed. Quickstart imports and validates the module
before listening; invalid theme values, invalid component specs, missing registry
entries, invalid examples, cyclic values, or throwing getters stop startup
instead of silently rendering the default catalog.

Example module shape:

```tsx
import type { QuickstartDesignOverlay } from "@facet/quickstart";

function PromoBanner() {
  return <section data-promo-banner>Private beta is open</section>;
}

export default {
  theme: {
    foundation: {
      palette: {
        brand500: "#6741d9",
      },
    },
    extensions: {
      campaign: {
        accent: "#6741d9",
      },
    },
  },
  themeExtensions: [
    {
      namespace: "campaign",
      tokens: {
        accent: "color",
      },
    },
  ],
  components: [
    {
      tag: "PromoBanner",
      whenToUse: "Use for a branded promotional banner.",
      authoring: {
        role: "display",
        informationTypes: ["promotion"],
        visualEmphasis: "primary",
      },
      props: {},
      acceptsChildren: false,
    },
  ],
  registry: { PromoBanner },
  examples: [
    {
      id: "promo-banner",
      kind: "component",
      label: "Promo banner",
      tags: ["PromoBanner"],
      markup: `<Facet entry="preview">
  <Screen name="preview">
    <PromoBanner />
  </Screen>
</Facet>`,
    },
  ],
  notes: [
    {
      id: "voice",
      title: "Voice",
      body: "Keep promotional copy direct and concrete.",
    },
  ],
} satisfies QuickstartDesignOverlay;
```

When a design module is active, the Assets view uses the active catalog/theme:
Design System shows the resolved token values, Components includes additive
custom tags and validated component examples, and Screens includes validated
screen examples. These previews remain local UI state and do not call the live
transport.
Use the Assets source filter to compare `All`, `Imported`, and `Default` views.
`Imported` isolates additive component tags and screen examples from the active
design module; `Default` shows the built-in assets without the module's custom
tags or examples.

## Providers and keys

| Provider | Environment variable | Default model |
| --- | --- | --- |
| OpenAI | `OPENAI_API_KEY` | `gpt-5.4-mini` |
| Anthropic | `ANTHROPIC_API_KEY` | `claude-sonnet-4-5` |

An explicit provider wins. Otherwise OpenAI wins when both keys exist, then
Anthropic. With neither key Quickstart exits with:

```text
No provider key found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.
```

Keys come from the environment only. They are never persisted, logged, placed in
the browser bundle, or echoed in errors.

## Agent workflow

The reference agent runs a bounded streaming tool loop. It can:

- mutate the page with `render_page`, `insert_subtree`, `replace_subtree`,
  `update_node`, and `remove_subtree`;
- read context with `read_component_spec`, `read_screen`, and `read_data`; and
- publish host-authorized data with `publish_data`.

When a visitor asks for a visible change, the agent must continue until a
mutation returns `applied_visible` before claiming completion. Provider prose is
the optional conversation message; page changes are component-markup mutations.

## Programmatic composition

`@facet/quickstart` exports `createQuickstartAgent`, `startQuickstart`,
`QUICKSTART_INITIAL_STAGE`, and their option/result types. The package applies
Quickstart's budget and summary defaults while composing
`@facet/reference-agent`. Cross-turn compaction is on by default through an
in-memory summary store; pass `summaryStore: null` to `createQuickstartAgent` to
disable it.

The default first-paint source markup is package-private. Consumers receive the
validated `QUICKSTART_INITIAL_STAGE` document for tests and examples, while the
CLI owns the raw built-in seed.

## Served page

The public wrapper serves the HTML shell and prebuilt `/app.js`, then proxies
browser SSE and POST routes to an internal `createFacetServer` bound to a random
loopback port with a per-boot agent token. `/agent/*` is never exposed by the
wrapper because the reference brain runs in-process.

The browser bundle uses `@facet/react`, `@facet/assets/react`, `@facet/client`,
and the active catalog/theme to mount the live page and floating conversation
surface. Quickstart gives local provider-backed turns a retry-budget-sized
runtime authority window, 125.25 seconds by default, and a browser POST timeout
five seconds longer so first-run LLM calls do not fail just after the default
server/client turn windows.
The same bundle exposes a local Assets view for the active catalog: service
groups, component role groups, and full-screen examples rendered through the
active catalog, registry, and theme. Selecting an Assets example is local UI
state and does not call the live transport.
Custom components, credentials, tenant routing, and domain data fetches belong
to a host integration outside Quickstart.

## Security posture

Quickstart binds `127.0.0.1` by default. Its visitor route is unauthenticated
and may trigger paid provider calls, so expose it on another host only after
adding auth, rate limiting, and spend controls.

- Password inputs are never collected by the default catalog.
- Sink records redact sensitive field names and key-looking values.
- Provider keys remain server-side.
- Context compaction is enabled by default with in-memory storage.

Quickstart is not a multi-tenant server and does not implement tenant isolation,
metering, admin auth, or global turn limits.

## Related guides

- [Facet overview and package chooser](https://github.com/getfacet/facet/blob/main/README.md)
- [Getting Started](https://github.com/getfacet/facet/blob/main/docs/GETTING-STARTED.md)
- [Design System](https://github.com/getfacet/facet/blob/main/docs/DESIGN-SYSTEM.md)
- [Agent Integration](https://github.com/getfacet/facet/blob/main/docs/AGENT-INTEGRATION.md)
- [Architecture](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md)
