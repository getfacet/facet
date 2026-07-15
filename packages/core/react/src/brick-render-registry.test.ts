import { BRICK_TYPES } from "@facet/core";
import { describe, expect, it } from "vitest";
import { BRICK_RENDERERS, brickRendererEntry } from "./brick-render-registry.js";

const BESPOKE_BRICKS = ["box", "text", "media", "richtext"] as const;
const REGISTERED_BRICKS = [
  "table",
  "chart",
  "list",
  "keyValue",
  "progress",
  "loading",
  "input",
] as const;
const RETIRED_BRICKS = ["button", "tabs", "nav", "metric", "stat", "form", "filterBar"];

describe("BRICK_RENDERERS", () => {
  it("has exactly one entry per drawable final brick", () => {
    expect(Object.keys(BRICK_RENDERERS).sort()).toEqual([...REGISTERED_BRICKS].sort());

    const accountedFor = [...BESPOKE_BRICKS, ...Object.keys(BRICK_RENDERERS)];
    expect(accountedFor).toHaveLength(BRICK_TYPES.length);
    expect(new Set(accountedFor).size).toBe(BRICK_TYPES.length);
    expect(accountedFor.sort()).toEqual([...BRICK_TYPES].sort());
  });

  it("keeps only final leaf bricks in the registry", () => {
    for (const type of REGISTERED_BRICKS) {
      expect(Object.hasOwn(BRICK_RENDERERS, type), type).toBe(true);
      expect(BRICK_RENDERERS[type].motionSnapshot, type).toBe(type !== "input");
    }
    for (const type of RETIRED_BRICKS) {
      expect(brickRendererEntry(type), type).toBeUndefined();
    }
  });
});

describe("brickRendererEntry prototype-chain lookup guard", () => {
  it("returns undefined for Object.prototype member names", () => {
    for (const junk of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
      expect(brickRendererEntry(junk), junk).toBeUndefined();
    }
  });
});
