/**
 * The canonical description of the Facet stage vocabulary — the bricks and style
 * tokens — for prompting an LLM. This is the SINGLE source: every agent-driving
 * path (the CLI generator, the bridge spawn prompt, the persistent tools) embeds
 * it and wraps it with its own action instructions, so the vocabulary never
 * drifts from `nodes.ts` / `tokens.ts`.
 */
export const STAGE_SPEC = `A Facet stage tree is { "root": "root", "nodes": { "<id>": <node> } } — a flat map where exactly one node has id "root" and type "box", and every referenced child id exists in nodes.

Node types (the ONLY allowed types):
- box:   { "id", "type":"box", "children":[ids], "style"?:BoxStyle, "onPress"?:{"name":string} } — the only container. A bordered box is a card; a box with onPress is a button; nested boxes make any layout. Flow layout only (no absolute positioning).
- text:  { "id", "type":"text", "value":string, "style"?:TextStyle }
- image: { "id", "type":"image", "src":url, "alt":string, "style"?:ImageStyle } — use https://picsum.photos/seed/<word>/600/400
- field: { "id", "type":"field", "name":string, "label"?, "placeholder"?, "input"?:("text"|"number"|"email"|"password"|"search"), "style"?:{"width"?} }

Style values MUST be tokens (never pixels or hex):
- BoxStyle: direction(row|col), gap/pad(none|xs|sm|md|lg|xl|2xl), align(start|center|end|stretch), justify(start|center|end|between|around), wrap(bool), bg(color), radius(none|sm|md|lg|full), border(bool), grow(bool), width(auto|full)
- TextStyle: size(xs|sm|md|lg|xl|2xl|3xl), weight(regular|medium|semibold|bold), color(color), align(start|center|end)
- ImageStyle: radius(none|sm|md|lg|full), width(auto|full), ratio(square|wide|tall)
- color tokens: fg, fg-muted, bg, surface, surface-2, accent, accent-fg, border, success, warning, danger`;
