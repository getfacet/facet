import { describe, expect, it } from "vitest";
import { SUBTITLES } from "./App.js";

describe("playground composition copy", () => {
  it("describes compositions as optional reference data", () => {
    expect(SUBTITLES.generated).toContain("Composition datasets are optional reference examples");
    expect(SUBTITLES.generated).toContain("component → primitive vocabulary");
    expect(SUBTITLES.generated).not.toContain("composition → component");
  });
});
