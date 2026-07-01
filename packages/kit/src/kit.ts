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

  private next(): NodeId {
    this.count += 1;
    return `k${String(this.count)}`;
  }

  box(style: BoxStyle, children: readonly NodeId[], onPress?: FacetAction): NodeId {
    const id = this.next();
    this.nodes[id] =
      onPress === undefined
        ? { id, type: "box", style, children: [...children] }
        : { id, type: "box", style, children: [...children], onPress };
    return id;
  }

  text(value: string, style?: TextStyle): NodeId {
    const id = this.next();
    this.nodes[id] = style === undefined ? { id, type: "text", value } : { id, type: "text", value, style };
    return id;
  }

  image(src: string, alt: string, style?: ImageStyle): NodeId {
    const id = this.next();
    this.nodes[id] = style === undefined ? { id, type: "image", src, alt } : { id, type: "image", src, alt, style };
    return id;
  }

  field(name: string, label?: string, placeholder?: string): NodeId {
    const id = this.next();
    this.nodes[id] = { id, type: "field", name, style: { width: "full" }, ...(label !== undefined ? { label } : {}), ...(placeholder !== undefined ? { placeholder } : {}) };
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
  return (b) => b.box({ bg: "accent", radius: "md", pad: "md", align: "center" }, [b.text(label, { color: "accent-fg", weight: "semibold" })], { name: action });
}

export interface StackOptions {
  readonly gap?: Space;
  readonly pad?: Space;
}

export function stack(children: readonly Block[], options: StackOptions = {}): Block {
  return (b) => b.box({ direction: "col", gap: options.gap ?? "md", ...(options.pad !== undefined ? { pad: options.pad } : {}) }, children.map((child) => child(b)));
}

export function row(children: readonly Block[], options: StackOptions = {}): Block {
  return (b) => b.box({ direction: "row", gap: options.gap ?? "md", wrap: true }, children.map((child) => child(b)));
}

export function card(children: readonly Block[]): Block {
  return (b) => b.box({ direction: "col", gap: "sm", pad: "lg", border: true, radius: "lg" }, children.map((child) => child(b)));
}

export function grid(items: readonly Block[]): Block {
  return (b) => b.box({ direction: "row", gap: "md", wrap: true }, items.map((item) => item(b)));
}

export interface HeroOptions {
  readonly title: string;
  readonly subtitle?: string;
  readonly cta?: { readonly label: string; readonly action: string };
}

export function hero(options: HeroOptions): Block {
  return (b) => {
    const children: NodeId[] = [b.text(options.title, { size: "3xl", weight: "bold", align: "center" })];
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
