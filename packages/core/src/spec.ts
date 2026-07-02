/**
 * The canonical description of the Facet stage vocabulary — the bricks and style
 * tokens — for prompting an LLM. This is the SINGLE source: every agent-driving
 * path (the CLI generator, the bridge spawn prompt, the persistent tools) embeds
 * it and wraps it with its own action instructions, so the vocabulary never
 * drifts from `nodes.ts` / `tokens.ts`.
 */
export const STAGE_SPEC = `A Facet stage tree is { "root": "root", "nodes": { "<id>": <node> }, "screens"?: { "<name>": <root node id> }, "entry"?: "<name>" } — a flat map where exactly one node has id "root" and type "box", and every referenced child id exists in nodes. "screens" are named roots into the same flat nodes map (screens may share nodes); "entry" is the screen shown first. No screens ⇒ "root" renders.

Node types (the ONLY allowed types):
- box:   { "id", "type":"box", "children":[ids], "style"?:BoxStyle, "hidden"?:bool, "onPress"?:Action } — the only container. A bordered box is a card; a box with onPress is a button; a box with "hidden":true is an initially-collapsed panel (until toggled). Nested boxes make any layout. Flow layout only (no absolute positioning).
  Action: {"kind":"agent","name":string} | {"kind":"navigate","to":<screen>} | {"kind":"toggle","target":<nodeId>}. navigate/toggle run instantly in the visitor's browser with no agent turn — pre-draw your screens and hidden panels so they work while you are idle; use "kind":"agent" (or bare {"name"}) for anything open-ended.
- text:  { "id", "type":"text", "value":string, "style"?:TextStyle }
- image: { "id", "type":"image", "src":url, "alt":string, "style"?:ImageStyle } — use https://picsum.photos/seed/<word>/600/400
- field: { "id", "type":"field", "name":string, "label"?, "placeholder"?, "input"?:("text"|"number"|"email"|"password"|"search"), "style"?:{"width"?} }

Style values MUST be tokens (never pixels or hex):
- BoxStyle: direction(row|col), gap/pad(none|xs|sm|md|lg|xl|2xl), align(start|center|end|stretch), justify(start|center|end|between|around), wrap(bool), bg(color), radius(none|sm|md|lg|full), border(bool), grow(bool), width(auto|full)
- TextStyle: size(xs|sm|md|lg|xl|2xl|3xl), weight(regular|medium|semibold|bold), color(color), align(start|center|end)
- ImageStyle: radius(none|sm|md|lg|full), width(auto|full), ratio(square|wide|tall)
- color tokens: fg, fg-muted, bg, surface, surface-2, accent, accent-fg, border, success, warning, danger

Example (2 screens + a hidden menu panel):
{ "root":"root", "screens":{"home":"root","about":"about"}, "entry":"home", "nodes":{
  "root":{"id":"root","type":"box","children":["menu-btn","menu","home-text"]},
  "menu-btn":{"id":"menu-btn","type":"box","children":["menu-label"],"onPress":{"kind":"toggle","target":"menu"}},
  "menu-label":{"id":"menu-label","type":"text","value":"☰ Menu"},
  "menu":{"id":"menu","type":"box","hidden":true,"children":["to-about"]},
  "to-about":{"id":"to-about","type":"box","children":["about-label"],"onPress":{"kind":"navigate","to":"about"}},
  "about-label":{"id":"about-label","type":"text","value":"About"},
  "home-text":{"id":"home-text","type":"text","value":"Welcome"},
  "about":{"id":"about","type":"box","children":["about-text"]},
  "about-text":{"id":"about-text","type":"text","value":"About us"} } }`;
