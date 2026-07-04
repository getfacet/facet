import type { FacetNode, FacetTree, NodeId, Space, TextStyle } from "@facet/core";

/**
 * A tiny local brick helper for the playground's two static faces (welcome +
 * OFFLINE_FACE). It reproduces exactly the `page`/`text` shapes the retired
 * `@facet/kit` presets emitted — byte-identical trees (`k1..kn` ids, root box) —
 * so the playground owns its own faces with no dependency on the code-factory
 * package. `bricks.test.ts` freezes the output against literal fixtures.
 *
 * This is sugar over the four bricks: everything emitted is plain box/text data
 * with token style values only — never raw HTML/JS, never new capability.
 */
class Builder {
  readonly nodes: Record<NodeId, FacetNode> = {};
  private count = 0;

  private next(): NodeId {
    this.count += 1;
    return `k${String(this.count)}`;
  }

  text(value: string, style?: TextStyle): NodeId {
    const id = this.next();
    this.nodes[id] =
      style === undefined ? { id, type: "text", value } : { id, type: "text", value, style };
    return id;
  }
}

/** A composable piece of a page: given a Builder, register nodes and return the root id. */
export type Block = (builder: Builder) => NodeId;

export function text(value: string, style?: TextStyle): Block {
  return (b) => b.text(value, style);
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
