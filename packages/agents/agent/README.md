# @facet/agent

In-process agent SDK for hosts that want to author the page from trusted
application code instead of an external LLM loop.

Role: **Agents**.

```bash
npm install @facet/agent @facet/core
```

Use `defineAgent` to implement an in-process Facet agent with the
session-backed `Stage` API. A turn may render component markup, update a
subtree, publish data through the host-authorized data model, and optionally
emit one assistant conversation message.

```ts
import { defineAgent } from "@facet/agent";

export const agent = defineAgent(async ({ stage }) => {
  await stage.publishData(["metrics"], { revenue: 128000 });

  await stage.render(
    `<Facet entry="home">
      <Screen name="home" title="Revenue">
        <Metric label="Revenue" value="data:metrics.revenue" />
      </Screen>
    </Facet>`,
  );

  stage.message("I updated the revenue view.");
});
```

The `Stage` API is the only in-process write surface. It validates authored
markup through the active catalog, folds successful mutations into authorized
RFC 6902 patches, and returns structured failures without applying partial
state.

## Conversation boundary

`stage.message(text)` records at most one assistant message for the current
turn. More text belongs in the visible component tree, host logs, or the agent's
own memory. There is no `say` frame kind and no browser-side chat mutation API.

## Trust model

`@facet/agent` is not an LLM provider adapter and does not fetch domain data.
Hosts remain responsible for model calls, authorization, and backend tools. This
package only gives trusted in-process code a typed Facet turn interface.

## Read next

- [Agent Integration](https://github.com/getfacet/facet/blob/main/docs/AGENT-INTEGRATION.md)
- [Agent Tool Result Contract](https://github.com/getfacet/facet/blob/main/docs/AGENT-TOOL-RESULT-CONTRACT.md)
- [Architecture](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md)
