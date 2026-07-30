import { readFileSync } from "node:fs";

import {
  BOUNDS,
  parseMarkup,
  validateAuthorMarkup,
  validateCatalog,
  validateComponentSpec,
} from "@facet/core";
import type { ComponentSpec } from "@facet/core";
import { describe, expect, it } from "vitest";

import { GRID_SPEC, LAYOUT_SPECS, ROW_SPEC, SCREEN_SPEC, STACK_SPEC } from "./specs-layout.js";

/** The three scalar types an authored prop value may take. */
const SCALAR_TYPES: readonly string[] = ["string", "number", "boolean"];

/**
 * Prop names that would smuggle placement, stacking or coordinates into author
 * markup. Layout stays flow-contained, so no spec in this group may declare one.
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

/** The catalog rejection code, or `"accepted"` — so a passing case reads as one. */
function catalogCode(components: readonly unknown[]): string {
  const result = validateCatalog({ components });
  return result.ok ? "accepted" : result.code;
}

/** Where the catalog rejection landed, so a negative case pins the position too. */
function catalogAt(components: readonly unknown[]): string {
  const result = validateCatalog({ components });
  return result.ok ? "accepted" : result.at;
}

/**
 * Validates one authored envelope against the layout group as the whole catalog.
 *
 * The group is a complete catalog on its own — it carries exactly one `Screen`,
 * which is what `validateCatalog` requires — so the screen root reaches the
 * ordinary component check the same way an agent's markup does.
 */
function authorOutcome(body: string): string {
  const parsed = parseMarkup(`<Facet entry="home">${body}</Facet>`);
  if (!parsed.ok) {
    return parsed.error.code;
  }
  const catalog = validateCatalog({ components: LAYOUT_SPECS.map(specRecord) });
  if (!catalog.ok) {
    return `catalog:${catalog.code}`;
  }
  const result = validateAuthorMarkup(parsed.ast, catalog.catalog, {});
  return result.ok ? "accepted" : result.error.code;
}

describe("layout specs — every spec is a valid component spec", () => {
  it("declares exactly Screen, Stack, Row and Grid, in that order", () => {
    expect(LAYOUT_SPECS.map((spec) => spec.tag)).toEqual(["Screen", "Stack", "Row", "Grid"]);
    expect(LAYOUT_SPECS).toEqual([SCREEN_SPEC, STACK_SPEC, ROW_SPEC, GRID_SPEC]);
  });

  it.each(["Screen", "Stack", "Row", "Grid"])("accepts the %s spec", (tag) => {
    const spec = LAYOUT_SPECS.find((candidate) => candidate.tag === tag);
    expect(spec).toBeDefined();
    expect(accept(specRecord(spec as ComponentSpec)).tag).toBe(tag);
  });

  it("survives a JSON round trip unchanged, because a spec travels to disk and to the agent", () => {
    for (const spec of LAYOUT_SPECS) {
      expect(specRecord(spec)).toEqual(spec);
    }
  });

  it("takes children everywhere: a layout component exists to contain other components", () => {
    for (const spec of LAYOUT_SPECS) {
      expect(spec.acceptsChildren).toBe(true);
    }
  });

  it("collects no value — layout frames content, it never owns a field", () => {
    for (const spec of LAYOUT_SPECS) {
      expect(spec.collect).toBeUndefined();
    }
  });
});

/**
 * `Screen` holds two roles at once, and the seam between them is what this
 * block pins.
 *
 * It is a **grammar position** in the envelope — one `Screen` per screen, a
 * direct child of `Facet` and nowhere else — *and* a registered catalog member
 * the renderer mounts like any other node. `catalog.ts` reserves `Facet` alone
 * and requires **exactly one** `Screen` in every valid catalog, so this group is
 * a complete catalog on its own. Registration reopens nothing: placement is
 * refused by document validation *before* the catalog is consulted, so no
 * registration can make a nested `<Screen>` legal.
 */
describe("Screen — a registered member whose placement stays grammar-owned", () => {
  it("validates on its own as a component spec", () => {
    expect(accept(specRecord(SCREEN_SPEC)).tag).toBe("Screen");
  });

  it("registers as a catalog member: the layout group is a complete catalog", () => {
    const registrable = LAYOUT_SPECS.map(specRecord);
    expect(catalogCode(registrable)).toBe("accepted");
  });

  it("is what a catalog is missing without it: Stack, Row and Grid alone are refused", () => {
    const screenless = [STACK_SPEC, ROW_SPEC, GRID_SPEC].map(specRecord);
    expect([catalogCode(screenless), catalogAt(screenless)]).toEqual([
      "missing_screen_spec",
      "components",
    ]);
  });

  it("is refused on its own fault when nonconforming, rather than counted as the required one", () => {
    const nonconforming = specRecord(SCREEN_SPEC);
    nonconforming["whenToUse"] = "w".repeat(BOUNDS.componentWhenToUseChars + 1);
    const components = [nonconforming, ...[STACK_SPEC, ROW_SPEC, GRID_SPEC].map(specRecord)];
    expect([catalogCode(components), catalogAt(components)]).toEqual([
      "when_to_use_too_long",
      "components[0].whenToUse",
    ]);
  });

  it("is refused twice over: a second Screen is two specs under one tag", () => {
    const doubled = [SCREEN_SPEC, STACK_SPEC, SCREEN_SPEC].map(specRecord);
    expect([catalogCode(doubled), catalogAt(doubled)]).toEqual([
      "duplicate_tag",
      "components[2].tag",
    ]);
  });

  it("declares name as a required scalar string with bounded guidance", () => {
    const schema = SCREEN_SPEC.props["name"];
    expect(schema?.type).toBe("string");
    expect(schema?.required).toBe(true);
    expect(schema?.guidance.length).toBeGreaterThan(0);
    expect(schema?.guidance.length).toBeLessThanOrEqual(BOUNDS.propGuidanceChars);
  });

  it("leaves default, enum and bindable off name entirely — absent, not declared false", () => {
    const schema: Record<string, unknown> = SCREEN_SPEC.props["name"] ?? {};
    // Key tests, not value reads. `bindable: false` declares a prop that is
    // bindable-and-switched-off, which is a different contract from one that
    // never mentions binding at all. A screen's identity is a literal the agent
    // writes, so these keys must be missing outright — and naming the offender
    // matters, because this spec is the Screen every downstream fixture is
    // measured against.
    for (const key of ["default", "enum", "bindable"]) {
      expect({ key, declared: key in schema }).toEqual({ key, declared: false });
    }
    expect(Object.keys(schema).sort()).toEqual(["guidance", "required", "type"]);
  });
});

describe("Screen — the authored screen root, checked against its registration", () => {
  it("accepts a screen root whose name and presentation props the spec declares", () => {
    expect(authorOutcome('<Screen name="home" maxWidth="wide"><Stack gap="md" /></Screen>')).toBe(
      "accepted",
    );
  });

  it("refuses a prop the Screen spec never declares — registration is not a bypass", () => {
    expect(authorOutcome('<Screen name="home" tone="accent"><Stack /></Screen>')).toBe(
      "undeclared-prop",
    );
  });

  it("refuses a value outside a declared presentation domain", () => {
    expect(authorOutcome('<Screen name="home" maxWidth="enormous"><Stack /></Screen>')).toBe(
      "invalid-value",
    );
  });

  it("refuses a screen root with no name at all", () => {
    expect(authorOutcome("<Screen><Stack /></Screen>")).toBe("malformed-document");
  });

  it("still refuses a nested Screen, on where it sits and before any catalog lookup", () => {
    expect(authorOutcome('<Screen name="home"><Screen name="inner" /></Screen>')).toBe(
      "misplaced-structural-tag",
    );
  });
});

describe("layout specs — flow-contained, never positioned", () => {
  it("declares no prop that could carry a coordinate, a layer or a placement", () => {
    for (const spec of LAYOUT_SPECS) {
      for (const name of Object.keys(spec.props)) {
        expect({ tag: spec.tag, coordinate: COORDINATE_PROP_NAMES.includes(name) }).toEqual({
          tag: spec.tag,
          coordinate: false,
        });
      }
    }
  });

  it("offers no authored value that names a placement mode", () => {
    for (const spec of LAYOUT_SPECS) {
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
    const source = readSource("./specs-layout.ts");
    for (const forbidden of ["zIndex", "z-index", "position:", "top:", "left:"]) {
      expect({ forbidden, present: source.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });
});

describe("layout specs — no prop accepts inline object or array JSON", () => {
  it("declares scalar props only: a structured prop is satisfiable by a binding alone", () => {
    for (const spec of LAYOUT_SPECS) {
      for (const [name, schema] of Object.entries(spec.props)) {
        expect({ at: `${spec.tag}.${name}`, scalar: SCALAR_TYPES.includes(schema.type) }).toEqual({
          at: `${spec.tag}.${name}`,
          scalar: true,
        });
      }
    }
  });

  it("declares no bindable prop at all, so no value arrives from outside the markup", () => {
    for (const spec of LAYOUT_SPECS) {
      for (const schema of Object.values(spec.props)) {
        expect(schema.bindable).toBeUndefined();
      }
    }
  });
});

describe("layout specs — per-prop guidance is present and bounded", () => {
  it("gives every prop of every spec its own non-empty guidance within B-13", () => {
    for (const spec of LAYOUT_SPECS) {
      const names = Object.keys(spec.props);
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) {
        const guidance = spec.props[name]?.guidance ?? "";
        expect({ at: `${spec.tag}.${name}`, empty: guidance.length === 0 }).toEqual({
          at: `${spec.tag}.${name}`,
          empty: false,
        });
        expect(guidance.length).toBeLessThanOrEqual(BOUNDS.propGuidanceChars);
      }
    }
  });

  it("says when to use each component in one non-empty line within B-12", () => {
    for (const spec of LAYOUT_SPECS) {
      expect(spec.whenToUse.length).toBeGreaterThan(0);
      expect(spec.whenToUse.length).toBeLessThanOrEqual(BOUNDS.componentWhenToUseChars);
    }
  });

  it("keeps prop count inside B-10 and every enum domain inside B-11", () => {
    for (const spec of LAYOUT_SPECS) {
      expect(Object.keys(spec.props).length).toBeLessThanOrEqual(BOUNDS.propsPerComponentSpec);
      for (const schema of Object.values(spec.props)) {
        const domain = "enum" in schema ? schema.enum : undefined;
        expect(domain === undefined ? 0 : domain.length).toBeLessThanOrEqual(
          BOUNDS.enumValuesPerProp,
        );
      }
    }
  });
});

describe("layout specs — the bounds that would reject them, one step away", () => {
  it("rejects a when-to-use one character past B-12 and accepts one exactly at it", () => {
    const atBound = specRecord(STACK_SPEC);
    atBound["whenToUse"] = "w".repeat(BOUNDS.componentWhenToUseChars);
    const overBound = specRecord(STACK_SPEC);
    overBound["whenToUse"] = "w".repeat(BOUNDS.componentWhenToUseChars + 1);
    expect(rejectionCode(atBound)).toBe("accepted");
    expect(rejectionCode(overBound)).toBe("when_to_use_too_long");
  });

  it("rejects prop guidance one character past B-13 and accepts one exactly at it", () => {
    const atBound = specRecord(ROW_SPEC);
    const atProps = atBound["props"] as Record<string, Record<string, unknown>>;
    (atProps["gap"] as Record<string, unknown>)["guidance"] = "g".repeat(BOUNDS.propGuidanceChars);
    const overBound = specRecord(ROW_SPEC);
    const overProps = overBound["props"] as Record<string, Record<string, unknown>>;
    (overProps["gap"] as Record<string, unknown>)["guidance"] = "g".repeat(
      BOUNDS.propGuidanceChars + 1,
    );
    expect(rejectionCode(atBound)).toBe("accepted");
    expect(rejectionCode(overBound)).toBe("prop_guidance_too_long");
  });

  it("rejects an enum domain one value past B-11 and accepts one exactly at it", () => {
    const domain = Array.from(
      { length: BOUNDS.enumValuesPerProp },
      (_unused, index) => `v${index}`,
    );
    const atBound = specRecord(GRID_SPEC);
    (atBound["props"] as Record<string, unknown>)["gap"] = {
      type: "string",
      guidance: "A probe domain sized exactly at the bound.",
      enum: domain,
    };
    const overBound = specRecord(GRID_SPEC);
    (overBound["props"] as Record<string, unknown>)["gap"] = {
      type: "string",
      guidance: "A probe domain sized one value past the bound.",
      enum: [...domain, "overflow"],
    };
    expect(rejectionCode(atBound)).toBe("accepted");
    expect(rejectionCode(overBound)).toBe("too_many_enum_values");
  });

  it("rejects a prop count one past B-10 and accepts one exactly at it", () => {
    const probe = (count: number): Record<string, unknown> => {
      const props: Record<string, unknown> = {};
      for (let index = 0; index < count; index += 1) {
        props[`p${index}`] = { type: "string", guidance: "A probe prop." };
      }
      return { ...specRecord(SCREEN_SPEC), props };
    };
    expect(rejectionCode(probe(BOUNDS.propsPerComponentSpec))).toBe("accepted");
    expect(rejectionCode(probe(BOUNDS.propsPerComponentSpec + 1))).toBe("too_many_props");
  });
});

describe("specs-layout.ts — source hygiene", () => {
  it("carries no NUL byte", () => {
    const bytes = readFileSync(new URL("./specs-layout.ts", import.meta.url));
    expect(bytes.indexOf(0)).toBe(-1);
  });

  it("imports nothing but @facet/core", () => {
    const source = readSource("./specs-layout.ts");
    const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    expect([...new Set(specifiers)]).toEqual(["@facet/core"]);
  });
});
