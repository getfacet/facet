// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { FacetTransport, ServerMessage } from "@facet/core";
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

  it("unsubscribes from the transport on unmount", () => {
    const t = fakeTransport();
    const { unmount } = renderHook(() => useFacet(t.transport));
    expect(t.subscribed()).toBe(true);
    unmount();
    expect(t.subscribed()).toBe(false);
  });
});
