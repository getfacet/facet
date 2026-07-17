# @facet/cli

Role: **Tools**.

The `facet` command — a running agent's action surface for its page, as a
terminal command. A local agent (e.g. Claude Code) changes the page by invoking
these commands, exactly as it edits files. Each is a thin wrapper over
`@facet/agent`'s `Stage` that POSTs the resulting change to the local Facet
bridge, which forwards it to the server.

This package is a local bridge command surface. It is not a remote admin CLI,
hosted API client, deployment-management tool, or a replacement for
`@facet/agent-tools`. Use it only inside a Facet Bridge session, where the
bridge supplies `FACET_BRIDGE_URL` and `FACET_EVENT`.

Requires Node.js 20 or newer.

```bash
npm install @facet/cli
```

```bash
facet render '<tree-json>'              # replace the whole stage
facet set '<node-json>'                 # insert/replace one node
facet append <parentId> '<node-json>'   # add a child (a box, text, input…)
facet remove <nodeId>                   # remove a node
facet screens '<map-json>' <entry>      # set the named screens map + entry screen
facet say <text…>                       # send a chat message
```

`facet` runs inside a Facet bridge session (see `@facet/bridge`): it reads
`FACET_BRIDGE_URL` (where to POST) and `FACET_EVENT` (which visitor event the
command belongs to) from the environment the bridge provides.

## Related guides

- [Facet overview and package chooser](https://github.com/getfacet/facet/blob/main/README.md)
- [Getting Started](https://github.com/getfacet/facet/blob/main/docs/GETTING-STARTED.md) —
  choose the external coding-agent path.
- [`@facet/bridge`](https://github.com/getfacet/facet/blob/main/packages/tools/bridge/README.md) —
  start the session that provides the CLI environment.
- [Architecture](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md) —
  understand the patch and agent/runtime boundaries.
