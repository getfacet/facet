---
"@facet/core": minor
"@facet/agent": minor
"@facet/runtime": minor
"@facet/server": minor
"@facet/agent-client": minor
"@facet/bridge": minor
"@facet/quickstart": minor
---

Live streaming v1: agents can return async iterable batches of server messages,
letting the runtime apply, persist, and deliver a turn incrementally while
recording one accumulated sink event. `defineStreamingAgent` streams Stage
deltas per step, quickstart now yields provider steps as live page updates, and
non-streaming remote/bridge boundaries explicitly collapse async results into a
single control batch.
