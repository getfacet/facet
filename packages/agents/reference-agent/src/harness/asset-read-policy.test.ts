import { describe, expect, it } from "vitest";

import { EXACT_ASSET_READ_TOOL_NAMES, isExactAssetReadToolName } from "./asset-read-policy.js";

describe("exact asset-read policy", () => {
  it("owns the four exact discovery names and rejects generic tools from one source", () => {
    expect(EXACT_ASSET_READ_TOOL_NAMES).toEqual([
      "get_pattern",
      "get_preset",
      "get_brick_spec",
      "get_style_choices",
    ]);
    for (const name of EXACT_ASSET_READ_TOOL_NAMES) {
      expect(isExactAssetReadToolName(name)).toBe(true);
    }
    for (const name of ["inspect_stage", "set_node", "unknown"]) {
      expect(isExactAssetReadToolName(name)).toBe(false);
    }
  });
});
