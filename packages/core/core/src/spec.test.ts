import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BRICK_TYPES } from "./nodes.js";
import { STAGE_SPEC } from "./spec.js";

const ISSUE_SOURCE = readFileSync(new URL("./issues.ts", import.meta.url), "utf8");

describe("STAGE_SPEC", () => {
  it("teaches Pattern and Preset first, then two-step Brick style discovery", () => {
    const patternIndex = STAGE_SPEC.indexOf("Pattern index");
    const brickIndex = STAGE_SPEC.indexOf("Brick index");
    const presetIndex = STAGE_SPEC.indexOf("Preset index");

    expect(patternIndex).toBeGreaterThanOrEqual(0);
    expect(presetIndex).toBeGreaterThan(patternIndex);
    expect(brickIndex).toBeGreaterThan(presetIndex);
    expect(STAGE_SPEC).toMatch(/read one relevant Pattern[^.]*only when useful/i);
    expect(STAGE_SPEC).toMatch(
      /get_brick_spec[^.]*one unfamiliar Brick[^.]*fields[^.]*style paths/i,
    );
    expect(STAGE_SPEC).toMatch(
      /get_style_choices[^.]*directly choosing[^.]*Brick[^.]*path[^.]*allowed names[^.]*meanings/i,
    );
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
    expect(STAGE_SPEC).toMatch(/get_style_choices[^.]*property-local allowed choices/i);
    expect(STAGE_SPEC).toMatch(/never author raw CSS/i);
    expect(STAGE_SPEC).toMatch(/Theme[^.]*concrete CSS values/i);
    expect(STAGE_SPEC).toMatch(/light and dark/i);
    expect(STAGE_SPEC).toMatch(/colorMode[^.]*host\/client view state/i);
    expect(STAGE_SPEC).toMatch(/never Facet Document syntax/i);
  });

  it("keeps author rejection separate from the fail-safe renderer", () => {
    expect(STAGE_SPEC).toMatch(/invalid authoring call[^.]*whole call/i);
    expect(STAGE_SPEC).toMatch(/structured repair errors/i);
    expect(STAGE_SPEC).toMatch(/no patch/i);
    expect(STAGE_SPEC).toMatch(/retry/i);
    expect(STAGE_SPEC).toMatch(/bypassed[^.]*invalid style fragments/i);
    expect(STAGE_SPEC).toMatch(/valid Bricks and siblings continue/i);
  });

  it("requires page-change requests to mutate visibly after read-only preparation", () => {
    const preparation = STAGE_SPEC.indexOf("asset reads and inspections are preparation only");
    const mutation = STAGE_SPEC.indexOf("must call a mutation tool");
    const completion = STAGE_SPEC.indexOf(
      "must receive applied_visible before claiming completion",
    );

    expect(preparation).toBeGreaterThanOrEqual(0);
    expect(mutation).toBeGreaterThan(preparation);
    expect(completion).toBeGreaterThan(mutation);
    expect(STAGE_SPEC.slice(mutation, completion)).toContain(
      "render_page, set_node, append_node, or remove_node",
    );
    expect(STAGE_SPEC).toMatch(/no_stage_change[^.]*does not satisfy[^.]*page-change request/i);
    expect(STAGE_SPEC).toMatch(/factual or no-change request[^.]*does not require a mutation/i);
  });

  it("defines one safe bottom-up sequence for a new hierarchy", () => {
    const leaves = STAGE_SPEC.indexOf("create every unattached leaf with set_node");
    const boxes = STAGE_SPEC.indexOf("create inner boxes bottom-up with set_node");
    const attach = STAGE_SPEC.indexOf(
      "append_node the completed top node to the existing parent exactly once",
    );

    expect(leaves).toBeGreaterThanOrEqual(0);
    expect(boxes).toBeGreaterThan(leaves);
    expect(attach).toBeGreaterThan(boxes);
    expect(STAGE_SPEC).toMatch(
      /never append a descendant directly to the destination and also reference it from the new container/i,
    );
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
