# @facet/quickstart

Role: **Tools**.

One command from a provider key to a live Facet page. `facet-quickstart` wraps
`@facet/reference-agent`, the reference server, the React renderer, and the chat
dock. The reference brain is one pluggable implementation, not the only agent
Facet can run.

With no `facet.md`, quickstart starts from a validated four-screen product tour:
**What is Facet?**, **Core Structure**, **Design System**, and **Use Cases**. It
uses all eleven native Bricks. Navigation, actions, cards, controls, summaries,
badges, and alerts are ordinary Brick trees styled by the active Theme.

```bash
OPENAI_API_KEY=sk-… npx facet-quickstart
```

On success:

```text
Facet quickstart running at http://localhost:5292
Brain: openai (gpt-5.4-mini)
```

In the workspace, build the browser bundle first:

```bash
pnpm --filter @facet/quickstart build
OPENAI_API_KEY=sk-… pnpm exec tsx packages/tools/quickstart/src/cli.ts
```

## Agent workflow

The reference agent runs a bounded streaming tool loop. It can mutate the page
with `render_page`, `append_node`, `set_node`, and `remove_node`; inspect with
`inspect_stage` and `inspect_node`; chat with `say`; and progressively discover
the design system with:

- `get_pattern({ name })`;
- `get_preset({ brick, name })`;
- `get_brick_spec({ type })`; and
- `get_style_choices({ brick, target, property })`.

Pattern, Preset, Brick, and style-choice reads return exact provider-side data
with `no_stage_change`. They are preparation only. When the visitor asks to
build or change the page, the agent must continue through a mutation and receive
`applied_visible` before claiming completion.

For a new hierarchy under an existing parent, the agent creates unattached
leaves and inner boxes bottom-up with `set_node`, then attaches only the
completed top Brick once with `append_node`. This avoids giving one child two
parents.

Each closed tool batch is yielded as soon as it is ready, so the browser can
show the page changing during a model turn.

## Flags

```text
facet-quickstart [--guide <path>] [--port <n>] [--provider openai|anthropic] [--agent-id <id>] [--assets <dir>]
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--guide <path>` | `./facet.md` | Deployer page brief. |
| `--port <n>` | `5292` | Public loopback port. |
| `--provider openai\|anthropic` | auto | Force a provider and require its key. |
| `--agent-id <id>` | `quickstart` | Agent id used for sessions and assets. |
| `--assets <dir>` | none | Directory containing the exact Theme, Pattern list, and optional initial tree files below. |

An explicitly supplied guide must exist. An explicitly supplied assets path
must be a readable directory. Either failure exits with status 1 and names the
path.

## Providers and keys

| Provider | Environment variable | Model |
| --- | --- | --- |
| OpenAI | `OPENAI_API_KEY` | `gpt-5.4-mini` |
| Anthropic | `ANTHROPIC_API_KEY` | `claude-sonnet-4-5` |

An explicit provider wins. Otherwise OpenAI wins when both keys exist, then
Anthropic. With neither key quickstart exits with:

```text
No provider key found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.
```

Keys come from the environment only. They are never persisted, logged, placed
in the browser bundle, or echoed in errors.

## Guide file

The guide is Markdown describing what the page should do and show. It becomes
the `PAGE BRIEF` layer after Facet's fixed Brick, style, and tool contract.

- If default `./facet.md` is absent, quickstart uses its built-in brief and
  initial tour.
- Passing an explicit guide disables that built-in initial tour. Supply
  `initial.tree.json` when an explicit guide also needs a pre-seeded first
  paint.

```markdown
# My onboarding assistant

Build a page that helps a visitor choose a plan. Ask for team size, goal, and
timeline, then reshape the page as the conversation develops.
```

## Exact assets

`--assets <dir>` is loaded once at boot through `FileAssets` and `loadAssets`.
Only three exact filenames are current:

| File | Purpose |
| --- | --- |
| `theme.json` | One complete Theme: tokens, light/dark paint, Brick defaults, and optional Presets. |
| `patterns.json` | One array containing up to 64 exact compatible Patterns. |
| `initial.tree.json` | One optional strict initial Facet tree. |

Without `--assets`, quickstart still resolves `DEFAULT_THEME` and
`DEFAULT_PATTERNS`. If `patterns.json` is absent, bundled Patterns are used; an
explicit `[]` disables Pattern references. There is no hot reload.

### Theme

The Theme is one complete operator design system, not a partial override. Its
token names are fixed by Core; the Theme supplies every concrete value, one
default style per Brick, and optional Presets. Start from `DEFAULT_THEME`,
replace allowed values, validate, then write the complete object:

```ts
import { writeFile } from "node:fs/promises";
import { DEFAULT_THEME } from "@facet/assets";
import { validateTheme } from "@facet/core";

const theme = {
  ...DEFAULT_THEME,
  name: "northstar",
  description: "Northstar's complete design system.",
  tokens: {
    ...DEFAULT_THEME.tokens,
    paint: {
      light: {
        ...DEFAULT_THEME.tokens.paint.light,
        color: {
          ...DEFAULT_THEME.tokens.paint.light.color,
          accent: "#3157d5",
        },
      },
      dark: {
        ...DEFAULT_THEME.tokens.paint.dark,
        color: {
          ...DEFAULT_THEME.tokens.paint.dark.color,
          accent: "#8aa4ff",
        },
      },
    },
  },
};

if (validateTheme(theme).theme === undefined) throw new Error("Invalid Theme");
await writeFile("theme.json", JSON.stringify(theme, null, 2));
```

The model never sees the concrete CSS values. It sees the active Preset index
and authors only closed Brick style names. Light/dark mode is browser state, not
document syntax or an agent tool.

### Patterns

`patterns.json` is one array. Every Pattern has discovery metadata and an exact
ordinary Facet tree already compatible with the active Theme:

```json
[
  {
    "name": "launch-card",
    "description": "A compact launch card with one primary action.",
    "useWhen": "A visitor needs one clear next step.",
    "root": "launch-card.root",
    "nodes": {
      "launch-card.root": {
        "id": "launch-card.root",
        "type": "box",
        "style": { "preset": "panel", "gap": "sm" },
        "children": ["launch-card.title", "launch-card.action"]
      },
      "launch-card.title": {
        "id": "launch-card.title",
        "type": "text",
        "value": "Ready to launch?",
        "style": { "preset": "heading" }
      },
      "launch-card.action": {
        "id": "launch-card.action",
        "type": "box",
        "style": { "preset": "primaryAction" },
        "onPress": { "kind": "agent", "name": "start" },
        "children": ["launch-card.action.label"]
      },
      "launch-card.action.label": {
        "id": "launch-card.action.label",
        "type": "text",
        "value": "Start",
        "style": { "preset": "actionLabel" }
      }
    }
  }
]
```

The prompt lists only Pattern name, description, and `useWhen`. The model calls
`get_pattern` when it needs the exact tree, then re-authors adapted ordinary
Bricks. Pattern data never enters the HTML shell, transport, browser globals,
or stage provenance.

### Validation and delivery

`loadAssets` validates the Theme whole, validates every Pattern against that
Theme, strictly validates the optional initial tree, and returns bounded issues
instead of throwing. Invalid Theme input falls back whole to `DEFAULT_THEME`;
invalid Patterns are hidden whole; an invalid or empty initial tree is not used
as a seed.

The effective Theme is inlined as escaped `window.__FACET_THEME__` for
`StageRenderer`. The optional seed is inlined as
`window.__FACET_INITIAL_STAGE__`. Patterns stay agent-side. No extra protocol
message or browser asset route is added.

## Served page

The public wrapper serves the HTML shell and prebuilt `/app.js`, then proxies
browser SSE/POST routes to an internal `createFacetServer` bound to a random
loopback port with a per-boot agent token. `/agent/*` is never exposed because
the reference brain runs in-process.

The shell loads Nunito from Google Fonts for the bundled Theme. If unavailable,
the browser falls back to `sans-serif`.

## Security posture

Quickstart is a local first-run tool. Its public wrapper binds `127.0.0.1` by
default. Its `/event` route is unauthenticated and may trigger paid provider
calls; expose it on another host only after adding auth, rate limiting, and
spend controls.

- Password inputs are never collected.
- Sink records redact sensitive field names and key-looking values.
- Provider keys remain server-side.
- Context compaction is enabled by default with `MemorySummaryStore`. Pass
  `summaryStore: null` to `composeQuickstartAgent` to disable it, or provide a
  durable store paired with a durable Sink.

Quickstart is not a multi-tenant server and does not implement tenant isolation,
metering, admin auth, or global turn limits.

To bring your own brain, see
[Bring your own brain](../../../README.md#bring-your-own-brain).
