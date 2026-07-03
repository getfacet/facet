# @facet/quickstart

One command from a provider key (or no key at all) to a live Facet page. The
package ships a **built-in reference brain** — a tool-calling LLM agent that
draws the page from your guide markdown and keeps editing it as visitors chat —
plus the `facet-quickstart` bin that boots it behind a ready-made server. It is
to brains what `@facet/server` is to transports: a reference implementation of a
pluggable seam, not the only brain Facet can run.

Each turn the agent runs a bounded **tool loop**: the model calls
`append_node` / `set_node` / `remove_node` (incremental edits), `render_page`
(a full redraw), and `say` (chat) — via the provider's native function-calling
(OpenAI) / tool-use (Anthropic) — observing each result before deciding the
next, so it can refine a page in place rather than redrawing it every time.

```bash
# with a provider key (env only — see below)
OPENAI_API_KEY=sk-… npx facet-quickstart --guide ./my-page.md

# no key: the deterministic stub brain (no network, fixture page)
npx facet-quickstart --stub
```

On success it prints the link and the resolved brain:

```
Facet quickstart running at http://localhost:5292
Brain: openai (gpt-4o-mini)
```

In the workspace (dev), build first — the bin serves a prebuilt page bundle:

```bash
pnpm --filter @facet/quickstart build
node packages/quickstart/dist/cli.js --stub
```

## Flags

```
facet-quickstart [--guide <path>] [--port <n>] [--provider openai|anthropic] [--stub] [--agent-id <id>]
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--guide <path>` | `./facet.md` | Guide markdown — what the page is about (the deployer's brief). |
| `--port <n>` | `5292` | Public port. Busy ⇒ exit 1 naming the port and `--port`. |
| `--provider openai\|anthropic` | auto | Force a provider; requires that provider's key. |
| `--stub` | off | Keyless deterministic brain; skips key resolution entirely. |
| `--agent-id <id>` | `quickstart` | Agent id the sessions are keyed under. |

## Providers & keys

| Provider | Key env var | Model |
| --- | --- | --- |
| `openai` (default) | `OPENAI_API_KEY` | `gpt-4o-mini` |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-5` |

Resolution: an explicit `--provider` wins and requires its own key; otherwise
`OPENAI_API_KEY` ⇒ openai (also when both keys are present), else
`ANTHROPIC_API_KEY` ⇒ anthropic. No key and no `--stub` exits 1 with:

```
No provider key found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY, or run with --stub for a keyless look around.
```

Keys are read from the environment only — never a config file, never persisted.
They travel exclusively in the provider request's auth header and are never
logged or echoed in errors (messages name the env var, never a value). Adapters
use raw `fetch` (no SDK dependencies).

## The guide file

The guide is plain markdown describing the page you want — tone, sections,
what to collect. It becomes the "PAGE BRIEF" layer of the agent's prompt (the
stage vocabulary and output contract are fixed layers above it).

- Default path `./facet.md`; if it doesn't exist, a built-in demo brief
  (`DEFAULT_GUIDE` — a personal landing page with a say-hi form) is used
  silently.
- An **explicitly passed** `--guide` path that doesn't exist is an error:
  exit 1 with `Guide file not found: <path>`.

## Stub mode

`--stub` wires `createStubAgent()` instead of an LLM: a fixed fixture page
(hero, a name+email form whose submit collects the fields, and two
navigate-linked screens) with fully deterministic replies — zero network, zero
randomness. It exists for a keyless look around and as the fixture behind the
repo's `/live-test` Tier-1 gate.

## The served page

The bin runs a thin wrapper server: it serves the HTML shell and the prebuilt
browser bundle (`/app.js` — the standard `@facet/react` renderer + chat dock)
itself, and proxies every protocol route (SSE + POST) to an internal
`createFacetServer` bound to `127.0.0.1` with a random per-boot agent token.
The external agent channel (`/agent/*`) is never exposed — quickstart's brain
is in-process; dial-in is an advanced jack.

## Security posture (local tool, not a hosted server)

The quickstart is a **local first-run tool**. Its `/event` route is
unauthenticated and each event drives paid provider calls, so:

- The public wrapper **binds `127.0.0.1` (loopback) by default** — not reachable
  from the network. Pass `host: "0.0.0.0"` to `startQuickstart` only after you
  add your own auth, rate limiting, and spend caps in front of it.
- **`password` fields are never collected** — the renderer excludes them, so a
  typed password can't ride an action event into the LLM or history.
- Provider keys are read from the environment only, used solely in the request
  auth header, and never logged.

It is **not** a multi-tenant server: there is no per-visitor rate limit or
global cap on concurrent turns, and `MemorySink` history is unbounded. Those are
hosted-product concerns (see the root roadmap), out of scope for the local
quickstart.

To bring your own brain instead (in-process, local CLI bridge, or dial-in), see
["Advanced: bring your own brain"](../../README.md#advanced-bring-your-own-brain)
in the root README.
