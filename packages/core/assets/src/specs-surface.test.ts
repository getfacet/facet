import { readFileSync } from "node:fs";

import {
  BOUNDS,
  validateCatalog,
  validateComponentSpec,
  validateModalConformance,
} from "@facet/core";
import type { ComponentSpec } from "@facet/core";
import { describe, expect, it } from "vitest";

import { CARD_SPEC, EMPTY_SPEC, MODAL_SPEC, SURFACE_SPECS } from "./specs-surface.js";

/** The three scalar types an authored prop value may take. */
const SCALAR_TYPES: readonly string[] = ["string", "number", "boolean"];

/**
 * Prop names that would smuggle placement, stacking or coordinates into author
 * markup. Overlap belongs to the framework Modal frame alone, so no spec in
 * this group may declare one.
 */
const COORDINATE_PROP_NAMES: readonly string[] = [
  "x",
  "y",
  "top",
  "left",
  "right",
  "bottom",
  "zIndex",
  "layer",
  "elevation",
  "offsetX",
  "offsetY",
  "anchorX",
  "anchorY",
  "placement",
  "coordinates",
];

/** Authored values that would name a placement mode rather than flow content. */
const PLACEMENT_VALUES: readonly string[] = [
  "absolute",
  "fixed",
  "sticky",
  "overlay",
  "above",
  "behind",
  "front",
  "back",
];

/** Accepts, or fails with the structured rejection rather than a bare undefined. */
function accept(value: unknown): ComponentSpec {
  const result = validateComponentSpec(value);
  if (!result.ok) {
    throw new Error(`expected acceptance, got ${result.code} at ${result.at}: ${result.detail}`);
  }
  return result.spec;
}

/** The rejection code, or the sentinel `"accepted"` so a stray acceptance reads clearly. */
function rejectionCode(value: unknown): string {
  const result = validateComponentSpec(value);
  return result.ok ? "accepted" : result.code;
}

/** A spec as plain JSON — which also proves the declaration is serializable. */
function specRecord(spec: ComponentSpec): Record<string, unknown> {
  return JSON.parse(JSON.stringify(spec)) as Record<string, unknown>;
}

function readSource(file: string): string {
  return readFileSync(new URL(file, import.meta.url), "utf8");
}

/**
 * The smallest conforming `Screen` registration, declared here rather than
 * imported from the layout group.
 *
 * Every valid catalog carries exactly one `Screen` — the renderer mounts a
 * stored screen root like any other node — so a catalog assembled from surface
 * specs alone is incomplete by construction. This stub supplies that one member
 * and nothing else, which keeps the assertions below about Modal, Card and
 * Empty instead of about whatever the real `Screen` happens to declare.
 */
const SCREEN_STUB: Record<string, unknown> = {
  tag: "Screen",
  whenToUse: "The screen root a catalog must register, standing in for the real one.",
  props: {
    name: { type: "string", guidance: "The screen's name.", required: true },
  },
  acceptsChildren: true,
};

describe("surface specs — every spec is a valid component spec", () => {
  it("declares exactly Modal, Card and Empty, in that order", () => {
    expect(SURFACE_SPECS.map((spec) => spec.tag)).toEqual(["Modal", "Card", "Empty"]);
    expect(SURFACE_SPECS).toEqual([MODAL_SPEC, CARD_SPEC, EMPTY_SPEC]);
  });

  it.each(["Modal", "Card", "Empty"])("accepts the %s spec", (tag) => {
    const spec = SURFACE_SPECS.find((candidate) => candidate.tag === tag);
    expect(spec).toBeDefined();
    expect(accept(specRecord(spec as ComponentSpec)).tag).toBe(tag);
  });

  it("registers all three as ordinary members — no surface tag is a grammar position", () => {
    const result = validateCatalog({
      components: [SCREEN_STUB, ...SURFACE_SPECS.map(specRecord)],
    });
    expect(result.ok ? result.catalog.components.map((spec) => spec.tag) : result.code).toEqual([
      "Screen",
      "Modal",
      "Card",
      "Empty",
    ]);
  });

  it("is not a complete catalog on its own: the required Screen is what it lacks", () => {
    const result = validateCatalog({ components: SURFACE_SPECS.map(specRecord) });
    expect(result.ok ? ["accepted", ""] : [result.code, result.at]).toEqual([
      "missing_screen_spec",
      "components",
    ]);
  });

  it("survives a JSON round trip unchanged, because a spec travels to disk and to the agent", () => {
    for (const spec of SURFACE_SPECS) {
      expect(specRecord(spec)).toEqual(spec);
    }
  });

  it("takes children everywhere: each surface frames authored flow content", () => {
    for (const spec of SURFACE_SPECS) {
      expect(spec.acceptsChildren).toBe(true);
    }
  });
});

describe("Modal — the framework frame contract", () => {
  it("conforms: validateModalConformance accepts the registered spec", () => {
    const result = validateModalConformance(specRecord(MODAL_SPEC));
    expect(result.ok ? "conforms" : `${result.code} at ${result.at}`).toBe("conforms");
  });

  it("declares the two projected props as required strings with no default of its own", () => {
    for (const name of ["triggerLabel", "title"] as const) {
      const schema = MODAL_SPEC.props[name];
      expect(schema?.type).toBe("string");
      expect(schema?.required).toBe(true);
      expect(schema === undefined ? true : "default" in schema).toBe(false);
    }
  });

  it("owns no collected value — the frame owns the overlap, not a field", () => {
    expect(MODAL_SPEC.collect).toBeUndefined();
  });

  it("stops conforming if the projected optionality is relaxed — the pair is one edit apart", () => {
    const record = specRecord(MODAL_SPEC);
    const props = record["props"] as Record<string, Record<string, unknown>>;
    const title = props["title"] as Record<string, unknown>;
    delete title["required"];
    const result = validateModalConformance(record);
    expect(result.ok ? "conforms" : result.code).toBe("modal_prop_optionality_mismatch");
  });

  it("stops conforming if a projected prop is dropped", () => {
    const record = specRecord(MODAL_SPEC);
    delete (record["props"] as Record<string, unknown>)["triggerLabel"];
    const result = validateModalConformance(record);
    expect(result.ok ? "conforms" : result.code).toBe("modal_prop_omitted");
  });
});

describe("surface specs — content only, never coordinates", () => {
  it("declares no prop that could carry a coordinate, a layer or a placement", () => {
    for (const spec of SURFACE_SPECS) {
      for (const name of Object.keys(spec.props)) {
        expect({ tag: spec.tag, coordinate: COORDINATE_PROP_NAMES.includes(name) }).toEqual({
          tag: spec.tag,
          coordinate: false,
        });
      }
    }
  });

  it("offers no authored value that names a placement mode", () => {
    for (const spec of SURFACE_SPECS) {
      for (const [name, schema] of Object.entries(spec.props)) {
        const domain = "enum" in schema ? (schema.enum ?? []) : [];
        const declared = "default" in schema ? [...domain, schema.default] : domain;
        for (const value of declared) {
          const placement = PLACEMENT_VALUES.includes(String(value));
          expect({ at: `${spec.tag}.${name}`, placement }).toEqual({
            at: `${spec.tag}.${name}`,
            placement: false,
          });
        }
      }
    }
  });

  it("writes no CSS stacking or placement declaration into its source", () => {
    const source = readSource("./specs-surface.ts");
    for (const forbidden of ["zIndex", "z-index", "position:", "top:", "left:"]) {
      expect({ forbidden, present: source.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });
});

describe("surface specs — no prop accepts inline object or array JSON", () => {
  it("declares scalar props only: a structured prop is satisfiable by a binding alone", () => {
    for (const spec of SURFACE_SPECS) {
      for (const [name, schema] of Object.entries(spec.props)) {
        expect({ at: `${spec.tag}.${name}`, scalar: SCALAR_TYPES.includes(schema.type) }).toEqual({
          at: `${spec.tag}.${name}`,
          scalar: true,
        });
      }
    }
  });

  it("declares no bindable prop at all, so no value arrives from outside the markup", () => {
    for (const spec of SURFACE_SPECS) {
      for (const schema of Object.values(spec.props)) {
        expect(schema.bindable).toBeUndefined();
      }
    }
  });
});

describe("surface specs — every bound is respected", () => {
  it("keeps when-to-use inside B-12 and prop guidance inside B-13", () => {
    for (const spec of SURFACE_SPECS) {
      expect(spec.whenToUse.length).toBeGreaterThan(0);
      expect(spec.whenToUse.length).toBeLessThanOrEqual(BOUNDS.componentWhenToUseChars);
      for (const schema of Object.values(spec.props)) {
        expect(schema.guidance.length).toBeGreaterThan(0);
        expect(schema.guidance.length).toBeLessThanOrEqual(BOUNDS.propGuidanceChars);
      }
    }
  });

  it("keeps prop count inside B-10 and every enum domain inside B-11", () => {
    for (const spec of SURFACE_SPECS) {
      expect(Object.keys(spec.props).length).toBeLessThanOrEqual(BOUNDS.propsPerComponentSpec);
      for (const schema of Object.values(spec.props)) {
        const domain = "enum" in schema ? schema.enum : undefined;
        expect(domain === undefined ? 0 : domain.length).toBeLessThanOrEqual(
          BOUNDS.enumValuesPerProp,
        );
      }
    }
  });

  it("rejects a when-to-use one character past B-12 and accepts one exactly at it", () => {
    const atBound = specRecord(CARD_SPEC);
    atBound["whenToUse"] = "w".repeat(BOUNDS.componentWhenToUseChars);
    const overBound = specRecord(CARD_SPEC);
    overBound["whenToUse"] = "w".repeat(BOUNDS.componentWhenToUseChars + 1);
    expect(rejectionCode(atBound)).toBe("accepted");
    expect(rejectionCode(overBound)).toBe("when_to_use_too_long");
  });

  it("rejects prop guidance one character past B-13 and accepts one exactly at it", () => {
    const atBound = specRecord(EMPTY_SPEC);
    const atProps = atBound["props"] as Record<string, Record<string, unknown>>;
    (atProps["title"] as Record<string, unknown>)["guidance"] = "g".repeat(
      BOUNDS.propGuidanceChars,
    );
    const overBound = specRecord(EMPTY_SPEC);
    const overProps = overBound["props"] as Record<string, Record<string, unknown>>;
    (overProps["title"] as Record<string, unknown>)["guidance"] = "g".repeat(
      BOUNDS.propGuidanceChars + 1,
    );
    expect(rejectionCode(atBound)).toBe("accepted");
    expect(rejectionCode(overBound)).toBe("prop_guidance_too_long");
  });
});

describe("specs-surface.ts — source hygiene", () => {
  it("carries no NUL byte", () => {
    const bytes = readFileSync(new URL("./specs-surface.ts", import.meta.url));
    expect(bytes.indexOf(0)).toBe(-1);
  });

  it("imports nothing but @facet/core", () => {
    const source = readSource("./specs-surface.ts");
    const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    expect([...new Set(specifiers)]).toEqual(["@facet/core"]);
  });
});
