/**
 * The closed brick vocabulary an agent uses to build a stage. `box`, `text`,
 * `media`, `input`, and `richtext` remain the universal base and fallback; the
 * data and feedback bricks provide safe, renderer-owned UI shapes without
 * allowing raw HTML/JS/CSS.
 *
 * The vocabulary grows only by adding typed brick shapes here and matching
 * validation/rendering support on purpose.
 */
import type { TableColumn, TableRow } from "./data-types.js";
import type { InputKind } from "./brick-contract.js";
import type { ViewPredicate } from "./view.js";
import type {
  BoxStyle,
  ChartStyle,
  InputStyle,
  KeyValueStyle,
  ListStyle,
  LoadingStyle,
  MediaStyle,
  ProgressStyle,
  RichTextStyle,
  TableStyle,
  TextStyle,
} from "./style-types.js";

export * from "./data-types.js";
export {
  BRICK_CONTRACT,
  BRICK_TYPES,
  INPUT_KINDS,
  type BrickContractEntry,
  type BrickFieldContract,
  type BrickStylePropertyContract,
  type BrickStyleTargetContract,
  type BrickType,
  type InputKind,
  type StyleValueSource,
} from "./brick-contract.js";
export type {
  BoxStyle,
  BrickActiveStyle,
  BrickStyle,
  BrickStyleByType,
  BrickStyleDefinition,
  BrickStyleDefinitionMap,
  ChartStyle,
  InputStyle,
  KeyValueStyle,
  ListStyle,
  LoadingStyle,
  MediaStyle,
  ProgressStyle,
  RichTextStyle,
  TableStyle,
  TextStyle,
} from "./style-types.js";

/** Identifier for a node within a stage tree. */
export type NodeId = string;

/**
 * An action routed to the agent (a ClientEvent over the transport). `kind` is
 * OPTIONAL by design: a bare legacy `{name}` IS an agent action, so every
 * pre-union `onPress` literal keeps compiling and behaving. `validateTree`
 * stamps the canonical `kind: "agent"` when normalizing.
 */
export interface AgentAction {
  readonly kind?: "agent";
  /** Stable action name the agent listens for, e.g. "view_pricing". */
  readonly name: string;
  /** Optional structured payload carried back to the agent. */
  readonly payload?: Readonly<Record<string, string | number | boolean>>;
  /**
   * Node-id reference; at press time the browser snapshots visible field values
   * in that box's subtree into the event's fields.
   */
  readonly collect?: NodeId;
}

/**
 * Switches the visible screen instantly in the browser — no agent turn, no
 * transport traffic. `name?: undefined` keeps legacy `.name` probes on the
 * union compiling while truthfully reporting there is no agent action name.
 */
export interface NavigateAction {
  readonly kind: "navigate";
  /** Screen name to show (a key of `FacetTree.screens`). Unknown names no-op. */
  readonly to: string;
  readonly name?: undefined;
}

/**
 * Shows/hides the target node instantly in the browser (view-state only).
 * `name?: undefined` for the same source-compat reason as NavigateAction.
 */
export interface ToggleAction {
  readonly kind: "toggle";
  /** Node id whose visibility flips. Unknown ids no-op. */
  readonly target: NodeId;
  readonly name?: undefined;
}

/**
 * Fired when an interactive brick is used (a pressed box, a submitted field).
 * Narrow on `kind`: `"navigate"`/`"toggle"` are exact literals, and the
 * else-branch (absent or `"agent"`) is the agent-routed action.
 */
export type FacetAction = AgentAction | NavigateAction | ToggleAction;

/**
 * Module-private field packs (mixins). These are shared shape fragments folded
 * into the base brick interfaces below via `interface … extends …`. They are
 * DELIBERATELY NOT exported: the `export * from "./nodes.js"` barrel would
 * otherwise surface them and collide conceptually with the exported
 * `ContainerNode`/`isContainer` surface. The literal `type` discriminant is
 * NEVER placed in a pack — each brick keeps `type` as a direct own member so
 * `Extract<FacetNode,{type:K}>` and type-guard narrowing keep resolving.
 */

/** Common identity field (`type` stays a direct member for union narrowing). */
interface BaseNode {
  readonly id: NodeId;
}

/** The style slot only — generic per-brick token type. */
interface Styleable<S> {
  readonly style?: S;
}

/**
 * The local-view condition supported initially by box and text only. Appearance
 * remains inside `style.active`; the predicate itself is node behavior.
 */
interface ActiveWhen {
  /** Closed view-state predicate selecting when `style.active` applies. */
  readonly activeWhen?: ViewPredicate;
}

/** The children slot. Named `ContainerFields` to avoid shadowing `ContainerNode`. */
interface ContainerFields {
  readonly children: readonly NodeId[];
}

/**
 * The `from`-binding trio: read a value from a single cell of
 * `FacetTree.data[from]` (enabler A). Mirrors `MetricFields`; `from` wins over an
 * inline value, a dangling reference or absent column yields empty — never throws.
 */
interface DataBound {
  readonly from?: string;
  /** The dataset column supplying the cell value (used only with `from`). */
  readonly column?: string;
  /** The dataset row index (default 0) supplying the cell value (used only with `from`). */
  readonly row?: number;
}

/**
 * The press-gesture pair. A box that carries these owns button behavior —
 * pointer/keyboard press and secondary long-press, both the same action union.
 */
interface Pressable {
  /** Makes the box pressable. Any box can be a button — or a clickable card. */
  readonly onPress?: FacetAction;
  /**
   * Secondary long-press gesture — the same action union as `onPress`. Advice:
   * hold is a secondary path; never make it the only way to critical content.
   */
  readonly onHold?: FacetAction;
}

/**
 * The closed, EXTENSIBLE set of overlay placements. Unknown kinds are dropped by
 * `validateBox`'s `sanitizeOverlay` (the box renders inline, fail-safe), so a
 * future placement (e.g. `popover`, which would also carry an optional `anchor`)
 * adds as a new tuple entry / union arm with no breaking reshape — mirrors
 * `INPUT_KINDS`/`MARK_KINDS`.
 */
export const OVERLAY_KINDS = ["modal", "drawer"] as const;
export type OverlayKind = (typeof OVERLAY_KINDS)[number];

/**
 * The overlay descriptor — a renderer-owned floating placement selected by a
 * closed `kind` name (single-sourced from `OverlayKind`, like `MediaKind`). The
 * concrete placement / z-band lives in the renderer's layout contract, never as
 * author coordinates. Today every kind carries only `kind`; when a kind needs its
 * own member (e.g. a future `popover` arm with an optional `anchor`) this becomes
 * a per-arm tagged union additively, with no breaking reshape.
 */
export type Overlay = { readonly kind: OverlayKind };

/** The bounded background-layer slot (distinct from visibility). */
interface Layered {
  /**
   * Node-id reference to a standalone MEDIA node used as this box's background.
   * At render time the renderer resolves it READ-ONLY to a media node and paints
   * it as a bounded background layer (renderer-synthesized, `position:absolute`
   * confined to that layer); it never absolute-positions a flow child. A
   * dangling/non-media/unsafe reference paints no layer (fail-safe).
   */
  readonly backdrop?: NodeId;
  /**
   * Floats this box in a renderer-owned, FIXED placement (a renderer-owned
   * positive-z band) selected purely by `kind` — the one sanctioned overlap in an
   * otherwise flow-only model. The author supplies ONLY the closed `kind`; the
   * renderer owns placement/z/scrim (no author coordinates). Open/close reuses the
   * box's own visibility toggle. An unknown/malformed descriptor is dropped and
   * the box renders inline (fail-safe).
   */
  readonly overlay?: Overlay;
}

/**
 * The universal container and the only brick that holds children. Flow layout
 * only (row/col), so children stack or wrap — they cannot overlap or fall off
 * the page. A box with `onPress` is pressable; a box with a border is
 * a card; nested boxes are any layout.
 */
export interface BoxNode
  extends BaseNode, Styleable<BoxStyle>, ActiveWhen, ContainerFields, Pressable, Layered {
  readonly type: "box";
  /**
   * Content-declared default visibility (server-written). The browser's toggle
   * override wins after first interaction; only literal `true` hides.
   */
  readonly hidden?: boolean;
}

export interface TextNode extends BaseNode, Styleable<TextStyle>, ActiveWhen, DataBound {
  readonly type: "text";
  readonly value: string;
}

export const MEDIA_KINDS = ["image", "video"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export interface MediaNode extends BaseNode, Styleable<MediaStyle> {
  readonly type: "media";
  readonly kind: MediaKind;
  readonly src: string;
  readonly alt?: string;
  readonly poster?: string;
  readonly controls?: boolean;
}

/** The input Brick. */
export interface InputNode extends BaseNode, Styleable<InputStyle> {
  readonly type: "input";
  readonly name: string;
  readonly input?: InputKind;
  readonly options?: readonly string[];
  readonly label?: string;
  readonly placeholder?: string;
}

/** The closed block types richtext supports. Unknown types degrade to `paragraph`. */
export const BLOCK_TYPES = ["paragraph", "heading", "listItem", "quote"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

/**
 * The closed, EXTENSIBLE set of per-run emphasis marks. Unknown kinds are dropped
 * by `validateRichText` (the run text is kept), so future valued marks
 * (highlight/color) and new block types add as new union members / entries with
 * no breaking reshape.
 */
export const MARK_KINDS = ["bold", "italic", "underline", "strike", "code", "link"] as const;
export type MarkKind = (typeof MARK_KINDS)[number];

/** An external-URL link destination, gated by `isSafeHref` (navigated, not fetched). */
export interface ExternalLink {
  readonly href: string;
}

/**
 * A `link` mark's destination: either an INTERNAL `FacetAction` (routed through
 * the shared `normalizeFacetAction`, dispatched via the single press writer) or a
 * gated EXTERNAL URL. Validation branches on shape: a `{ href }` object is the
 * external URL; anything else is normalized as a `FacetAction`.
 */
export type LinkTarget = FacetAction | ExternalLink;

/**
 * A per-run mark — a closed tagged union. Members may carry attributes (`link`
 * carries `target`); an unknown `kind` degrades (dropped, run text kept).
 */
export type Mark =
  | { readonly kind: "bold" }
  | { readonly kind: "italic" }
  | { readonly kind: "underline" }
  | { readonly kind: "strike" }
  | { readonly kind: "code" }
  | { readonly kind: "link"; readonly target: LinkTarget };

/** A contiguous span of text sharing zero or more marks. */
export interface Run {
  readonly text: string;
  readonly marks?: readonly Mark[];
}

/**
 * A flat block of runs. `level` is the heading rank (clamped 1–3); `depth` is the
 * `listItem` nesting depth (clamped 0–5, expressed as renderer-owned flow indent).
 */
export interface RichTextBlock {
  readonly type: BlockType;
  readonly level?: number;
  readonly depth?: number;
  readonly runs: readonly Run[];
}

/**
 * A flowing block of mixed-format prose with inline links. A LEAF brick: it holds
 * its own `blocks`/`runs` (no child ids, no `from` binding) and its block-level
 * typography is the same `TextStyle` token family as `text`.
 */
export interface RichTextNode extends BaseNode, Styleable<RichTextStyle> {
  readonly type: "richtext";
  readonly blocks: readonly RichTextBlock[];
}

export interface TableNode extends BaseNode, Styleable<TableStyle> {
  readonly type: "table";
  readonly columns: readonly TableColumn[];
  readonly rows: readonly TableRow[];
  readonly caption?: string;
  /** Optional binding: project rows from `FacetTree.data[from]` instead of inline `rows`. */
  readonly from?: string;
}

export const CHART_KINDS = ["bar", "line", "donut"] as const;
export type ChartKind = (typeof CHART_KINDS)[number];

export interface ChartSeries {
  readonly label: string;
  readonly values: readonly number[];
}

export interface ChartNode extends BaseNode, Styleable<ChartStyle> {
  readonly type: "chart";
  readonly kind: ChartKind;
  readonly series: readonly ChartSeries[];
  readonly labels?: readonly string[];
  readonly title?: string;
  /** Optional binding: derive one series per numeric column of `FacetTree.data[from]`. */
  readonly from?: string;
}

export interface ListItem {
  readonly title: string;
  readonly body?: string;
}

export interface ListNode extends BaseNode, Styleable<ListStyle> {
  readonly type: "list";
  readonly items: readonly ListItem[];
  /** Optional binding: project one item per row from `FacetTree.data[from]`. */
  readonly from?: string;
}

export interface KeyValueItem {
  readonly key?: string;
  readonly label: string;
  readonly value: string;
}

export interface KeyValueNode extends BaseNode, Styleable<KeyValueStyle> {
  readonly type: "keyValue";
  readonly items: readonly KeyValueItem[];
  /** Optional binding: project `{label, value}` per row from `FacetTree.data[from]`. */
  readonly from?: string;
}

export interface ProgressNode extends BaseNode, Styleable<ProgressStyle> {
  readonly type: "progress";
  readonly value: number;
  readonly label?: string;
}

export interface LoadingNode extends BaseNode, Styleable<LoadingStyle> {
  readonly type: "loading";
  readonly label?: string;
}

/** Any brick the agent may place on a stage. */
export type FacetNode =
  | BoxNode
  | TextNode
  | MediaNode
  | InputNode
  | RichTextNode
  | TableNode
  | ChartNode
  | ListNode
  | KeyValueNode
  | ProgressNode
  | LoadingNode;

/** The only brick that can hold child node ids. */
export type ContainerNode = BoxNode;

/** Narrows a node to the box-only child-container capability. */
export function isContainer(node: FacetNode): node is ContainerNode {
  return node.type === "box";
}
