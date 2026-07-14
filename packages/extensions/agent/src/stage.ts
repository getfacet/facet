import {
  MAX_PATCH_OPS,
  expandComposition,
  isContainer,
  type CompositionParams,
  type Dataset,
  type ExpandAt,
  type FacetComposition,
  type FacetNode,
  type FacetTree,
  type JsonPatchOperation,
  type NodeId,
  type ServerMessage,
  type UseCompositionResult,
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

function dataPath(name: string): string {
  return `/data/${escape(name)}`;
}

/**
 * Whether an expanded node is a RESIDUAL composition reference — a value carrying
 * a string `use` but no brick `type`. Core resolves every `{ use }` reference to
 * primitives at expand time, so this should never fire; it is the defensive
 * backstop keeping a reference out of the stage patch (RISK-INV-1), symmetric
 * with the executor's `nodesCatalogViolation` re-check.
 */
function isResidualReference(node: FacetNode): boolean {
  const raw = node as { readonly type?: unknown; readonly use?: unknown };
  return raw.type === undefined && typeof raw.use === "string";
}

/**
 * The agent's control surface for its page — the "CLI" the agent drives to build
 * and mutate the stage as a conversation unfolds.
 *
 * The method names stay ergonomic (render / set / append / remove / screens /
 * theme / say), but each records standard RFC 6902 operations underneath. Stage
 * edits are coalesced into a single `patch` message and ordered correctly
 * relative to `say(...)`.
 */
export class Stage {
  private out: ServerMessage[] = [];
  private pending: JsonPatchOperation[] = [];
  private emittedPatchOps = 0;
  private knownIds: Set<NodeId>;
  private knownContainerIds: Set<NodeId>;
  private dataInitialized = false;

  constructor(initialStage?: FacetTree) {
    this.knownIds = new Set(["root"]);
    this.knownContainerIds = new Set(["root"]);
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

  /** Append a new node as the last child of a container. */
  append(parent: NodeId, node: FacetNode): this {
    this.pending.push({ op: "add", path: nodePath(node.id), value: node });
    this.pending.push({ op: "add", path: childrenPath(parent), value: node.id });
    this.rememberNode(node);
    return this;
  }

  /**
   * Expand a resolved composition under a known parent as ordinary patch ops.
   *
   * The optional `compositions` registry is the set a nested `{ use }` reference
   * is resolved against — the caller threads its loaded compositions so a nested
   * reference expands to primitives. Absent a registry, an unresolved reference
   * fail-safe-skips (dropped by core, never thrown). Either way a residual
   * reference can never reach the patch: `isResidualReference` is the defensive
   * backstop symmetric with the executor's `nodesCatalogViolation` re-check.
   */
  useComposition(
    composition: FacetComposition | undefined,
    params: CompositionParams,
    at: ExpandAt,
    compositions?: readonly FacetComposition[],
  ): UseCompositionResult {
    if (!this.knownContainerIds.has(at.parent)) return { slots: {}, ids: {} };
    const expanded = expandComposition(composition, params, at, {
      existingIds: this.knownIds,
      ...(compositions !== undefined ? { compositions } : {}),
    });
    if (expanded.root === undefined) return { slots: expanded.slots, ids: expanded.ids };

    // Backstop: a residual `{ use }` reference must NEVER land on the stage. Core
    // resolves references to primitives at expand time; if any survived, refuse
    // the whole expansion (fail-safe no-op) rather than leak it into the patch.
    if (Object.values(expanded.nodes).some(isResidualReference)) {
      return { slots: {}, ids: {} };
    }

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
   * Author a named dataset in the tree's DATA WAREHOUSE so many nodes can bind
   * to one source by NAME via their `from` field (author once, bind many).
   *
   * Records an `add` op at `/data/<name>` (an upsert per RFC 6902 — replaces the
   * dataset if the name already exists, creates it otherwise), so `setData`
   * updates a bound view in place. The first data write in a session also emits
   * a one-time `add /data {}` so the nested `/data/<name>` op has a parent to
   * land in — subsequent writes and a session stage that already carries `data`
   * skip it, never clobbering existing datasets. `rows` are agent-authored
   * declared data (the same trust tier as inline `rows`) and are sanitized by
   * `validateTree` on the fold, exactly like node values; there is no fetch,
   * resolver, or query here — just a name and its rows.
   */
  setData(name: string, rows: Dataset): this {
    if (!this.dataInitialized) {
      this.pending.push({ op: "add", path: "/data", value: {} });
      this.dataInitialized = true;
    }
    this.pending.push({ op: "add", path: dataPath(name), value: rows });
    return this;
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
    this.knownContainerIds.delete(id);
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
    this.knownContainerIds = new Set(
      Object.values(tree.nodes)
        .filter((node) => node != null && isContainer(node))
        .map((node) => node.id),
    );
    // A tree that already carries `data` has the `/data` container present, so
    // the next `setData` must NOT re-emit the init op (it would clobber it); a
    // tree without `data` resets the flag so the next write recreates `/data`.
    this.dataInitialized = tree.data !== undefined;
  }

  private rememberNode(node: FacetNode): void {
    this.knownIds.add(node.id);
    if (isContainer(node)) this.knownContainerIds.add(node.id);
    else this.knownContainerIds.delete(node.id);
  }
}
