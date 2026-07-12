import { describe, expect, it } from "vitest";

import { stableJson } from "./stable-json.js";

describe("stableJson", () => {
  it("sorts object keys recursively while preserving array order", () => {
    expect(stableJson({ z: [{ b: 2, a: 1 }], a: { y: true, x: null } })).toBe(
      '{"a":{"x":null,"y":true},"z":[{"a":1,"b":2}]}',
    );
  });

  it("preserves the existing undefined and non-finite scalar encoding", () => {
    expect(stableJson(undefined)).toBe("undefined");
    expect(stableJson([undefined, Number.NaN])).toBe("[undefined,null]");
    expect(stableJson({ missing: undefined })).toBe('{"missing":undefined}');
  });
});
