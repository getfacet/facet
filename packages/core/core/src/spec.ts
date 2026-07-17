/**
 * Compact, tool-neutral authoring guidance for the current Facet contract.
 * Dynamic Pattern, Preset, and Brick indexes add the active asset details around
 * this shared text; exact fields, style paths, and local choices stay
 * progressively readable instead of making every mutation schema carry the
 * whole design system.
 */
export const STAGE_SPEC = `Facet is UI an agent authors as safe data. Author a Facet Document such as {"root":"root","nodes":{"<id>":<Brick>}} with optional "screens", "entry", and "data". The root and all screen roots are box Bricks. Node ids are stable map keys, referenced children must exist, and only box may contain "children". Layout is flow-only. Author declarative data only, never raw HTML, JavaScript, or CSS. Successful changes travel as RFC 6902 patches.

Discovery order (keep mutation calls compact):
1. Pattern index — start with names, descriptions, and useWhen guidance. Read one relevant Pattern by exact name only when useful. A Pattern is read-only design guidance: inspect its concrete tree, preserve useful structure and style ideas, then re-author adapted content as ordinary native Bricks. A Pattern is never automatically inserted; never copy sample content or actions blindly.
2. Preset index — prefer a suitable same-Brick Preset for a repeatable visual role. Inspect exact Preset details with get_preset when its style bundle or guidance matters. Preset names are scoped by Brick type; a name available to box is not automatically available to text.
3. Brick index — choose from the eleven native Bricks: box, text, media, input, richtext, table, chart, list, keyValue, progress, loading. Use get_brick_spec to read one unfamiliar Brick's authored fields and compact style paths: targets, properties with their sources, states, and applicability rules. get_style_choices is only for directly choosing a value at one exact Brick-owned path; it returns allowed names and meanings for that local property, never a global token lookup.

Styling has one entry point: each Brick may have one optional "style" object, and every Brick owns its own closed style vocabulary. A target such as input.style.control or progress.style.track belongs only to that Brick even when another Brick uses a similarly named target. Use exactly one of four forms:
- omit "style": the complete Theme default styles the Brick;
- Preset only, for example a box with "style":{"preset":"panel"};
- direct style only, for example a box with "style":{"gap":"lg"};
- Preset plus a deliberate direct adjustment, for example "style":{"preset":"panel","gap":"lg"}.
Resolution order is Theme default, then same-Brick Preset, then direct style. Work Preset first. Use direct style for Pattern-specific layout or an intentional visual adjustment; direct style may override one disclosed Preset property. Only box and text initially support "activeWhen" with their alternate appearance inside "style.active". Renderer interaction states such as hover, pressed, focus, checked, sorted, and alternate are authorable only at the exact Brick target and property paths disclosed by that Brick specification.

Vocabulary is exact:
- fontSize, gap, background, and color are examples of style property names;
- label, control, track, and fill are examples of Brick-owned style targets;
- md, lg, and success are examples of token names; get_style_choices returns their property-local allowed choices as names with description and useWhen meanings;
- row, column, auto, full, true, and false are examples of closed fixed choices owned by renderer behavior;
- concrete values such as pixels, rem values, color codes, gradients, and font stacks are Theme-only.
Never author raw CSS or invent a property, target, state, token name, or fixed choice. The Theme owns all concrete CSS values. The host supplies one validated Theme containing complete token definitions, light and dark paint values, Brick defaults, and optional Presets. The agent does not select or mutate the Theme. colorMode is host/client view state (system preference resolved to light or dark), never Facet Document syntax.

Brick behavior stays closed. box is the sole container and may carry onPress/onHold actions, hidden state, a bounded media backdrop, or a renderer-owned modal/drawer overlay. text is one plain text value; richtext is closed blocks, runs, and semantic marks; media is a gated image or video; input is a named renderer-owned control; table, chart, list, keyValue, progress, and loading are bounded display Bricks. Exact fields come from the Brick specification rather than this compact guide.

Actions are agent, navigate, or toggle. navigate and toggle run locally with no agent turn. Agent actions may collect visible named inputs from a containing box. A document may keep reusable rows in its named "data" warehouse; disclosed data Bricks bind by dataset name through "from". These names are never URLs, queries, expressions, or resolvers. There is no client-side fetch or authored browser business logic; backend work stays with the agent.

For a user request to build, change, or draw the page, asset reads and inspections are preparation only: no_stage_change does not satisfy a page-change request. After preparation, the agent must call a mutation tool — render_page, set_node, append_node, or remove_node — and must receive applied_visible before claiming completion. A factual or no-change request does not require a mutation.

When adding a new hierarchy under an existing parent, create every unattached leaf with set_node, create inner boxes bottom-up with set_node, then append_node the completed top node to the existing parent exactly once. Never append a descendant directly to the destination and also reference it from the new container.

Normal authoring is strict and atomic. An invalid authoring call rejects the whole call with bounded structured repair errors and no patch; inspect the reported allowed choices and retry. Fail-safe rendering is a separate last defense: if stale or bypassed data reaches validation or rendering, invalid style fragments are ignored while valid Bricks and siblings continue. Unknown or dangling nodes are skipped, never thrown.`;
