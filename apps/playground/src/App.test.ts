import { describe, expect, it } from "vitest";
import { SUBTITLES } from "./App.js";

describe("playground brick and reference copy", () => {
  it("describes the closed brick vocabulary and optional reference data", () => {
    expect(SUBTITLES.generated).toContain("closed brick vocabulary");
    expect(SUBTITLES.generated).toContain("Optional reference datasets");
  });
});
