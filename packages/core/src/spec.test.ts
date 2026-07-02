import { describe, expect, it } from "vitest";
import { STAGE_SPEC } from "./spec.js";

describe("STAGE_SPEC", () => {
  it("teaches screens entry navigate toggle and hidden", () => {
    // Tree gains named screens + entry.
    expect(STAGE_SPEC).toContain('"screens"');
    expect(STAGE_SPEC).toContain('"entry"');
    // Box gains hidden + the onPress action union.
    expect(STAGE_SPEC).toContain('"hidden"');
    expect(STAGE_SPEC).toContain('"kind":"agent"');
    expect(STAGE_SPEC).toContain('"kind":"navigate"');
    expect(STAGE_SPEC).toContain('"kind":"toggle"');
    // The instant-in-browser rule: navigate/toggle run with no agent turn.
    expect(STAGE_SPEC).toMatch(/instantly in the (visitor'?s )?browser/i);
    expect(STAGE_SPEC).toMatch(/no agent turn/i);
  });
});
