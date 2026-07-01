# @facet/bridge

Point a local coding agent (Claude Code, Codex, …) at a Facet link. The bridge
dials into a Facet server (SSE + POST, NAT-safe) and, for each visitor event,
runs your local agent — exposing a `facet` command the agent calls to change the
page (`facet render/append/set/remove/say`).

```bash
# with a Facet server running (see @facet/server)
FACET_SERVER=http://localhost:5291 FACET_AGENT_ID=live facet-bridge
```

## Two modes

- **`spawn`** (default) — runs a CLI (`claude`/`codex`/any) per event. Works with
  any agent CLI; simple and robust. Uses the CLI's own local auth (no API key).
- **`persistent`** — one always-on Claude session (via the Claude Agent SDK's
  streaming input) OWNS the link; visitor events stream into the live session,
  which drives the page through in-process `facet_*` tools. Warmer/continuous,
  **Claude only**. Also uses the local Claude Code auth (no API key).

```bash
FACET_MODE=persistent facet-bridge          # always-on Claude session owns the link
FACET_MODE=spawn FACET_BRAIN=codex facet-bridge   # a CLI per event
```

## Config (env)

| Var | Default | Meaning |
| --- | --- | --- |
| `FACET_SERVER` | `http://localhost:5291` | Facet server to dial into |
| `FACET_AGENT_ID` | `live` | which link (agent id) to own |
| `FACET_MODE` | `spawn` | `spawn` (CLI per event) or `persistent` (always-on session) |
| `FACET_METHOD` | `session` | (spawn) `oneshot` or `session` (`--resume` for continuity) |
| `FACET_BRAIN` | `claude` | (spawn) the brain CLI to run (e.g. `codex`) |
| `FACET_MODEL` | — | (persistent) model for the session |
| `FACET_BRIDGE_PORT` | `5292` | (spawn) local port the `facet` CLI posts to |

Or programmatically:

```ts
import { createBridge } from "@facet/bridge";

const bridge = createBridge({ serverUrl, agentId: "live", method: "session", command: "claude" });
// …
bridge.close();
```

## How it works

The bridge never lets the brain talk to the server directly. In **spawn** mode
the brain runs `facet …` (from `@facet/cli`), which the bridge collects and
returns over the connection. In **persistent** mode the always-on session calls
in-process `facet_*` tools (via the Agent SDK's MCP tools) whose handlers write
to the current event's stage — events are processed serially so each turn's
changes are attributed to that event.

`createBridge({ mode, serverUrl, agentId, … })` is also exported for programmatic
use, alongside `createPersistentDriver(...)`.
