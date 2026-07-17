# @facet/cli

Role: **Tools**.

The `facet` command — a running agent's action surface for its page, as a
terminal command. A local agent (e.g. Claude Code) changes the page by invoking
these commands, exactly as it edits files. Each is a thin wrapper over
`@facet/agent`'s `Stage` that POSTs the resulting change to the local Facet
bridge, which forwards it to the server.

This package is a local bridge command surface. It is not a remote admin CLI,
hosted API client, or deployment-management tool.

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

See the [Facet docs](https://github.com/getfacet/facet) and
[ARCHITECTURE.md](https://github.com/getfacet/facet/blob/main/docs/ARCHITECTURE.md).
