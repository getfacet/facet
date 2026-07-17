import type { FacetTree, NodeId, Space, TextStyle } from "@facet/core";
import { TreeBuilder } from "./tree-builder.js";

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
/** A composable piece of a page: given a TreeBuilder, register nodes and return the root id. */
export type Block = (builder: TreeBuilder) => NodeId;

export function text(value: string, style?: TextStyle): Block {
  return (b) => b.text(value, style);
}

export interface PageOptions {
  readonly gap?: Space;
  readonly padding?: Space;
}

/** Assemble Blocks into a complete FacetTree with a root box. */
export function page(blocks: readonly Block[], options: PageOptions = {}): FacetTree {
  const builder = new TreeBuilder("k");
  const children = blocks.map((block) => block(builder));
  builder.nodes["root"] = {
    id: "root",
    type: "box",
    style: {
      direction: "column",
      gap: options.gap ?? "lg",
      padding: options.padding ?? "xl",
    },
    children,
  };
  return { root: "root", nodes: builder.nodes };
}
