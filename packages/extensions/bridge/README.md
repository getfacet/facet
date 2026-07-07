# @facet/bridge

Point a local coding agent (Claude Code, Codex, …) at a Facet link. The bridge
dials into a Facet server (SSE + POST, NAT-safe) and, for each visitor event,
runs your local agent — exposing a `facet` command the agent calls to change the
page (`facet render/append/set/remove/screens/theme/say`).

```bash
# it's a bin package — install globally or run with npx
npm install -g @facet/bridge   # then: facet-bridge
npx facet-bridge               # or run it one-off

# with a Facet server running (see @facet/server)
FACET_SERVER=http://localhost:5291 FACET_AGENT_ID=live facet-bridge
```

## Two runners

- **`spawn`** (default) — runs a CLI (`claude`/`codex`/any) per event. Works with
  any agent CLI; simple and robust. Uses the CLI's own local auth (no API key).
- **`persistent`** — one always-on Claude session (via the Claude Agent SDK's
  streaming input) OWNS the link; visitor events stream into the live session,
  which drives the page through in-process `facet_*` tools. Warmer/continuous,
  **Claude only**. Also uses the local Claude Code auth (no API key).

```bash
FACET_RUNNER=persistent facet-bridge          # always-on Claude session owns the link
FACET_RUNNER=spawn FACET_BRAIN=codex facet-bridge   # a CLI per event
```

## Config (env)

| Var | Default | Meaning |
| --- | --- | --- |
| `FACET_SERVER` | `http://localhost:5291` | Facet server to dial into |
| `FACET_AGENT_ID` | `live` | which link (agent id) to own |
| `FACET_RUNNER` | `spawn` | `spawn` (CLI per event) or `persistent` (always-on session) |
| `FACET_CONTINUITY` | `resume` | (spawn) `oneshot` or `resume` (`--resume` for continuity) |
| `FACET_BRAIN` | `claude` | (spawn) the brain CLI to run (e.g. `codex`) |
| `FACET_MODEL` | — | (persistent) model for the session |
| `FACET_BRIDGE_PORT` | `5292` | (spawn) local port the `facet` CLI posts to |
| `FACET_MAX_CONCURRENT` | `4` | (spawn) max brain CLIs running at once — extra visitors queue FIFO |
| `FACET_AGENT_TOKEN` | — | shared token sent to the server's `/agent/*` channel (set when the server sets `agentToken`) |

An unrecognized enum/number value (e.g. `FACET_RUNNER=persistant`) exits with a
clear error rather than silently falling back to the default.

Or programmatically (the library entry is ESM-only):

```ts
import { createBridge } from "@facet/bridge";

const bridge = createBridge({ serverUrl, agentId: "live", continuity: "resume", command: "claude" });
// …
bridge.close();
```

## How it works

The bridge never lets the brain talk to the server directly. With the **spawn**
runner the brain runs `facet …` (from `@facet/cli`), which the bridge collects
and returns over the connection. With the **persistent** runner the always-on
session calls in-process `facet_*` tools (via the Agent SDK's MCP tools) whose
handlers write to the current event's stage — events are processed serially so
each turn's changes are attributed to that event.

Both runners expose the same stage action surface: render, append, set, remove,
screens, theme by name, and say. In spawn mode, theme selection uses
`facet theme <name>`. Theme selection is name-only; invalid names are rejected
before any stage patch is emitted.

`createBridge({ runner, serverUrl, agentId, … })` is also exported for programmatic
use, alongside `createPersistentDriver(...)`.
