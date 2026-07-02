import { useState } from "react";
import type { ReactNode } from "react";
import {
  FIELD_INPUTS,
  isSafeImageSrc,
  MAX_DEPTH,
  type AgentAction,
  type FacetAction,
  type FacetNode,
  type FacetTree,
  type NodeId,
} from "@facet/core";
import { boxStyle, fieldStyle, imageStyle, textStyle } from "./theme.js";

const EMPTY_ANCESTORS: ReadonlySet<NodeId> = new Set<NodeId>();

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
    // != null: a patch can set the root node to JSON null, not just remove it
    tree.nodes[tree.root] != null
  );
}

/**
 * Resolves `name` to a screen's live root node id, or null. Defensive against
 * raw-path junk: `screens` may not be an object, its values may not be strings,
 * and a value may name a node that no longer exists.
 */
function liveScreenRoot(tree: FacetTree, name: unknown): NodeId | null {
  const screens: unknown = tree.screens;
  if (typeof screens !== "object" || screens === null || typeof name !== "string") {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(screens, name)) {
    return null;
  }
  const rootId: unknown = (screens as Record<string, unknown>)[name];
  return typeof rootId === "string" && tree.nodes[rootId] != null ? rootId : null;
}

/**
 * Total function from view-state to the node id to render (invariant #6):
 * current screen if live → entry if live → first live screen → plain `root`.
 */
function resolveScreenRoot(tree: FacetTree, currentScreen: string | null): NodeId {
  const current = liveScreenRoot(tree, currentScreen);
  if (current !== null) {
    return current;
  }
  const entry = liveScreenRoot(tree, tree.entry);
  if (entry !== null) {
    return entry;
  }
  const screens: unknown = tree.screens;
  if (typeof screens === "object" && screens !== null) {
    for (const name of Object.keys(screens)) {
      const first = liveScreenRoot(tree, name);
      if (first !== null) {
        return first;
      }
    }
  }
  return tree.root;
}

/** A press the renderer has classified from an UNTRUSTED `onPress` value. */
type ClassifiedPress =
  | { readonly kind: "navigate"; readonly to: string }
  | { readonly kind: "toggle"; readonly target: NodeId }
  | { readonly kind: "agent"; readonly action: AgentAction };

/**
 * Classifies an untrusted `onPress` (the raw live-patch path bypasses
 * validateTree). Unclassifiable shapes return null — the box renders as a plain
 * NON-pressable box, never a broken button.
 */
function classifyPress(onPress: unknown): ClassifiedPress | null {
  if (typeof onPress !== "object" || onPress === null) {
    return null;
  }
  const press = onPress as {
    readonly kind?: unknown;
    readonly to?: unknown;
    readonly target?: unknown;
    readonly name?: unknown;
    readonly payload?: unknown;
  };
  if (press.kind === "navigate") {
    return typeof press.to === "string" ? { kind: "navigate", to: press.to } : null;
  }
  if (press.kind === "toggle") {
    return typeof press.target === "string" ? { kind: "toggle", target: press.target } : null;
  }
  if ((press.kind === undefined || press.kind === "agent") && typeof press.name === "string") {
    // Emit the canonical kind-stamped agent action (a bare {name} IS an agent action).
    const payload = press.payload;
    if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
      // Payload must be a plain (non-array) object, then keep only primitive
      // values — mirror of core asAction (arrays fail its isObject check, so no
      // payload is emitted at all rather than an index-keyed object).
      const filtered: Record<string, string | number | boolean> = {};
      for (const [key, raw] of Object.entries(payload)) {
        if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
          filtered[key] = raw;
        }
      }
      return { kind: "agent", action: { kind: "agent", name: press.name, payload: filtered } };
    }
    return { kind: "agent", action: { kind: "agent", name: press.name } };
  }
  return null;
}

/** Content-declared default visibility; only literal `true` hides (raw-path junk is visible). */
function isHiddenByDefault(node: FacetNode): boolean {
  return (node as { readonly hidden?: unknown }).hidden === true;
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
 *
 * It also owns the browser's VIEW-STATE (invariant #6): `currentScreen` and
 * `visibilityOverrides` live here as React state; navigate/toggle presses
 * mutate only this state and NEVER reach `onAction` (the only channel to any
 * transport). Content stays server-owned via the patch flow.
 */
export function StageRenderer({ tree, onAction }: StageRendererProps): ReactNode {
  const [currentScreen, setCurrentScreen] = useState<string | null>(null);
  const [visibilityOverrides, setVisibilityOverrides] = useState<Readonly<Record<NodeId, boolean>>>(
    {},
  );

  // Fail-safe boundary (invariant #2): a malformed tree — e.g. `render 'null'` on
  // the unvalidated CLI path — renders as nothing, never a crash.
  if (!isRenderableTree(tree)) {
    return null;
  }

  const handlePress = (press: ClassifiedPress): void => {
    switch (press.kind) {
      case "navigate":
        // Only a live screen is navigable; unknown targets no-op (DC-004).
        if (liveScreenRoot(tree, press.to) !== null) {
          setCurrentScreen(press.to);
        }
        return;
      case "toggle": {
        const target = tree.nodes[press.target];
        if (target == null) {
          return; // unknown target no-ops (DC-004)
        }
        setVisibilityOverrides((prev) => {
          const effective = prev[press.target] ?? !isHiddenByDefault(target);
          return { ...prev, [press.target]: !effective };
        });
        return;
      }
      case "agent":
        onAction?.(press.action);
    }
  };

  return (
    <RenderNode
      tree={tree}
      id={resolveScreenRoot(tree, currentScreen)}
      onPress={handlePress}
      visibilityOverrides={visibilityOverrides}
      depth={0}
    />
  );
}

interface RenderNodeProps {
  readonly tree: FacetTree;
  readonly id: NodeId;
  readonly onPress: (press: ClassifiedPress) => void;
  readonly visibilityOverrides: Readonly<Record<NodeId, boolean>>;
  /** Ids on the path from the root to here — used to break cycles fail-safe. */
  readonly ancestors?: ReadonlySet<NodeId> | undefined;
  readonly depth: number;
}

function RenderNode({
  tree,
  id,
  onPress,
  visibilityOverrides,
  ancestors,
  depth,
}: RenderNodeProps): ReactNode {
  const node = tree.nodes[id];
  // == null also skips a node a patch replaced with JSON null (not just missing ids).
  if (node == null || depth > MAX_DEPTH) {
    return null;
  }
  // Effective visibility = browser override ?? content default. A hidden node
  // is skipped (never thrown on), same as an unresolvable id.
  const visible = visibilityOverrides[id] ?? !isHiddenByDefault(node);
  if (!visible) {
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
      // One linear pass skips ancestors (cycle break) and dedupes sibling ids
      // (raw path can repeat one; validateTree dedupes too) — first occurrence
      // wins so React keys stay unique.
      const emitted = new Set<NodeId>(seen);
      const uniqueChildIds = childIds.filter((childId) => {
        if (emitted.has(childId)) {
          return false;
        }
        emitted.add(childId);
        return true;
      });
      const children = uniqueChildIds.map((childId) => (
        <RenderNode
          key={childId}
          tree={tree}
          id={childId}
          onPress={onPress}
          visibilityOverrides={visibilityOverrides}
          ancestors={childAncestors}
          depth={depth + 1}
        />
      ));
      // onPress is untrusted on the raw path — an unclassifiable action renders
      // a plain non-pressable box instead of a dead or dangerous button.
      const press = classifyPress(node.onPress);
      if (press !== null) {
        return (
          <div
            role="button"
            tabIndex={0}
            style={{ ...boxStyle(styleOf(node.style)), cursor: "pointer" }}
            onClick={() => onPress(press)}
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
    case "field": {
      // Raw-path junk: constrain `input` to the token set (else "text") and
      // omit non-string name/placeholder, mirroring core's field coercion.
      const input =
        typeof node.input === "string" && (FIELD_INPUTS as readonly string[]).includes(node.input)
          ? node.input
          : "text";
      const name = typeof node.name === "string" ? node.name : undefined;
      const placeholder = typeof node.placeholder === "string" ? node.placeholder : undefined;
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
          <input type={input} name={name} placeholder={placeholder} />
        </label>
      );
    }
  }
}
