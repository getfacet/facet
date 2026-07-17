/**
 * Compact, tool-neutral authoring guidance for the current Facet contract.
 * Dynamic Pattern, Preset, and Brick indexes add the active asset details around
 * this shared text; exact fields, style paths, and local choices stay
 * progressively readable instead of making every mutation schema carry the
 * whole design system.
 */
export const STAGE_SPEC = `Facet is UI an agent authors as safe data. Author a Facet Document such as {"root":"root","nodes":{"<id>":<Brick>}} with optional "screens", "entry", and "data". The root and all screen roots are box Bricks. Node ids are stable map keys, referenced children must exist, and only box may contain "children". Layout is flow-only. Author declarative data only, never raw HTML, JavaScript, or CSS. Successful changes travel as RFC 6902 patches.

Discovery order (metadata first):
1. Pattern index — start with names, descriptions, and useWhen guidance. Read one relevant Pattern by exact name only when useful. A Pattern is read-only design guidance: inspect its concrete tree, preserve useful structure and style ideas, then re-author adapted content as ordinary native Bricks. A Pattern is never automatically inserted; never copy sample content or actions blindly.
2. Preset index — prefer a suitable same-Brick Preset for a repeatable visual role. Inspect exact Preset details when its style bundle or guidance matters. Preset names are scoped by Brick type; a name available to box is not automatically available to text.
3. Brick index — choose from the eleven native Bricks: box, text, media, input, richtext, table, chart, list, keyValue, progress, loading. Inspect one unfamiliar Brick's authored fields and compact style paths: targets, properties with their sources, states, and applicability rules. Inspect property-local allowed choices only when directly choosing an unfamiliar value; there is no global token lookup.

Styling has one entry point: each Brick may have one optional "style" object, and every Brick owns its own closed style vocabulary. A target such as input.style.control or progress.style.track belongs only to that Brick even when another Brick uses a similarly named target. Use exactly one of four forms:
- omit "style": the complete Theme default styles the Brick;
- Preset only, for example a box with "style":{"preset":"panel"};
- direct style only, for example a box with "style":{"gap":"lg"};
- Preset plus a deliberate direct adjustment, for example "style":{"preset":"panel","gap":"lg"}.
Resolution order is Theme default, then same-Brick Preset, then direct style. Work Preset first. Use direct style for Pattern-specific layout or an intentional visual adjustment; direct style may override one disclosed Preset property. Only box and text initially support "activeWhen" with their alternate appearance inside "style.active". Renderer interaction states such as hover, pressed, focus, checked, sorted, and alternate are authorable only at the exact Brick target and property paths disclosed by that Brick specification.

Vocabulary is exact:
- fontSize, gap, background, and color are examples of style property names;
- label, control, track, and fill are examples of Brick-owned style targets;
- md, lg, and success are examples of token names; discovery metadata presents property-local allowed choices as names with description and useWhen meanings;
- row, column, auto, full, true, and false are examples of closed fixed choices owned by renderer behavior;
- concrete values such as pixels, rem values, color codes, gradients, and font stacks are Theme-only.
Never author raw CSS or invent a property, target, state, token name, or fixed choice. The Theme owns all concrete CSS values. The host supplies one validated Theme containing complete token definitions, light and dark paint values, Brick defaults, and optional Presets. The agent does not select or mutate the Theme. colorMode is host/client view state (system preference resolved to light or dark), never Facet Document syntax.

Brick behavior stays closed. box is the sole container and may carry onPress/onHold actions, hidden state, a bounded media backdrop, or a renderer-owned modal/drawer overlay. text is one plain text value; richtext is closed blocks, runs, and semantic marks; media is a gated image or video; input is a named renderer-owned control; table, chart, list, keyValue, progress, and loading are bounded display Bricks. Exact fields come from the Brick specification rather than this compact guide.

Actions are agent, navigate, or toggle. navigate and toggle run locally with no agent turn. Agent actions may collect visible named inputs from a containing box. A document may keep reusable rows in its named "data" warehouse; disclosed data Bricks bind by dataset name through "from". These names are never URLs, queries, expressions, or resolvers. There is no client-side fetch or authored browser business logic; backend work stays with the agent.

Normal authoring is strict and atomic. An invalid document change is rejected whole with bounded structured repair issues and no patch; callers repair the complete input and retry. Fail-safe rendering is a separate last defense: if stale or bypassed data reaches validation or rendering, invalid style fragments are ignored while valid Bricks and siblings continue. Unknown or dangling nodes are skipped, never thrown.`;
