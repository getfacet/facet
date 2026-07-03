import { describe, expect, it } from "vitest";
import type { FacetTree } from "@facet/core";
import { parseReply } from "./parse.js";

const TREE: FacetTree = {
  root: "root",
  nodes: {
    root: { id: "root", type: "box", children: ["greet"] },
    greet: { id: "greet", type: "text", value: "hello" },
  },
};

describe("parseReply", () => {
  it("salvages a fenced tree preceded by prose", () => {
    const text = [
      "Sure — here is the page you asked for:",
      "",
      "```json",
      JSON.stringify(TREE),
      "```",
      "",
      "Let me know if you want anything changed!",
    ].join("\n");
    expect(parseReply(text)).toEqual({ tree: TREE });
  });

  it("accepts a bare tree-shaped object as { tree }", () => {
    const reply = parseReply(JSON.stringify(TREE));
    expect(reply.say).toBeUndefined();
    expect(reply.tree).toEqual(TREE);
  });

  it("accepts a wrapper with say only", () => {
    expect(parseReply('{"say":"hi there"}')).toEqual({ say: "hi there" });
  });

  it("accepts a wrapper with both say and tree", () => {
    const text = JSON.stringify({ say: "done", tree: TREE });
    expect(parseReply(text)).toEqual({ say: "done", tree: TREE });
  });

  it("survives escaped quotes and brace characters inside JSON strings", () => {
    const text = `prefix {"say":"an \\"escaped\\" say with braces }} {{","tree":${JSON.stringify(TREE)}} suffix`;
    const reply = parseReply(text);
    expect(reply.say).toBe('an "escaped" say with braces }} {{');
    expect(reply.tree).toEqual(TREE);
  });

  it("throws on truncated input", () => {
    const truncated = JSON.stringify(TREE).slice(0, -8);
    expect(() => parseReply(truncated)).toThrow(/no usable JSON/i);
  });

  it("throws on garbage with no JSON object at all", () => {
    expect(() => parseReply("sorry, I cannot draw that page")).toThrow(/no usable JSON/i);
  });

  it("skips a non-tree JSON object and throws when nothing else is usable", () => {
    expect(() => parseReply('{"a":1}')).toThrow(/no usable JSON/i);
  });

  it("skips a non-tree JSON object and keeps scanning to a later tree", () => {
    const text = `{"a":1} then the real thing: ${JSON.stringify(TREE)}`;
    expect(parseReply(text)).toEqual({ tree: TREE });
  });

  it("rejects a wrapper whose tree is not tree-shaped", () => {
    expect(() => parseReply('{"say":"x","tree":{"a":1}}')).toThrow(/no usable JSON/i);
  });
});
