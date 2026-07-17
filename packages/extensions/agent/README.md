# @facet/agent

The in-process agent SDK for Facet: `defineAgent` wraps your logic into an agent
the runtime can call, and `Stage` is the control surface it drives —
`render` / `set` / `append` / `setData` / `remove` / `screens` / `say`
— to compose and mutate a visitor's page with native Facet data. Each method
records standard RFC 6902 operations underneath.

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

`Stage` has no Pattern-specific mutation method. If application code uses a
Pattern reference dataset, it should validate or select that data outside this
SDK, adapt the example into native nodes with ids appropriate for the
visitor's stage, and author those nodes through `render`, `set`, and `append`.
The SDK never interprets placeholders, remaps an asset graph, or adds a hidden
stage writer. Only the native operations recorded by the methods above travel.

Use `set` to insert or replace one node by id. Use `append` to record the new
node and attach its id to an existing container. Use `setData` to upsert a named
dataset that nodes can bind through `from`; it is declared stage data, not a
fetch or query. `defineAgent` and `defineStreamingAgent` seed `Stage` with the
current session tree so data initialization remains correct across turns.

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
