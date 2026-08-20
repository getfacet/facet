import { describe, expect, it } from "vitest";

import { BOUNDS } from "./bounds.js";
import type { StructuredFieldSpec, StructuredShapeSpec } from "./structured-shape.js";
import { validateStructuredShapeSpec, validateStructuredValue } from "./structured-shape.js";

function acceptShape(value: unknown, at = "shape"): StructuredShapeSpec {
  const result = validateStructuredShapeSpec(value, at);
  if (!result.ok) {
    throw new Error(`expected acceptance, got ${result.code} at ${result.at}: ${result.detail}`);
  }
  return result.shape;
}

function rejection(value: unknown, at = "shape"): readonly [string, string] {
  const result = validateStructuredShapeSpec(value, at);
  return result.ok ? ["accepted", "accepted"] : [result.code, result.at];
}

function field(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "string",
    guidance: "A display-safe scalar field.",
    ...overrides,
  };
}

describe("validateStructuredShapeSpec - shallow closed fields", () => {
  it("accepts and snapshots a bounded scalar field schema", () => {
    const source = {
      fields: {
        disabled: field({ type: "boolean", required: false }),
        label: field({ required: true }),
        rank: field({ type: "number" }),
      },
    };

    const shape = acceptShape(source);

    expect(shape).toEqual(source);
    expect(Object.isFrozen(shape)).toBe(true);
    expect(Object.isFrozen(shape.fields)).toBe(true);
    expect(Object.isFrozen(shape.fields["label"])).toBe(true);

    source.fields.label.guidance = "changed after validation";
    expect(shape.fields["label"]?.guidance).toBe("A display-safe scalar field.");
  });

  it("keeps the public field and shape types independently usable", () => {
    const label: StructuredFieldSpec = {
      type: "string",
      guidance: "The option label.",
      required: true,
    };
    const shape: StructuredShapeSpec = { fields: { label } };

    expect(shape.fields["label"]).toBe(label);
  });

  it("allows an explicitly closed empty object shape", () => {
    expect(acceptShape({ fields: {} })).toEqual({ fields: {} });
  });

  it("uses a caller-provided location when embedded in a prop schema", () => {
    expect(
      rejection({ fields: { label: field({ type: "array" }) } }, "props.options.shape"),
    ).toEqual(["invalid_structured_field_type", "props.options.shape.fields.label.type"]);
  });
});

describe("validateStructuredShapeSpec - closure and bounds", () => {
  it("rejects arbitrary JSON Schema and union keywords in sorted order", () => {
    expect(rejection({ fields: {}, oneOf: [], properties: {} })).toEqual([
      "unknown_structured_shape_key",
      "shape.oneOf",
    ]);
    expect(rejection({ fields: { label: field({ items: {}, oneOf: [] }) } })).toEqual([
      "unknown_structured_field_key",
      "shape.fields.label.items",
    ]);
  });

  it("rejects an oversized field descriptor before sorting all unknown keys", () => {
    const descriptor = Object.fromEntries(
      Array.from({ length: 100_000 }, (_, index) => [`unknown${index}`, true]),
    );
    const started = performance.now();

    expect(rejection({ fields: { label: descriptor } })).toEqual([
      "unknown_structured_field_key",
      "shape.fields.label",
    ]);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("requires a plain field map with bounded Facet field names", () => {
    expect(rejection({})).toEqual(["invalid_structured_fields", "shape.fields"]);
    expect(rejection({ fields: [] })).toEqual(["invalid_structured_fields", "shape.fields"]);
    expect(rejection({ fields: { "bad field": field() } })).toEqual([
      "invalid_structured_field_name",
      "shape.fields.bad field",
    ]);

    const tooMany = Object.fromEntries(
      Array.from({ length: BOUNDS.dataModelObjectKeys + 1 }, (_, index) => [
        `Field${index}`,
        field(),
      ]),
    );
    expect(rejection({ fields: tooMany })).toEqual(["too_many_structured_fields", "shape.fields"]);
  });

  it("treats non-enumerable field declarations as out-of-band JavaScript metadata", () => {
    const fields = {};
    Object.defineProperty(fields, "hidden", { value: field(), enumerable: false });

    expect(acceptShape({ fields })).toEqual({ fields: {} });
  });

  it("rejects a large field map without sorting the complete hostile input", () => {
    const fields = Object.fromEntries(
      Array.from({ length: 100_000 }, (_, index) => [`Field${index}`, field()]),
    );
    const started = performance.now();

    expect(rejection({ fields })).toEqual(["too_many_structured_fields", "shape.fields"]);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it.each([
    [null, "invalid_structured_field", "shape.fields.label"],
    [field({ type: "object" }), "invalid_structured_field_type", "shape.fields.label.type"],
    [field({ type: "string[]" }), "invalid_structured_field_type", "shape.fields.label.type"],
    [
      field({ guidance: undefined }),
      "invalid_structured_field_guidance",
      "shape.fields.label.guidance",
    ],
    [field({ guidance: "" }), "invalid_structured_field_guidance", "shape.fields.label.guidance"],
    [
      field({ guidance: "g".repeat(BOUNDS.propGuidanceChars + 1) }),
      "structured_field_guidance_too_long",
      "shape.fields.label.guidance",
    ],
    [
      field({ required: "yes" }),
      "invalid_structured_field_required",
      "shape.fields.label.required",
    ],
  ] as const)("rejects malformed scalar field declarations", (candidate, code, at) => {
    expect(rejection({ fields: { label: candidate } })).toEqual([code, at]);
  });
});

describe("validateStructuredValue - object and array item shapes", () => {
  const options = acceptShape({
    fields: {
      disabled: field({ type: "boolean" }),
      label: field({ required: true }),
      rank: field({ type: "number" }),
      value: field({ required: true }),
    },
  });

  it("accepts a closed object and an array of matching shallow objects", () => {
    const option = { label: "Most recent", value: "recent", disabled: false, rank: 1 };

    expect(validateStructuredValue(option, "object", options)).toBe(true);
    expect(
      validateStructuredValue([option, { label: "Popular", value: "popular" }], "array", options),
    ).toBe(true);
    expect(
      validateStructuredValue(
        Object.assign(Object.create(null) as Record<string, unknown>, {
          label: "Null prototype",
          value: "null-prototype",
        }),
        "object",
        options,
      ),
    ).toBe(true);
  });

  it.each([
    [{ value: "missing-label" }, "object"],
    [{ label: "Missing value" }, "object"],
    [{ label: "Wrong", value: 1 }, "object"],
    [{ label: "Nested", value: "nested", disabled: { nested: true } }, "object"],
    [{ label: "Extra", value: "extra", href: "https://example.com" }, "object"],
    [{ label: "Non-finite", value: "nan", rank: Number.NaN }, "object"],
    [
      [
        { label: "Good", value: "good" },
        { label: "Bad", value: false },
      ],
      "array",
    ],
    [{ label: "Not an array", value: "single" }, "array"],
    [["not-an-object"], "array"],
  ] as const)("rejects a mismatched %s value", (candidate, type) => {
    expect(validateStructuredValue(candidate, type, options)).toBe(false);
  });

  it("enforces existing Data Model string and array bounds", () => {
    expect(
      validateStructuredValue(
        { label: "l".repeat(BOUNDS.dataModelStringChars), value: "at-limit" },
        "object",
        options,
      ),
    ).toBe(true);
    expect(
      validateStructuredValue(
        { label: "l".repeat(BOUNDS.dataModelStringChars + 1), value: "past-limit" },
        "object",
        options,
      ),
    ).toBe(false);

    const oversized = new Array(BOUNDS.dataModelArrayLength + 1).fill({
      label: "Bounded",
      value: "bounded",
    });
    expect(validateStructuredValue(oversized, "array", options)).toBe(false);
  });

  it("rejects an unreadable or forged shape instead of weakening it", () => {
    const invalidShape = { fields: { label: field({ type: "object" }) } };
    const hostileShape = {
      get fields(): never {
        throw new Error("boom");
      },
    };

    expect(
      validateStructuredValue(
        { label: "Looks valid" },
        "object",
        invalidShape as unknown as StructuredShapeSpec,
      ),
    ).toBe(false);
    expect(
      validateStructuredValue(
        { label: "Looks valid" },
        "object",
        hostileShape as unknown as StructuredShapeSpec,
      ),
    ).toBe(false);
  });
});

describe("structured shape totality", () => {
  it.each([undefined, null, 1, "shape", [], new Date(0)])(
    "returns a structured rejection for %j",
    (value) => {
      expect(() => validateStructuredShapeSpec(value)).not.toThrow();
      expect(validateStructuredShapeSpec(value).ok).toBe(false);
    },
  );

  it("survives hostile schema and value access", () => {
    const hostileShape = new Proxy(
      { fields: {} },
      {
        ownKeys(): never {
          throw new Error("boom");
        },
      },
    );
    expect(rejection(hostileShape)).toEqual(["structured_shape_read_failed", "shape"]);

    const shape = acceptShape({ fields: { label: field({ required: true }) } });
    const hostileValue = {
      get label(): never {
        throw new Error("boom");
      },
    };
    const hostileArray = new Proxy([hostileValue], {
      get(target, property, receiver) {
        if (property === "length") {
          throw new Error("boom");
        }
        return Reflect.get(target, property, receiver);
      },
    });

    expect(() => validateStructuredValue(hostileValue, "object", shape)).not.toThrow();
    expect(validateStructuredValue(hostileValue, "object", shape)).toBe(false);
    expect(() => validateStructuredValue(hostileArray, "array", shape)).not.toThrow();
    expect(validateStructuredValue(hostileArray, "array", shape)).toBe(false);
  });
});
