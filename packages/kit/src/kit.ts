import type {
  BoxStyle,
  FacetAction,
  FacetNode,
  FacetTree,
  ImageStyle,
  NodeId,
  Space,
  TextStyle,
} from "@facet/core";

/**
 * Presets — sugar over the four low-level bricks. Each preset is a `Block`: a
 * function that, given a Builder, registers its nodes and returns its root id.
 * `page(...)` assembles Blocks into a FacetTree. Everything a preset emits is
 * plain box/text/image/field, so presets add convenience, never new capability
 * or risk. Reach for a preset for a common shape; drop to raw bricks for custom.
 */
class Builder {
  readonly nodes: Record<NodeId, FacetNode> = {};
  private count = 0;

  /**
   * `prefix` namespaces every generated id (`` `${prefix}k${n}` ``) so a
   * fragment grafted onto an existing tree can never collide with another
   * prefix's ids — or with the reserved `"root"`. `page()` passes `""`, keeping
   * its ids byte-identical to today (`k1..kn`, root `"root"`).
   */
  constructor(private readonly prefix = "") {}

  private next(): NodeId {
    this.count += 1;
    return `${this.prefix}k${String(this.count)}`;
  }

  /**
   * `onHold` is the LAST positional parameter this signature will take — the
   * next per-box word means switching to an options object.
   */
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

  text(value: string, style?: TextStyle): NodeId {
    const id = this.next();
    this.nodes[id] =
      style === undefined ? { id, type: "text", value } : { id, type: "text", value, style };
    return id;
  }

  image(src: string, alt: string, style?: ImageStyle): NodeId {
    const id = this.next();
    this.nodes[id] =
      style === undefined
        ? { id, type: "image", src, alt }
        : { id, type: "image", src, alt, style };
    return id;
  }

  field(name: string, label?: string, placeholder?: string): NodeId {
    const id = this.next();
    this.nodes[id] = {
      id,
      type: "field",
      name,
      style: { width: "full" },
      ...(label !== undefined ? { label } : {}),
      ...(placeholder !== undefined ? { placeholder } : {}),
    };
    return id;
  }
}

/** A composable piece of a page. */
export type Block = (builder: Builder) => NodeId;

export function text(value: string, style?: TextStyle): Block {
  return (b) => b.text(value, style);
}

export function heading(value: string, level: 1 | 2 | 3 = 1): Block {
  const size = level === 1 ? "3xl" : level === 2 ? "2xl" : "xl";
  return (b) => b.text(value, { size, weight: "bold" });
}

export function image(src: string, alt: string, ratio: ImageStyle["ratio"] = "wide"): Block {
  return (b) => b.image(src, alt, { width: "full", ratio, radius: "md" });
}

export function field(name: string, label?: string, placeholder?: string): Block {
  return (b) => b.field(name, label, placeholder);
}

export function button(label: string, action: string): Block {
  return (b) =>
    b.box(
      { bg: "accent", radius: "md", pad: "md", align: "center" },
      [b.text(label, { color: "accent-fg", weight: "semibold" })],
      { kind: "agent", name: action },
    );
}

export interface StackOptions {
  readonly gap?: Space;
  readonly pad?: Space;
}

export function stack(children: readonly Block[], options: StackOptions = {}): Block {
  return (b) =>
    b.box(
      {
        direction: "col",
        gap: options.gap ?? "md",
        ...(options.pad !== undefined ? { pad: options.pad } : {}),
      },
      children.map((child) => child(b)),
    );
}

export function row(children: readonly Block[], options: StackOptions = {}): Block {
  return (b) =>
    b.box(
      {
        direction: "row",
        gap: options.gap ?? "md",
        wrap: true,
        ...(options.pad !== undefined ? { pad: options.pad } : {}),
      },
      children.map((child) => child(b)),
    );
}

export function card(children: readonly Block[]): Block {
  return (b) =>
    b.box(
      { direction: "col", gap: "sm", pad: "lg", border: true, radius: "lg" },
      children.map((child) => child(b)),
    );
}

export interface HeroOptions {
  readonly title: string;
  readonly subtitle?: string;
  readonly cta?: { readonly label: string; readonly action: string };
}

export function hero(options: HeroOptions): Block {
  return (b) => {
    const children: NodeId[] = [
      b.text(options.title, { size: "3xl", weight: "bold", align: "center" }),
    ];
    if (options.subtitle !== undefined) {
      children.push(b.text(options.subtitle, { size: "md", color: "fg-muted", align: "center" }));
    }
    if (options.cta !== undefined) {
      children.push(button(options.cta.label, options.cta.action)(b));
    }
    return b.box({ direction: "col", gap: "lg", pad: "2xl", align: "center" }, children);
  };
}

export interface PageOptions {
  readonly gap?: Space;
  readonly pad?: Space;
}

/** Assemble Blocks into a complete FacetTree with a root box. */
export function page(blocks: readonly Block[], options: PageOptions = {}): FacetTree {
  const builder = new Builder();
  const children = blocks.map((block) => block(builder));
  builder.nodes["root"] = {
    id: "root",
    type: "box",
    style: { direction: "col", gap: options.gap ?? "lg", pad: options.pad ?? "xl" },
    children,
  };
  return { root: "root", nodes: builder.nodes };
}

/**
 * A graftable subtree: a `Block` instantiated on its own prefixed Builder. Every
 * id is `` `${prefix}k${n}` `` — never `"root"`, never colliding with another
 * prefix's ids — so `nodes` can be spread into an existing tree's node map and
 * `root` referenced from a parent's `children`. Unlike a `FacetTree` a fragment
 * has no root box of its own; `root` is the Block's own returned node.
 */
export interface Fragment {
  readonly root: NodeId;
  readonly nodes: Readonly<Record<NodeId, FacetNode>>;
}

/**
 * Instantiate one `Block` under an explicit id prefix, yielding a graftable
 * `Fragment`. Callers pass a non-empty prefix; kit does not police it (ids were
 * never contractual). Two fragments with different prefixes are disjoint.
 */
export function fragment(block: Block, prefix: string): Fragment {
  const builder = new Builder(prefix);
  const root = block(builder);
  return { root, nodes: builder.nodes };
}
