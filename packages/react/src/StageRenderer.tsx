import type { ReactNode } from "react";
import { isSafeImageSrc, type FacetAction, type FacetTree, type NodeId } from "@facet/core";
import { boxStyle, fieldStyle, imageStyle, textStyle } from "./theme.js";

const EMPTY_ANCESTORS: ReadonlySet<NodeId> = new Set<NodeId>();
const MAX_DEPTH = 100;

// Fail-safe (invariant #2): the live path applies raw RFC 6902 patches with no
// validateTree, so any node FIELD can hold arbitrary JSON (children: "oops",
// src: 42, style: null). Coerce shapes here instead of trusting the types.
function styleOf<T extends object>(style: T | undefined): T | undefined {
  return typeof style === "object" && style !== null ? style : undefined;
}

/** A tree is renderable only if it's an object with a `nodes` map and a resolvable root. */
function isRenderableTree(tree: FacetTree): boolean {
  return (
    typeof tree === "object" &&
    tree !== null &&
    typeof (tree as { nodes?: unknown }).nodes === "object" &&
    (tree as { nodes?: Record<string, unknown> }).nodes !== null &&
    tree.nodes[tree.root] !== undefined
  );
}

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
  // Fail-safe boundary (invariant #2): a malformed tree — e.g. `render 'null'` on
  // the unvalidated CLI path — renders as nothing, never a crash.
  if (!isRenderableTree(tree)) {
    return null;
  }
  return <RenderNode tree={tree} id={tree.root} onAction={onAction} depth={0} />;
}

interface RenderNodeProps {
  readonly tree: FacetTree;
  readonly id: NodeId;
  readonly onAction?: ((action: FacetAction) => void) | undefined;
  /** Ids on the path from the root to here — used to break cycles fail-safe. */
  readonly ancestors?: ReadonlySet<NodeId> | undefined;
  readonly depth: number;
}

function RenderNode({ tree, id, onAction, ancestors, depth }: RenderNodeProps): ReactNode {
  const node = tree.nodes[id];
  if (node === undefined || depth > MAX_DEPTH) {
    return null;
  }

  switch (node.type) {
    case "box": {
      // Fail-safe (invariant #2): skip a child that points back to an ancestor so
      // a cyclic tree (which never passes through validateTree on the live path)
      // can't infinitely recurse and crash the render.
      const seen = ancestors ?? EMPTY_ANCESTORS;
      const childAncestors = new Set(seen).add(id);
      const childIds: readonly NodeId[] = Array.isArray(node.children) ? node.children : [];
      const children = childIds
        .filter((childId) => !seen.has(childId))
        .map((childId) => (
          <RenderNode
            key={childId}
            tree={tree}
            id={childId}
            onAction={onAction}
            ancestors={childAncestors}
            depth={depth + 1}
          />
        ));
      const action = node.onPress;
      if (action !== undefined) {
        return (
          <div
            role="button"
            tabIndex={0}
            style={{ ...boxStyle(styleOf(node.style)), cursor: "pointer" }}
            onClick={() => onAction?.(action)}
          >
            {children}
          </div>
        );
      }
      return <div style={boxStyle(styleOf(node.style))}>{children}</div>;
    }
    case "text":
      // A non-string value (an object would make React itself throw) is skipped.
      return typeof node.value === "string" ? (
        <p style={textStyle(styleOf(node.style))}>{node.value}</p>
      ) : null;
    case "image":
      // Fail-safe/security: never put an unsafe URL scheme (javascript:, …) in the DOM.
      return typeof node.src === "string" && isSafeImageSrc(node.src) ? (
        <img
          src={node.src}
          alt={typeof node.alt === "string" ? node.alt : ""}
          style={imageStyle(styleOf(node.style))}
        />
      ) : null;
    case "field":
      return (
        <label
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            ...fieldStyle(styleOf(node.style)),
          }}
        >
          {typeof node.label === "string" ? <span>{node.label}</span> : null}
          <input type={node.input ?? "text"} name={node.name} placeholder={node.placeholder} />
        </label>
      );
  }
}
