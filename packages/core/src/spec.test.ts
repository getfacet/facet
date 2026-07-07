import { describe, expect, it } from "vitest";
import { FIELD_INPUTS } from "./nodes.js";
import { STAGE_SPEC } from "./spec.js";
import { APPEARS, COLUMNS, FONT_FAMILIES, SCROLL_AXES } from "./tokens.js";

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

  it("teaches appear onHold and scroll", () => {
    // BoxStyle gains the two new tokens. The appear assertion is BUILT from
    // core's APPEARS so the spec teaches every current token — extending the
    // palette without updating STAGE_SPEC fails here, not silently.
    expect(STAGE_SPEC).toContain(`appear(${APPEARS.join("|")})`);
    expect(STAGE_SPEC).toContain(`scroll(${SCROLL_AXES.join("|")})`);
    expect(STAGE_SPEC).not.toMatch(/scroll\(bool\)/);
    // appear = enter animation: replays on each re-show; renderer honors reduced motion.
    expect(STAGE_SPEC).toMatch(/replays on each re-show/i);
    expect(STAGE_SPEC).toMatch(/reduced motion/i);
    // scroll = bounded, internally-scrollable region; the renderer owns the height
    // (a framework constant — no FacetTheme surface exists for it, RISK-API-5).
    expect(STAGE_SPEC).toMatch(/bounded, internally-scroll/i);
    expect(STAGE_SPEC).toMatch(/renderer owns the max height/i);
    // Box gains onHold — the secondary long-press gesture, same Action union as onPress.
    expect(STAGE_SPEC).toContain('"onHold"?:Action');
    expect(STAGE_SPEC).toMatch(/long-press/i);
    expect(STAGE_SPEC).toMatch(/secondary/i);
    expect(STAGE_SPEC).toMatch(/same Action union as onPress/i);
    // The advice (guidance, not enforcement — invariant #2): never hold-only content.
    expect(STAGE_SPEC).toMatch(/never make hold the only path/i);
  });

  it("teaches text font family tokens without raw font-family values", () => {
    expect(STAGE_SPEC).toContain(`family(${FONT_FAMILIES.join("|")})`);
    expect(STAGE_SPEC).toMatch(/Style values MUST be tokens/i);
    expect(STAGE_SPEC).toMatch(/never pixels or hex/i);
    expect(STAGE_SPEC).not.toContain("font-family:");
    expect(STAGE_SPEC).not.toContain("system-ui");
    expect(STAGE_SPEC).not.toContain("fontFamily");
  });

  it("brick-vocab v1 teaches media, native field inputs, columns, and scroll axes", () => {
    expect(STAGE_SPEC).toContain('"type":"media"');
    expect(STAGE_SPEC).toContain('"kind"');
    expect(STAGE_SPEC).toMatch(/"image"\|"video"/);
    expect(STAGE_SPEC).toContain('"poster"?');
    expect(STAGE_SPEC).toContain('"controls"?');
    expect(STAGE_SPEC).toMatch(/MediaStyle/);

    for (const input of FIELD_INPUTS) {
      expect(STAGE_SPEC).toContain(`"${input}"`);
    }
    expect(STAGE_SPEC).toContain('"options"?');
    expect(STAGE_SPEC).toMatch(/select/i);
    expect(STAGE_SPEC).toMatch(/checkbox/i);
    expect(STAGE_SPEC).toMatch(/radio/i);
    expect(STAGE_SPEC).toMatch(/switch/i);

    expect(STAGE_SPEC).toContain(`columns(${COLUMNS.join("|")})`);
    expect(STAGE_SPEC).toContain(`scroll(${SCROLL_AXES.join("|")})`);
    expect(STAGE_SPEC).not.toMatch(/ImageStyle/);
    expect(STAGE_SPEC).not.toContain('"type":"image"');
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
