import {
  MAX_PATCH_OPS,
  expandStamp,
  type ExpandAt,
  type FacetStamp,
  type FacetNode,
  type FacetTree,
  type JsonPatchOperation,
  type NodeId,
  type ServerMessage,
  type StampParams,
  type UseStampResult,
} from "@facet/core";

/** Escapes a token for use in an RFC 6901 JSON Pointer. */
function escape(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

function nodePath(id: NodeId): string {
  return `/nodes/${escape(id)}`;
}

function childrenPath(parent: NodeId): string {
  return `/nodes/${escape(parent)}/children/-`;
}

/**
 * The agent's control surface for its page — the "CLI" the agent drives to build
 * and mutate the stage as a conversation unfolds.
 *
 * The method names stay ergonomic (render / set / append / remove / say), but
 * each records standard RFC 6902 operations underneath. Stage edits are coalesced
 * into a single `patch` message and ordered correctly relative to `say(...)`.
 */
export class Stage {
  private out: ServerMessage[] = [];
  private pending: JsonPatchOperation[] = [];
  private emittedPatchOps = 0;
  private knownIds: Set<NodeId>;
  private knownBoxIds: Set<NodeId>;

  constructor(initialStage?: FacetTree) {
    this.knownIds = new Set(["root"]);
    this.knownBoxIds = new Set(["root"]);
    if (initialStage !== undefined) this.seedKnown(initialStage);
  }

  /** Replace the entire stage with a new tree. */
  render(tree: FacetTree): this {
    this.pending.push({ op: "replace", path: "", value: tree });
    this.seedKnown(tree);
    return this;
  }

  /** Insert or replace a single node by id (RFC 6902 `add` upserts). */
  set(node: FacetNode): this {
    this.pending.push({ op: "add", path: nodePath(node.id), value: node });
    this.rememberNode(node);
    return this;
  }

  /** Append a new node as the last child of a box. */
  append(parent: NodeId, node: FacetNode): this {
    this.pending.push({ op: "add", path: nodePath(node.id), value: node });
    this.pending.push({ op: "add", path: childrenPath(parent), value: node.id });
    this.rememberNode(node);
    return this;
  }

  /** Expand a resolved stamp under a known parent as ordinary patch ops. */
  useStamp(stamp: FacetStamp | undefined, params: StampParams, at: ExpandAt): UseStampResult {
    if (!this.knownBoxIds.has(at.parent)) return { slots: {}, ids: {} };
    const expanded = expandStamp(stamp, params, at, { existingIds: this.knownIds });
    if (expanded.root === undefined) return { slots: expanded.slots, ids: expanded.ids };

    const patchOps = Object.keys(expanded.nodes).length + 1;
    if (this.emittedPatchOps + this.pending.length + patchOps > MAX_PATCH_OPS) {
      return { slots: {}, ids: {} };
    }

    for (const node of Object.values(expanded.nodes)) {
      this.pending.push({ op: "add", path: nodePath(node.id), value: node });
      this.rememberNode(node);
    }
    this.pending.push({ op: "add", path: childrenPath(at.parent), value: expanded.root });
    return { root: expanded.root, slots: expanded.slots, ids: expanded.ids };
  }

  /**
   * Set the stage's named screens and entry screen.
   *
   * Records top-level `add` ops for `/screens` and `/entry` — per RFC 6902 an
   * `add` against an existing member of the root document upserts, so this
   * works whether or not the stage already has screens. The map is replaced
   * WHOLE: every call sets the complete screens map atomically (per-screen
   * incremental add is a follow-up if needed).
   */
  screens(screens: Readonly<Record<string, NodeId>>, entry: string): this {
    this.pending.push({ op: "add", path: "/screens", value: screens });
    this.pending.push({ op: "add", path: "/entry", value: entry });
    return this;
  }

  /**
   * Select the stage's theme by name.
   *
   * Records a top-level `add` op for `/theme` — the same upsert precedent as
   * `screens()` — carrying only a theme NAME, never a CSS value. An unknown
   * name is the renderer's fail-safe problem: `resolveTheme` falls back to the
   * default look, so a stale or missing name never breaks the page.
   */
  theme(name: string): this {
    this.pending.push({ op: "add", path: "/theme", value: name });
    return this;
  }

  /**
   * Remove a node from the map. Any lingering id reference in a parent's
   * `children` is harmless — the fail-safe renderer skips ids it can't resolve.
   */
  remove(id: NodeId): this {
    this.pending.push({ op: "remove", path: nodePath(id) });
    this.knownIds.delete(id);
    this.knownBoxIds.delete(id);
    return this;
  }

  /** Send a chat message to the visitor, after any queued stage edits. */
  say(text: string): this {
    this.flushPending();
    this.out.push({ kind: "say", text });
    return this;
  }

  /** Drain all recorded commands into the messages to return to the runtime. */
  flush(): ServerMessage[] {
    this.flushPending();
    const out = this.out;
    this.out = [];
    this.emittedPatchOps = 0;
    return out;
  }

  private flushPending(): void {
    if (this.pending.length > 0) {
      this.out.push({ kind: "patch", patches: this.pending });
      this.emittedPatchOps += this.pending.length;
      this.pending = [];
    }
  }

  private seedKnown(tree: FacetTree): void {
    this.knownIds = new Set(Object.keys(tree.nodes));
    this.knownBoxIds = new Set(
      Object.values(tree.nodes)
        .filter((node) => node != null && node.type === "box")
        .map((node) => node.id),
    );
  }

  private rememberNode(node: FacetNode): void {
    this.knownIds.add(node.id);
    if (node.type === "box") this.knownBoxIds.add(node.id);
    else this.knownBoxIds.delete(node.id);
  }
}
