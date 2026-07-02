# @facet/agent

The in-process agent SDK for Facet: `defineAgent` wraps your logic into an agent
the runtime can call, and `Stage` is the control surface it drives —
`render` / `set` / `append` / `remove` / `screens` / `say` — to compose and
mutate a visitor's page. Each method records standard RFC 6902 operations
underneath.

```bash
npm install @facet/agent @facet/core
```

You write a function that reacts to an event by driving `stage`; the recorded
commands are flushed into the messages sent back to the visitor.

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

See the [Facet docs](https://github.com/getfacet/facet) and
[ARCHITECTURE.md](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md).
