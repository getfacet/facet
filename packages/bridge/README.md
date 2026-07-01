# @facet/bridge

Point a local coding agent (Claude Code, Codex, …) at a Facet link. The bridge
dials into a Facet server (SSE + POST, NAT-safe) and, for each visitor event,
runs your local agent — exposing a `facet` command the agent calls to change the
page (`facet render/append/set/remove/say`).

```bash
# with a Facet server running (see @facet/server)
FACET_SERVER=http://localhost:5291 FACET_AGENT_ID=live facet-bridge
```

## Config (env)

| Var | Default | Meaning |
| --- | --- | --- |
| `FACET_SERVER` | `http://localhost:5291` | Facet server to dial into |
| `FACET_AGENT_ID` | `live` | which link (agent id) to own |
| `FACET_METHOD` | `session` | `oneshot` (fresh agent per event) or `session` (`--resume` for continuity) |
| `FACET_BRAIN` | `claude` | the brain CLI to run (e.g. `codex`) |
| `FACET_BRIDGE_PORT` | `5292` | local port the `facet` CLI posts to |

Or programmatically:

```ts
import { createBridge } from "@facet/bridge";

const bridge = createBridge({ serverUrl, agentId: "live", method: "session", command: "claude" });
// …
bridge.close();
```

## How it works today

The agent is **spawned per event** — `oneshot` starts a fresh run each time;
`session` `--resume`s the same conversation so page context carries across
events. A persistent, always-on session that owns the link is a planned upgrade.

The brain never talks to the server directly: it only runs `facet …` (from
`@facet/cli`), which the bridge collects and returns over the connection.
