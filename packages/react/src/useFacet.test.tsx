// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { EMPTY_TREE, type FacetTransport, type ServerMessage } from "@facet/core";
import { useFacet } from "./useFacet.js";

afterEach(cleanup);

function fakeTransport() {
  let listener: ((message: ServerMessage) => void) | null = null;
  const transport: FacetTransport = {
    send: vi.fn(),
    subscribe: (on) => {
      listener = on;
      return () => {
        listener = null;
      };
    },
  };
  return {
    transport,
    emit: (message: ServerMessage) => act(() => listener?.(message)),
    subscribed: () => listener !== null,
  };
}

const validTree = {
  root: "root",
  nodes: { root: { id: "root", type: "box" as const, children: [] } },
};

// A distinct root id (not "root") so "the seed is visible before any frame"
// can't be satisfied by EMPTY_TREE, which also carries a "root" node.
const seedTree = {
  root: "seed",
  nodes: { seed: { id: "seed", type: "box" as const, children: [] } },
};

describe("useFacet (jsdom)", () => {
  it("applies a patch message to the tree", () => {
    const t = fakeTransport();
    const { result } = renderHook(() => useFacet(t.transport));
    t.emit({ kind: "patch", patches: [{ op: "replace", path: "", value: validTree }] });
    expect(result.current.tree.root).toBe("root");
    expect(result.current.tree.nodes["root"]).toBeDefined();
  });

  it("appends say messages to chat in order", () => {
    const t = fakeTransport();
    const { result } = renderHook(() => useFacet(t.transport));
    t.emit({ kind: "say", text: "hello" });
    t.emit({ kind: "say", text: "again" });
    expect(result.current.chat).toEqual(["hello", "again"]);
  });

  it("keeps the current tree when a malformed patch throws (client fail-safe)", () => {
    const t = fakeTransport();
    const { result } = renderHook(() => useFacet(t.transport));
    t.emit({ kind: "patch", patches: [{ op: "replace", path: "", value: validTree }] });
    // parent path doesn't exist → applyPatch throws → must be swallowed
    t.emit({
      kind: "patch",
      patches: [{ op: "add", path: "/nodes/missing/children/-", value: "x" }],
    });
    expect(result.current.tree.nodes["root"]).toBeDefined(); // unchanged, no crash
  });

  it("ignores a root replace carrying a non-tree (keeps the current tree)", () => {
    const t = fakeTransport();
    const { result } = renderHook(() => useFacet(t.transport));
    t.emit({ kind: "patch", patches: [{ op: "replace", path: "", value: validTree }] });
    t.emit({ kind: "patch", patches: [{ op: "replace", path: "", value: null }] });
    expect(result.current.tree.nodes["root"]).toBeDefined(); // not null
  });

  it("clears chat on a reset message (reconnect), then re-accumulates", () => {
    const t = fakeTransport();
    const { result } = renderHook(() => useFacet(t.transport));
    t.emit({ kind: "say", text: "one" });
    t.emit({ kind: "reset" });
    expect(result.current.chat).toEqual([]);
    t.emit({ kind: "say", text: "fresh" });
    expect(result.current.chat).toEqual(["fresh"]);
  });

  it("ignores an unknown message kind (never pushes undefined into chat)", () => {
    const t = fakeTransport();
    const { result } = renderHook(() => useFacet(t.transport));
    t.emit({ kind: "mystery" } as unknown as ServerMessage);
    expect(result.current.chat).toEqual([]);
  });

  it("renders a boot-shipped initialTree before any transport frame arrives", () => {
    const t = fakeTransport();
    const { result } = renderHook(() => useFacet(t.transport, { initialTree: seedTree }));
    // No frame has been emitted yet — the seed is the very first paint.
    expect(result.current.tree.root).toBe("seed");
    expect(result.current.tree.nodes["seed"]).toBeDefined();
  });

  it("the server's root-replace frame wins over the boot seed (server stays the only writer)", () => {
    const t = fakeTransport();
    const { result } = renderHook(() => useFacet(t.transport, { initialTree: seedTree }));
    // Pre-frame: the boot seed is the first paint.
    expect(result.current.tree.root).toBe("seed");
    // The server is the only writer of stage content: a root-replace frame
    // carrying a DIFFERENT tree must overwrite the boot seed. A dead
    // subscription, a rejected patch, or an isTreeShaped rejection would all
    // leave root === "seed" and fail here.
    const serverTree = {
      root: "server",
      nodes: { server: { id: "server", type: "text" as const, value: "from server" } },
    };
    t.emit({ kind: "patch", patches: [{ op: "replace", path: "", value: serverTree }] });
    expect(result.current.tree.root).toBe("server");
    expect(result.current.tree.nodes["server"]).toBeDefined();
    expect(result.current.tree.nodes["seed"]).toBeUndefined();
  });

  it("one-arg useFacet still starts from EMPTY_TREE (no boot seed)", () => {
    const t = fakeTransport();
    const { result } = renderHook(() => useFacet(t.transport));
    expect(result.current.tree).toEqual(EMPTY_TREE);
    expect(result.current.tree.nodes["seed"]).toBeUndefined();
  });

  it("unsubscribes from the transport on unmount", () => {
    const t = fakeTransport();
    const { unmount } = renderHook(() => useFacet(t.transport));
    expect(t.subscribed()).toBe(true);
    unmount();
    expect(t.subscribed()).toBe(false);
  });
});
