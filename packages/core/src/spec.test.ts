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

  it("documents theme select-by-name (a name, never a CSS value)", () => {
    // The tree-shape line carries an optional theme NAME slot.
    expect(STAGE_SPEC).toContain('"theme"?: "<theme name>"');
    // Select-by-name only: set it to a provided theme NAME, never a value.
    expect(STAGE_SPEC).toMatch(/only to a theme name/i);
    // The invariant: the model never writes CSS values; styles stay tokens.
    expect(STAGE_SPEC).toMatch(/never write CSS values/i);
    // Unknown / missing names fall back to the default look (fail-safe).
    expect(STAGE_SPEC).toMatch(/unknown[^.]*falls back to the default/i);
  });

  it("teaches collect and press-time field snapshots", () => {
    // Agent action shape gains an optional collect box id.
    expect(STAGE_SPEC).toContain('"collect"?:<boxId>');
    // Snapshot rule: pressing snapshots VISIBLE fields on the CURRENT screen
    // within the collect box's subtree into the event's "fields".
    expect(STAGE_SPEC).toMatch(/visible fields on the current screen/i);
    expect(STAGE_SPEC).toMatch(/subtree/i);
    expect(STAGE_SPEC).toContain('"fields"');
    // Values are keyed by each field's "name" — names must be stable.
    expect(STAGE_SPEC).toMatch(/keyed by each field's "name"/i);
    expect(STAGE_SPEC).toMatch(/stable names/i);
    // Keep a form and its submit button together and visible on one screen;
    // hidden fields, off-screen fields, and password fields are never captured.
    expect(STAGE_SPEC).toMatch(/submit button together/i);
    expect(STAGE_SPEC).toMatch(/never captured/i);
    expect(STAGE_SPEC).toMatch(/password fields/i);
  });
});
