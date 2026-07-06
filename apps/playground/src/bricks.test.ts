import { readFileSync } from "node:fs";
import type { FacetTree } from "@facet/core";
import { describe, expect, it } from "vitest";
import { page, text } from "./bricks.js";
import { welcome } from "./ui.js";

// Frozen literal fixtures capturing the pre-migration @facet/kit output of the
// two playground faces (welcome in ui.ts, OFFLINE_FACE in server.ts). Inlined as
// literals — NOT imported from @facet/kit — so this byte-identical guarantee
// survives kit's deletion in WU-2. The whole point of the migration is that the
// local ./bricks.js helper emits these exact trees.

const WELCOME_SUBTITLE = "A subtitle line";

const WELCOME_FIXTURE: FacetTree = {
  root: "root",
  nodes: {
    k1: {
      id: "k1",
      type: "text",
      value: "What should this page be?",
      style: { size: "2xl", weight: "bold", align: "center" },
    },
    k2: {
      id: "k2",
      type: "text",
      value: WELCOME_SUBTITLE,
      style: { color: "fg-muted", align: "center" },
    },
    root: {
      id: "root",
      type: "box",
      style: { direction: "col", gap: "md", pad: "2xl" },
      children: ["k1", "k2"],
    },
  },
};

const OFFLINE_FIXTURE: FacetTree = {
  root: "root",
  nodes: {
    k1: {
      id: "k1",
      type: "text",
      value: "Nova is offline right now",
      style: { size: "2xl", weight: "bold", align: "center" },
    },
    k2: {
      id: "k2",
      type: "text",
      value: "This page's agent isn't connected — check back soon.",
      style: { color: "fg-muted", align: "center" },
    },
    root: {
      id: "root",
      type: "box",
      style: { direction: "col", gap: "lg", pad: "2xl" },
      children: ["k1", "k2"],
    },
  },
};

/** Rebuild the welcome face through the local helper (mirrors ui.ts). */
function buildWelcome(subtitle: string): FacetTree {
  return page(
    [
      text("What should this page be?", { size: "2xl", weight: "bold", align: "center" }),
      text(subtitle, { color: "fg-muted", align: "center" }),
    ],
    { gap: "md", pad: "2xl" },
  );
}

/** Rebuild OFFLINE_FACE through the local helper (mirrors server.ts). */
function buildOffline(): FacetTree {
  return page(
    [
      text("Nova is offline right now", { size: "2xl", weight: "bold", align: "center" }),
      text("This page's agent isn't connected — check back soon.", {
        color: "fg-muted",
        align: "center",
      }),
    ],
    { pad: "2xl" },
  );
}

describe("playground local bricks (page/text)", () => {
  it("rebuilds the welcome face byte-identical to the frozen kit fixture", () => {
    expect(buildWelcome(WELCOME_SUBTITLE)).toEqual(WELCOME_FIXTURE);
  });

  it("welcome() exported from ui.ts renders the frozen kit fixture", () => {
    expect(welcome(WELCOME_SUBTITLE)).toEqual(WELCOME_FIXTURE);
  });

  it("rebuilds OFFLINE_FACE byte-identical to the frozen kit fixture", () => {
    expect(buildOffline()).toEqual(OFFLINE_FIXTURE);
  });

  it("shares one flat-map authoring helper with the gallery", () => {
    const bricksSource = readFileSync(new URL("./bricks.ts", import.meta.url), "utf8");
    const gallerySource = readFileSync(new URL("./gallery.tsx", import.meta.url), "utf8");
    expect(bricksSource).toContain('from "./tree-builder.js"');
    expect(gallerySource).toContain('from "./tree-builder.js"');
    expect(bricksSource).not.toMatch(/class Builder/);
    expect(gallerySource).not.toMatch(/class Sheet/);
  });
});
