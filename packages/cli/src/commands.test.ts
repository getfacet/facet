import { describe, expect, it } from "vitest";
import { buildMessages } from "./commands.js";

describe("buildMessages", () => {
  it("render → a single replace-root patch", () => {
    const messages = buildMessages("render", [JSON.stringify({ root: "root", nodes: {} })]);
    expect(messages).toEqual([
      { kind: "patch", patches: [{ op: "replace", path: "", value: { root: "root", nodes: {} } }] },
    ]);
  });

  it("say → a say message", () => {
    expect(buildMessages("say", ["hello", "there"])).toEqual([
      { kind: "say", text: "hello there" },
    ]);
  });

  it("append → add node + add child-ref", () => {
    const [message] = buildMessages("append", [
      "root",
      JSON.stringify({ id: "a", type: "text", value: "x" }),
    ]);
    if (message?.kind !== "patch") throw new Error("expected a patch");
    expect(message.patches).toEqual([
      { op: "add", path: "/nodes/a", value: { id: "a", type: "text", value: "x" } },
      { op: "add", path: "/nodes/root/children/-", value: "a" },
    ]);
  });

  it("throws on a missing parent id for append", () => {
    expect(() => buildMessages("append", [])).toThrow(/parent id/);
  });

  it("throws on invalid JSON", () => {
    expect(() => buildMessages("render", ["{not json"])).toThrow(/invalid JSON/);
  });

  it("set → upsert-node patch", () => {
    const [message] = buildMessages("set", [JSON.stringify({ id: "a", type: "text", value: "x" })]);
    if (message?.kind !== "patch") throw new Error("expected a patch");
    expect(message.patches).toEqual([
      { op: "add", path: "/nodes/a", value: { id: "a", type: "text", value: "x" } },
    ]);
  });

  it("remove → remove-node patch", () => {
    const [message] = buildMessages("remove", ["a"]);
    if (message?.kind !== "patch") throw new Error("expected a patch");
    expect(message.patches).toEqual([{ op: "remove", path: "/nodes/a" }]);
  });

  it("throws on a missing node id for remove", () => {
    expect(() => buildMessages("remove", [])).toThrow(/node id/);
  });

  it("throws on an unknown command", () => {
    expect(() => buildMessages("frobnicate", [])).toThrow(/unknown command/);
  });
});
