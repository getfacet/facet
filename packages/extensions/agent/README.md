# @facet/agent

The in-process agent SDK for Facet: `defineAgent` wraps your logic into an agent
the runtime can call, and `Stage` is the control surface it drives —
`render` / `set` / `append` / `useStamp` / `remove` / `screens` / `theme` /
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

`Stage.useStamp(stamp, params, { parent })` accepts an already-resolved
`FacetStamp`, fills its declared `{{slot}}` markers, mints fresh ids, appends
the expanded root under a known box parent, and returns the new `root`, `slots`,
and full old-to-new `ids` map for follow-up edits. `defineAgent` and
`defineStreamingAgent` seed `Stage` with the current session tree, so stamps can
target boxes that existed before the current turn; malformed stamps, non-box
parents, and expansions that would exceed one patch batch are no-ops.

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
