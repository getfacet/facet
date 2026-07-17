import { readFileSync } from "node:fs";
import type { FacetTree } from "@facet/core";
import { describe, expect, it } from "vitest";
import { page, text } from "./bricks.js";
import { welcome } from "./ui.js";

// Frozen literal fixtures for the playground's local authored Brick syntax.
// The helper must emit these exact plain trees without a compatibility mapper.

const WELCOME_SUBTITLE = "A subtitle line";

const WELCOME_FIXTURE: FacetTree = {
  root: "root",
  nodes: {
    k1: {
      id: "k1",
      type: "text",
      value: "What should this page be?",
      style: { fontSize: "2xl", fontWeight: "bold", textAlign: "center" },
    },
    k2: {
      id: "k2",
      type: "text",
      value: WELCOME_SUBTITLE,
      style: { color: "mutedForeground", textAlign: "center" },
    },
    root: {
      id: "root",
      type: "box",
      style: { direction: "column", gap: "md", padding: "2xl" },
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
      style: { fontSize: "2xl", fontWeight: "bold", textAlign: "center" },
    },
    k2: {
      id: "k2",
      type: "text",
      value: "This page's agent isn't connected — check back soon.",
      style: { color: "mutedForeground", textAlign: "center" },
    },
    root: {
      id: "root",
      type: "box",
      style: { direction: "column", gap: "lg", padding: "2xl" },
      children: ["k1", "k2"],
    },
  },
};

/** Rebuild the welcome face through the local helper (mirrors ui.ts). */
function buildWelcome(subtitle: string): FacetTree {
  return page(
    [
      text("What should this page be?", {
        fontSize: "2xl",
        fontWeight: "bold",
        textAlign: "center",
      }),
      text(subtitle, { color: "mutedForeground", textAlign: "center" }),
    ],
    { gap: "md", padding: "2xl" },
  );
}

/** Rebuild OFFLINE_FACE through the local helper (mirrors server.ts). */
function buildOffline(): FacetTree {
  return page(
    [
      text("Nova is offline right now", {
        fontSize: "2xl",
        fontWeight: "bold",
        textAlign: "center",
      }),
      text("This page's agent isn't connected — check back soon.", {
        color: "mutedForeground",
        textAlign: "center",
      }),
    ],
    { padding: "2xl" },
  );
}

describe("playground local bricks (page/text)", () => {
  it("builds only current authored style syntax", () => {
    expect(buildWelcome(WELCOME_SUBTITLE)).toEqual(WELCOME_FIXTURE);
    expect(buildOffline()).toEqual(OFFLINE_FIXTURE);

    const source = [
      readFileSync(new URL("./bricks.ts", import.meta.url), "utf8"),
      readFileSync(new URL("./nova.ts", import.meta.url), "utf8"),
      readFileSync(new URL("./server.ts", import.meta.url), "utf8"),
      readFileSync(new URL("./tree-builder.ts", import.meta.url), "utf8"),
      readFileSync(new URL("./ui.ts", import.meta.url), "utf8"),
    ].join("\n");
    expect(source).not.toMatch(/\b(?:size|weight|align|bg|pad|radius|border)\s*:/);
    expect(source).not.toMatch(/"(?:col|fg|fg-muted|accent-fg)"/);
  });

  it("rebuilds the welcome face byte-identical to the current fixture", () => {
    expect(buildWelcome(WELCOME_SUBTITLE)).toEqual(WELCOME_FIXTURE);
  });

  it("welcome() exported from ui.ts renders the current fixture", () => {
    expect(welcome(WELCOME_SUBTITLE)).toEqual(WELCOME_FIXTURE);
  });

  it("rebuilds OFFLINE_FACE byte-identical to the current fixture", () => {
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
