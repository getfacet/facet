import {
  type Dataset,
  type FacetNode,
  type FacetTree,
  type JsonPatchOperation,
  type NodeId,
  type ServerMessage,
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
 * The agent's control surface for its page — the "CLI" the agent drives to build
 * and mutate the stage as a conversation unfolds.
 *
 * The method names stay ergonomic (render / set / append / remove / screens /
 * say), but each records standard RFC 6902 operations underneath. Stage edits
 * are coalesced into a single `patch` message and ordered correctly relative to
 * `say(...)`.
 */
export class Stage {
  private out: ServerMessage[] = [];
  private pending: JsonPatchOperation[] = [];
  private dataInitialized = false;

  constructor(initialStage?: FacetTree) {
    if (initialStage !== undefined) this.dataInitialized = initialStage.data !== undefined;
  }

  /** Replace the entire stage with a new tree. */
  render(tree: FacetTree): this {
    this.pending.push({ op: "replace", path: "", value: tree });
    this.dataInitialized = tree.data !== undefined;
    return this;
  }

  /** Insert or replace a single node by id (RFC 6902 `add` upserts). */
  set(node: FacetNode): this {
    this.pending.push({ op: "add", path: nodePath(node.id), value: node });
    return this;
  }

  /** Append a new node as the last child of a container. */
  append(parent: NodeId, node: FacetNode): this {
    this.pending.push({ op: "add", path: nodePath(node.id), value: node });
    this.pending.push({ op: "add", path: childrenPath(parent), value: node.id });
    return this;
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
   * Remove a node from the map. Any lingering id reference in a parent's
   * `children` is harmless — the fail-safe renderer skips ids it can't resolve.
   */
  remove(id: NodeId): this {
    this.pending.push({ op: "remove", path: nodePath(id) });
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
    return out;
  }

  private flushPending(): void {
    if (this.pending.length > 0) {
      this.out.push({ kind: "patch", patches: this.pending });
      this.pending = [];
    }
  }
}
