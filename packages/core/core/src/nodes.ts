/**
 * The closed vocabulary an agent uses to build a stage. Primitive bricks
 * (`box`, `text`, `media`, `field`) remain the universal fallback; intrinsic
 * components provide safer common UI shapes without allowing raw HTML/JS/CSS.
 *
 * Primitive bricks stay the base and escape hatch; intrinsic components are
 * typed shortcuts for common, renderer-owned UI shapes. The agent can fall back
 * to primitives whenever a component is too specific, while every node remains a
 * typed, token-styled data value (never raw HTML/JS), so nothing can be injected
 * and nothing can render broken.
 *
 * The vocabulary grows only by adding typed node shapes here and matching
 * validation/rendering support on purpose.
 */
import type {
  Align,
  Appear,
  Columns,
  Color,
  Direction,
  FontFamily,
  FontSize,
  FontWeight,
  Gradient,
  ColorScheme,
  Highlight,
  Justify,
  Leading,
  MaxWidth,
  MinHeight,
  Radius,
  Ratio,
  Scrim,
  ScrollAxis,
  Shadow,
  Sizing,
  Space,
  TextAlign,
  Tracking,
} from "./tokens.js";
import type { ViewPredicate } from "./view.js";

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

export interface BoxStyle {
  readonly direction?: Direction;
  readonly gap?: Space;
  readonly pad?: Space;
  readonly align?: Align;
  readonly justify?: Justify;
  readonly wrap?: boolean;
  readonly bg?: Color;
  readonly radius?: Radius;
  readonly border?: boolean;
  readonly grow?: boolean;
  readonly width?: Sizing;
  /**
   * Enter animation, replayed on each mount/re-show of the node (first paint,
   * node re-add, toggle re-show, screen navigation). The renderer owns the
   * duration/curve as framework constants — this token names the motion only.
   */
  readonly appear?: Appear;
  /**
   * Bounded, internally-scrollable region. Legacy `true` normalizes to vertical
   * (`"y"`). Horizontal scroll remains bounded by the renderer.
   */
  readonly scroll?: ScrollAxis | true;
  /**
   * Flow-safe grid columns. When present, the renderer uses grid layout and
   * ignores direction/wrap because the grid owns the axis.
   */
  readonly columns?: Columns;
  readonly shadow?: Shadow;
  /** Bounded minimum height for landing-grade sections (theme-mapped length). */
  readonly minHeight?: MinHeight;
  /** Bounded max content width for readable columns (theme-mapped length). */
  readonly maxWidth?: MaxWidth;
  /**
   * Keeps the box stuck within its scroll container. The renderer owns the top
   * offset as a framework constant — flow-compatible, no author offset/z-index.
   */
  readonly sticky?: boolean;
  /** Named background gradient (theme maps the name to a concrete CSS gradient). */
  readonly gradient?: Gradient;
  /** Scrim overlay strength painted over this box's backdrop layer. */
  readonly backdropScrim?: Scrim;
  /**
   * Authored color scheme for this box's subtree (a dark/light section) — the
   * renderer swaps the color-token map read-only for the subtree (never leaks
   * upward). Unknown value → unchanged. `ColorScheme` is deliberately distinct
   * from view-state's report-only device `Scheme`.
   */
  readonly scheme?: ColorScheme;
}

export interface TextStyle {
  readonly family?: FontFamily;
  readonly size?: FontSize;
  readonly weight?: FontWeight;
  readonly color?: Color;
  readonly align?: TextAlign;
  /** Letter-spacing token (theme-mapped). */
  readonly tracking?: Tracking;
  /** Line-height token (theme-mapped). */
  readonly leading?: Leading;
  /** Highlight treatment behind the text run (theme-mapped decoration). */
  readonly highlight?: Highlight;
}

export interface MediaStyle {
  readonly radius?: Radius;
  readonly width?: Sizing;
  readonly ratio?: Ratio;
}

export interface FieldStyle {
  readonly width?: Sizing;
}

/**
 * Module-private field packs (mixins). These are shared shape fragments folded
 * into the primitive interfaces below via `interface … extends …` (mirroring the
 * `MetricFields` precedent in `component-nodes.ts`). They are DELIBERATELY NOT
 * exported: the `export * from "./nodes.js"` barrel would otherwise surface them
 * and collide conceptually with the exported `ContainerNode`/`isContainer`
 * surface. The literal `type` discriminant is NEVER placed in a pack — each
 * primitive keeps `type` as a direct own member so `Extract<FacetNode,{type:K}>`
 * and type-guard narrowing keep resolving.
 */

/** Common identity fields on all four primitives (`type` stays a direct member). */
interface BaseNode {
  readonly id: NodeId;
  readonly variant?: string;
}

/** The style slot only — generic per-brick token type. */
interface Styleable<S> {
  readonly style?: S;
}

/**
 * The active-look trio (folds the PR-1 duplication). Kept separate from
 * `Styleable` so media/field (which have `style` but no active-look) do not gain
 * these fields.
 */
interface ActiveLook<S> {
  /**
   * Recipe name applied ONLY while `active` evaluates true (enabler B). The
   * renderer folds it over `variant` read-only via `resolveRecipe`; token-only
   * by construction. Prefer this over `activeStyle`.
   */
  readonly activeVariant?: string;
  /**
   * Extra style tokens applied ONLY while `active` evaluates true (enabler B).
   * Routed through the SAME token sanitizer as `style`, so it can carry only
   * tokens — never a raw-CSS bypass.
   */
  readonly activeStyle?: S;
  /**
   * Closed view-state predicate selecting when the active look applies (enabler
   * B). Read-only, evaluated against the threaded snapshot view-state; an
   * unknown/dangling predicate degrades to the default look.
   */
  readonly active?: ViewPredicate;
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
 * The press-gesture pair. A box that carries these IS the button primitive —
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
 * `FIELD_INPUTS`/`MARK_KINDS`.
 */
export const OVERLAY_KINDS = ["modal", "drawer"] as const;
export type OverlayKind = (typeof OVERLAY_KINDS)[number];

/**
 * The overlay descriptor — a closed, EXTENSIBLE tagged union selecting a
 * renderer-owned floating placement. Members carry ONLY a closed `kind` name; the
 * concrete placement / z-band lives in the renderer's layout contract, never as
 * author coordinates. Future members add as new arms (e.g. a `popover` arm with
 * an optional `anchor`) with no breaking reshape.
 */
export type Overlay = { readonly kind: "modal" } | { readonly kind: "drawer" };

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
 * the page. A box with `onPress` IS the button primitive; a box with a border is
 * a card; nested boxes are any layout.
 */
export interface BoxNode
  extends BaseNode, Styleable<BoxStyle>, ActiveLook<BoxStyle>, ContainerFields, Pressable, Layered {
  readonly type: "box";
  /**
   * Content-declared default visibility (server-written). The browser's toggle
   * override wins after first interaction; only literal `true` hides.
   */
  readonly hidden?: boolean;
}

export interface TextNode extends BaseNode, Styleable<TextStyle>, ActiveLook<TextStyle>, DataBound {
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

/** Allowed field input types — single source (validator derives its check from this). */
export const FIELD_INPUTS = [
  "text",
  "number",
  "email",
  "password",
  "search",
  "checkbox",
  "radio",
  "select",
  "switch",
] as const;
export type FieldInput = (typeof FIELD_INPUTS)[number];

/** The input primitive. */
export interface FieldNode extends BaseNode, Styleable<FieldStyle> {
  readonly type: "field";
  readonly name: string;
  readonly input?: FieldInput;
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
export interface RichTextNode extends BaseNode, Styleable<TextStyle> {
  readonly type: "richtext";
  readonly blocks: readonly RichTextBlock[];
}

export const PRIMITIVE_BRICK_TYPES = ["box", "text", "media", "field", "richtext"] as const;
export type PrimitiveBrickType = (typeof PRIMITIVE_BRICK_TYPES)[number];
export type PrimitiveBrickNode = BoxNode | TextNode | MediaNode | FieldNode | RichTextNode;

export * from "./component-nodes.js";
import type { CardNode, ComponentNode, FormNode, SectionNode } from "./component-nodes.js";

/** Any brick the agent may place on a stage. */
export type FacetNode = PrimitiveBrickNode | ComponentNode;

export type ContainerNode = BoxNode | SectionNode | CardNode | FormNode;

/** Narrows a node to the bricks that can hold children. */
export function isContainer(node: FacetNode): node is ContainerNode {
  return (
    node.type === "box" || node.type === "section" || node.type === "card" || node.type === "form"
  );
}
