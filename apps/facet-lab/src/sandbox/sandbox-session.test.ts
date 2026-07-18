import { describe, expect, it } from "vitest";

import { DEFAULT_THEME } from "@facet/assets";

import { createSandboxSession } from "./sandbox-session.js";

const sourceTree = () => ({
  root: "root",
  nodes: {
    root: { id: "root", type: "box", children: ["message"] },
    message: { id: "message", type: "text", value: "Trusted" },
  },
});

describe("sandbox session", () => {
  it("preserves the last safe clone under prohibited and racing edits", () => {
    const liveTree = sourceTree();
    const created = createSandboxSession({
      id: "sandbox-1",
      theme: DEFAULT_THEME,
      tree: liveTree,
      view: { screen: "main", viewport: "wide", colorMode: "dark" },
      source: { kind: "clone", runId: "run-1", revision: 7 },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("expected a valid sandbox session");

    const session = created.session;
    liveTree.nodes.message.value = "Mutated live run";
    expect(session.snapshot().tree.nodes["message"]).toMatchObject({ value: "Trusted" });
    expect(session.snapshot().originalTree.nodes["message"]).toMatchObject({ value: "Trusted" });

    const firstWriter = session.applyPatches(0, [
      { op: "replace", path: "/nodes/message/value", value: "First writer" },
    ]);
    expect(firstWriter).toMatchObject({ status: "applied", revision: 1 });

    const racingWriter = session.applyPatches(0, [
      { op: "replace", path: "/nodes/message/value", value: "Racing writer" },
    ]);
    expect(racingWriter).toMatchObject({
      status: "rejected",
      reason: "conflict",
      revision: 1,
    });
    expect(session.snapshot().tree.nodes["message"]).toMatchObject({ value: "First writer" });

    const prohibited = session.applyPatches(1, [
      { op: "add", path: "/nodes/message/fetch", value: "https://example.test" },
    ]);
    expect(prohibited).toMatchObject({
      status: "rejected",
      reason: "prohibited-content",
      revision: 1,
    });

    const invalid = session.applyPatches(1, [
      { op: "add", path: "/nodes/message/style/position", value: "absolute" },
    ]);
    expect(invalid).toMatchObject({ status: "rejected", reason: "invalid-tree", revision: 1 });
    expect(session.snapshot().tree.nodes["message"]).toMatchObject({ value: "First writer" });
    expect(session.snapshot().originalTree.nodes["message"]).toMatchObject({ value: "Trusted" });

    const beforeView = session.snapshot().tree;
    expect(session.checkpointView(1, { screen: "details", viewport: "narrow" })).toMatchObject({
      status: "applied",
      revision: 2,
    });
    expect(session.snapshot().tree).toEqual(beforeView);
    expect(session.snapshot().view).toEqual({ screen: "details", viewport: "narrow" });
    expect(session.snapshot().tree).not.toHaveProperty("view");

    expect(session.applyPatches(2, [{ op: "add", path: "/view", value: {} }])).toMatchObject({
      status: "rejected",
      revision: 2,
    });
    expect(session.snapshot().tree.nodes["message"]).toMatchObject({ value: "First writer" });
  });

  it("creates a safe new session and rejects an invalid clone", () => {
    const fresh = createSandboxSession({ id: "fresh", theme: DEFAULT_THEME });
    expect(fresh).toMatchObject({ ok: true, session: { id: "fresh" } });
    if (fresh.ok)
      expect(fresh.session.snapshot().tree.nodes["root"]).toMatchObject({ type: "box" });

    expect(
      createSandboxSession({
        id: "invalid",
        theme: DEFAULT_THEME,
        tree: { root: "missing", nodes: {} },
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid-tree" } });
  });
});
