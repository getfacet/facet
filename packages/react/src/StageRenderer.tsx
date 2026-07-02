import type { ReactNode } from "react";
import type { FacetAction, FacetTree, NodeId } from "@facet/core";
import { boxStyle, fieldStyle, imageStyle, textStyle } from "./theme.js";

const EMPTY_ANCESTORS: ReadonlySet<NodeId> = new Set<NodeId>();

export interface StageRendererProps {
  readonly tree: FacetTree;
  /** Invoked when an interactive brick fires (a pressed box, a submitted field). */
  readonly onAction?: (action: FacetAction) => void;
}

/**
 * Renders a stage tree into React elements from the four low-level bricks.
 *
 * This is the security boundary and the fail-safe boundary: only known brick
 * types are rendered, there is no node that carries raw HTML/JS, and any id that
 * can't be resolved (e.g. a removed node still referenced by a parent) is simply
 * skipped — so a partial or imperfect stage renders as "plain", never broken.
 */
export function StageRenderer({ tree, onAction }: StageRendererProps): ReactNode {
  return <RenderNode tree={tree} id={tree.root} onAction={onAction} />;
}

interface RenderNodeProps {
  readonly tree: FacetTree;
  readonly id: NodeId;
  readonly onAction?: ((action: FacetAction) => void) | undefined;
  /** Ids on the path from the root to here — used to break cycles fail-safe. */
  readonly ancestors?: ReadonlySet<NodeId> | undefined;
}

function RenderNode({ tree, id, onAction, ancestors }: RenderNodeProps): ReactNode {
  const node = tree.nodes[id];
  if (node === undefined) {
    return null;
  }

  switch (node.type) {
    case "box": {
      // Fail-safe (invariant #2): skip a child that points back to an ancestor so
      // a cyclic tree (which never passes through validateTree on the live path)
      // can't infinitely recurse and crash the render.
      const seen = ancestors ?? EMPTY_ANCESTORS;
      const childAncestors = new Set(seen).add(id);
      const children = node.children
        .filter((childId) => !seen.has(childId))
        .map((childId) => (
          <RenderNode
            key={childId}
            tree={tree}
            id={childId}
            onAction={onAction}
            ancestors={childAncestors}
          />
        ));
      const action = node.onPress;
      if (action !== undefined) {
        return (
          <div
            role="button"
            tabIndex={0}
            style={{ ...boxStyle(node.style), cursor: "pointer" }}
            onClick={() => onAction?.(action)}
          >
            {children}
          </div>
        );
      }
      return <div style={boxStyle(node.style)}>{children}</div>;
    }
    case "text":
      return <p style={textStyle(node.style)}>{node.value}</p>;
    case "image":
      return <img src={node.src} alt={node.alt} style={imageStyle(node.style)} />;
    case "field":
      return (
        <label
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            ...fieldStyle(node.style),
          }}
        >
          {node.label !== undefined ? <span>{node.label}</span> : null}
          <input type={node.input ?? "text"} name={node.name} placeholder={node.placeholder} />
        </label>
      );
  }
}
