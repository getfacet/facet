// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import {
  EMPTY_TREE,
  type FacetTransport,
  type JsonPatchOperation,
  type ServerMessage,
} from "@facet/core";
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
    emitRaw: (message: ServerMessage) => listener?.(message),
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

  it("salvages good ops in a mixed batch (per-op fold, matching the server)", () => {
    const t = fakeTransport();
    const { result } = renderHook(() => useFacet(t.transport));
    t.emit({ kind: "patch", patches: [{ op: "replace", path: "", value: validTree }] });
    // A batch where one op throws (missing parent) and one applies. The NEW
    // contract folds per-op: the good op survives, the bad one is dropped — no
    // whole-batch drop, no crash. This mirrors foldPatchIntoStage on the server.
    t.emit({
      kind: "patch",
      patches: [
        { op: "add", path: "/nodes/good", value: { id: "good", type: "text", value: "kept" } },
        { op: "add", path: "/nodes/missing/children/-", value: "x" }, // throws
      ],
    });
    expect(result.current.tree.nodes["good"]).toBeDefined(); // salvaged
    expect(result.current.tree.nodes["root"]).toBeDefined(); // still valid
  });

  it("normalizes a root replace carrying a non-tree to the validated EMPTY_TREE", () => {
    const t = fakeTransport();
    const { result } = renderHook(() => useFacet(t.transport));
    t.emit({ kind: "patch", patches: [{ op: "replace", path: "", value: validTree }] });
    // `replace "" null` is exactly what the server folds too: applyPatch → null,
    // validateTree(null) → EMPTY_TREE. The client lands on the SAME normalized
    // tree (not the stale prior tree), so the two views cannot drift.
    t.emit({ kind: "patch", patches: [{ op: "replace", path: "", value: null }] });
    expect(result.current.tree).toEqual(EMPTY_TREE);
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
    // subscription or a rejected patch would leave root === "seed" and fail
    // here. The tree is a valid box-root so the shared fold keeps it as-is
    // (a non-box root would normalize to EMPTY_TREE — still an overwrite).
    const serverTree = {
      root: "server",
      nodes: { server: { id: "server", type: "box" as const, children: [] } },
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

  it("exposes transition metadata for root document writes", () => {
    const t = fakeTransport();
    const { result } = renderHook(() => useFacet(t.transport, { initialTree: seedTree }));

    expect(result.current.transition).toEqual({ revision: 0, rootReplaced: false });

    t.emit({ kind: "patch", patches: [{ op: "test", path: "/root", value: "seed" }] });
    expect(result.current.transition).toEqual({ revision: 0, rootReplaced: false });

    t.emit({ kind: "patch", patches: "not-an-array" as unknown as [] });
    expect(result.current.transition).toEqual({ revision: 0, rootReplaced: false });

    t.emit({
      kind: "patch",
      patches: [{ op: "replace", path: "/nodes/missing/value", value: "x" }],
    });
    expect(result.current.transition).toEqual({ revision: 0, rootReplaced: false });

    t.emit({ kind: "patch", patches: [{ op: "replace", path: "", value: validTree }] });
    expect(result.current.transition).toEqual({
      revision: 1,
      rootReplaced: true,
      rootReplacedRevision: 1,
    });

    t.emit({
      kind: "patch",
      patches: [
        { op: "add", path: "/nodes/child", value: { id: "child", type: "text", value: "child" } },
      ],
    });
    expect(result.current.transition).toEqual({
      revision: 2,
      rootReplaced: false,
      rootReplacedRevision: 1,
    });

    t.emit({
      kind: "patch",
      patches: [
        null,
        { op: "add", path: "/nodes/rawGood", value: { id: "rawGood", type: "text", value: "raw" } },
      ] as unknown as JsonPatchOperation[],
    });
    expect(result.current.tree.nodes["rawGood"]).toBeDefined();
    expect(result.current.transition).toEqual({
      revision: 3,
      rootReplaced: false,
      rootReplacedRevision: 1,
    });

    t.emit({
      kind: "patch",
      patches: [
        { op: "remove", path: "" },
        { op: "add", path: "/nodes/other", value: { id: "other", type: "text", value: "other" } },
      ],
    });
    expect(result.current.transition).toEqual({
      revision: 4,
      rootReplaced: false,
      rootReplacedRevision: 1,
    });

    for (const patches of [
      [{ op: "add", path: "", value: validTree }],
      [{ op: "copy", from: "", path: "" }],
      [{ op: "move", from: "/nodes/root", path: "" }],
    ] as const) {
      t.emit({ kind: "patch", patches });
      expect(result.current.transition.rootReplaced).toBe(true);
      expect(result.current.transition.rootReplacedRevision).toBe(
        result.current.transition.revision,
      );
    }

    expect(result.current.transition.revision).toBe(7);
  });

  it("preserves the last root-write revision across batched follow-up patch messages", () => {
    const t = fakeTransport();
    const { result } = renderHook(() => useFacet(t.transport, { initialTree: seedTree }));

    act(() => {
      t.emitRaw({ kind: "patch", patches: [{ op: "replace", path: "", value: validTree }] });
      t.emitRaw({
        kind: "patch",
        patches: [
          { op: "add", path: "/nodes/child", value: { id: "child", type: "text", value: "child" } },
        ],
      });
    });

    expect(result.current.transition).toEqual({
      revision: 2,
      rootReplaced: false,
      rootReplacedRevision: 1,
    });
  });

  it("does not mark a root write that was dropped behind a failed test guard", () => {
    const t = fakeTransport();
    const { result } = renderHook(() => useFacet(t.transport, { initialTree: seedTree }));

    t.emit({
      kind: "patch",
      patches: [
        { op: "add", path: "/nodes/good", value: { id: "good", type: "text", value: "kept" } },
        { op: "test", path: "/root", value: "not-the-seed" },
        { op: "replace", path: "", value: validTree },
      ],
    });

    expect(result.current.tree.nodes["good"]).toBeDefined();
    expect(result.current.tree.root).toBe("seed");
    expect(result.current.transition).toEqual({ revision: 1, rootReplaced: false });
  });

  it("unsubscribes from the transport on unmount", () => {
    const t = fakeTransport();
    const { unmount } = renderHook(() => useFacet(t.transport));
    expect(t.subscribed()).toBe(true);
    unmount();
    expect(t.subscribed()).toBe(false);
  });

  it("record forwards a collected tap to the transport's record method", () => {
    const record = vi.fn();
    const transport: FacetTransport = { send: vi.fn(), subscribe: () => () => {}, record };
    const { result } = renderHook(() => useFacet(transport));
    const tap = { kind: "tap", target: "goAbout", effect: { navigate: "about" } } as const;
    result.current.record(tap);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(tap);
  });

  it("record is a safe no-op when the transport does not implement record", () => {
    // `FacetTransport.record` is optional (additive protocol method): a transport
    // without it must not make `record` throw — the renderer wires onRecord to
    // this unconditionally.
    const transport: FacetTransport = { send: vi.fn(), subscribe: () => () => {} };
    const { result } = renderHook(() => useFacet(transport));
    expect(() =>
      result.current.record({ kind: "tap", target: "btn", effect: { toggle: "panel" } }),
    ).not.toThrow();
  });
});
