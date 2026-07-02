/**
 * The low-level brick palette — the entire vocabulary an agent uses to build a
 * stage. There are only four bricks: `box`, `text`, `image`, `field`.
 *
 * These are Lego bricks, not finished furniture. A "card" is a `box` with a
 * border; a "button" is a `box` with `onPress`; a "heading" is a big `text`. The
 * agent composes everything from these four, so the set of producible pages is
 * unbounded — while every brick stays a typed, token-styled data value (never
 * raw HTML/JS), so nothing can be injected and nothing can render broken.
 *
 * Higher-level shapes (card(), hero(), grid()) live in an optional preset
 * package, not here — they are just functions that emit box compositions.
 */
import type {
  Align,
  Color,
  Direction,
  FontSize,
  FontWeight,
  Justify,
  Radius,
  Ratio,
  Sizing,
  Space,
  TextAlign,
} from "./tokens.js";

/** Identifier for a node within a stage tree. */
export type NodeId = string;

/** Fired when an interactive brick is used (a pressed box, a submitted field). */
export interface FacetAction {
  /** Stable action name the agent listens for, e.g. "view_pricing". */
  readonly name: string;
  /** Optional structured payload carried back to the agent. */
  readonly payload?: Readonly<Record<string, string | number | boolean>>;
}

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
}

export interface TextStyle {
  readonly size?: FontSize;
  readonly weight?: FontWeight;
  readonly color?: Color;
  readonly align?: TextAlign;
}

export interface ImageStyle {
  readonly radius?: Radius;
  readonly width?: Sizing;
  readonly ratio?: Ratio;
}

export interface FieldStyle {
  readonly width?: Sizing;
}

/**
 * The universal container and the only brick that holds children. Flow layout
 * only (row/col), so children stack or wrap — they cannot overlap or fall off
 * the page. A box with `onPress` IS the button primitive; a box with a border is
 * a card; nested boxes are any layout.
 */
export interface BoxNode {
  readonly id: NodeId;
  readonly type: "box";
  readonly style?: BoxStyle;
  /** Makes the box pressable. Any box can be a button — or a clickable card. */
  readonly onPress?: FacetAction;
  readonly children: readonly NodeId[];
}

export interface TextNode {
  readonly id: NodeId;
  readonly type: "text";
  readonly value: string;
  readonly style?: TextStyle;
}

export interface ImageNode {
  readonly id: NodeId;
  readonly type: "image";
  readonly src: string;
  readonly alt: string;
  readonly style?: ImageStyle;
}

/** Allowed field input types — single source (validator derives its check from this). */
export const FIELD_INPUTS = ["text", "number", "email", "password", "search"] as const;
export type FieldInput = (typeof FIELD_INPUTS)[number];

/** The input primitive. */
export interface FieldNode {
  readonly id: NodeId;
  readonly type: "field";
  readonly name: string;
  readonly input?: FieldInput;
  readonly label?: string;
  readonly placeholder?: string;
  readonly style?: FieldStyle;
}

/** Any brick the agent may place on a stage. */
export type FacetNode = BoxNode | TextNode | ImageNode | FieldNode;

export type FacetNodeType = FacetNode["type"];

/** Narrows a node to the one brick that can hold children. */
export function isContainer(node: FacetNode): node is BoxNode {
  return node.type === "box";
}
