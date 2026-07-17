# @facet/bridge

Role: **Tools**.

Point a local coding agent (Claude Code, Codex, …) at a Facet link. The bridge
dials into a Facet server (SSE + POST, NAT-safe) and, for each visitor event,
runs your local agent. The spawn runner exposes the `facet` command
(`render/append/set/remove/screens/say`); the persistent runner exposes
in-process `render/append/set/remove/say` tools.

This is local/operator tooling. It is not a hosted worker fleet, queue, billing
boundary, tenant isolation layer, or the provider-neutral LLM tool loop from
`@facet/agent-tools`.

Use Bridge when a coding agent running on your machine should own a link exposed
by a running Facet server. It requires Node.js 20 or newer, that server's URL,
and a compatible local agent CLI. For an in-process application agent or a
direct provider integration, choose another path in
[Getting Started](https://github.com/getfacet/facet/blob/main/docs/GETTING-STARTED.md).

```bash
# it's a bin package — install globally or run with npx
npm install -g @facet/bridge   # then: facet-bridge
npx --package=@facet/bridge -- facet-bridge  # or run it one-off

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

The spawn runner additionally exposes `screens` through the `facet` CLI. The
persistent runner currently exposes render, append, set, remove, and say only.
Theme selection is absent from both runners: one operator-selected Theme belongs
to the agent's assets and never travels as a document patch.

`createBridge({ runner, serverUrl, agentId, … })` is also exported for programmatic
use, alongside `createPersistentDriver(...)`.

## Related guides

- [Facet overview and package chooser](https://github.com/getfacet/facet/blob/main/README.md)
- [Getting Started](https://github.com/getfacet/facet/blob/main/docs/GETTING-STARTED.md) —
  compare external, in-process, and custom-LLM paths.
- [`@facet/cli`](https://github.com/getfacet/facet/blob/main/packages/tools/cli/README.md) —
  the command surface exposed to a spawned local agent.
- [Agent Integration](https://github.com/getfacet/facet/blob/main/docs/AGENT-INTEGRATION.md) —
  build a provider-neutral LLM tool loop instead of a local CLI bridge.
- [Architecture](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md) —
  understand stage ownership and transport boundaries.
