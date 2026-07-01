import type { FacetNode, FacetTree, JsonPatchOperation, NodeId, ServerMessage } from "@facet/core";

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
  private readonly out: ServerMessage[] = [];
  private pending: JsonPatchOperation[] = [];

  /** Replace the entire stage with a new tree. */
  render(tree: FacetTree): this {
    this.pending.push({ op: "replace", path: "", value: tree });
    return this;
  }

  /** Insert or replace a single node by id (RFC 6902 `add` upserts). */
  set(node: FacetNode): this {
    this.pending.push({ op: "add", path: nodePath(node.id), value: node });
    return this;
  }

  /** Append a new node as the last child of a box. */
  append(parent: NodeId, node: FacetNode): this {
    this.pending.push({ op: "add", path: nodePath(node.id), value: node });
    this.pending.push({ op: "add", path: childrenPath(parent), value: node.id });
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

  /** Send a chat message to the viewer, after any queued stage edits. */
  say(text: string): this {
    this.flushPending();
    this.out.push({ kind: "say", text });
    return this;
  }

  /** Drain all recorded commands into the messages to return to the runtime. */
  flush(): ServerMessage[] {
    this.flushPending();
    return this.out;
  }

  private flushPending(): void {
    if (this.pending.length > 0) {
      this.out.push({ kind: "patch", patches: this.pending });
      this.pending = [];
    }
  }
}
