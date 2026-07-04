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
    return this.out;
  }

  private flushPending(): void {
    if (this.pending.length > 0) {
      this.out.push({ kind: "patch", patches: this.pending });
      this.pending = [];
    }
  }
}
