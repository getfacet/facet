/**
 * The canonical description of the Facet stage vocabulary — primitive bricks,
 * components, catalog policy, and style tokens — for prompting an LLM. This is
 * the SINGLE source: every agent-driving path (the CLI generator, the bridge
 * spawn prompt, the persistent tools) embeds it and wraps it with its own action
 * instructions, so the vocabulary never drifts from `nodes.ts` / `tokens.ts`.
 */
export const STAGE_SPEC = `A Facet stage tree is { "root": "root", "nodes": { "<id>": <node> }, "screens"?: { "<name>": <root node id> }, "entry"?: "<name>", "theme"?: "<theme name>" } — a flat map where every referenced child id exists in nodes. "root" and each screen target must be a screen root container: box, section, or card. "screens" are named roots into the same flat nodes map (screens may share nodes); "entry" is the screen shown first. No screens ⇒ "root" renders. Set top-level "theme" only to a theme name you have been given (a THEMES list, if any) — you never write CSS values, styles stay tokens; an unknown or missing name falls back to the default look.

Agent-facing model: Primitive Brick -> Component -> Catalog. Primitive bricks are the universal base and fallback: box, text, media, field. Components are locked Facet/platform-managed node shapes for common UI; the catalog tells you which components, variants, themes, and compositions are available for this session. Intrinsic components are locked: button, section, card, tabs, nav, table, chart, metric, keyValue, badge, progress, alert, list, divider, form, search, filterBar, emptyState, loading. "stat" remains legacy compatibility; prefer metric for new KPI and summary values.

Node types (the ONLY allowed types):
- box:   { "id", "type":"box", "children":[ids], "variant"?:name, "style"?:BoxStyle, "hidden"?:bool, "onPress"?:Action, "onHold"?:Action } — primitive container and fallback layout. Flow-only layout (no absolute positioning). "onHold" is a secondary long-press gesture (same Action union as onPress) — never make hold the only path to critical content.
  Action: {"kind":"agent","name":string,"collect"?:<containerId>} | {"kind":"navigate","to":<screen>} | {"kind":"toggle","target":<nodeId>}. navigate/toggle run instantly in the visitor's browser with no agent turn — pre-draw your screens and hidden panels so they work while you are idle; use "kind":"agent" (or bare {"name"}) for anything open-ended. "collect": pressing an agent action snapshots the values of visible fields on the current screen within that container subtree into the event's "fields", keyed by each field's "name" — text/select/radio values are strings, checked checkbox/switch values are boolean true, unchecked checkbox/switch controls are omitted. Give fields stable names, and keep a form and its submit button together and visible on one screen (hidden fields, fields on other screens, and password fields are never captured).
- text:  { "id", "type":"text", "value":string, "variant"?:name, "style"?:TextStyle }
- media: { "id", "type":"media", "kind":("image"|"video"), "src":url, "variant"?:name, "alt"?:string, "poster"?:url, "controls"?:bool, "style"?:MediaStyle } — use kind:"image" with https://picsum.photos/seed/<word>/600/400 for sample images; kind:"video" may use poster/controls.
- field: { "id", "type":"field", "name":string, "variant"?:name, "label"?, "placeholder"?, "input"?:("text"|"number"|"email"|"password"|"search"|"checkbox"|"radio"|"select"|"switch"), "options"?:[strings], "style"?:{"width"?} } — select/radio use options; checkbox/switch are boolean controls.
- button: { "id", "type":"button", "label":string, "variant"?:name, "tone"?:tone, "disabled"?:bool, "onPress"?:Action, "onHold"?:Action } — use for direct actions instead of hand-rolled pressable boxes.
- section: { "id", "type":"section", "title"?, "eyebrow"?, "body"?, "variant"?:name, "children":[ids] } — page/content region.
- card: { "id", "type":"card", "title"?, "body"?, "variant"?:name, "tone"?:tone, "onPress"?:Action, "onHold"?:Action, "children":[ids] } — grouped content/action panel.
- tabs: { "id", "type":"tabs", "items":[{"label":string,"to":screen}], "variant"?:name } — navigation wrapper over existing local navigate semantics; it does not mutate stage content.
- nav: { "id", "type":"nav", "items":[{"label":string,"to":screen}], "variant"?:name } — app or section navigation over existing local navigate semantics.
- table: { "id", "type":"table", "columns":[{"key":name,"label":string,"align"?:"start"|"center"|"end"}], "rows":[objects], "caption"?, "variant"?:name } — display-only capped tabular data.
- chart: { "id", "type":"chart", "kind":("bar"|"line"|"donut"), "series":[{"label":string,"values":[numbers]}], "labels"?:[strings], "title"?, "variant"?:name } — display-only capped chart data.
- metric: { "id", "type":"metric", "label":string, "value":string, "delta"?, "tone"?:tone, "variant"?:name }
- keyValue: { "id", "type":"keyValue", "items":[{"label":string,"value":string,"tone"?:tone}], "variant"?:name }
- badge: { "id", "type":"badge", "label":string, "tone"?:tone, "variant"?:name }
- progress: { "id", "type":"progress", "value":0..100, "label"?, "tone"?:tone, "variant"?:name }
- alert: { "id", "type":"alert", "title"?, "body":string, "tone"?:tone, "variant"?:name }
- list: { "id", "type":"list", "items":[string|{"title":string,"body"?}], "variant"?:name }
- divider: { "id", "type":"divider", "label"?, "variant"?:name }
- form: { "id", "type":"form", "title"?, "body"?, "submitLabel"?, "variant"?:name, "onSubmit"?:Action, "children":[ids] } — grouped visitor input; submit uses the same agent action and field collection semantics.
- search: { "id", "type":"search", "name":string, "label"?, "placeholder"?, "value"?, "submitLabel"?, "variant"?:name, "onSubmit"?:Action } — search input and submission UI only.
- filterBar: { "id", "type":"filterBar", "filters":[{"name":string,"label":string,"input"?, "options"?, "value"?}], "variant"?:name, "onChange"?:Action } — compact filtering controls UI only.
- emptyState: { "id", "type":"emptyState", "title"?, "body"?, "actionLabel"?, "variant"?:name, "onPress"?:Action }
- loading: { "id", "type":"loading", "label"?, "variant"?:name }
- stat: { "id", "type":"stat", "label":string, "value":string, "delta"?, "tone"?:tone, "variant"?:name } — legacy metric compatibility; prefer metric.

Containers are box, section, card, and form. Tables, charts, search, and filterBar are display/control-only: no client-side fetch, sort engine, query expression, data-binding, endpoint, resolver, or browser business logic. Backend work stays with the agent through actions/tools and patching new data into the stage.

Composition boundary: compositions are reusable component definitions loaded as assets and expanded into ordinary validated nodes before patches reach the visitor. They are not renderer plugins, raw HTML, JS, CSS, data fetchers, or live bindings. use_stamp remains a compatibility tool name for existing reusable composition/stamp assets; prefer component and composition concepts in new agent-facing language.

Renderer layout contract: the parent controls placement and each component owns its internal layout within that placement. Layout is flow-only, boxes and component roots are bounded to their parent, bounded overflow is the default for long content, long content wraps or clips within renderer-owned bounds, and horizontal overflow is allowed only inside an explicit renderer-owned scroll region.

Style values MUST be tokens (never pixels or hex):
- BoxStyle: direction(row|col), gap/pad(none|xs|sm|md|lg|xl|2xl), align(start|center|end|stretch), justify(start|center|end|between|around), wrap(bool), bg(color), radius(none|sm|md|lg|full), border(bool), grow(bool), width(auto|full), appear(none|fade|slide), scroll(x|y), columns(2|3|4), shadow(none|sm|md|lg) — appear animates the node's entry and replays on each re-show (toggle, navigation, re-add); the renderer owns the timing and honors reduced motion. scroll:"y" makes the box a bounded, internally-scrolling region for long lists (the renderer owns the max height); scroll:"x" makes a bounded horizontal region; columns creates a flow-safe grid and ignores direction/wrap.
- TextStyle: family(sans|serif|mono), size(xs|sm|md|lg|xl|2xl|3xl), weight(regular|medium|semibold|bold), color(color), align(start|center|end)
- MediaStyle: radius(none|sm|md|lg|full), width(auto|full), ratio(square|wide|tall)
- color tokens: fg, fg-muted, bg, surface, surface-2, accent, accent-fg, border, neutral, info, success, warning, danger, chart-1, chart-2, chart-3, chart-4, chart-5, chart-6

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
