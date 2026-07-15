import { describe, expect, it } from "vitest";
import {
  BLOCK_TYPES,
  INPUT_KINDS,
  INTRINSIC_COMPONENT_TYPES,
  LEGACY_COMPONENT_TYPES,
  MARK_KINDS,
  PRIMITIVE_BRICK_TYPES,
} from "./nodes.js";
import { STAGE_SPEC } from "./spec.js";
import { APPEARS, COLUMNS, FONT_FAMILIES, SCROLL_AXES } from "./tokens.js";

// Legacy vocabulary is built at runtime so the removed tokens never appear as
// source literals (same idiom as theme.test.ts).
const legacy = ["st", "amp"].join("");
const legacyNaming = new RegExp(legacy, "i");

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

  it("brick-vocab v1 teaches media, native input kinds, columns, and scroll axes", () => {
    expect(STAGE_SPEC).toContain('"type":"media"');
    expect(STAGE_SPEC).toContain('"kind"');
    expect(STAGE_SPEC).toMatch(/"image"\|"video"/);
    expect(STAGE_SPEC).toMatch(/media:[^\n]*"variant"\?:name/);
    expect(STAGE_SPEC).toContain('"poster"?');
    expect(STAGE_SPEC).toContain('"controls"?');
    expect(STAGE_SPEC).toMatch(/MediaStyle/);

    expect(STAGE_SPEC).toMatch(/input:[^\n]*"variant"\?:name/);
    for (const input of INPUT_KINDS) {
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

  it("teaches the richtext brick shape: closed blocks, marks, and link kinds", () => {
    // DC-003/DC-006: STAGE_SPEC teaches the richtext primitive as a closed,
    // no-DSL vocabulary — the loop at :102-104 asserts the "type":"richtext"
    // token; these drift pins hold the shape (blocks/runs/marks/link) in sync
    // with nodes.ts so widening the brick set without teaching it fails here.
    expect(STAGE_SPEC).toContain('"type":"richtext"');
    // Flat blocks[] of the four closed block types.
    expect(STAGE_SPEC).toMatch(/richtext:[^\n]*"blocks"/);
    for (const block of BLOCK_TYPES) {
      expect(STAGE_SPEC).toContain(`"${block}"`);
    }
    // A run is { text, marks } and the marks are the closed semantic kinds.
    expect(STAGE_SPEC).toMatch(/"runs"/);
    expect(STAGE_SPEC).toMatch(/"text":string/);
    for (const mark of MARK_KINDS) {
      expect(STAGE_SPEC).toContain(`"${mark}"`);
    }
    // Marks are closed NAMES, never a parsed markup/markdown/CSS DSL.
    expect(STAGE_SPEC).toMatch(/never raw HTML, markdown, or CSS/i);
    // Link target: internal Action OR a gated external { href }.
    expect(STAGE_SPEC).toMatch(/"kind":"link"/);
    expect(STAGE_SPEC).toMatch(/"href"/);
    expect(STAGE_SPEC).toMatch(/navigated, never fetched/i);
    // Leaf + why it exists (mixed inline formatting the single-string text can't do).
    expect(STAGE_SPEC).toMatch(/single-string "text" node cannot express/i);
    expect(STAGE_SPEC).toMatch(/LEAF brick/i);
  });

  it("reference dataset hard cutover teaches optional reading followed by native authoring", () => {
    expect(STAGE_SPEC).toMatch(/component -> primitive fallback/);
    expect(STAGE_SPEC).toMatch(/primitive bricks/i);
    expect(STAGE_SPEC).toContain("box, text, media, input, richtext");
    for (const type of PRIMITIVE_BRICK_TYPES) {
      expect(STAGE_SPEC).toContain(`"type":"${type}"`);
    }
    expect(STAGE_SPEC).toMatch(/intrinsic components are locked/i);
    // "search" is retired as a node type by the input consolidation — STAGE_SPEC
    // no longer teaches a search node line (its type leaves ComponentNodeType in
    // WU-2). Cast to string[] so the literal filter stays legal once "search" is
    // gone from the type. "search + submit" is now an input+button composition.
    for (const type of INTRINSIC_COMPONENT_TYPES as readonly string[]) {
      if (type === "search") continue;
      expect(STAGE_SPEC).toContain(`"type":"${type}"`);
    }
    expect(STAGE_SPEC).not.toContain('"type":"search"');
    for (const type of LEGACY_COMPONENT_TYPES) {
      expect(STAGE_SPEC).toContain(`"type":"${type}"`);
    }
    expect(STAGE_SPEC).toMatch(/prefer metric/i);
    expect(STAGE_SPEC).toMatch(/stat[^.]*legacy/i);
    expect(STAGE_SPEC).toMatch(/Catalog/i);
    expect(STAGE_SPEC).toMatch(/optional reference dataset/i);
    expect(STAGE_SPEC).toMatch(/read[^.]*by name[^.]*only when useful/i);
    expect(STAGE_SPEC).toMatch(/author[^.]*native nodes/i);
    expect(STAGE_SPEC).toMatch(/reference read[^.]*does not mutate/i);
    expect(STAGE_SPEC).not.toMatch(
      new RegExp(["composition", "component", "primitive fallback"].join(" -> "), "i"),
    );
    expect(STAGE_SPEC).not.toContain(`"${["slo", "ts"].join("")}"`);
    expect(STAGE_SPEC).not.toMatch(/expanded? into|expand by name|filling[^.]*slots/i);
    expect(STAGE_SPEC).not.toContain(`{ "${["u", "se"].join("")}":"badge" }`);
    expect(STAGE_SPEC).not.toMatch(/high-level brick/i);
    expect(STAGE_SPEC).not.toMatch(new RegExp(`${legacy} -> high-level`, "i"));
  });

  it("omits demoted display leaves as node types and teaches native construction", () => {
    for (const type of ["badge", "alert", "divider"] as const) {
      expect(STAGE_SPEC).not.toContain(`"type":"${type}"`);
      expect(STAGE_SPEC).not.toContain(`- ${type}:`);
      expect(INTRINSIC_COMPONENT_TYPES as readonly string[]).not.toContain(type);
    }
    // These display shapes are authored from the native vocabulary, never as node types.
    expect(STAGE_SPEC).not.toContain("divider");
    expect(STAGE_SPEC).toMatch(/Badges and alerts are NOT node types/i);
    expect(STAGE_SPEC).toMatch(/author[^.]*native/i);
    expect(STAGE_SPEC).toMatch(/use a plain box/i);
  });

  it("documents composition and renderer layout boundaries without backend bindings", () => {
    expect(STAGE_SPEC).toMatch(/composition/i);
    expect(STAGE_SPEC).toMatch(/validated nodes/i);
    expect(STAGE_SPEC).toMatch(/loaded as assets/i);
    expect(STAGE_SPEC).toMatch(/renderer layout contract/i);
    expect(STAGE_SPEC).toMatch(/parent[^.]*placement/i);
    expect(STAGE_SPEC).toMatch(/component[^.]*internal layout/i);
    expect(STAGE_SPEC).toMatch(/bounded overflow/i);
    expect(STAGE_SPEC).toMatch(/flow-only/i);
    expect(STAGE_SPEC).toMatch(/no client-side fetch/i);
    expect(STAGE_SPEC).toMatch(/backend[^.]*agent/i);
    expect(STAGE_SPEC).not.toMatch(/<script|innerHTML|dangerouslySetInnerHTML/i);
    expect(STAGE_SPEC).not.toMatch(/position:\s*absolute/i);
  });

  it("teaches the safe data warehouse + from binding (names only, no fetch/compute)", () => {
    // The vocabulary now supports data binding — but only the safe, names-only
    // kind (no URL/endpoint/query/expression/resolver, no computed column).
    expect(STAGE_SPEC).toMatch(/"data"\??:\s*{/); // the top-level warehouse shape
    expect(STAGE_SPEC).toMatch(/"from"\??:datasetName/); // binding field on nodes
    expect(STAGE_SPEC).toMatch(/author once, bind many/i);
    expect(STAGE_SPEC).toMatch(/"from" wins over inline/i);
    expect(STAGE_SPEC).toMatch(/never a URL\/endpoint\/query\/expression\/resolver/i);
    expect(STAGE_SPEC).toMatch(/no fetch or computed column/i);
  });

  it("keeps reference guidance tool-neutral with no functional composition vocabulary", () => {
    expect(STAGE_SPEC).not.toMatch(legacyNaming);
    expect(STAGE_SPEC).toMatch(/concrete native node examples/i);
    expect(STAGE_SPEC).toMatch(/optional design guidance/i);
    expect(STAGE_SPEC).not.toMatch(/renderer plugins|automatic insertion/i);
    // Tool-neutral: embedding surfaces add concrete read and write tool instructions.
    for (const toolName of [
      "render_page",
      "set_node",
      "append_node",
      "remove_node",
      ["use", "composition"].join("_"),
      ["get", "composition"].join("_"),
      `use_${legacy}`,
      "set_theme",
      "inspect_stage",
      "inspect_node",
    ]) {
      expect(STAGE_SPEC).not.toContain(toolName);
    }
  });

  it("landing-grade-vocab teaches the new landing tokens + backdrop, names only", () => {
    // DC-007: STAGE_SPEC teaches the landing-grade vocabulary as CLOSED token
    // NAMES (resolved by the theme) — never raw CSS values.
    // FontSize enumeration extended with the three large display sizes.
    expect(STAGE_SPEC).toContain("size(xs|sm|md|lg|xl|2xl|3xl|4xl|5xl|6xl)");
    // New BoxStyle tokens (closed sets, names only).
    expect(STAGE_SPEC).toContain("minHeight(auto|half|screen)");
    expect(STAGE_SPEC).toContain("maxWidth(none|prose|narrow|wide)");
    expect(STAGE_SPEC).toContain("sticky(bool)");
    expect(STAGE_SPEC).toContain("gradient(none|accent|dusk|dawn)");
    expect(STAGE_SPEC).toContain("backdropScrim(none|light|dark)");
    expect(STAGE_SPEC).toMatch(/scrim/i);
    expect(STAGE_SPEC).toContain("scheme(light|dark)");
    // New TextStyle tokens.
    expect(STAGE_SPEC).toContain("tracking(tight|normal|wide)");
    expect(STAGE_SPEC).toContain("leading(tight|normal|relaxed)");
    expect(STAGE_SPEC).toContain("highlight(none|accent|band)");
    // Box gains a backdrop attribute referencing a media node id.
    expect(STAGE_SPEC).toContain('"backdrop"?');
    expect(STAGE_SPEC).toMatch(/backdrop[^.]*media node/i);
    expect(STAGE_SPEC).toMatch(/background layer/i);
    // Teaching note: these are landing/hero token names resolved by the theme.
    expect(STAGE_SPEC).toMatch(/landing/i);
    expect(STAGE_SPEC).toMatch(/hero/i);
    // The invariant survives: styles stay tokens, never raw CSS values.
    expect(STAGE_SPEC).toMatch(/Style values MUST be tokens/i);
    expect(STAGE_SPEC).toMatch(/never pixels or hex/i);
    // No raw CSS values leak into the teaching (names only).
    expect(STAGE_SPEC).not.toMatch(/100svh|50svh|65ch/);
    expect(STAGE_SPEC).not.toMatch(/linear-gradient\(/);
    expect(STAGE_SPEC).not.toMatch(/#[0-9a-fA-F]{6}/);
    expect(STAGE_SPEC).not.toMatch(/position:\s*sticky/i);
  });

  it("teaches collect and press-time field snapshots", () => {
    // Agent action shape gains an optional collect container id.
    expect(STAGE_SPEC).toContain('"collect"?:<containerId>');
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

  it("teaches the overlay box capability: closed kind set, renderer-owned placement, toggle open/close, no coords", () => {
    // DC-007: STAGE_SPEC teaches overlay on box as CLOSED names only — a box
    // floats ABOVE flow as a modal or drawer; the renderer owns placement/scrim/
    // z/focus and the author gives ONLY "kind" (never coordinates/size/z).
    expect(STAGE_SPEC).toContain('"overlay"?');
    expect(STAGE_SPEC).toContain('"modal"');
    expect(STAGE_SPEC).toContain('"drawer"');
    expect(STAGE_SPEC).toMatch(/overlay/i);
    // Renderer owns the float mechanics; author supplies only the kind.
    expect(STAGE_SPEC).toMatch(/renderer owns placement/i);
    expect(STAGE_SPEC).toMatch(/never coordinates/i);
    // Open/close reuses the EXISTING toggle action on the box id — no agent turn.
    expect(STAGE_SPEC).toMatch(/toggle/i);
    expect(STAGE_SPEC).toMatch(/no agent turn/i);
  });

  it("teaches store-bound text and the closed active-look predicate", () => {
    // DC-001: text becomes a from-bindable node reading ONE cell via from+column+row.
    expect(STAGE_SPEC).toMatch(/text:[^\n]*"from"\?:datasetName/);
    expect(STAGE_SPEC).toMatch(/text:[^\n]*"column"\?:name/);
    expect(STAGE_SPEC).toMatch(/text:[^\n]*"row"\?:number/);
    // The data-binding paragraph lists text in the from-bindable family.
    expect(STAGE_SPEC).toMatch(/metric\/stat\/text reads ONE cell/i);
    // DC-006: the active-look predicate is a CLOSED union — screen | toggled —
    // preferring activeVariant, and an unknown/dangling predicate keeps the default look.
    expect(STAGE_SPEC).toContain('"activeVariant"?');
    expect(STAGE_SPEC).toContain('"activeStyle"?');
    expect(STAGE_SPEC).toContain('"active"?');
    expect(STAGE_SPEC).toMatch(/\{\s*"screen":/);
    expect(STAGE_SPEC).toMatch(/\{\s*"toggled":/);
    expect(STAGE_SPEC).toMatch(/prefer[^.]*activeVariant/i);
    expect(STAGE_SPEC).toMatch(/unknown[^.]*default look/i);
    // Read-only: evaluating the active look runs no agent turn / fires no event.
    expect(STAGE_SPEC).toMatch(/read-only/i);
    expect(STAGE_SPEC).toMatch(/no agent turn/i);
  });
});
