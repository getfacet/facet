import type {
  BoxStyle,
  FacetAction,
  FacetNode,
  FacetTree,
  InputKind,
  MediaKind,
  MediaStyle,
  NodeId,
  TextStyle,
} from "@facet/core";

/**
 * Playground-local sugar for hand-authored demo trees. It only emits normal
 * Facet brick data into a flat node map; no renderer or protocol behavior lives
 * here.
 */
export class TreeBuilder {
  readonly nodes: Record<NodeId, FacetNode> = {};
  private count = 0;

  constructor(private readonly prefix: string) {}

  private next(): NodeId {
    this.count += 1;
    return `${this.prefix}${String(this.count)}`;
  }

  text(value: string, style?: TextStyle): NodeId {
    const id = this.next();
    this.nodes[id] =
      style === undefined ? { id, type: "text", value } : { id, type: "text", value, style };
    return id;
  }

  box(
    style: BoxStyle,
    children: readonly NodeId[],
    onPress?: FacetAction,
    onHold?: FacetAction,
  ): NodeId {
    const id = this.next();
    this.nodes[id] = {
      id,
      type: "box",
      style,
      children: [...children],
      ...(onPress !== undefined ? { onPress } : {}),
      ...(onHold !== undefined ? { onHold } : {}),
    };
    return id;
  }

  hiddenBox(style: BoxStyle, children: readonly NodeId[]): NodeId {
    const id = this.next();
    this.nodes[id] = { id, type: "box", style, children: [...children], hidden: true };
    return id;
  }

  media(
    src: string,
    alt: string,
    style?: MediaStyle,
    kind: MediaKind = "image",
    extra?: { readonly poster?: string; readonly controls?: boolean },
  ): NodeId {
    const id = this.next();
    this.nodes[id] = {
      id,
      type: "media",
      kind,
      src,
      alt,
      ...(style !== undefined ? { style } : {}),
      ...(extra?.poster !== undefined ? { poster: extra.poster } : {}),
      ...(extra?.controls !== undefined ? { controls: extra.controls } : {}),
    };
    return id;
  }

  field(
    name: string,
    label: string,
    placeholder: string,
    input?: InputKind,
    options?: readonly string[],
  ): NodeId {
    const id = this.next();
    this.nodes[id] = {
      id,
      type: "input",
      name,
      label,
      placeholder,
      style: { width: "full" },
      ...(input !== undefined ? { input } : {}),
      ...(options !== undefined ? { options } : {}),
    };
    return id;
  }

  tree(rootStyle: BoxStyle, children: readonly NodeId[]): FacetTree {
    this.nodes["root"] = { id: "root", type: "box", style: rootStyle, children: [...children] };
    return { root: "root", nodes: this.nodes };
  }

  screensTree(screens: Readonly<Record<string, NodeId>>, entry: string): FacetTree {
    this.nodes["root"] = {
      id: "root",
      type: "box",
      style: { direction: "column" },
      children: Object.values(screens),
    };
    return { root: "root", nodes: this.nodes, screens, entry };
  }
}
