import { describe, expect, it } from "vitest";

import { BOUNDS } from "./bounds.js";
import type {
  ComponentSpec,
  ComponentSpecValidationResult,
  PropSchema,
  StructuredPropType,
} from "./component-spec.js";
import { validateComponentSpec } from "./component-spec.js";

/** A minimal spec that must validate: every required field present, nothing more. */
function minimalSpec(): Record<string, unknown> {
  return {
    tag: "Card",
    whenToUse: "Group related content in one bounded surface.",
    props: {},
    acceptsChildren: true,
  };
}

function withProps(props: Record<string, unknown>): Record<string, unknown> {
  return { ...minimalSpec(), props };
}

function stringProp(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "string", guidance: "The visible label.", ...overrides };
}

function numberProp(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "number", guidance: "How many columns to lay out.", ...overrides };
}

/**
 * The framework's collection address, in its conforming shape: the exact
 * lowercase `name`, a required scalar string the author writes literally, with
 * no `default`, `enum` or `bindable` key (D-08).
 */
function collectNameProp(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "string",
    required: true,
    guidance: "The name a collect list addresses this field by.",
    ...overrides,
  };
}

/** Accepts, or fails the test with the structured rejection rather than a bare `undefined`. */
function accept(value: unknown): ComponentSpec {
  const result = validateComponentSpec(value);
  if (!result.ok) {
    throw new Error(`expected acceptance, got ${result.code} at ${result.at}: ${result.detail}`);
  }
  return result.spec;
}

/** The rejection code, or the sentinel `"accepted"` so an accidental acceptance reads clearly. */
function rejectionCode(value: unknown): string {
  const result = validateComponentSpec(value);
  return result.ok ? "accepted" : result.code;
}

function rejectionAt(value: unknown): string {
  const result = validateComponentSpec(value);
  return result.ok ? "accepted" : result.at;
}

describe("validateComponentSpec — the accepted spec form", () => {
  it("accepts the minimal spec: tag, when-to-use, prop contract, acceptsChildren", () => {
    const spec = accept(minimalSpec());
    expect(spec.tag).toBe("Card");
    expect(spec.acceptsChildren).toBe(true);
    expect(spec.props).toEqual({});
  });

  it("accepts a full spec — enum domain, default, required, bindable, and a collect block", () => {
    const spec = accept({
      tag: "Field",
      whenToUse: "Collect one short value from the visitor.",
      props: {
        name: stringProp({ required: true, guidance: "The field name used by collect." }),
        label: stringProp({ guidance: "The visible label." }),
        value: stringProp({ bindable: true, guidance: "The current value.", default: "" }),
        size: stringProp({ enum: ["sm", "md", "lg"], default: "md", guidance: "Control size." }),
        rows: numberProp({ minimum: 1, maximum: 8, default: 1, guidance: "Visible rows." }),
        secret: { type: "boolean", guidance: "Hide the value.", default: false },
      },
      acceptsChildren: false,
      collect: { collectable: true, valueProp: "value", sensitiveProp: "secret" },
    });
    expect(spec.collect).toEqual({
      collectable: true,
      valueProp: "value",
      sensitiveProp: "secret",
    });
    expect(Object.keys(spec.props)).toHaveLength(6);
  });

  it("accepts a closed themeRecipe declaration on a component spec", () => {
    const spec = accept({
      ...minimalSpec(),
      themeRecipe: {
        tokens: {
          background: "color",
          padding: "length",
          focusRing: "shadow",
        },
      },
    });
    expect(spec.themeRecipe?.tokens).toEqual({
      background: "color",
      focusRing: "shadow",
      padding: "length",
    });
    expect(Object.isFrozen(spec.themeRecipe)).toBe(true);
    expect(Object.isFrozen(spec.themeRecipe?.tokens)).toBe(true);
  });

  it("accepts a record with a null prototype — a plain data record is still a spec", () => {
    const spec = Object.assign(Object.create(null) as Record<string, unknown>, minimalSpec());
    expect(validateComponentSpec(spec).ok).toBe(true);
  });

  it("returns a frozen spec whose prop contract the host cannot mutate after validation", () => {
    const source = withProps({ label: stringProp() });
    const spec = accept(source);
    expect(Object.isFrozen(spec)).toBe(true);
    expect(Object.isFrozen(spec.props)).toBe(true);
    const propsSource = source["props"] as Record<string, unknown>;
    propsSource["injected"] = stringProp();
    expect(Object.keys(spec.props)).toEqual(["label"]);
  });

  it("freezes an enum domain so the accepted value set cannot widen after validation", () => {
    const spec = accept(withProps({ size: stringProp({ enum: ["sm", "md"] }) }));
    const size = spec.props["size"];
    expect(size?.type).toBe("string");
    const domain = size?.type === "string" ? size.enum : undefined;
    expect(Object.isFrozen(domain)).toBe(true);
  });

  it("is deterministic — the same input yields an equal result on repeat calls", () => {
    const bad = withProps({ label: { type: "string" } });
    expect(validateComponentSpec(bad)).toEqual(validateComponentSpec(bad));
    const good = minimalSpec();
    expect(validateComponentSpec(good)).toEqual(validateComponentSpec(good));
  });
});

describe("validateComponentSpec — a spec missing a required part is rejected", () => {
  const missing: ReadonlyArray<{ readonly field: string; readonly code: string }> = [
    { field: "tag", code: "invalid_tag" },
    { field: "whenToUse", code: "invalid_when_to_use" },
    { field: "props", code: "invalid_props" },
    { field: "acceptsChildren", code: "invalid_accepts_children" },
  ];

  it.each(missing)("rejects a spec missing $field", ({ field, code }) => {
    const spec = minimalSpec();
    delete spec[field];
    expect(rejectionCode(spec)).toBe(code);
  });

  it.each(missing)("rejects a spec whose $field is explicitly undefined", ({ field, code }) => {
    expect(rejectionCode({ ...minimalSpec(), [field]: undefined })).toBe(code);
  });

  it("rejects a prop schema with no per-prop guidance", () => {
    expect(rejectionCode(withProps({ label: { type: "string" } }))).toBe("invalid_prop_guidance");
    expect(rejectionAt(withProps({ label: { type: "string" } }))).toBe("props.label.guidance");
  });

  it("rejects a prop schema with empty guidance — the text must actually guide", () => {
    expect(rejectionCode(withProps({ label: stringProp({ guidance: "" }) }))).toBe(
      "invalid_prop_guidance",
    );
  });

  it("rejects an empty when-to-use line", () => {
    expect(rejectionCode({ ...minimalSpec(), whenToUse: "" })).toBe("invalid_when_to_use");
  });
});

describe("validateComponentSpec — no category field (deliberately absent)", () => {
  it("accepts a spec that carries no category — it is not a required part of the form", () => {
    expect("category" in minimalSpec()).toBe(false);
    expect(validateComponentSpec(minimalSpec()).ok).toBe(true);
  });

  it("rejects a spec that carries a category — the spec form is closed, not extensible", () => {
    expect(rejectionCode({ ...minimalSpec(), category: "surface" })).toBe("unknown_spec_key");
    expect(rejectionAt({ ...minimalSpec(), category: "surface" })).toBe("category");
  });

  it("rejects any other unknown top-level key", () => {
    expect(rejectionCode({ ...minimalSpec(), examples: ["<Card />"] })).toBe("unknown_spec_key");
  });
});

describe("validateComponentSpec — themeRecipe declarations", () => {
  it("rejects an unknown themeRecipe key", () => {
    expect(rejectionCode({ ...minimalSpec(), themeRecipe: { tokens: {}, examples: [] } })).toBe(
      "unknown_theme_recipe_key",
    );
    expect(rejectionAt({ ...minimalSpec(), themeRecipe: { tokens: {}, examples: [] } })).toBe(
      "themeRecipe.examples",
    );
  });

  it("rejects a recipe token name outside the Facet identifier grammar", () => {
    expect(
      rejectionCode({ ...minimalSpec(), themeRecipe: { tokens: { "bad token": "color" } } }),
    ).toBe("invalid_theme_recipe_token");
  });

  it("rejects a recipe token kind Facet does not declare", () => {
    expect(
      rejectionCode({ ...minimalSpec(), themeRecipe: { tokens: { background: "gradient" } } }),
    ).toBe("invalid_theme_recipe_token_kind");
  });

  it("rejects recipe token names that collide after CSS variable projection", () => {
    expect(
      rejectionCode({
        ...minimalSpec(),
        themeRecipe: { tokens: { focusRing: "shadow", "focus-ring": "shadow" } },
      }),
    ).toBe("duplicate_theme_recipe_token");
    expect(
      rejectionCode({
        ...minimalSpec(),
        themeRecipe: { tokens: { "focus-ring": "shadow", focus_ring: "shadow" } },
      }),
    ).toBe("duplicate_theme_recipe_token");
  });
});

describe("validateComponentSpec — tag and prop names use the one identifier grammar (B-06)", () => {
  it("accepts a tag at exactly B-06 characters and rejects one past it", () => {
    const atLimit = "T".repeat(BOUNDS.identifierChars);
    expect(validateComponentSpec({ ...minimalSpec(), tag: atLimit }).ok).toBe(true);
    expect(rejectionCode({ ...minimalSpec(), tag: `${atLimit}x` })).toBe("invalid_tag");
  });

  const badTags: readonly string[] = ["", "1Card", "-Card", "_Card", "My Card", "Card.Body", "a:b"];

  it.each(badTags)("rejects the tag %j", (tag) => {
    expect(rejectionCode({ ...minimalSpec(), tag })).toBe("invalid_tag");
  });

  it("accepts a prop name the identifier grammar admits", () => {
    expect(validateComponentSpec(withProps({ "data-id": stringProp() })).ok).toBe(true);
    expect(validateComponentSpec(withProps({ maxHeight: stringProp() })).ok).toBe(true);
  });

  it("rejects a prop name outside the identifier grammar", () => {
    expect(rejectionCode(withProps({ "aria label": stringProp() }))).toBe("invalid_prop_name");
    expect(rejectionCode(withProps({ "0": stringProp() }))).toBe("invalid_prop_name");
    expect(rejectionCode(withProps({ "on:click": stringProp() }))).toBe("invalid_prop_name");
  });

  it("rejects a prototype-shaped own prop name", () => {
    // A computed key makes `__proto__` a real own property rather than a prototype write.
    expect(rejectionCode(withProps({ ["__proto__"]: stringProp() }))).toBe("invalid_prop_name");
  });
});

describe("validateComponentSpec — PropSchema is a closed JSON-Schema subset", () => {
  const acceptedTypes: readonly string[] = ["string", "number", "boolean"];

  it.each(acceptedTypes)("admits the scalar type %s", (type) => {
    expect(validateComponentSpec(withProps({ p: { type, guidance: "Guidance." } })).ok).toBe(true);
  });

  // `array` and `object` are declared types too, but only in the binding-only
  // structured branch below — never as an inline scalar-shaped schema.
  const rejectedTypes: readonly unknown[] = [
    "null",
    "integer",
    "any",
    "String",
    "Array",
    1,
    true,
    null,
    ["string", "number"],
  ];

  it.each(rejectedTypes.map((type) => ({ type })))(
    "rejects the undeclared prop type $type",
    ({ type }) => {
      expect(rejectionCode(withProps({ p: { type, guidance: "Guidance." } }))).toBe(
        "invalid_prop_type",
      );
    },
  );

  const rejectedKeywords: readonly string[] = [
    "$ref",
    "$schema",
    "allOf",
    "anyOf",
    "oneOf",
    "not",
    "properties",
    "patternProperties",
    "additionalProperties",
    "items",
    "pattern",
    "format",
    "const",
  ];

  it.each(rejectedKeywords)("rejects the JSON-Schema keyword %s", (keyword) => {
    const schema = stringProp({ [keyword]: {} });
    expect(rejectionCode(withProps({ p: schema }))).toBe("unknown_prop_key");
    expect(rejectionAt(withProps({ p: schema }))).toBe(`props.p.${keyword}`);
  });

  it("rejects a keyword that is legal for a different scalar type", () => {
    expect(rejectionCode(withProps({ p: stringProp({ minimum: 1 }) }))).toBe("unknown_prop_key");
    expect(rejectionCode(withProps({ p: { type: "boolean", guidance: "G.", enum: [true] } }))).toBe(
      "unknown_prop_key",
    );
  });

  it("rejects a prop schema that is not an object at all", () => {
    expect(rejectionCode(withProps({ p: "string" }))).toBe("invalid_prop_schema");
    expect(rejectionCode(withProps({ p: null }))).toBe("invalid_prop_schema");
    expect(rejectionCode(withProps({ p: ["string"] }))).toBe("invalid_prop_schema");
  });

  it("rejects a props container that is not a record", () => {
    expect(rejectionCode({ ...minimalSpec(), props: [] })).toBe("invalid_props");
    expect(rejectionCode({ ...minimalSpec(), props: "none" })).toBe("invalid_props");
  });

  it("rejects a non-boolean required or bindable flag", () => {
    expect(rejectionCode(withProps({ p: stringProp({ required: "yes" }) }))).toBe(
      "invalid_prop_required",
    );
    expect(rejectionCode(withProps({ p: stringProp({ bindable: 1 }) }))).toBe(
      "invalid_prop_bindable",
    );
  });

  it("rejects a non-boolean acceptsChildren", () => {
    expect(rejectionCode({ ...minimalSpec(), acceptsChildren: "true" })).toBe(
      "invalid_accepts_children",
    );
  });
});

describe("validateComponentSpec — domain and default coherence", () => {
  it("rejects a default whose type contradicts the declared prop type", () => {
    expect(rejectionCode(withProps({ p: stringProp({ default: 3 }) }))).toBe(
      "invalid_prop_default",
    );
    expect(rejectionCode(withProps({ p: numberProp({ default: "3" }) }))).toBe(
      "invalid_prop_default",
    );
  });

  it("rejects a default outside its own enum domain", () => {
    const schema = stringProp({ enum: ["sm", "md"], default: "lg" });
    expect(rejectionCode(withProps({ p: schema }))).toBe("default_outside_domain");
  });

  it("rejects a default outside a numeric minimum/maximum domain", () => {
    expect(
      rejectionCode(withProps({ p: numberProp({ minimum: 1, maximum: 4, default: 9 }) })),
    ).toBe("default_outside_domain");
  });

  it("rejects a required prop that also declares a default — the two contradict", () => {
    expect(rejectionCode(withProps({ p: stringProp({ required: true, default: "x" }) }))).toBe(
      "required_prop_with_default",
    );
  });

  it("rejects a non-finite number anywhere in the schema — a spec must be serializable", () => {
    expect(rejectionCode(withProps({ p: numberProp({ default: Number.NaN }) }))).toBe(
      "invalid_prop_default",
    );
    expect(rejectionCode(withProps({ p: numberProp({ minimum: Number.POSITIVE_INFINITY }) }))).toBe(
      "invalid_prop_minimum",
    );
    expect(rejectionCode(withProps({ p: numberProp({ enum: [1, Number.NaN] }) }))).toBe(
      "invalid_enum_value",
    );
  });

  it("rejects an inverted numeric domain", () => {
    expect(rejectionCode(withProps({ p: numberProp({ minimum: 8, maximum: 2 }) }))).toBe(
      "inverted_numeric_domain",
    );
  });

  it("rejects an empty enum — a domain with no members admits nothing", () => {
    expect(rejectionCode(withProps({ p: stringProp({ enum: [] }) }))).toBe("empty_enum");
  });

  it("rejects a duplicated enum value", () => {
    expect(rejectionCode(withProps({ p: stringProp({ enum: ["sm", "sm"] }) }))).toBe(
      "duplicate_enum_value",
    );
  });

  it("rejects an enum value whose type contradicts the prop type", () => {
    expect(rejectionCode(withProps({ p: stringProp({ enum: ["sm", 2] }) }))).toBe(
      "invalid_enum_value",
    );
  });

  it("rejects an enum that is not an array", () => {
    expect(rejectionCode(withProps({ p: stringProp({ enum: { sm: true } }) }))).toBe(
      "invalid_enum",
    );
  });
});

describe("validateComponentSpec — structured props are shallow, closed and binding-only", () => {
  const structuredTypes: readonly string[] = ["array", "object"];

  function structuredProp(
    type: string,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return { type, guidance: "The rows the component renders.", bindable: true, ...overrides };
  }

  it.each(structuredTypes)("accepts a bindable %s prop", (type) => {
    const spec = accept(withProps({ rows: structuredProp(type) }));
    expect(spec.props["rows"]).toEqual({
      type,
      guidance: "The rows the component renders.",
      bindable: true,
    });
  });

  it.each(structuredTypes)("accepts a required bindable %s prop", (type) => {
    const spec = accept(withProps({ rows: structuredProp(type, { required: true }) }));
    expect(spec.props["rows"]).toEqual({
      type,
      guidance: "The rows the component renders.",
      required: true,
      bindable: true,
    });
  });

  it.each(structuredTypes)("freezes an accepted %s prop schema", (type) => {
    expect(Object.isFrozen(accept(withProps({ rows: structuredProp(type) })).props["rows"])).toBe(
      true,
    );
  });

  it.each(structuredTypes)("rejects a %s prop that omits bindable", (type) => {
    const schema = { type, guidance: "The rows." };
    expect(rejectionCode(withProps({ rows: schema }))).toBe("structured_prop_not_bindable");
    expect(rejectionAt(withProps({ rows: schema }))).toBe("props.rows.bindable");
  });

  it.each(structuredTypes)("rejects a %s prop declaring bindable false", (type) => {
    const schema = structuredProp(type, { bindable: false });
    expect(rejectionCode(withProps({ rows: schema }))).toBe("structured_prop_not_bindable");
    expect(rejectionAt(withProps({ rows: schema }))).toBe("props.rows.bindable");
  });

  it.each(structuredTypes)("rejects a non-boolean bindable on a %s prop", (type) => {
    expect(rejectionCode(withProps({ rows: structuredProp(type, { bindable: "yes" }) }))).toBe(
      "invalid_prop_bindable",
    );
  });

  const forbiddenKeys: readonly string[] = [
    "default",
    "enum",
    "minimum",
    "maximum",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "items",
    "properties",
    "additionalProperties",
    "shape",
  ];

  const forbidden = structuredTypes.flatMap((type) => forbiddenKeys.map((key) => ({ type, key })));

  it.each(forbidden)(
    "rejects the key $key on a $type prop — the branch is shallow",
    ({ type, key }) => {
      const schema = structuredProp(type, { [key]: {} });
      expect(rejectionCode(withProps({ rows: schema }))).toBe("unknown_prop_key");
      expect(rejectionAt(withProps({ rows: schema }))).toBe(`props.rows.${key}`);
    },
  );

  it("reports one error, first in deterministic order, never an aggregated list", () => {
    const schema = { type: "array", guidance: "The rows.", items: {}, default: [], zzz: 1 };
    const result = validateComponentSpec(withProps({ rows: schema }));
    expect(result.ok).toBe(false);
    expect(Object.keys(result).sort()).toEqual(["at", "code", "detail", "ok"]);
    expect(rejectionAt(withProps({ rows: schema }))).toBe("props.rows.default");
  });

  it("prefers the closed-key rejection to the missing-bindable one — the order is fixed", () => {
    const schema = { type: "object", guidance: "The record.", properties: {} };
    expect(rejectionCode(withProps({ rows: schema }))).toBe("unknown_prop_key");
    expect(rejectionAt(withProps({ rows: schema }))).toBe("props.rows.properties");
  });

  it("is deterministic — the same structured rejection repeats exactly", () => {
    const bad = withProps({ rows: { type: "array", guidance: "The rows." } });
    expect(validateComponentSpec(bad)).toEqual(validateComponentSpec(bad));
  });

  it("leaves the scalar branch contract unchanged — enum and default still admitted", () => {
    const spec = accept(withProps({ size: stringProp({ enum: ["sm", "md"], default: "md" }) }));
    expect(spec.props["size"]).toEqual({
      type: "string",
      guidance: "The visible label.",
      enum: ["sm", "md"],
      default: "md",
    });
  });

  it("applies B-13 to structured guidance as well as scalar guidance", () => {
    const atLimit = structuredProp("array", { guidance: "g".repeat(BOUNDS.propGuidanceChars) });
    expect(validateComponentSpec(withProps({ rows: atLimit })).ok).toBe(true);
    const pastLimit = structuredProp("array", {
      guidance: "g".repeat(BOUNDS.propGuidanceChars + 1),
    });
    expect(rejectionCode(withProps({ rows: pastLimit }))).toBe("prop_guidance_too_long");
  });
});

describe("validateComponentSpec — the optional collect block (D-08)", () => {
  /**
   * A collectable spec carries the framework's collection address as well as
   * its value prop, so these fixtures declare `name` — a spec that omits it is
   * rejected by the address rule below rather than reaching the block's own
   * checks.
   */
  function collectSpec(collect: unknown): Record<string, unknown> {
    return {
      ...withProps({
        name: collectNameProp(),
        value: stringProp({ guidance: "The current value." }),
        secret: { type: "boolean", guidance: "Hide the value.", default: false },
      }),
      collect,
    };
  }

  it("accepts a collect block naming a declared value prop", () => {
    const spec = accept(collectSpec({ collectable: true, valueProp: "value" }));
    expect(spec.collect?.valueProp).toBe("value");
    expect(spec.collect?.sensitiveProp).toBeUndefined();
  });

  it("freezes the collect block", () => {
    const spec = accept(collectSpec({ collectable: true, valueProp: "value" }));
    expect(Object.isFrozen(spec.collect)).toBe(true);
  });

  it("rejects a collect block whose valueProp is not a declared prop", () => {
    expect(rejectionCode(collectSpec({ collectable: true, valueProp: "missing" }))).toBe(
      "unknown_value_prop",
    );
  });

  it("rejects a sensitiveProp that is not a declared boolean prop", () => {
    expect(
      rejectionCode(collectSpec({ collectable: true, valueProp: "value", sensitiveProp: "value" })),
    ).toBe("invalid_sensitive_prop");
    expect(
      rejectionCode(
        collectSpec({ collectable: true, valueProp: "value", sensitiveProp: "missing" }),
      ),
    ).toBe("invalid_sensitive_prop");
  });

  it("rejects collectable false — a non-collectable component omits the block entirely", () => {
    expect(rejectionCode(collectSpec({ collectable: false, valueProp: "value" }))).toBe(
      "invalid_collectable",
    );
  });

  it("rejects an unknown key inside the collect block", () => {
    expect(
      rejectionCode(collectSpec({ collectable: true, valueProp: "value", writable: true })),
    ).toBe("unknown_collect_key");
  });

  it("rejects a collect block that is not a record", () => {
    expect(rejectionCode(collectSpec("value"))).toBe("invalid_collect");
    expect(rejectionCode(collectSpec(null))).toBe("invalid_collect");
  });
});

/**
 * The collection address (D-08).
 *
 * A `Button`'s `collect` list addresses fields by their authored name, so the
 * address has to be part of the declared contract. `CollectSpec` stays closed —
 * there is no `nameProp` — and the exact lowercase `name` is the address
 * instead, which every collectable spec must declare as a required scalar
 * string. The rejections are pinned to **one** code,
 * `nonconforming_collect_name`, whose location names the offending key, and the
 * whole rule is scoped to collectable specs: elsewhere `name` is ordinary.
 */
describe("validateComponentSpec — the framework collection address (D-08)", () => {
  const valueProps: Record<string, unknown> = {
    value: stringProp({ guidance: "The current value." }),
  };

  /** A collectable spec over the given prop contract. */
  function collectable(
    props: Record<string, unknown>,
    collect: unknown = { collectable: true, valueProp: "value" },
  ): Record<string, unknown> {
    return { ...withProps(props), collect };
  }

  /** The same, with `name` declared by a schema of the caller's choosing. */
  function named(schema: unknown): Record<string, unknown> {
    return collectable({ ...valueProps, name: schema });
  }

  /** The same again, with the conforming address bent by `overrides`. */
  function addressed(overrides: Record<string, unknown>): Record<string, unknown> {
    return named(collectNameProp(overrides));
  }

  it("accepts a collectable spec whose `name` is a required scalar string", () => {
    const spec = accept(addressed({}));
    expect(spec.props["name"]).toEqual({
      type: "string",
      required: true,
      guidance: "The name a collect list addresses this field by.",
    });
  });

  it("keeps `CollectSpec` closed — the address is a prop, not a `nameProp` key", () => {
    const spec = collectable(
      { ...valueProps, name: collectNameProp() },
      { collectable: true, valueProp: "value", nameProp: "name" },
    );
    expect(rejectionCode(spec)).toBe("unknown_collect_key");
    expect(rejectionAt(spec)).toBe("collect.nameProp");
  });

  it("accepts the address without widening the collect block itself", () => {
    expect(Object.keys(accept(addressed({})).collect ?? {})).toEqual(["collectable", "valueProp"]);
  });

  it("rejects a collectable spec that declares no `name` prop at all", () => {
    expect(rejectionCode(collectable(valueProps))).toBe("nonconforming_collect_name");
    expect(rejectionAt(collectable(valueProps))).toBe("props.name");
  });

  it("rejects an address that is not a scalar string", () => {
    const wrongType = addressed({ type: "number" });
    expect(rejectionCode(wrongType)).toBe("nonconforming_collect_name");
    expect(rejectionAt(wrongType)).toBe("props.name.type");
  });

  it("rejects a bound address — the structured branch is named by the type check", () => {
    const bound = named({ type: "array", required: true, bindable: true, guidance: "The name." });
    expect(rejectionCode(bound)).toBe("nonconforming_collect_name");
    expect(rejectionAt(bound)).toBe("props.name.type");
  });

  it("rejects an address that omits `required`", () => {
    const optional = named({ type: "string", guidance: "The name." });
    expect(rejectionCode(optional)).toBe("nonconforming_collect_name");
    expect(rejectionAt(optional)).toBe("props.name.required");
  });

  it("rejects an address declaring `required: false`", () => {
    const optional = addressed({ required: false });
    expect(rejectionCode(optional)).toBe("nonconforming_collect_name");
    expect(rejectionAt(optional)).toBe("props.name.required");
  });

  it("rejects a `default` on the address — the key, not a falsy value", () => {
    const defaulted = named({ type: "string", guidance: "The name.", default: "amount" });
    expect(rejectionCode(defaulted)).toBe("nonconforming_collect_name");
    expect(rejectionAt(defaulted)).toBe("props.name.default");
  });

  it("rejects an `enum` on the address", () => {
    const domained = addressed({ enum: ["amount", "note"] });
    expect(rejectionCode(domained)).toBe("nonconforming_collect_name");
    expect(rejectionAt(domained)).toBe("props.name.enum");
  });

  it("rejects `bindable: true` on the address", () => {
    const bindable = addressed({ bindable: true });
    expect(rejectionCode(bindable)).toBe("nonconforming_collect_name");
    expect(rejectionAt(bindable)).toBe("props.name.bindable");
  });

  it("rejects `bindable: false` on the address — an absent key is required", () => {
    const bindable = addressed({ bindable: false });
    expect(rejectionCode(bindable)).toBe("nonconforming_collect_name");
    expect(rejectionAt(bindable)).toBe("props.name.bindable");
  });

  it("pins one code for every nonconformity, so WU-13/WU-25/WU-36 mirror one name", () => {
    const nonconforming: readonly Record<string, unknown>[] = [
      collectable(valueProps),
      addressed({ type: "number" }),
      named({ type: "array", required: true, bindable: true, guidance: "The name." }),
      named({ type: "string", guidance: "The name." }),
      addressed({ required: false }),
      named({ type: "string", guidance: "The name.", default: "amount" }),
      addressed({ enum: ["amount"] }),
      addressed({ bindable: true }),
      addressed({ bindable: false }),
      collectable(
        { ...valueProps, name: collectNameProp() },
        { collectable: true, valueProp: "name" },
      ),
    ];
    expect(nonconforming.map(rejectionCode)).toEqual(
      Array.from({ length: 10 }, () => "nonconforming_collect_name"),
    );
  });

  it("leaves `name` an ordinary prop on a spec that collects nothing", () => {
    expect(validateComponentSpec(withProps(valueProps)).ok).toBe(true);
    const bound = withProps({
      name: { type: "object", guidance: "A bound record.", bindable: true },
    });
    expect(validateComponentSpec(bound).ok).toBe(true);
    const defaulted = withProps({ name: stringProp({ default: "amount", enum: ["amount"] }) });
    expect(validateComponentSpec(defaulted).ok).toBe(true);
  });

  it("reports the collect block's own faults before the missing address", () => {
    const bare = (collect: unknown): Record<string, unknown> => collectable(valueProps, collect);
    expect(rejectionCode(bare("value"))).toBe("invalid_collect");
    expect(rejectionCode(bare({ collectable: true, valueProp: "value", writable: true }))).toBe(
      "unknown_collect_key",
    );
    expect(rejectionCode(bare({ collectable: false, valueProp: "value" }))).toBe(
      "invalid_collectable",
    );
    expect(rejectionCode(bare({ collectable: true, valueProp: "missing" }))).toBe(
      "unknown_value_prop",
    );
    expect(
      rejectionCode(bare({ collectable: true, valueProp: "value", sensitiveProp: "value" })),
    ).toBe("invalid_sensitive_prop");
    // An undeclared `valueProp` keeps its own earlier code even when the name it
    // spells is the address — the collision branch below is never reached.
    expect(rejectionCode(bare({ collectable: true, valueProp: "name" }))).toBe(
      "unknown_value_prop",
    );
  });

  it("rejects a `valueProp` that names the address itself", () => {
    const collided = collectable(
      { ...valueProps, name: collectNameProp() },
      { collectable: true, valueProp: "name" },
    );
    expect(rejectionCode(collided)).toBe("nonconforming_collect_name");
    expect(rejectionAt(collided)).toBe("collect.valueProp");
  });

  it("names the address's own fault before the collision, when it has both", () => {
    // The collision branch runs only once a conforming address exists, so a
    // spec that is wrong in both ways reports the address fault it has.
    const both = collectable(
      { ...valueProps, name: collectNameProp({ bindable: true }) },
      { collectable: true, valueProp: "name" },
    );
    expect(rejectionCode(both)).toBe("nonconforming_collect_name");
    expect(rejectionAt(both)).toBe("props.name.bindable");
  });

  it("needs no rule for `sensitiveProp` — the boolean schema already refuses it", () => {
    // The address is a required string, so naming it as the sensitive flag is a
    // type mismatch the pre-existing check catches, ahead of the address rule.
    const collided = collectable(
      { ...valueProps, name: collectNameProp() },
      { collectable: true, valueProp: "value", sensitiveProp: "name" },
    );
    expect(rejectionCode(collided)).toBe("invalid_sensitive_prop");
    expect(rejectionAt(collided)).toBe("collect.sensitiveProp");
  });

  it("leaves the address to ordinary prop validation first", () => {
    const overlong = addressed({ guidance: "n".repeat(BOUNDS.propGuidanceChars + 1) });
    expect(rejectionCode(overlong)).toBe("prop_guidance_too_long");
    expect(rejectionCode(addressed({ default: "amount" }))).toBe("required_prop_with_default");
  });

  it("is deterministic — the same address rejection repeats exactly", () => {
    const bad = collectable(valueProps);
    expect(validateComponentSpec(bad)).toEqual(validateComponentSpec(bad));
  });
});

/**
 * The collection request list (D-08).
 *
 * The other half of the same framework convention. A `Button` names the fields
 * its event carries by writing them into one authored prop, so that prop name is
 * reserved as well: the exact lowercase `collect`. It is **not** part of
 * `CollectSpec` — the block stays closed at `collectable`/`valueProp`/
 * `sensitiveProp` — and it is deliberately **not** gated on collectability,
 * because the two are independent. A `Button` declares the list and collects
 * nothing; a `Field` is collectable and declares no list. Reserving the name
 * only for collectable specs would leave the one component that actually writes
 * it unguarded.
 *
 * Every nonconforming declaration rejects under one pinned code,
 * `nonconforming_collect_request`, whose location names the offending key. That
 * is a **different question** from `nonconforming_collect_name`: this rule reads
 * a catalog's **declaration** of the request list, that one reads the
 * **address** a request resolves to. The two never share a code or a location,
 * and this one — a rule about `props` — is answered first.
 */
describe("validateComponentSpec — the framework collection request list (D-08)", () => {
  /** The request list in its conforming shape: a scalar string with guidance. */
  function requestProp(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      type: "string",
      guidance: "The field names this event carries, separated by spaces.",
      ...overrides,
    };
  }

  /** A spec that declares the list and collects nothing — a `Button`. */
  function requester(schema: unknown = requestProp()): Record<string, unknown> {
    return withProps({ label: stringProp(), collect: schema });
  }

  const collectedValueProp: Record<string, unknown> = {
    type: "string",
    guidance: "The current value.",
  };

  /**
   * Declares no address at all. A bare `undefined` cannot say this: it is what a
   * defaulted parameter reads as, so a fixture meaning "no `name` prop" would
   * silently be handed the conforming one.
   */
  const NO_ADDRESS = Symbol("no collection address");

  /** A collectable spec whose request list, address and block the caller chooses. */
  function collectingRequester(
    request: unknown,
    name: unknown = collectNameProp(),
    block: unknown = { collectable: true, valueProp: "value" },
  ): Record<string, unknown> {
    const props: Record<string, unknown> = { value: collectedValueProp, collect: request };
    if (name !== NO_ADDRESS) {
      props["name"] = name;
    }
    return { ...withProps(props), collect: block };
  }

  it("accepts a scalar string `collect` on a spec that collects nothing", () => {
    const spec = accept(requester());
    expect(spec.props["collect"]).toEqual({
      type: "string",
      guidance: "The field names this event carries, separated by spaces.",
    });
    expect(spec.collect).toBeUndefined();
  });

  it("accepts either `required` — unlike the address, the list is not compulsory", () => {
    expect(accept(requester(requestProp({ required: true }))).props["collect"]?.required).toBe(
      true,
    );
    expect(accept(requester(requestProp({ required: false }))).props["collect"]?.required).toBe(
      false,
    );
  });

  it("rejects a non-string request list — the reservation does not depend on its type", () => {
    for (const type of ["number", "boolean"]) {
      const wrong = requester({ type, guidance: "An ordinary value this catalog declares." });
      expect(rejectionCode(wrong)).toBe("nonconforming_collect_request");
      expect(rejectionAt(wrong)).toBe("props.collect.type");
    }
  });

  it("rejects a structured request list at its type, ahead of the binding key", () => {
    const bound = requester({ type: "array", guidance: "Bound rows.", bindable: true });
    expect(rejectionCode(bound)).toBe("nonconforming_collect_request");
    expect(rejectionAt(bound)).toBe("props.collect.type");
  });

  it("rejects a `default` on the request list — the key, not a falsy value", () => {
    const defaulted = requester(requestProp({ default: "" }));
    expect(rejectionCode(defaulted)).toBe("nonconforming_collect_request");
    expect(rejectionAt(defaulted)).toBe("props.collect.default");
  });

  it("rejects an `enum` on the request list", () => {
    const domained = requester(requestProp({ enum: ["amount note"] }));
    expect(rejectionCode(domained)).toBe("nonconforming_collect_request");
    expect(rejectionAt(domained)).toBe("props.collect.enum");
  });

  it("rejects `bindable: true` — a request list is authored, never bound", () => {
    const bindable = requester(requestProp({ bindable: true }));
    expect(rejectionCode(bindable)).toBe("nonconforming_collect_request");
    expect(rejectionAt(bindable)).toBe("props.collect.bindable");
  });

  it("rejects `bindable: false` — an absent key is required, not a false one", () => {
    const bindable = requester(requestProp({ bindable: false }));
    expect(rejectionCode(bindable)).toBe("nonconforming_collect_request");
    expect(rejectionAt(bindable)).toBe("props.collect.bindable");
  });

  it("pins one code for every nonconformity, each at its own location", () => {
    const rows: readonly (readonly [Record<string, unknown>, string])[] = [
      [requester({ type: "number", guidance: "A count." }), "props.collect.type"],
      [requester({ type: "boolean", guidance: "A flag." }), "props.collect.type"],
      [
        requester({ type: "object", guidance: "A bound record.", bindable: true }),
        "props.collect.type",
      ],
      [requester(requestProp({ default: "" })), "props.collect.default"],
      [requester(requestProp({ enum: ["amount"] })), "props.collect.enum"],
      [requester(requestProp({ bindable: true })), "props.collect.bindable"],
      [requester(requestProp({ bindable: false })), "props.collect.bindable"],
    ];
    expect(rows.map(([value]) => rejectionCode(value))).toEqual(
      rows.map(() => "nonconforming_collect_request"),
    );
    expect(rows.map(([value]) => rejectionAt(value))).toEqual(rows.map(([, at]) => at));
  });

  it("applies to a collectable spec that also declares a list", () => {
    const spec = collectingRequester(requestProp({ enum: ["amount"] }));
    expect(rejectionCode(spec)).toBe("nonconforming_collect_request");
    expect(rejectionAt(spec)).toBe("props.collect.enum");
  });

  it("obliges nobody to declare it — a collectable spec with no list is accepted", () => {
    const field = {
      ...withProps({ value: collectedValueProp, name: collectNameProp() }),
      collect: { collectable: true, valueProp: "value" },
    };
    expect(validateComponentSpec(field).ok).toBe(true);
  });

  it("matches the exact lowercase name — `Collect`, `COLLECT` and `collects` stay ordinary", () => {
    for (const name of ["Collect", "COLLECT", "collects"]) {
      const ordinary = withProps({
        [name]: { type: "object", guidance: "A bound record.", bindable: true },
      });
      expect(validateComponentSpec(ordinary).ok).toBe(true);
    }
  });

  it("stays distinguishable from the address rule — same fault key, two codes", () => {
    // One `bindable: true`, two different reserved props. The codes and the
    // locations both separate them, or a consumer reading either one cannot
    // tell a bad request declaration from a bad address.
    const request = requester(requestProp({ bindable: true }));
    const address = collectingRequester(requestProp(), collectNameProp({ bindable: true }));
    expect([rejectionCode(request), rejectionAt(request)]).toEqual([
      "nonconforming_collect_request",
      "props.collect.bindable",
    ]);
    expect([rejectionCode(address), rejectionAt(address)]).toEqual([
      "nonconforming_collect_name",
      "props.name.bindable",
    ]);
  });

  it("runs ahead of the address rule, which answers a different question", () => {
    // Wrong in both ways: the declared list is bound and the address is absent.
    const both = collectingRequester(requestProp({ bindable: true }), NO_ADDRESS);
    expect(rejectionCode(both)).toBe("nonconforming_collect_request");
    expect(rejectionAt(both)).toBe("props.collect.bindable");
    // The control: the same spec with a conforming list reaches the address
    // rule, so the row above rejects for the declaration it has rather than for
    // the missing address it also has.
    const addressOnly = collectingRequester(requestProp(), NO_ADDRESS);
    expect(rejectionCode(addressOnly)).toBe("nonconforming_collect_name");
    expect(rejectionAt(addressOnly)).toBe("props.name");
  });

  it("runs ahead of every fault inside the collect block, because it reads props", () => {
    const blocks: readonly unknown[] = [
      "value",
      { collectable: true, valueProp: "value", writable: true },
      { collectable: false, valueProp: "value" },
      { collectable: true, valueProp: "missing" },
      { collectable: true, valueProp: "value", sensitiveProp: "value" },
      { collectable: true, valueProp: "name" },
    ];
    for (const block of blocks) {
      const spec = collectingRequester(requestProp({ bindable: true }), collectNameProp(), block);
      expect(rejectionCode(spec)).toBe("nonconforming_collect_request");
      expect(rejectionAt(spec)).toBe("props.collect.bindable");
    }
    // The control: with a conforming list each block reports its own fault, so
    // the rows above are not all rejecting through one shared neighbour.
    expect(
      blocks.map((block) =>
        rejectionCode(collectingRequester(requestProp(), collectNameProp(), block)),
      ),
    ).toEqual([
      "invalid_collect",
      "unknown_collect_key",
      "invalid_collectable",
      "unknown_value_prop",
      "invalid_sensitive_prop",
      "nonconforming_collect_name",
    ]);
  });

  it("leaves the request list to ordinary prop validation first", () => {
    const overlong = requestProp({ guidance: "n".repeat(BOUNDS.propGuidanceChars + 1) });
    expect(rejectionCode(requester(overlong))).toBe("prop_guidance_too_long");
    // "with guidance" needs no rule of its own — every prop already needs it.
    expect(rejectionCode(requester({ type: "string" }))).toBe("invalid_prop_guidance");
    expect(rejectionAt(requester({ type: "string" }))).toBe("props.collect.guidance");
    expect(rejectionCode(requester(requestProp({ required: true, default: "amount" })))).toBe(
      "required_prop_with_default",
    );
    expect(rejectionCode(requester(requestProp({ items: "name" })))).toBe("unknown_prop_key");
    expect(rejectionCode(requester("collect"))).toBe("invalid_prop_schema");
  });

  it("runs after the whole prop record, not at its own key in sorted order", () => {
    // `zebra` sorts after `collect`, so a rule fired mid-loop would report the
    // request list. The ordinary fault is reported instead.
    const spec = withProps({
      collect: requestProp({ bindable: true }),
      zebra: { type: "string" },
    });
    expect(rejectionCode(spec)).toBe("invalid_prop_guidance");
    expect(rejectionAt(spec)).toBe("props.zebra.guidance");
  });

  it("is deterministic — the same request rejection repeats exactly", () => {
    const bad = requester(requestProp({ bindable: false }));
    expect(validateComponentSpec(bad)).toEqual(validateComponentSpec(bad));
  });
});

/**
 * The framework event argument (D-07).
 *
 * A third reserved name, and a **different** convention from the two collection
 * ones. An `agent:` event carries one explicit argument, pinned in the six-field
 * payload and bounded by B-23, and the renderer forwards it by reading the exact
 * lowercase declared prop `arg`. Reading a framework convention is not the
 * renderer inferring meaning from a component-specific prop, so the name is
 * reserved exactly as `collect` and `name` are.
 *
 * The conforming shape is a scalar `string` with guidance, carrying no `default`
 * and no `bindable` key. Two differences from the request list are deliberate:
 * `required` may be either value or absent, because whether a component must
 * carry an argument is a question about that component; and `enum` **stays
 * allowed**, because a closed set of argument values is an authoring constraint
 * the catalog declares, not a framework leak. A blind reuse of the request
 * list's forbidden-key set would forbid it.
 *
 * Every nonconforming declaration rejects under one pinned code,
 * `nonconforming_event_arg`, whose location names the offending key.
 */
describe("validateComponentSpec — the framework event argument (D-07)", () => {
  /** The event argument in its conforming shape: a scalar string with guidance. */
  function argProp(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      type: "string",
      guidance: "One explicit argument sent with an `agent:` event.",
      ...overrides,
    };
  }

  /** A spec that declares the argument — a `Button`. */
  function sender(schema: unknown = argProp()): Record<string, unknown> {
    return withProps({ label: stringProp(), arg: schema });
  }

  /** The request list in its conforming shape, for the ordering rows below. */
  function requestProp(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { type: "string", guidance: "The field names this event carries.", ...overrides };
  }

  it("accepts a scalar string `arg` — the shape the default `Button` declares", () => {
    const spec = accept(sender());
    expect(spec.props["arg"]).toEqual({
      type: "string",
      guidance: "One explicit argument sent with an `agent:` event.",
    });
  });

  it("accepts either `required`, and reads it back off the accepted spec", () => {
    // Read back rather than merely accepted: a validator that dropped the key
    // would otherwise pass this row.
    expect(accept(sender(argProp({ required: true }))).props["arg"]?.required).toBe(true);
    expect(accept(sender(argProp({ required: false }))).props["arg"]?.required).toBe(false);
    // Absence is asserted as a missing key. `toEqual` cannot tell an absent
    // `required` from one present and `undefined`.
    const omitted = accept(sender()).props["arg"];
    if (omitted === undefined) {
      throw new Error("the accepted spec dropped the argument prop entirely");
    }
    expect("required" in omitted).toBe(false);
  });

  it("accepts an `enum` on the argument, and reads the domain back off the spec", () => {
    // The opposite of the request list, on purpose: a closed set of argument
    // values is an authoring constraint, so the forbidden-key set is not shared.
    const arg = accept(sender(argProp({ enum: ["approve", "reject"] }))).props["arg"];
    expect(arg?.type).toBe("string");
    expect(arg?.type === "string" ? arg.enum : undefined).toEqual(["approve", "reject"]);
  });

  it("accepts a required argument drawn from a domain — the two combine", () => {
    const arg = accept(sender(argProp({ required: true, enum: ["approve"] }))).props["arg"];
    expect(arg?.required).toBe(true);
    expect(arg?.type === "string" ? arg.enum : undefined).toEqual(["approve"]);
  });

  it("obliges nobody to declare it — a spec with no `arg` is accepted", () => {
    expect("arg" in (minimalSpec()["props"] as Record<string, unknown>)).toBe(false);
    expect(validateComponentSpec(minimalSpec()).ok).toBe(true);
  });

  it("rejects a non-string argument — the reservation does not depend on its type", () => {
    for (const type of ["number", "boolean"]) {
      const wrong = sender({ type, guidance: "An ordinary value this catalog declares." });
      expect(rejectionCode(wrong)).toBe("nonconforming_event_arg");
      expect(rejectionAt(wrong)).toBe("props.arg.type");
    }
  });

  it("rejects a structured argument at its type, ahead of the binding key", () => {
    const bound = sender({ type: "array", guidance: "Bound rows.", bindable: true });
    expect(rejectionCode(bound)).toBe("nonconforming_event_arg");
    expect(rejectionAt(bound)).toBe("props.arg.type");
  });

  it("rejects a `default` on the argument — the key, not a falsy value", () => {
    const defaulted = sender(argProp({ default: "" }));
    expect(rejectionCode(defaulted)).toBe("nonconforming_event_arg");
    expect(rejectionAt(defaulted)).toBe("props.arg.default");
  });

  it("rejects a `default` even when it sits inside a legal domain", () => {
    const defaulted = sender(argProp({ enum: ["approve"], default: "approve" }));
    expect(rejectionCode(defaulted)).toBe("nonconforming_event_arg");
    expect(rejectionAt(defaulted)).toBe("props.arg.default");
  });

  it("rejects `bindable: true` — the argument is authored, never bound", () => {
    const bindable = sender(argProp({ bindable: true }));
    expect(rejectionCode(bindable)).toBe("nonconforming_event_arg");
    expect(rejectionAt(bindable)).toBe("props.arg.bindable");
  });

  it("rejects `bindable: false` — an absent key is required, not a false one", () => {
    const bindable = sender(argProp({ bindable: false }));
    expect(rejectionCode(bindable)).toBe("nonconforming_event_arg");
    expect(rejectionAt(bindable)).toBe("props.arg.bindable");
  });

  it("pins one code for every nonconformity, each at its own location", () => {
    const rows: readonly (readonly [Record<string, unknown>, string])[] = [
      [sender({ type: "number", guidance: "A count." }), "props.arg.type"],
      [sender({ type: "boolean", guidance: "A flag." }), "props.arg.type"],
      [sender({ type: "object", guidance: "A bound record.", bindable: true }), "props.arg.type"],
      [sender(argProp({ default: "" })), "props.arg.default"],
      [sender(argProp({ bindable: true })), "props.arg.bindable"],
      [sender(argProp({ bindable: false })), "props.arg.bindable"],
    ];
    expect(rows.map(([value]) => rejectionCode(value))).toEqual(
      rows.map(() => "nonconforming_event_arg"),
    );
    expect(rows.map(([value]) => rejectionAt(value))).toEqual(rows.map(([, at]) => at));
  });

  it("matches the exact lowercase name — `Arg`, `args` and `argument` stay ordinary", () => {
    const bound = { type: "object", guidance: "A bound record.", bindable: true };
    for (const name of ["Arg", "args", "argument"]) {
      expect(validateComponentSpec(withProps({ [name]: bound })).ok).toBe(true);
    }
    // The contrast: the exact lowercase name under the very same schema rejects,
    // so the three rows above pass for the name they carry rather than because
    // the rule never fires.
    expect(rejectionCode(withProps({ arg: bound }))).toBe("nonconforming_event_arg");
    expect(rejectionAt(withProps({ arg: bound }))).toBe("props.arg.type");
  });

  it("is not gated on the collect block — a collectable spec is read the same way", () => {
    const field = {
      ...withProps({
        arg: argProp({ bindable: true }),
        name: collectNameProp(),
        value: stringProp({ guidance: "The current value." }),
      }),
      collect: { collectable: true, valueProp: "value" },
    };
    expect(rejectionCode(field)).toBe("nonconforming_event_arg");
    expect(rejectionAt(field)).toBe("props.arg.bindable");
  });

  it("runs after the request-list rule, which answers a different question", () => {
    // Wrong in both ways: the request list is bound and so is the argument.
    const both = withProps({
      arg: argProp({ bindable: true }),
      collect: requestProp({ bindable: true }),
    });
    expect(rejectionCode(both)).toBe("nonconforming_collect_request");
    expect(rejectionAt(both)).toBe("props.collect.bindable");
    // The control: with a conforming list the same spec reaches the argument
    // rule, so the row above rejects for the list it has rather than silently.
    const argOnly = withProps({ arg: argProp({ bindable: true }), collect: requestProp() });
    expect(rejectionCode(argOnly)).toBe("nonconforming_event_arg");
    expect(rejectionAt(argOnly)).toBe("props.arg.bindable");
  });

  it("stays distinguishable from both collection rules — one fault key, three codes", () => {
    const arg = withProps({ arg: argProp({ bindable: true }) });
    const request = withProps({ collect: requestProp({ bindable: true }) });
    const address = {
      ...withProps({
        name: collectNameProp({ bindable: true }),
        value: stringProp({ guidance: "The current value." }),
      }),
      collect: { collectable: true, valueProp: "value" },
    };
    expect([rejectionCode(arg), rejectionAt(arg)]).toEqual([
      "nonconforming_event_arg",
      "props.arg.bindable",
    ]);
    expect([rejectionCode(request), rejectionAt(request)]).toEqual([
      "nonconforming_collect_request",
      "props.collect.bindable",
    ]);
    expect([rejectionCode(address), rejectionAt(address)]).toEqual([
      "nonconforming_collect_name",
      "props.name.bindable",
    ]);
  });

  it("leaves the argument to ordinary prop validation first", () => {
    const overlong = argProp({ guidance: "n".repeat(BOUNDS.propGuidanceChars + 1) });
    expect(rejectionCode(sender(overlong))).toBe("prop_guidance_too_long");
    // "with guidance" needs no rule of its own — every prop already needs it.
    expect(rejectionCode(sender({ type: "string" }))).toBe("invalid_prop_guidance");
    expect(rejectionAt(sender({ type: "string" }))).toBe("props.arg.guidance");
    expect(rejectionCode(sender(argProp({ required: true, default: "x" })))).toBe(
      "required_prop_with_default",
    );
    expect(rejectionCode(sender(argProp({ enum: [] })))).toBe("empty_enum");
    expect(rejectionCode(sender(argProp({ items: "name" })))).toBe("unknown_prop_key");
    expect(rejectionCode(sender("arg"))).toBe("invalid_prop_schema");
  });

  it("runs after the whole prop record, not at its own key in sorted order", () => {
    // `zebra` sorts after `arg`, so a rule fired mid-loop would report the
    // argument. The ordinary fault is reported instead.
    const spec = withProps({ arg: argProp({ bindable: true }), zebra: { type: "string" } });
    expect(rejectionCode(spec)).toBe("invalid_prop_guidance");
    expect(rejectionAt(spec)).toBe("props.zebra.guidance");
  });

  it("is deterministic — the same argument rejection repeats exactly", () => {
    const bad = sender(argProp({ bindable: false }));
    expect(validateComponentSpec(bad)).toEqual(validateComponentSpec(bad));
  });
});

describe("validateComponentSpec — totality", () => {
  const nonSpecs: readonly unknown[] = [
    undefined,
    null,
    0,
    42,
    Number.NaN,
    true,
    false,
    "Card",
    [],
    [minimalSpec()],
    Symbol("Card"),
    () => minimalSpec(),
    new Date(0),
  ];

  it("returns a structured rejection rather than throwing on a non-spec input", () => {
    for (const input of nonSpecs) {
      expect(() => validateComponentSpec(input)).not.toThrow();
      expect(validateComponentSpec(input).ok).toBe(false);
    }
  });

  it("survives a throwing getter — a hostile host object is a rejection, not an exception", () => {
    const hostile = {
      get tag(): string {
        throw new Error("boom");
      },
    };
    expect(() => validateComponentSpec(hostile)).not.toThrow();
    expect(validateComponentSpec(hostile).ok).toBe(false);
  });

  it("survives a throwing proxy", () => {
    const hostile = new Proxy(minimalSpec(), {
      ownKeys(): never {
        throw new Error("boom");
      },
    });
    expect(() => validateComponentSpec(hostile)).not.toThrow();
    expect(validateComponentSpec(hostile).ok).toBe(false);
  });
});

describe("validateComponentSpec — bounds read from BOUNDS (DC-026)", () => {
  function propsOfSize(count: number): Record<string, unknown> {
    const props: Record<string, unknown> = {};
    for (let index = 0; index < count; index += 1) {
      props[`p${index}`] = stringProp();
    }
    return props;
  }

  it("B-10 — accepts exactly BOUNDS.propsPerComponentSpec props", () => {
    const spec = accept(withProps(propsOfSize(BOUNDS.propsPerComponentSpec)));
    expect(Object.keys(spec.props)).toHaveLength(BOUNDS.propsPerComponentSpec);
  });

  it("B-10 — rejects one prop past BOUNDS.propsPerComponentSpec", () => {
    expect(rejectionCode(withProps(propsOfSize(BOUNDS.propsPerComponentSpec + 1)))).toBe(
      "too_many_props",
    );
  });

  it("B-11 — accepts exactly BOUNDS.enumValuesPerProp enum values", () => {
    const domain = Array.from({ length: BOUNDS.enumValuesPerProp }, (_, index) => `v${index}`);
    expect(validateComponentSpec(withProps({ p: stringProp({ enum: domain }) })).ok).toBe(true);
  });

  it("B-11 — rejects one enum value past BOUNDS.enumValuesPerProp", () => {
    const domain = Array.from({ length: BOUNDS.enumValuesPerProp + 1 }, (_, index) => `v${index}`);
    expect(rejectionCode(withProps({ p: stringProp({ enum: domain }) }))).toBe(
      "too_many_enum_values",
    );
  });

  it("B-12 — accepts a when-to-use line of exactly BOUNDS.componentWhenToUseChars characters", () => {
    const line = "u".repeat(BOUNDS.componentWhenToUseChars);
    expect(validateComponentSpec({ ...minimalSpec(), whenToUse: line }).ok).toBe(true);
  });

  it("B-12 — rejects a when-to-use line one character past BOUNDS.componentWhenToUseChars", () => {
    const line = "u".repeat(BOUNDS.componentWhenToUseChars + 1);
    expect(rejectionCode({ ...minimalSpec(), whenToUse: line })).toBe("when_to_use_too_long");
  });

  it("B-13 — accepts per-prop guidance of exactly BOUNDS.propGuidanceChars characters", () => {
    const guidance = "g".repeat(BOUNDS.propGuidanceChars);
    expect(validateComponentSpec(withProps({ p: stringProp({ guidance }) })).ok).toBe(true);
  });

  it("B-13 — rejects per-prop guidance one character past BOUNDS.propGuidanceChars", () => {
    const guidance = "g".repeat(BOUNDS.propGuidanceChars + 1);
    expect(rejectionCode(withProps({ p: stringProp({ guidance }) }))).toBe(
      "prop_guidance_too_long",
    );
  });
});

/**
 * The public result contract, held the way a consumer holds it.
 *
 * These annotations — not the `expect` calls under them — are the test. vitest
 * erases `import type`, so a missing export leaves every assertion here green;
 * the typecheck is what fails. The block exists so the four names stay part of
 * the package's typechecked surface rather than only of a throwaway fixture.
 */
describe("validateComponentSpec — the public result contract", () => {
  it("lets a consumer declare the result type and narrow both of its branches", () => {
    const accepted: ComponentSpecValidationResult = validateComponentSpec(minimalSpec());
    expect(accepted.ok ? accepted.spec.tag : accepted.code).toBe("Card");

    const rejection: ComponentSpecValidationResult = {
      ok: false,
      code: "spec_not_an_object",
      at: "",
      detail: "A component spec must be a plain object.",
    };
    expect(validateComponentSpec(null)).toEqual(rejection);
  });

  it("lets a consumer name the structured prop type when it writes a PropSchema", () => {
    const type: StructuredPropType = "array";
    const schema: PropSchema = { type, guidance: "The rows to render.", bindable: true };
    expect(accept(withProps({ rows: schema })).props["rows"]).toEqual(schema);
  });
});
