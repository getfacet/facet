import { describe, expect, it } from "vitest";
import { extractJson } from "./generator.js";

const tree = { root: "root", nodes: { root: { id: "root", type: "box", children: [] } } };

describe("extractJson", () => {
  it("parses a clean tree", () => {
    expect(extractJson(JSON.stringify(tree))).toEqual(tree);
  });

  it("ignores a trailing sentence after the tree", () => {
    expect(extractJson(`${JSON.stringify(tree)}\n\nHere's your page!`)).toEqual(tree);
  });

  it("ignores prose before the tree", () => {
    expect(extractJson(`Sure, here you go:\n${JSON.stringify(tree)}`)).toEqual(tree);
  });

  it("strips markdown code fences", () => {
    expect(extractJson("```json\n" + JSON.stringify(tree) + "\n```")).toEqual(tree);
  });

  it("picks the stage tree over a leading preamble object", () => {
    // The regression: a small non-tree object emitted before the real tree made
    // the first-object extractor pick the wrong one, yielding an empty page.
    expect(extractJson(`{"thinking":"a coffee page"}\n${JSON.stringify(tree)}`)).toEqual(tree);
  });

  it("is not fooled by a brace inside a string value", () => {
    const withBrace = {
      root: "root",
      nodes: { root: { id: "root", type: "text", value: "a } b" } },
    };
    expect(extractJson(JSON.stringify(withBrace))).toEqual(withBrace);
  });

  it("throws when there is no object at all", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});
