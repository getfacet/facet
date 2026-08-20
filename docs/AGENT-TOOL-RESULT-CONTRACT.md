# Agent Tool Result Contract

Facet's agent-facing tool surface is provider-neutral and closed. Tools let an
LLM read the current UI contract, author component markup, publish bounded UI
data, and observe results. They do not fetch domain data, execute business
actions, or send conversation messages.

## Tool roster

`FACET_TOOL_NAMES` and `FACET_TOOL_SPECS` define exactly nine tools:

| Tool | Mutates stage | Purpose |
| --- | --- | --- |
| `render_page` | yes | Replace the page with a complete component-markup document. |
| `insert_subtree` | yes | Insert a component-markup subtree under an existing generated node id. |
| `replace_subtree` | yes | Replace an existing component subtree with authored markup. |
| `update_node` | yes | Update one existing node from authored markup. |
| `remove_subtree` | yes | Remove one existing component subtree. |
| `read_component_spec` | no | Read the active catalog metadata for one registered tag. |
| `read_screen` | no | Read one declared screen as bounded serialized markup. |
| `read_data` | no | Read a bounded projection of the data model at a named-key path. |
| `publish_data` | yes | Publish one bounded JSON value through the data lane. |

Every tool response is plain data. A successful mutating response includes the
stage revision in force after the operation. A successful read response includes
the requested projection and the current revision.

## Common rejection shape

Failures use a closed `{ ok: false, code, ... }` shape. The first deterministic
fault is reported; a rejected mutation emits no patch and leaves the local
shadow unchanged.

Authoring failures use the same author-error vocabulary as Core parsing and
catalog validation. The error carries one code, one source location, one cause,
and one repair hint. That is the only path for invalid markup: renderer
fail-safe behavior is not an authoring acceptance path.

## Mutation outcomes

`render_page`, `insert_subtree`, `replace_subtree`, `update_node`, and
`remove_subtree` can return:

| Outcome | Meaning |
| --- | --- |
| `ok: true` | The authored change was validated, folded, and the response includes `stageRevision`. |
| `author_error` | Markup parsed or catalog validation failed; no stage change. |
| `page_not_rendered` | A targeted mutation was requested before any page exists. |
| `unknown_target_id` | The supplied generated node id is not present in the current document. |
| `entry_screen_root_removal` | The request attempted to remove the entry screen root. |
| `invalid_document` | The post-removal document could not be serialized safely. |
| `invalid_fragment` | Targeted markup did not contain exactly one subtree. |
| `invalid_markup_input` | The mutation input did not include a markup string. |
| `reserved-attribute` | A targeted fragment attempted to author the reserved `id` attribute. |
| `invalid_target_id` | A targeted mutation did not include a valid target id string. |
| `screen_boundary_violation` | A targeted mutation crossed a screen-root boundary. |
| `screen_name_changed` | A screen-root update or replacement changed the screen name. |
| `mutation_authority_rejected` | The runtime write authority expired before the mutation could commit. |
| `stale_revision` | The mutation expected an older revision than the active session. |
| `unknown_mutation_kind` | The mutation kind is not in the closed roster. |
| `invalid_mutation_input` | The submitted mutation input was not an object. |
| `mutation_rejected` | A future runtime rejection was safely collapsed to the generic mutation failure. |

Runtime or transport layers can additionally reject a submitted turn as `busy`,
`deduped`, or another revision/settlement failure. Those are not model-tool
success states; they are delivery outcomes around the same single-writer stage
contract.

## Read outcomes

`read_component_spec` returns `{ ok: true, spec, availableAssets,
stageRevision }` or `component_not_found` with the available tag list.
`availableAssets` is the bounded host-pinned key and kind index used by valid
`asset:` references; it is empty when the host supplied no matching assets.

`read_screen` returns `{ ok: true, screen, markup, issues, stageRevision }` or
`page_not_rendered`. Serialization issues are included as structured issue
strings; a successful read may still report safe degradation of corrupt stored
input.

`read_data` returns `{ ok: true, path, value, count, truncated, stageRevision }`
or `invalid_data_path`. Paths use named keys only and reuse Facet's identifier
grammar for each segment.

## Data publish outcomes

`publish_data` returns `{ ok: true, descriptor, stageRevision }` when the value
fits all payload and model bounds. The descriptor reports path, JSON shape,
fields, and count.

Rejections mirror Core payload evaluation: non-serializable input, model/object
shape violations, payload length limits, value-count limits, array length
limits, object-key limits, string length limits, or a specific bound at the
reported path. The tool never performs a domain fetch; the host must fetch and
authorize data before publishing it into Facet.

## Visitor event collection

The renderer sends `agent:` events with exactly the fields the author requested.
Each collected field is one of:

- `{ kind: "value", value }`;
- `{ kind: "omitted_sensitive" }`; or
- `{ kind: "collect_source_unavailable" }`.

`collect_source_unavailable` is a runtime fail-safe for a validly authored field
that is not live or registered at event time. It is not an author-time escape
hatch for a typo; author validation rejects collect names that the screen cannot
resolve.

## Conversation is separate

Conversation messages are runtime/protocol frames, not tool calls in the roster
above. A turn may produce a conversation frame alongside stage patches, but no
Facet tool is named "send message" and no authoring operation smuggles
conversation text through component markup.

## Agent loop rule

After every tool call, return the structured observation to the model. If a
mutation is rejected, repair the one reported fault and retry. Do not claim the
requested UI change is complete until a mutating tool returns success and the
runtime accepts the resulting turn.
