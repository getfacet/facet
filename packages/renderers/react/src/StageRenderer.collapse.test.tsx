// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { FacetNode, FacetTree, NodeId } from "@facet/core";
import { StageRenderer } from "./StageRenderer.js";
import { COLLAPSE_CLASS, COLLAPSE_CSS, COLLAPSE_ITEM_CLASS } from "./collapse-style.js";

// WU-7 (box-layout-foundation): the collapse EMISSION CHANNEL — the class lands on
// the collapsible row, one gated COLLAPSE_CSS <style> slot ships when (and only
// when) the tree uses collapse, and a basis-carrying child gets the item marker
// while a basis-less sibling does not. jsdom applies a `@media` block to
// getComputedStyle ONLY when its media list literally contains `screen`, so a
// `(max-width: 639px)` block is never applied here — this file therefore proves
// the emission channel, NEVER the narrow reflow (WU-12's 390x844 journey owns that).

const tree = (nodes: Record<NodeId, FacetNode>, root: NodeId = "root"): FacetTree => ({
  root,
  nodes,
});
const text = (id: NodeId, value: string): FacetNode => ({ id, type: "text", value });
const box = (
  id: NodeId,
  opts: {
    children?: readonly NodeId[];
    style?: unknown;
    activeWhen?: unknown;
  } = {},
): FacetNode =>
  ({
    id,
    type: "box",
    children: opts.children ?? [],
    ...(opts.style === undefined ? {} : { style: opts.style }),
    ...(opts.activeWhen === undefined ? {} : { activeWhen: opts.activeWhen }),
  }) as FacetNode;
const icon = (id: NodeId): FacetNode =>
  ({ id, type: "media", kind: "icon", icon: "check", alt: "" }) as FacetNode;

const renderStage = (t: FacetTree): HTMLElement =>
  render(createElement(StageRenderer, { tree: t })).container;

// Every `<style>` slot whose text is EXACTLY the framework collapse stylesheet.
// Distinct from the BRICK_STATE/APPEAR/MOTION slots, which carry other text.
const collapseStyleSlots = (container: HTMLElement): HTMLStyleElement[] =>
  [...container.querySelectorAll("style")].filter(
    (node): node is HTMLStyleElement => node.textContent === COLLAPSE_CSS,
  );

describe("StageRenderer collapse emission channel (jsdom)", () => {
  afterEach(cleanup);

  it("emits COLLAPSE_CLASS on a collapse:stack direction:row box and exactly one COLLAPSE_CSS <style> slot (R10)", () => {
    const container = renderStage(
      tree({
        root: box("root", {
          children: ["copy"],
          style: { direction: "row", collapse: "stack" },
        }),
        copy: text("copy", "content"),
      }),
    );
    expect(container.querySelector(`.${COLLAPSE_CLASS}`)).not.toBeNull();
    // Gated ONE-per-stage slot (R10): not appended to the unconditional BRICK_STATE_CSS.
    expect(collapseStyleSlots(container)).toHaveLength(1);
  });

  it("marks a basis-carrying child with COLLAPSE_ITEM_CLASS while a basis-less icon sibling stays unmarked (R8b DOM blast-radius)", () => {
    const container = renderStage(
      tree({
        root: box("root", {
          children: ["pane", "glyph"],
          style: { direction: "row", collapse: "stack" },
        }),
        // A basis-carrying pane box — the ONLY node whose main-axis sizing this
        // feature authored, so the ONLY node that may carry the item marker.
        pane: box("pane", { children: ["paneText"], style: { basis: "sm" } }),
        paneText: text("paneText", "pane"),
        // A renderer-owned icon media root (renderer-media.tsx:84 iconFrameStyle):
        // a real direct DOM child of the collapse row, and it must NOT be reached.
        glyph: icon("glyph"),
      }),
    );
    // Exactly one carrier — pins the blast radius on the DOM, not just the CSS
    // string: the media icon sibling is excluded by construction (no basis).
    const marked = container.querySelectorAll(`.${COLLAPSE_ITEM_CLASS}`);
    expect(marked).toHaveLength(1);
    // The single carrier is the pane box (a <div>), not the icon.
    expect(screen.getByText("pane").closest(`.${COLLAPSE_ITEM_CLASS}`)).not.toBeNull();
    expect(marked[0]?.tagName).toBe("DIV");
  });

  it("emits NO collapse class and NO collapse <style> for a tree without a collapsible row (DC-006 byte-identity)", () => {
    const container = renderStage(
      tree({
        root: box("root", { children: ["copy"], style: { direction: "column", gap: "md" } }),
        copy: text("copy", "content"),
      }),
    );
    // `facet-collapse` prefixes BOTH marker classes AND the CSS selector, so a
    // single substring check proves nothing collapse-related was emitted.
    expect(container.innerHTML).not.toContain("facet-collapse");
    expect(collapseStyleSlots(container)).toHaveLength(0);
  });

  it("emits nothing for collapse:none, collapse on a column box, and collapse on a columns:auto grid (R1 / R7 fail-soft)", () => {
    for (const style of [
      { direction: "row", collapse: "none" },
      { direction: "column", collapse: "stack" },
      { direction: "row", collapse: "stack", columns: "auto", itemWidth: "md" },
    ]) {
      cleanup();
      const container = renderStage(
        tree({
          root: box("root", { children: ["copy"], style }),
          copy: text("copy", "content"),
        }),
      );
      expect(container.querySelector(`.${COLLAPSE_CLASS}`)).toBeNull();
      expect(collapseStyleSlots(container)).toHaveLength(0);
    }
  });

  it("resolves collapse/basis supplied through the style.active layer — class + gated slot both come from the post-active resolved style, nothing throws (R11)", () => {
    const activeTree: FacetTree = {
      ...tree({
        root: box("root", { children: ["row"] }),
        // collapse arrives from the active layer; direction:row is the base.
        row: box("row", {
          children: ["pane"],
          activeWhen: { screen: "home" },
          style: { direction: "row", active: { collapse: "stack" } },
        }),
        // basis arrives from the active layer too — item marker recomputes post-active.
        pane: box("pane", {
          children: ["paneText"],
          activeWhen: { screen: "home" },
          style: { active: { basis: "sm" } },
        }),
        paneText: text("paneText", "pane"),
      }),
      screens: { home: "root" },
      entry: "home",
    };
    let container: HTMLElement | undefined;
    expect(() => {
      container = renderStage(activeTree);
    }).not.toThrow();
    expect(container?.querySelector(`.${COLLAPSE_CLASS}`)).not.toBeNull();
    expect(container?.querySelector(`.${COLLAPSE_ITEM_CLASS}`)).not.toBeNull();
    expect(collapseStyleSlots(container as HTMLElement)).toHaveLength(1);
  });

  it("still emits COLLAPSE_CLASS on a box resolving direction:row AND collapse:stack — collapse wins by design (R9 conflict precedence)", () => {
    // collapse from the active layer, direction:row freshly authored in the base:
    // below the breakpoint the !important media rule is authoritative over the
    // inline flexDirection, so the row must still receive the class.
    const conflictTree: FacetTree = {
      ...tree({
        root: box("root", { children: ["row"] }),
        row: box("row", {
          children: ["copy"],
          activeWhen: { screen: "home" },
          style: { direction: "row", active: { collapse: "stack" } },
        }),
        copy: text("copy", "content"),
      }),
      screens: { home: "root" },
      entry: "home",
    };
    const container = renderStage(conflictTree);
    expect(container.querySelector(`.${COLLAPSE_CLASS}`)).not.toBeNull();
  });
});

// R6 red-check owner (invariant #6): collapse is CSS-ONLY. This source-scan is the
// executable ban — NOT a DoD checkbox — mirroring StageRenderer.view.test.tsx's
// fence: it reads module source as text and proves the collapse path adds no JS
// resize listener, no matchMedia read, and no new React state. Whole-file scans
// for the two hook-free modules; a marker-anchored region scan for the two files
// that legitimately use hooks ELSEWHERE (renderer-render.tsx / StageRenderer.tsx).
describe("collapse is CSS-only — no JS layout writer (R6 source-scan)", () => {
  const SRC_DIR = dirname(fileURLToPath(import.meta.url));
  const readSrc = (name: string): string => readFileSync(join(SRC_DIR, name), "utf8");
  const FORBIDDEN = ["matchMedia", 'addEventListener("resize"', "useState", "useEffect"] as const;
  // Strip block + line comments before scanning: the ban is on collapse CODE, not
  // on prose. collapse-style.ts's own doc comment legitimately NAMES `matchMedia`
  // while documenting its absence — the executable ban must read the code only.
  const codeOf = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const expectClean = (region: string): void => {
    const code = codeOf(region);
    for (const forbidden of FORBIDDEN) {
      expect(code).not.toContain(forbidden);
    }
  };

  it("collapse-style.ts contains no matchMedia, resize listener, or React state", () => {
    expectClean(readSrc("collapse-style.ts"));
  });

  it("brick-style-layout.ts (the class-join site) contains no matchMedia, resize listener, or React state", () => {
    expectClean(readSrc("brick-style-layout.ts"));
  });

  it("the collapse-touched region of renderer-render.tsx adds no matchMedia, resize listener, or React state", () => {
    const src = readSrc("renderer-render.tsx");
    // Explicit literal anchors: from the appear flip (where the sibling collapse
    // flip lives) to the layoutBoxTargetStyle call — the whole collapse touch.
    const start = src.indexOf("if (appear !== undefined)");
    const end = src.indexOf("const boxTarget = layoutBoxTargetStyle");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expectClean(src.slice(start, end));
  });

  it("the collapse-touched region of StageRenderer.tsx adds no matchMedia, resize listener, or React state", () => {
    const src = readSrc("StageRenderer.tsx");
    // Explicit literal anchors: from the stageCssSeen flag init through the gated
    // <style> slots — the flag object and the collapse slot both live here.
    const start = src.indexOf("const stageCssSeen");
    const end = src.indexOf("if (onAction === undefined)");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expectClean(src.slice(start, end));
  });
});
