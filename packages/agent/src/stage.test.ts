import { describe, expect, it } from "vitest";
import { Stage } from "./stage.js";

describe("Stage — ergonomic CLI over RFC 6902", () => {
  it("append emits an add-node op plus an add-child-ref op", () => {
    const stage = new Stage();
    stage.append("root", { id: "c", type: "text", value: "hi" });
    const messages = stage.flush();
    expect(messages).toHaveLength(1);
    const message = messages[0];
    expect(message?.kind).toBe("patch");
    if (message?.kind !== "patch") throw new Error("expected patch");
    expect(message.patches).toEqual([
      { op: "add", path: "/nodes/c", value: { id: "c", type: "text", value: "hi" } },
      { op: "add", path: "/nodes/root/children/-", value: "c" },
    ]);
  });

  it("render becomes a replace at the root path", () => {
    const stage = new Stage();
    stage.render({ root: "root", nodes: {} });
    const message = stage.flush()[0];
    if (message?.kind !== "patch") throw new Error("expected patch");
    expect(message.patches[0]).toEqual({ op: "replace", path: "", value: { root: "root", nodes: {} } });
  });

  it("say flushes queued patches first, preserving order", () => {
    const stage = new Stage();
    stage.set({ id: "a", type: "text", value: "x" }).say("done");
    expect(stage.flush().map((m) => m.kind)).toEqual(["patch", "say"]);
  });

  it("escapes ids in JSON pointers", () => {
    const stage = new Stage();
    stage.remove("a/b~c");
    const message = stage.flush()[0];
    if (message?.kind !== "patch") throw new Error("expected patch");
    expect(message.patches[0]).toEqual({ op: "remove", path: "/nodes/a~1b~0c" });
  });
});
