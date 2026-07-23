import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BRICK_TYPES } from "./nodes.js";
import { STAGE_SPEC } from "./spec.js";

const ISSUE_SOURCE = readFileSync(new URL("./issues.ts", import.meta.url), "utf8");

describe("STAGE_SPEC", () => {
  it("teaches Pattern and Preset first, then Brick discovery without runner-specific tools", () => {
    const patternIndex = STAGE_SPEC.indexOf("Pattern index");
    const brickIndex = STAGE_SPEC.indexOf("Brick index");
    const presetIndex = STAGE_SPEC.indexOf("Preset index");

    expect(patternIndex).toBeGreaterThanOrEqual(0);
    expect(presetIndex).toBeGreaterThan(patternIndex);
    expect(brickIndex).toBeGreaterThan(presetIndex);
    expect(STAGE_SPEC).toMatch(/read one relevant Pattern[^.]*only when useful/i);
    expect(STAGE_SPEC).toMatch(/Brick index[^.]*eleven native Bricks/i);
    expect(STAGE_SPEC).toMatch(/exact fields[^.]*Brick specification/i);
    expect(STAGE_SPEC).toMatch(/inspect[^.]*Preset details/i);
    expect(STAGE_SPEC).toMatch(/Pattern[^.]*read-only design guidance/i);
    expect(STAGE_SPEC).toMatch(/re-author[^.]*ordinary native Bricks/i);
    expect(STAGE_SPEC).toMatch(/never automatically inserted/i);
    expect(STAGE_SPEC).toMatch(/never copy[^.]*content or actions blindly/i);

    for (const type of BRICK_TYPES) expect(STAGE_SPEC).toContain(type);
    expect(STAGE_SPEC).toMatch(/eleven native Bricks/i);
    expect(STAGE_SPEC).toMatch(/only box[^.]*children/i);
  });

  it("teaches the four style forms and their exact precedence", () => {
    expect(STAGE_SPEC).toMatch(/omit "style"[^.]*Theme default/i);
    expect(STAGE_SPEC).toContain(`"style":{"preset":"panel"}`);
    expect(STAGE_SPEC).toContain(`"style":{"gap":"lg"}`);
    expect(STAGE_SPEC).toContain(`"style":{"preset":"panel","gap":"lg"}`);
    expect(STAGE_SPEC).toMatch(/Theme default[^.]*Preset[^.]*direct style/i);
    expect(STAGE_SPEC).toMatch(/Preset first/i);
    expect(STAGE_SPEC).toMatch(/direct style[^.]*Pattern-specific layout/i);
    expect(STAGE_SPEC).toMatch(/direct style[^.]*override/i);
    expect(STAGE_SPEC).toMatch(/every Brick owns[^.]*style vocabulary/i);
    expect(STAGE_SPEC).toMatch(/targets[^.]*properties[^.]*states/i);
  });

  it("keeps authored values closed and concrete CSS Theme-only", () => {
    expect(STAGE_SPEC).toMatch(/style property/i);
    expect(STAGE_SPEC).toMatch(/token name/i);
    expect(STAGE_SPEC).toMatch(/fixed choice/i);
    expect(STAGE_SPEC).toMatch(/property-local allowed choices/i);
    expect(STAGE_SPEC).toMatch(/never author raw CSS/i);
    expect(STAGE_SPEC).toMatch(/Theme[^.]*concrete CSS values/i);
    expect(STAGE_SPEC).toMatch(/light and dark/i);
    expect(STAGE_SPEC).toMatch(/colorMode[^.]*host\/client view state/i);
    expect(STAGE_SPEC).toMatch(/never Facet Document syntax/i);
  });

  it("keeps author rejection separate from the fail-safe renderer", () => {
    expect(STAGE_SPEC).toMatch(/invalid document change[^.]*rejected whole/i);
    expect(STAGE_SPEC).toMatch(/structured repair issues/i);
    expect(STAGE_SPEC).toMatch(/no patch/i);
    expect(STAGE_SPEC).toMatch(/retry/i);
    expect(STAGE_SPEC).toMatch(/bypassed[^.]*invalid style fragments/i);
    expect(STAGE_SPEC).toMatch(/valid Bricks and siblings continue/i);
  });

  it("stays tool-neutral so every runner can embed it safely", () => {
    for (const runnerTerm of [
      "get_pattern",
      "get_preset",
      "get_brick_spec",
      "get_style_choices",
      "render_page",
      "set_node",
      "append_node",
      "remove_node",
      "no_stage_change",
      "applied_visible",
    ]) {
      expect(STAGE_SPEC).not.toContain(runnerTerm);
    }
  });

  it("teaches the current document and interaction boundaries compactly", () => {
    expect(STAGE_SPEC).toContain(`{"root":"root","nodes":{"<id>":<Brick>}}`);
    expect(STAGE_SPEC).toMatch(/screen roots[^.]*box/i);
    expect(STAGE_SPEC).toMatch(/flow-only/i);
    expect(STAGE_SPEC).toMatch(/RFC 6902/i);
    expect(STAGE_SPEC).toMatch(/never raw HTML, JavaScript, or CSS/i);
    expect(STAGE_SPEC).toMatch(/navigate and toggle[^.]*no agent turn/i);
    expect(STAGE_SPEC).toMatch(/backend work[^.]*agent/i);
    expect(STAGE_SPEC).toMatch(/no client-side fetch/i);
  });

  it("teaches product-grade media icon and text flow vocabulary", () => {
    expect(BRICK_TYPES).toEqual([
      "box",
      "text",
      "media",
      "input",
      "richtext",
      "table",
      "chart",
      "list",
      "keyValue",
      "progress",
      "loading",
    ]);
    expect(STAGE_SPEC).toMatch(/eleven native Bricks/i);
    expect(STAGE_SPEC).toMatch(/media\.kind[^.]*"icon"[^.]*MEDIA_ICON_NAMES/i);
    expect(STAGE_SPEC).toMatch(/never raw SVG[^.]*path[^.]*CSS/i);
    expect(STAGE_SPEC).toMatch(/text, list, richtext, and table[^.]*textWrap[^.]*lineClamp/i);
    expect(STAGE_SPEC).toMatch(/table columns[^.]*align/i);
    expect(STAGE_SPEC).toMatch(/chart series[^.]*lineStyle/i);
    expect(STAGE_SPEC).toMatch(/chart plot[^.]*axisColor[^.]*gridColor[^.]*labelColor[^.]*tokens/i);
    expect(STAGE_SPEC).toMatch(/custom assets[^.]*per-agent or per-user/i);
    expect(STAGE_SPEC).toMatch(/bundled defaults[^.]*fallback/i);
    expect(STAGE_SPEC).not.toMatch(/default Presets?[^.]*solve[^.]*benchmark quality/i);
    expect(STAGE_SPEC).not.toMatch(/default Patterns?[^.]*solve[^.]*benchmark quality/i);
  });

  it("enumerates the analytics-data-surface chart and table vocabulary", () => {
    for (const term of [
      "width",
      "narrow",
      "medium",
      "wide",
      "dividers",
      "none",
      "rows",
      "grid",
      "stickyHeader",
      "emptyLabel",
      "axis",
      "primary",
      "secondary",
    ]) {
      expect(STAGE_SPEC).toContain(term);
    }
    expect(STAGE_SPEC).toMatch(/table columns[^.]*width/i);
    expect(STAGE_SPEC).toMatch(/chart series[^.]*axis/i);
    // Existing closed-choice anchors must survive the extension.
    expect(STAGE_SPEC).toMatch(/table columns[^.]*align/i);
    expect(STAGE_SPEC).toMatch(/chart series[^.]*lineStyle/i);
  });

  it("names the box-layout-foundation capability without leaking resolved CSS", () => {
    for (const term of ["basis", "itemWidth", "maxHeight", "collapse", 'columns:"auto"']) {
      expect(STAGE_SPEC).toContain(term);
    }
    // The responsive-grid pairing, the bounded-viewport role, and collapse's
    // row-only scope are all stated in the closed-vocabulary prose.
    expect(STAGE_SPEC).toMatch(/columns:"auto"[^.]*itemWidth/i);
    expect(STAGE_SPEC).toMatch(/maxHeight[^.]*(?:scrolling|viewport)/i);
    expect(STAGE_SPEC).toMatch(/collapse[^.]*row/i);
    // No resolved CSS value (pixel/rem/viewport unit) leaks into the spec prose.
    expect(STAGE_SPEC).not.toMatch(/\b\d+(?:\.\d+)?(?:px|rem|em|svh|vh|vw)\b/i);
  });

  it("contains no retired style asset or selector guidance", () => {
    const retiredTerms = [
      ["cata", "log"].join(""),
      ["compo", "sition"].join(""),
      ["rec", "ipe"].join(""),
      ["vari", "ant"].join(""),
      ["active", "Style"].join(""),
      ["active", "Variant"].join(""),
      ["set", "_theme"].join(""),
      ["get", "_token"].join(""),
    ];
    for (const term of retiredTerms) {
      expect(STAGE_SPEC.toLowerCase()).not.toContain(term.toLowerCase());
    }
    expect(ISSUE_SOURCE.toLowerCase()).not.toContain(["compo", "sition"].join(""));

    expect(STAGE_SPEC).not.toMatch(/"theme"\s*:/i);
    expect(STAGE_SPEC).not.toMatch(/"scheme"\s*:/i);
    expect(STAGE_SPEC).not.toMatch(/"tone"\s*:/i);
    expect(STAGE_SPEC).not.toMatch(/"variant"\s*:/i);
    expect(STAGE_SPEC).not.toMatch(/"bg"\s*:/i);
    expect(STAGE_SPEC).not.toMatch(/"pad"\s*:/i);
    expect(STAGE_SPEC).not.toMatch(/renderer plugins|automatic insertion|raw scalar/i);
  });
});
