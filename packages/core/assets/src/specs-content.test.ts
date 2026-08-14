import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  BOUNDS,
  parseMarkup,
  validateAuthorMarkup,
  validateCatalog,
  validateComponentSpec,
} from "@facet/core";
import type { ComponentSpec, DataModel, FacetCatalog, PropSchema } from "@facet/core";

import { BADGE_SPEC, CONTENT_SPECS, METRIC_SPEC, TABLE_SPEC, TEXT_SPEC } from "./specs-content.js";

/** The four content tags this module owns, in declaration order. */
const CONTENT_TAGS: readonly string[] = ["Text", "Metric", "Badge", "Table"];

/** The one prop of each content component that carries its data (DC-019). */
const BINDABLE_CONTENT_PROPS: readonly (readonly [string, string])[] = [
  ["Text", "value"],
  ["Metric", "value"],
  ["Badge", "label"],
  ["Table", "rows"],
];

/**
 * The exact `Table.rows` declaration the structured branch admits: the type, the
 * guidance, `required`, and a literal `bindable: true`. Nothing else — no
 * `items`, no domain, no default — because the value never comes from the
 * markup.
 */
const TABLE_ROWS_KEYS: readonly string[] = ["type", "guidance", "required", "bindable"];

/**
 * The three prop names the framework reserves: the collection address a request
 * resolves against, the collection request list itself, and the one explicit
 * argument an `agent:` event carries. Written out as literals rather than read
 * from a spec, so the absence below is measured against the convention and not
 * against whatever these specs happen to declare.
 */
const FRAMEWORK_PROPS: readonly string[] = ["name", "collect", "arg"];

/**
 * The smallest conforming `Screen` registration, declared here rather than
 * imported from the layout group.
 *
 * Every valid catalog carries exactly one `Screen` — the renderer mounts a
 * stored screen root like any other node — so a catalog assembled from content
 * specs alone is incomplete by construction. This stub supplies that one member
 * and nothing else, which keeps the assertions below about Text, Metric, Badge
 * and Table instead of about whatever the real `Screen` happens to declare.
 */
const SCREEN_STUB: Record<string, unknown> = {
  tag: "Screen",
  whenToUse: "The screen root a catalog must register, standing in for the real one.",
  authoring: {
    role: "display",
    informationTypes: ["test_content"],
    visualEmphasis: "supporting",
  } as const,
  props: {
    name: { type: "string", guidance: "The screen's name.", required: true },
  },
  acceptsChildren: true,
};

const SOURCE = readFileSync(new URL("./specs-content.ts", import.meta.url), "utf8");

/** The registered set an authored document actually reaches: the stub plus the four. */
const REGISTERED_SPECS: readonly unknown[] = [SCREEN_STUB, ...CONTENT_SPECS];

function specFor(tag: string): ComponentSpec {
  const found = CONTENT_SPECS.find((candidate) => candidate.tag === tag);
  if (found === undefined) {
    throw new Error(`the content group declares no ${tag} spec`);
  }
  return found;
}

function propOf(tag: string, name: string): PropSchema {
  const schema = specFor(tag).props[name];
  if (schema === undefined) {
    throw new Error(`${tag} declares no ${name} prop`);
  }
  return schema;
}

/** The first rejection code, or `"accepted"` — so a passing case reads as one. */
function rejection(value: unknown): string {
  const result = validateComponentSpec(value);
  return result.ok ? "accepted" : result.code;
}

/** The location the first rejection names, so a negative case pins where it failed. */
function rejectionAt(value: unknown): string {
  const result = validateComponentSpec(value);
  return result.ok ? "accepted" : result.at;
}

function acceptCatalog(components: readonly unknown[]): FacetCatalog {
  const result = validateCatalog({ components });
  if (!result.ok) {
    throw new Error(`expected acceptance, got ${result.code} at ${result.at}: ${result.detail}`);
  }
  return result.catalog;
}

function catalogPropOf(tag: string, name: string): unknown {
  const spec = acceptCatalog(REGISTERED_SPECS).components.find(
    (candidate) => candidate.tag === tag,
  );
  return spec?.props[name];
}

function withWhenToUse(spec: ComponentSpec, whenToUse: string): unknown {
  return { ...spec, whenToUse };
}

function withProp(spec: ComponentSpec, name: string, schema: unknown): unknown {
  return { ...spec, props: { ...spec.props, [name]: schema } };
}

/**
 * Validates one authored document against a catalog of exactly these content
 * specs plus the Screen every valid catalog registers.
 */
function authorOutcome(body: string, model: DataModel = {}): string {
  const source = `<Facet entry="home"><Screen name="home">${body}</Screen></Facet>`;
  const parsed = parseMarkup(source);
  if (!parsed.ok) {
    return parsed.error.code;
  }
  const result = validateAuthorMarkup(parsed.ast, acceptCatalog(REGISTERED_SPECS), model);
  return result.ok ? "accepted" : result.error.code;
}

/** A string of exactly `length` characters, so a bound can be met and then passed. */
function text(length: number): string {
  return "x".repeat(length);
}

const ROWS_MODEL: DataModel = { sales: { rows: [{ month: "2026-07", revenue: 23 }] } };

describe("content specs — the four tags register", () => {
  it("declares exactly Text, Metric, Badge and Table", () => {
    expect(CONTENT_SPECS.map((spec) => spec.tag)).toEqual(CONTENT_TAGS);
  });

  it("groups the four named specs in registration order", () => {
    expect(CONTENT_SPECS).toEqual([TEXT_SPEC, METRIC_SPEC, BADGE_SPEC, TABLE_SPEC]);
  });

  it("accepts every spec on its own", () => {
    for (const spec of CONTENT_SPECS) {
      expect([spec.tag, rejection(spec)]).toEqual([spec.tag, "accepted"]);
    }
  });

  it("registers all four as ordinary members alongside the required Screen", () => {
    const result = validateCatalog({ components: [SCREEN_STUB, ...CONTENT_SPECS] });
    expect(result.ok ? result.catalog.components.map((spec) => spec.tag) : result.code).toEqual([
      "Screen",
      ...CONTENT_TAGS,
    ]);
  });

  it("is not a complete catalog on its own: the required Screen is what it lacks", () => {
    const result = validateCatalog({ components: CONTENT_SPECS });
    expect(result.ok ? ["accepted", ""] : [result.code, result.at]).toEqual([
      "missing_screen_spec",
      "components",
    ]);
  });

  it("takes no children — content arrives through props, not a nested tree", () => {
    for (const spec of CONTENT_SPECS) {
      expect([spec.tag, spec.acceptsChildren]).toEqual([spec.tag, false]);
    }
  });

  it("collects nothing — content is read, never a value the visitor supplies", () => {
    for (const spec of CONTENT_SPECS) {
      expect([spec.tag, spec.collect]).toEqual([spec.tag, undefined]);
    }
  });

  it("requests and argues nothing either — no framework prop appears in the group", () => {
    // The address, the request list and the event argument are independent
    // framework reservations, and a content component takes part in none of
    // them: it holds no value to collect, so it needs no address, and it sends
    // no event, so it names no fields and carries no argument. Stated as an
    // explicit absence rather than left implicit, so a later spec that quietly
    // declared `collect`, `name` or `arg` here would have to answer for it.
    for (const spec of CONTENT_SPECS) {
      const declared = FRAMEWORK_PROPS.filter((name) => name in spec.props);
      expect([spec.tag, declared]).toEqual([spec.tag, []]);
    }
  });
});

describe("content specs — bindable prop declarations (DC-019)", () => {
  it("declares Metric.value a required bindable number", () => {
    const value = propOf("Metric", "value");
    expect({ type: value.type, required: value.required, bindable: value.bindable }).toEqual({
      type: "number",
      required: true,
      bindable: true,
    });
  });

  it("declares one bindable data prop per content component", () => {
    for (const [tag, name] of BINDABLE_CONTENT_PROPS) {
      expect([tag, name, propOf(tag, name).bindable]).toEqual([tag, name, true]);
    }
  });

  it("keeps every other prop unbindable — a vocabulary is authored, not published", () => {
    const bindable = new Set(BINDABLE_CONTENT_PROPS.map(([tag, name]) => `${tag}.${name}`));
    for (const spec of CONTENT_SPECS) {
      for (const [name, schema] of Object.entries(spec.props)) {
        const located = `${spec.tag}.${name}`;
        expect([located, schema.bindable === true]).toEqual([located, bindable.has(located)]);
      }
    }
  });

  it("survives validation with the bindable flags intact", () => {
    const result = validateCatalog({ components: [SCREEN_STUB, ...CONTENT_SPECS] });
    if (!result.ok) {
      throw new Error(`expected acceptance, got ${result.code} at ${result.at}`);
    }
    const metric = result.catalog.components.find((spec) => spec.tag === "Metric");
    expect(metric?.props["value"]).toEqual(propOf("Metric", "value"));
  });

  it("declares only scalar props except Table.rows, the one bindable record collection", () => {
    for (const spec of CONTENT_SPECS) {
      for (const [name, schema] of Object.entries(spec.props)) {
        const located = `${spec.tag}.${name}`;
        const allowed =
          located === "Table.rows"
            ? schema.type === "array"
            : ["string", "number", "boolean"].includes(schema.type);
        expect([located, allowed]).toEqual([located, true]);
      }
    }
  });
});

describe("content specs — Table.rows is a required bindable array", () => {
  it("declares exactly the four keys the structured branch admits", () => {
    const rows = propOf("Table", "rows");
    expect(Object.keys(rows).sort()).toEqual([...TABLE_ROWS_KEYS].sort());
    expect({ type: rows.type, required: rows.required, bindable: rows.bindable }).toEqual({
      type: "array",
      required: true,
      bindable: true,
    });
  });

  it("round-trips through validateCatalog unchanged", () => {
    expect(catalogPropOf("Table", "rows")).toEqual(propOf("Table", "rows"));
  });

  it("is rejected the moment bindable is dropped, naming the flag", () => {
    const spec = specFor("Table");
    const rows = propOf("Table", "rows");
    const unbindable = { type: rows.type, guidance: rows.guidance, required: true };
    expect(rejection(withProp(spec, "rows", unbindable))).toBe("structured_prop_not_bindable");
    expect(rejectionAt(withProp(spec, "rows", unbindable))).toBe("props.rows.bindable");
  });

  it("is filled by a data: reference and refuses an inline scalar", () => {
    expect(authorOutcome(`<Table rows="data:sales.rows" />`, ROWS_MODEL)).toBe("accepted");
    expect(authorOutcome(`<Table rows="none" />`, ROWS_MODEL)).toBe("invalid-value");
  });

  it("refuses a binding whose published value is not an array", () => {
    expect(authorOutcome(`<Table rows="data:sales" />`, ROWS_MODEL)).toBe("unresolved-binding");
  });
});

describe("content specs — bounded metadata", () => {
  it("keeps every when-to-use line inside B-12", () => {
    for (const spec of CONTENT_SPECS) {
      expect([spec.tag, spec.whenToUse.length <= BOUNDS.componentWhenToUseChars]).toEqual([
        spec.tag,
        true,
      ]);
      expect(spec.whenToUse.length).toBeGreaterThan(0);
    }
  });

  it("keeps every prop guidance line inside B-13", () => {
    for (const spec of CONTENT_SPECS) {
      for (const [name, schema] of Object.entries(spec.props)) {
        const located = `${spec.tag}.${name}`;
        expect([located, schema.guidance.length <= BOUNDS.propGuidanceChars]).toEqual([
          located,
          true,
        ]);
        expect(schema.guidance.length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps every prop count inside B-10 and every domain inside B-11", () => {
    for (const spec of CONTENT_SPECS) {
      const names = Object.keys(spec.props);
      expect([spec.tag, names.length <= BOUNDS.propsPerComponentSpec]).toEqual([spec.tag, true]);
      for (const [name, schema] of Object.entries(spec.props)) {
        const located = `${spec.tag}.${name}`;
        const size = "enum" in schema && schema.enum !== undefined ? schema.enum.length : 0;
        expect([located, size <= BOUNDS.enumValuesPerProp]).toEqual([located, true]);
      }
    }
  });

  it("accepts a when-to-use line of exactly B-12 and rejects one character more", () => {
    const spec = specFor("Text");
    expect(rejection(withWhenToUse(spec, text(BOUNDS.componentWhenToUseChars)))).toBe("accepted");
    expect(rejection(withWhenToUse(spec, text(BOUNDS.componentWhenToUseChars + 1)))).toBe(
      "when_to_use_too_long",
    );
  });

  it("accepts guidance of exactly B-13 and rejects one character more", () => {
    const spec = specFor("Badge");
    const at = (length: number): unknown =>
      withProp(spec, "label", { type: "string", required: true, guidance: text(length) });
    expect(rejection(at(BOUNDS.propGuidanceChars))).toBe("accepted");
    expect(rejection(at(BOUNDS.propGuidanceChars + 1))).toBe("prop_guidance_too_long");
  });
});

describe("content specs — the module stays a private, core-only leaf", () => {
  it("imports nothing but @facet/core", () => {
    const specifiers = [...SOURCE.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1] ?? "");
    expect(new Set(specifiers)).toEqual(new Set(["@facet/core"]));
  });

  it("carries no NUL byte", () => {
    expect(SOURCE.includes(String.fromCharCode(0))).toBe(false);
  });
});
