# @facet/agent

The in-process agent SDK for Facet: `defineAgent` wraps your logic into an agent
the runtime can call, and `Stage` is the control surface it drives —
`render` / `set` / `append` / `useComposition` / `remove` / `screens` / `theme` /
`say` — to compose and mutate a visitor's page. Each method records standard RFC
6902 operations underneath.

Tier: **Agent Authoring**. Use this when TypeScript code, tests, a rules engine,
or a local demo should author stage changes without hand-writing patch arrays.
For LLM/provider tool-calling loops, start with `@facet/agent-tools`; this
package is not the LLM tool-schema surface.

```bash
npm install @facet/agent @facet/core
```

You write a function that reacts to an event by driving `stage`; the recorded
commands are flushed into the messages sent back to the visitor. `defineAgent`
flushes once at the end of the turn. `defineStreamingAgent` accepts generator
logic and flushes on each `yield`, so a long-running model loop can let the page
build live.

```ts
import { defineAgent } from "@facet/agent";

export const agent = defineAgent(({ event, stage }) => {
  if (event.kind === "visit") {
    stage.render({
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["title"] },
        title: { id: "title", type: "text", value: "Welcome" },
      },
    });
  }
  if (event.kind === "message") {
    stage
      .append("root", { id: "price", type: "text", value: "$20/mo" })
      .say("Added it below.");
  }
});
```

`Stage.useComposition(composition, params, { parent })` accepts an
already-resolved `FacetComposition`, fills its declared `{{slot}}` markers,
mints fresh ids, appends the expanded root under a known container parent, and
returns the new `root`, `slots`, and full old-to-new `ids` map for follow-up
edits. On success every expansion op — all minted nodes plus the single parent
attach — is recorded together, so the expansion travels as one referentially
closed patch batch; on any failure (a malformed composition, an unknown or
non-container parent, or an expansion that would exceed one patch batch) it
records zero ops and returns a result without `root`. `defineAgent` and
`defineStreamingAgent` seed `Stage` with the current session tree, so
compositions can target containers that existed before the current turn.

```ts
import { defineStreamingAgent } from "@facet/agent";

export const streamingAgent = defineStreamingAgent(async function* ({ event, stage }) {
  if (event.kind !== "message") return;
  stage.say("Starting...");
  yield;
  stage.append("root", { id: "answer", type: "text", value: "First result" });
  yield;
});
```

See the [Facet docs](https://github.com/getfacet/facet) and
[ARCHITECTURE.md](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md).
