# @facet/quickstart

Tier: **Local First-Run Tool**.

One command from a provider key to a live Facet page. The package is the
`facet-quickstart` CLI/server/page wrapper. It composes `@facet/reference-agent`,
a tool-calling LLM agent that draws the page from your guide markdown and keeps
editing it as visitors chat. The brain is a reference implementation of a
pluggable seam, not the only brain Facet can run.

With no `facet.md`, quickstart opens on a compact, validated four-tab product
tour: **What is Facet?**, **Core Structure**, **Design System**, and **Use
Cases**. The seed demonstrates the polished default kit: sections, cards, tabs,
table, chart, fields, buttons, stats, badges, progress, alerts, lists, and a
divider. That first paint is not a stub mode; the normal path still resolves
your provider key and the provider-backed reference agent can refine the seeded
stage on the first visit.

The reference agent runs a bounded **streaming tool loop**: the model calls
`append_node` / `set_node` / `remove_node` (incremental edits), `render_page`
(a full redraw), and `say` (chat) — via the provider's native function-calling
(OpenAI) / tool-use (Anthropic) — observing each result before deciding the
next. Those observations are structured results with outcomes such as
`applied_visible`, `applied_not_visible`, `applied_with_warnings`, `pending`,
and `rejected`, so the model can repair tool failures instead of treating them
as success. After every provider step, quickstart yields the closed batch it
produced, so the browser can see the page build live instead of waiting for the
whole turn to finish.

```bash
# with a provider key (env only — see below)
OPENAI_API_KEY=sk-… npx facet-quickstart
```

On success it prints the link and the resolved brain:

```
Facet quickstart running at http://localhost:5292
Brain: openai (gpt-5.4-mini)
```

In the workspace (dev), build first — the source CLI serves the prebuilt page
bundle from `dist/page/app.js`:

```bash
pnpm --filter @facet/quickstart build
OPENAI_API_KEY=sk-… pnpm exec tsx packages/agent-stack/quickstart/src/cli.ts
```

The grouped source paths are `packages/agent-stack/quickstart` for this wrapper,
`packages/agent-stack/reference-agent` for the composed reference brain, and
`packages/agent-stack/agent-tools` for the reusable stage tool layer.

## Flags

```
facet-quickstart [--guide <path>] [--port <n>] [--provider openai|anthropic] [--agent-id <id>] [--assets <dir>]
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--guide <path>` | `./facet.md` | Guide markdown — what the page is about (the deployer's brief). |
| `--port <n>` | `5292` | Public port. Busy ⇒ exit 1 naming the port and `--port`. |
| `--provider openai\|anthropic` | auto | Force a provider; requires that provider's key. |
| `--agent-id <id>` | `quickstart` | Agent id the sessions are keyed under. |
| `--assets <dir>` | none | Directory of theme/stamp/initial-tree documents to reskin and pre-seed the page (see below). An explicit path that doesn't exist ⇒ exit 1 naming it. |

## Providers & keys

| Provider | Key env var | Model |
| --- | --- | --- |
| `openai` (default) | `OPENAI_API_KEY` | `gpt-5.4-mini` |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-5` |

Resolution: an explicit `--provider` wins and requires its own key; otherwise
`OPENAI_API_KEY` ⇒ openai (also when both keys are present), else
`ANTHROPIC_API_KEY` ⇒ anthropic. No key exits 1 with:

```
No provider key found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.
```

Keys are read from the environment only — never a config file, never persisted.
They travel exclusively in the provider request's auth header and are never
logged or echoed in errors (messages name the env var, never a value). Adapters
use raw `fetch` (no SDK dependencies).

## The guide file

The guide is plain markdown describing the page you want — tone, sections,
what to collect. It becomes the "PAGE BRIEF" layer of the agent's prompt (the
stage vocabulary and output contract are fixed layers above it).

- Default path `./facet.md`; if it doesn't exist, a built-in quickstart tour
  brief and seeded four-tab first paint are used silently.
- Passing an explicit guide makes that guide the product brief. Quickstart will
  not use the built-in seed; provide `initial.tree.json` through assets if you
  want an explicit pre-seeded first paint.
- An **explicitly passed** `--guide` path that doesn't exist is an error:
  exit 1 with `Guide file not found: <path>`.

To customize the first run, create `facet.md` next to the command:

```markdown
# My onboarding assistant

Build a page for an AI assistant that helps new users choose the right plan.
Ask for their team size, goal, and timeline, then reshape the page as they chat.
```

Or pass a different file explicitly:

```bash
OPENAI_API_KEY=sk-… npx facet-quickstart --guide ./my-page.md
```

## Assets: themes, stamps, initial tree

`--assets <dir>` points at a directory of **operator data** that reskins and
pre-seeds the page. It's read once at boot — there is no hot reload; a registry
edit needs a restart. Four file kinds are recognized (any subset; a `.json`
that doesn't match is ignored):

| File | What it is |
| --- | --- |
| `*.theme.json` | A named palette/type/scale document — token names mapped to CSS values, including optional `fontFamily` stacks. Offered to the agent by NAME (a `set_theme` tool); **the model never authors the CSS values**. |
| `*.stamp.json` | A reusable `{ name, description?, slots?, root, nodes }` brick fragment the agent may add with `use_stamp`. The prompt advertises names/slots/descriptions only; the server expands the root-reachable stamp subtree into ordinary patches with fresh ids. |
| `catalog.json` | A `FacetCatalog` policy document that tells the agent which theme is active, whether theme switching is locked or allowed, which brick types/variants and stamps it may use, and whether primitive fallback is allowed. |
| `initial.tree.json` | A single `FacetTree` the first visit opens on before the agent's first turn (a fast, non-blank first paint). |

If the built-in guide is in use and assets do not provide `initial.tree.json`,
quickstart supplies its own polished four-tab tour seed. A valid asset
`initial.tree.json` wins over that built-in seed.

A theme document looks like:

```json
{
  "name": "midnight",
  "description": "Dark, high-contrast",
  "color": { "bg": "#0b1020", "fg": "#e8ecff", "accent": "#7c9cff" },
  "fontFamily": { "sans": "Inter, system-ui, sans-serif" }
}
```

With no `catalog.json`, quickstart uses `DEFAULT_CATALOG`: a compact product/app
UI catalog with a locked theme (`default`), all default stamps advertised, the
built-in high-level brick set and variants, primitive fallback allowed, and the
authoring order `stamp -> high-level brick -> primitive fallback`.

A catalog document can lock the page to one theme:

```json
{
  "name": "launch-catalog",
  "description": "Launch page UI policy",
  "theme": { "active": "midnight", "switchPolicy": "locked", "allowed": ["midnight"] },
  "bricks": [
    { "type": "section", "variants": ["surface"] },
    { "type": "card", "variants": ["default", "interactive"] },
    { "type": "button", "variants": ["primary", "secondary"] }
  ],
  "stamps": { "mode": "all" },
  "primitiveFallback": "allowed",
  "policy": {
    "order": ["stamp", "brick", "primitive"],
    "editBeforeAppend": true,
    "compactScreens": true,
    "maxScreenSections": 6
  }
}
```

To explicitly allow theme switching, set `switchPolicy` to `allowed` and list the
theme names the model may choose with `set_theme`:

```json
{
  "name": "switchable-catalog",
  "theme": {
    "active": "midnight",
    "switchPolicy": "allowed",
    "allowed": ["midnight", "daylight"]
  },
  "bricks": [{ "type": "section", "variants": ["surface"] }],
  "stamps": { "mode": "all" },
  "primitiveFallback": "allowed",
  "policy": {
    "order": ["stamp", "brick", "primitive"],
    "editBeforeAppend": true,
    "compactScreens": true
  }
}
```

Every document passes one `@facet/core` validator at boot — `validateTheme`,
`validateStamp`, `validateCatalog`, and `validateTree` respectively:

- A theme value that smuggles CSS (`url()`, `var()`, `expression()`,
  `javascript:`) is refused; dimensions are clamped so a theme can't push
  content off-screen; a low-contrast text/background pair is **flagged as a
  warning, never rejected** (the WCAG ratio is measured, the policy is yours).
- An **invalid document is skipped** and boot proceeds — every problem is logged
  as one concise `[facet-quickstart]` line (never a document value). An initial
  tree that `validateTree` reduces to empty is refused as a seed, so a bad
  `initial.tree.json` falls back to today's model-first paint rather than
  silently seeding a blank page. A missing, malformed, or invalid `catalog.json`
  falls back to `DEFAULT_CATALOG` and logs a concise catalog issue.

The validated theme names + descriptions (never values), catalog policy, and
stamp names + slot names + descriptions + whitelisted metadata are injected into
the agent's prompt; full stamp JSON stays server-side and is expanded only when
the model calls `use_stamp`. Stamp expansion only targets an existing container
parent, reports non-fatal sanitization issues back to the model, and refuses an
expansion that would overflow one patch batch. Catalog-guided behavior is also
enforced by the tool executor: a locked theme rejects `set_theme`, disallowed
brick variants, tone-only recipe selectors outside the advertised variants, and
stamp names reject before any patch is emitted, and the model gets a structured
repair observation instead of a silent no-op. The validated theme map ships
inline in the served HTML shell for the renderer (no new protocol message). An
explicit `--assets` path that doesn't exist ⇒ exit 1 naming it.

This catalog is catalog UI policy only. It is not a hosted auth, billing,
tenant, metering, rate-limit, or spend-control policy; put those controls in the
platform that wraps quickstart.

## The served page

The bin runs a thin wrapper server: it resolves guides/assets, creates the
reference provider-backed agent, serves the HTML shell and the prebuilt browser
bundle (`/app.js` — the standard `@facet/react` renderer + chat dock) itself,
and proxies every protocol route (SSE + POST) to an internal `createFacetServer`
bound to `127.0.0.1` with a random per-boot agent token. The external agent
channel (`/agent/*`) is never exposed — the composed reference agent is
in-process; dial-in is an advanced jack.

The default shell loads Nunito from Google Fonts so the built-in
`DEFAULT_THEME.fontFamily.sans` value renders as intended. If that stylesheet is
blocked or offline, the browser falls back to `sans-serif`.

## Security posture (local tool, not a hosted server)

The quickstart is a **local first-run tool**. Its `/event` route is
unauthenticated and each event drives paid provider calls, so:

- The public wrapper **binds `127.0.0.1` (loopback) by default** — not reachable
  from the network. Pass `host: "0.0.0.0"` to `startQuickstart` only after you
  add your own auth, rate limiting, and spend caps in front of it.
- **`password` fields are never collected** — the renderer excludes them, so a
  typed password can't ride an action event into the LLM or history.
- `MemorySink` is keyed by visitor id, but stored event bodies redact duplicate
  visit `visitorId` values, sensitive collected field names, and key-looking
  field values.
- Provider keys are read from the environment only, used solely in the request
  auth header, and never logged.
- **Context compaction is ON by default**: long conversations are folded into a
  rolling, redacted summary by the same provider model (stored in-memory via
  `MemorySummaryStore`; lost on restart). Compose with
  `composeQuickstartAgent({ summaryStore: null, ... })` to opt out, or pass a
  durable `FileSummaryStore`/`PostgresSummaryStore` paired with an equally
  durable sink.

It is **not** a multi-tenant server: there is no tenant/project isolation,
per-visitor rate limit, spend cap, usage metering, admin auth, or global cap on
concurrent turns, and `MemorySink` history is unbounded. Those are production
platform concerns around Facet, out of scope for the local quickstart.

To bring your own brain instead (in-process, local CLI bridge, or dial-in), see
["Advanced: bring your own brain"](../../../README.md#advanced-bring-your-own-brain)
in the root README.
