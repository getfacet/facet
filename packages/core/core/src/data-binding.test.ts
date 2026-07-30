import { describe, expect, it } from "vitest";

import type { PropSchema } from "./component-spec.js";
import { resolveBinding } from "./data-binding.js";
import type { BindingResolution } from "./data-binding.js";
import type { DataModel } from "./data-model.js";

/**
 * The consumer-shaped proof that this module's public result type can be
 * **named**. `resolveBinding` is public, so a renderer or validator that holds a
 * resolution, threads it through a helper, or narrows it in a second function
 * has to annotate it — and an unexported result type makes that `TS2459`.
 *
 * **vitest cannot catch this**: `import type` is erased by esbuild, so a missing
 * type export runs green and only `tsc` sees it. The tests below call this
 * helper so the runtime behaviour is exercised too.
 */
function describeResolution(resolution: BindingResolution): string {
  return resolution.ok ? `ok:${typeof resolution.value}` : `reject:${resolution.reason}`;
}

/** A representative model: scalars, an empty-but-present value, and a row collection. */
const MODEL: DataModel = {
  metrics: {
    revenue: "1,204",
    orders: 42,
    growing: true,
    note: "",
    tags: [],
    breakdown: {},
    missingish: null,
  },
  sales: {
    rows: [
      { region: "north", total: 10 },
      { region: "south", total: 12 },
    ],
  },
  status: "active",
};

const BINDABLE_STRING = { type: "string", bindable: true } as const;
const BINDABLE_NUMBER = { type: "number", bindable: true } as const;
const BINDABLE_BOOLEAN = { type: "boolean", bindable: true } as const;
const BINDABLE_ARRAY = { type: "array", bindable: true } as const;
const BINDABLE_OBJECT = { type: "object", bindable: true } as const;

/** Resolves and returns the reject reason, failing if the binding resolved. */
function reasonFor(reference: unknown, schema: unknown, model: DataModel = MODEL): string {
  const result = resolveBinding(reference, model, schema);
  if (result.ok) {
    throw new Error(`expected a rejected binding, got ${JSON.stringify(result.value)}`);
  }
  return result.reason;
}

/** Resolves and returns the bound value, failing if the binding was rejected. */
function valueOf(reference: unknown, schema: unknown, model: DataModel = MODEL): unknown {
  const result = resolveBinding(reference, model, schema);
  if (!result.ok) {
    throw new Error(`expected a resolved binding, got ${result.reason}`);
  }
  return result.value;
}

/** The closed reject vocabulary, restated here so a silent widening fails a test. */
const REJECT_REASONS: readonly string[] = [
  "invalid_prop_schema",
  "prop_not_bindable",
  "invalid_reference",
  "path_not_found",
  "schema_mismatch",
];

/**
 * Asserts the outcome of a hostile input is a **well-formed structured
 * rejection** — not merely "did not throw".
 *
 * Totality is two claims, and a `not.toThrow()` only covers the first. A helper
 * that swallowed everything into `undefined`, or that returned an `ok: true`
 * with no value, would pass a throw-only assertion while breaking every caller.
 * So this checks the discriminant, the closed reason vocabulary, and the absence
 * of a `value` on the reject branch, and it returns the reason so the caller can
 * pin the *specific* one rather than accepting any rejection.
 */
function rejectionFor(reference: unknown, model: DataModel, schema: unknown): string {
  let result: BindingResolution | undefined;
  expect(() => {
    result = resolveBinding(reference, model, schema);
  }).not.toThrow();
  if (result === undefined) {
    throw new Error("resolveBinding returned nothing");
  }
  expect(result.ok).toBe(false);
  expect(result).not.toHaveProperty("value");
  if (result.ok) {
    throw new Error("unreachable — asserted above");
  }
  expect(REJECT_REASONS).toContain(result.reason);
  return result.reason;
}

describe("the module's named public result type", () => {
  it("lets a consumer name and narrow a resolution without restating its shape", () => {
    expect(describeResolution(resolveBinding("data:metrics.revenue", MODEL, BINDABLE_STRING))).toBe(
      "ok:string",
    );
    expect(describeResolution(resolveBinding("data:sales.rows", MODEL, BINDABLE_ARRAY))).toBe(
      "ok:object",
    );
    expect(describeResolution(resolveBinding("data:absent", MODEL, BINDABLE_STRING))).toBe(
      "reject:path_not_found",
    );
    expect(describeResolution(resolveBinding("data:metrics.revenue", MODEL, null))).toBe(
      "reject:invalid_prop_schema",
    );
  });

  it("lets a consumer hold a resolution before deciding what to do with it", () => {
    // The annotation is the point: a caller that stores the outcome rather than
    // narrowing it inline is exactly the caller an unexported result type blocks.
    const held: BindingResolution = resolveBinding("data:metrics.orders", MODEL, BINDABLE_NUMBER);
    expect(held.ok).toBe(true);
    expect(describeResolution(held)).toBe("ok:number");
  });
});

describe("resolveBinding — the authored reference form", () => {
  it("resolves a reference written in its authored `data:` form", () => {
    expect(valueOf("data:metrics.revenue", BINDABLE_STRING)).toBe("1,204");
  });

  it("resolves the same reference with the prefix already stripped", () => {
    expect(valueOf("metrics.revenue", BINDABLE_STRING)).toBe("1,204");
  });

  it("rejects a reference that is not a legal data path", () => {
    expect(reasonFor("data:", BINDABLE_STRING)).toBe("invalid_reference");
    expect(reasonFor("metrics..revenue", BINDABLE_STRING)).toBe("invalid_reference");
    expect(reasonFor("metrics.1", BINDABLE_STRING)).toBe("invalid_reference");
    expect(reasonFor("sales.rows.0.region", BINDABLE_STRING)).toBe("invalid_reference");
    expect(reasonFor("a.b.c.d.e.f.g.h.i", BINDABLE_STRING)).toBe("invalid_reference");
    expect(reasonFor("nav:home", BINDABLE_STRING)).toBe("invalid_reference");
    expect(reasonFor(42, BINDABLE_STRING)).toBe("invalid_reference");
    expect(reasonFor(null, BINDABLE_STRING)).toBe("invalid_reference");
  });
});

describe("resolveBinding — bindable and non-bindable props", () => {
  it("resolves a prop the component spec declares bindable", () => {
    expect(valueOf("data:metrics.orders", BINDABLE_NUMBER)).toBe(42);
  });

  it("rejects a prop whose schema does not declare it bindable", () => {
    expect(reasonFor("data:metrics.revenue", { type: "string" })).toBe("prop_not_bindable");
  });

  it("rejects a prop that declares itself explicitly non-bindable", () => {
    expect(reasonFor("data:metrics.revenue", { type: "string", bindable: false })).toBe(
      "prop_not_bindable",
    );
  });

  it("rejects a bindable flag that is not a boolean", () => {
    expect(reasonFor("data:metrics.revenue", { type: "string", bindable: "yes" })).toBe(
      "invalid_prop_schema",
    );
  });

  it("rejects a prop schema that is not a recognized schema at all", () => {
    expect(reasonFor("data:metrics.revenue", null)).toBe("invalid_prop_schema");
    expect(reasonFor("data:metrics.revenue", "string")).toBe("invalid_prop_schema");
    expect(reasonFor("data:metrics.revenue", {})).toBe("invalid_prop_schema");
    expect(reasonFor("data:metrics.revenue", { type: "any", bindable: true })).toBe(
      "invalid_prop_schema",
    );
  });
});

describe("resolveBinding — schema agreement", () => {
  it("resolves each declared type against a matching value", () => {
    expect(valueOf("data:metrics.revenue", BINDABLE_STRING)).toBe("1,204");
    expect(valueOf("data:metrics.orders", BINDABLE_NUMBER)).toBe(42);
    expect(valueOf("data:metrics.growing", BINDABLE_BOOLEAN)).toBe(true);
    expect(valueOf("data:sales.rows", BINDABLE_ARRAY)).toEqual([
      { region: "north", total: 10 },
      { region: "south", total: 12 },
    ]);
    expect(valueOf("data:metrics", BINDABLE_OBJECT)).toEqual(MODEL["metrics"]);
  });

  it("rejects a value whose type mismatches the declared prop schema", () => {
    expect(reasonFor("data:metrics.orders", BINDABLE_STRING)).toBe("schema_mismatch");
    expect(reasonFor("data:metrics.revenue", BINDABLE_NUMBER)).toBe("schema_mismatch");
    expect(reasonFor("data:metrics.revenue", BINDABLE_BOOLEAN)).toBe("schema_mismatch");
    expect(reasonFor("data:metrics", BINDABLE_ARRAY)).toBe("schema_mismatch");
    expect(reasonFor("data:sales.rows", BINDABLE_OBJECT)).toBe("schema_mismatch");
  });

  it("honours a declared enum domain", () => {
    const schema = { type: "string", bindable: true, enum: ["active", "paused"] };
    expect(valueOf("data:status", schema)).toBe("active");
    expect(reasonFor("data:metrics.revenue", schema)).toBe("schema_mismatch");
  });

  it("rejects a null value against every declared type, because null is not schema-valid", () => {
    for (const schema of [BINDABLE_STRING, BINDABLE_NUMBER, BINDABLE_BOOLEAN, BINDABLE_ARRAY]) {
      expect(reasonFor("data:metrics.missingish", schema)).toBe("schema_mismatch");
    }
  });

  it("rejects a non-finite number, which is not a JSON value", () => {
    const model: DataModel = { ratio: Number.NaN };
    expect(reasonFor("data:ratio", BINDABLE_NUMBER, model)).toBe("schema_mismatch");
  });
});

describe("resolveBinding — missing is never empty", () => {
  const table: ReadonlyArray<{
    readonly label: string;
    readonly reference: string;
    readonly schema: unknown;
    readonly outcome: "empty" | "missing";
    readonly empty?: unknown;
  }> = [
    {
      label: "an explicit empty string",
      reference: "data:metrics.note",
      schema: BINDABLE_STRING,
      outcome: "empty",
      empty: "",
    },
    {
      label: "an explicit empty array",
      reference: "data:metrics.tags",
      schema: BINDABLE_ARRAY,
      outcome: "empty",
      empty: [],
    },
    {
      label: "an explicit empty object",
      reference: "data:metrics.breakdown",
      schema: BINDABLE_OBJECT,
      outcome: "empty",
      empty: {},
    },
    {
      label: "a leaf key that is absent",
      reference: "data:metrics.absent",
      schema: BINDABLE_STRING,
      outcome: "missing",
    },
    {
      label: "a root key that is absent",
      reference: "data:absent",
      schema: BINDABLE_STRING,
      outcome: "missing",
    },
    {
      label: "a path that reads through a scalar",
      reference: "data:metrics.revenue.deeper",
      schema: BINDABLE_STRING,
      outcome: "missing",
    },
    {
      label: "a path that reads into an array",
      reference: "data:sales.rows.region",
      schema: BINDABLE_STRING,
      outcome: "missing",
    },
    {
      label: "a path that reads an array's intrinsic property",
      reference: "data:sales.rows.length",
      schema: BINDABLE_NUMBER,
      outcome: "missing",
    },
    {
      label: "a path that reads through null",
      reference: "data:metrics.missingish.deeper",
      schema: BINDABLE_STRING,
      outcome: "missing",
    },
  ];

  for (const row of table) {
    it(`treats ${row.label} as ${row.outcome}`, () => {
      if (row.outcome === "empty") {
        expect(valueOf(row.reference, row.schema)).toEqual(row.empty);
      } else {
        expect(reasonFor(row.reference, row.schema)).toBe("path_not_found");
      }
    });
  }

  it("never resolves a missing path to an empty value", () => {
    const result = resolveBinding("data:metrics.absent", MODEL, BINDABLE_STRING);
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("value");
  });

  it("does not treat an inherited property as present", () => {
    const model = { own: "yes" } as DataModel;
    expect(reasonFor("data:toString", BINDABLE_STRING, model)).toBe("path_not_found");
    expect(reasonFor("data:constructor", BINDABLE_OBJECT, model)).toBe("path_not_found");
  });
});

describe("resolveBinding — totality", () => {
  it("never throws, whatever it is handed", () => {
    const hostile: DataModel = {
      get boom(): unknown {
        throw new Error("hostile getter");
      },
    };
    const inputs: readonly unknown[] = [
      undefined,
      null,
      0,
      "",
      Symbol("s"),
      { type: "string", bindable: true },
    ];
    for (const reference of inputs) {
      for (const schema of inputs) {
        expect(() => resolveBinding(reference, hostile, schema)).not.toThrow();
      }
    }
    expect(reasonFor("data:boom", BINDABLE_STRING, hostile)).toBe("path_not_found");
  });

  it("treats a model that is not an object as holding no data", () => {
    const notAModel = "not a model" as unknown as DataModel;
    expect(reasonFor("data:metrics.revenue", BINDABLE_STRING, notAModel)).toBe("path_not_found");
  });
});

describe("resolveBinding — a prop schema as a component spec actually declares it", () => {
  // Shaped like a real catalog `PropSchema`, carrying the keywords a binding
  // does not consult. They must be ignored, not treated as an unknown shape.
  it("ignores the schema keywords a binding has no business reading", () => {
    const declared = {
      type: "string",
      guidance: "The headline figure, already formatted.",
      required: true,
      bindable: true,
    };
    expect(valueOf("data:metrics.revenue", declared)).toBe("1,204");
  });

  it("resolves a numeric prop that carries a range and a default", () => {
    const declared = {
      type: "number",
      guidance: "Orders in the period.",
      bindable: true,
      minimum: 0,
      maximum: 1_000,
      default: 0,
    };
    expect(valueOf("data:metrics.orders", declared)).toBe(42);
  });

  it("honours a numeric enum domain", () => {
    const declared = { type: "number", guidance: "", bindable: true, enum: [7, 42] };
    expect(valueOf("data:metrics.orders", declared)).toBe(42);
    const narrowed = { type: "number", guidance: "", bindable: true, enum: [7] };
    expect(reasonFor("data:metrics.orders", narrowed)).toBe("schema_mismatch");
  });
});

describe("resolveBinding — the structured prop branches", () => {
  // `PropSchema`'s `array` and `object` branches are shallow, closed and
  // binding-only: they admit `type`, `guidance`, an optional `required`, and a
  // required literal `bindable: true` — nothing else. A structured prop exists
  // *so that* a collection or a record can arrive from the Data Model, so a
  // structured branch that is not bindable declares a prop nothing can fill.
  //
  // The two valid fixtures are typed as the real `PropSchema` so that a later
  // change to the structured branches breaks this test rather than silently
  // leaving the resolver agreeing with a schema the catalog no longer admits.
  // `resolveBinding` itself still takes the schema as `unknown` — the catalog is
  // the trust boundary that admits it, not the type annotation.
  const ROWS_PROP: PropSchema = {
    type: "array",
    guidance: "The rows the table renders.",
    required: true,
    bindable: true,
  };
  const SUMMARY_PROP: PropSchema = {
    type: "object",
    guidance: "The record the key-value view renders.",
    bindable: true,
  };

  it("resolves a model array against a declared array prop", () => {
    expect(valueOf("data:sales.rows", ROWS_PROP)).toEqual([
      { region: "north", total: 10 },
      { region: "south", total: 12 },
    ]);
  });

  it("resolves a model object against a declared object prop", () => {
    expect(valueOf("data:metrics", SUMMARY_PROP)).toEqual(MODEL["metrics"]);
  });

  it("rejects a scalar model value against a structured prop", () => {
    expect(reasonFor("data:metrics.revenue", ROWS_PROP)).toBe("schema_mismatch");
    expect(reasonFor("data:metrics.orders", ROWS_PROP)).toBe("schema_mismatch");
    expect(reasonFor("data:metrics.growing", ROWS_PROP)).toBe("schema_mismatch");
    expect(reasonFor("data:metrics.revenue", SUMMARY_PROP)).toBe("schema_mismatch");
    expect(reasonFor("data:metrics.orders", SUMMARY_PROP)).toBe("schema_mismatch");
    expect(reasonFor("data:metrics.growing", SUMMARY_PROP)).toBe("schema_mismatch");
  });

  it("rejects a structured model value against a scalar prop", () => {
    expect(reasonFor("data:sales.rows", BINDABLE_STRING)).toBe("schema_mismatch");
    expect(reasonFor("data:sales.rows", BINDABLE_NUMBER)).toBe("schema_mismatch");
    expect(reasonFor("data:sales.rows", BINDABLE_BOOLEAN)).toBe("schema_mismatch");
    expect(reasonFor("data:metrics", BINDABLE_STRING)).toBe("schema_mismatch");
    expect(reasonFor("data:metrics", BINDABLE_NUMBER)).toBe("schema_mismatch");
    expect(reasonFor("data:metrics", BINDABLE_BOOLEAN)).toBe("schema_mismatch");
  });

  it("rejects the two structured types against each other", () => {
    expect(reasonFor("data:metrics", ROWS_PROP)).toBe("schema_mismatch");
    expect(reasonFor("data:sales.rows", SUMMARY_PROP)).toBe("schema_mismatch");
  });

  it("rejects a structured prop that omits bindable", () => {
    expect(reasonFor("data:sales.rows", { type: "array", guidance: "" })).toBe("prop_not_bindable");
    expect(reasonFor("data:metrics", { type: "object", guidance: "" })).toBe("prop_not_bindable");
  });

  it("rejects a structured prop that declares bindable false", () => {
    expect(reasonFor("data:sales.rows", { type: "array", guidance: "", bindable: false })).toBe(
      "prop_not_bindable",
    );
    expect(reasonFor("data:metrics", { type: "object", guidance: "", bindable: false })).toBe(
      "prop_not_bindable",
    );
  });

  it("rejects a structured prop whose bindable flag is not a boolean", () => {
    expect(reasonFor("data:sales.rows", { type: "array", guidance: "", bindable: "true" })).toBe(
      "invalid_prop_schema",
    );
  });

  it("rejects a structured branch carrying a keyword it does not admit", () => {
    // The scalar branches admit `enum`, `default`, `minimum` and `maximum`. The
    // structured branches admit none of them, so a schema carrying one is not a
    // `PropSchema` this resolver understands — it must reject as an unknown
    // shape rather than resolve against a keyword it would silently ignore.
    const unadmitted: readonly Record<string, unknown>[] = [
      { type: "array", guidance: "", bindable: true, enum: [[]] },
      { type: "array", guidance: "", bindable: true, default: [] },
      { type: "array", guidance: "", bindable: true, items: { type: "string" } },
      { type: "object", guidance: "", bindable: true, enum: [{}] },
      { type: "object", guidance: "", bindable: true, default: {} },
      { type: "object", guidance: "", bindable: true, properties: {} },
      { type: "object", guidance: "", bindable: true, minimum: 0 },
    ];
    for (const schema of unadmitted) {
      expect(reasonFor("data:sales.rows", schema)).toBe("invalid_prop_schema");
    }
  });

  it("stays shallow — it never inspects a structured value's contents", () => {
    // A structured branch declares no element or property contract, so the
    // resolver has nothing to check inside the value and must not invent one.
    const model: DataModel = { mixed: [1, "two", true, null, { nested: [] }] };
    expect(valueOf("data:mixed", ROWS_PROP, model)).toEqual([1, "two", true, null, { nested: [] }]);
  });
});

describe("resolveBinding — the numeric domain, identical to the author path's", () => {
  // The round-trip rule: a value the author grammar refuses must not become
  // mountable by surviving a binding. `checkNumber` in `document-validation.ts`
  // enforces finiteness, then `enum`, then `minimum`, then `maximum`; a bound
  // value has to clear the same four. `enum` was already honoured here, which is
  // exactly what made the missing range easy to miss.
  //
  // Every expectation below is a literal written out by hand. Nothing is read
  // back off the schema under test, so a resolver that echoed its own bounds
  // could not satisfy them.
  const PERCENT: PropSchema = {
    type: "number",
    guidance: "A share of the whole.",
    bindable: true,
    minimum: 0,
    maximum: 100,
  };

  it("refuses the out-of-range value the author path refuses", () => {
    // The executed defect, verbatim: authored `percent="500"` is an
    // `invalid-value` author error, while the identical bound 500 resolved
    // cleanly and mounted.
    expect(rejectionFor("data:percent", { percent: 500 }, PERCENT)).toBe("schema_mismatch");
  });

  it("accepts a value exactly at each bound", () => {
    expect(valueOf("data:percent", PERCENT, { percent: 0 })).toBe(0);
    expect(valueOf("data:percent", PERCENT, { percent: 100 })).toBe(100);
  });

  it("rejects a value one step past each bound, in both directions", () => {
    expect(rejectionFor("data:percent", { percent: -1 }, PERCENT)).toBe("schema_mismatch");
    expect(rejectionFor("data:percent", { percent: 101 }, PERCENT)).toBe("schema_mismatch");
  });

  it("rejects a fractional overshoot, not just an integer one", () => {
    // An integer-only check would let 100.5 through while refusing 101.
    expect(rejectionFor("data:percent", { percent: 100.5 }, PERCENT)).toBe("schema_mismatch");
    expect(rejectionFor("data:percent", { percent: -0.5 }, PERCENT)).toBe("schema_mismatch");
  });

  it("resolves a value strictly inside the declared range", () => {
    expect(valueOf("data:percent", PERCENT, { percent: 42 })).toBe(42);
  });

  it("enforces a one-sided range on the side it declares, and only that side", () => {
    const atLeast: PropSchema = { type: "number", guidance: "", bindable: true, minimum: 10 };
    expect(rejectionFor("data:n", { n: 9 }, atLeast)).toBe("schema_mismatch");
    expect(valueOf("data:n", atLeast, { n: 10 })).toBe(10);
    expect(valueOf("data:n", atLeast, { n: 1_000_000 })).toBe(1_000_000);

    const atMost: PropSchema = { type: "number", guidance: "", bindable: true, maximum: 10 };
    expect(rejectionFor("data:n", { n: 11 }, atMost)).toBe("schema_mismatch");
    expect(valueOf("data:n", atMost, { n: 10 })).toBe(10);
    expect(valueOf("data:n", atMost, { n: -1_000_000 })).toBe(-1_000_000);
  });

  it("applies a negative range the same way", () => {
    const below: PropSchema = {
      type: "number",
      guidance: "",
      bindable: true,
      minimum: -50,
      maximum: -10,
    };
    expect(valueOf("data:n", below, { n: -50 })).toBe(-50);
    expect(valueOf("data:n", below, { n: -10 })).toBe(-10);
    expect(rejectionFor("data:n", { n: -51 }, below)).toBe("schema_mismatch");
    expect(rejectionFor("data:n", { n: -9 }, below)).toBe("schema_mismatch");
    expect(rejectionFor("data:n", { n: 0 }, below)).toBe("schema_mismatch");
  });

  it("applies the enum and the range together, each on its own", () => {
    // A range that admits a value the enum does not, and an enum member the
    // range excludes: neither keyword may cover for the other.
    const schema = {
      type: "number",
      guidance: "",
      bindable: true,
      enum: [5, 500],
      minimum: 0,
      maximum: 100,
    };
    expect(valueOf("data:n", schema, { n: 5 })).toBe(5);
    expect(rejectionFor("data:n", { n: 500 }, schema)).toBe("schema_mismatch");
    expect(rejectionFor("data:n", { n: 50 }, schema)).toBe("schema_mismatch");
  });

  it("rejects a range keyword that is not a finite number as an unreadable schema", () => {
    // Silently ignoring an unreadable `minimum` would resolve the binding
    // against a contract the author believes is being enforced — the same
    // reason the structured branches refuse a keyword they do not admit.
    const malformed: readonly Record<string, unknown>[] = [
      { type: "number", guidance: "", bindable: true, minimum: "0" },
      { type: "number", guidance: "", bindable: true, maximum: null },
      { type: "number", guidance: "", bindable: true, minimum: Number.NaN },
      { type: "number", guidance: "", bindable: true, maximum: Number.POSITIVE_INFINITY },
    ];
    for (const schema of malformed) {
      expect(rejectionFor("data:n", { n: 42 }, schema)).toBe("invalid_prop_schema");
    }
  });
});

describe("resolveBinding — totality is a property of the code, not of the docblock", () => {
  /** A revoked proxy: `Array.isArray`, `getPrototypeOf`, `hasOwnProperty` and `ownKeys` all throw on it. */
  function revokedProxy(): object {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    return proxy;
  }

  it("proves the hostile fixtures really are hostile", () => {
    // Without this, every assertion below could pass against an input that was
    // never dangerous. Each of the four primitives the resolver touches is
    // shown to throw when called directly.
    const revoked = revokedProxy();
    expect(() => Array.isArray(revoked)).toThrow(TypeError);
    expect(() => Object.getPrototypeOf(revoked)).toThrow(TypeError);
    expect(() => Object.prototype.hasOwnProperty.call(revoked, "x")).toThrow(TypeError);
    expect(() => Object.keys(revoked)).toThrow(TypeError);

    const throwingBindable = {
      type: "string",
      get bindable(): unknown {
        throw new Error("hostile bindable getter");
      },
    };
    expect(() => throwingBindable.bindable).toThrow("hostile bindable getter");

    class HostileEnum extends Array<string> {
      override includes(_searchElement: string, _fromIndex?: number): boolean {
        throw new Error("hostile includes");
      }
    }
    const hostileEnum = new HostileEnum();
    hostileEnum.push("active");
    expect(Array.isArray(hostileEnum)).toBe(true);
    expect(() => hostileEnum.includes("active")).toThrow("hostile includes");
  });

  it("rejects a revoked proxy standing in for the whole model", () => {
    const model = revokedProxy() as DataModel;
    expect(rejectionFor("data:metrics", model, BINDABLE_OBJECT)).toBe("path_not_found");
  });

  it("rejects a revoked proxy sitting on the path it must descend through", () => {
    const model = { a: revokedProxy() } as unknown as DataModel;
    expect(rejectionFor("data:a.b", model, BINDABLE_STRING)).toBe("path_not_found");
  });

  it("rejects a revoked proxy as the selected value, against every declared type", () => {
    const model = { a: revokedProxy() } as unknown as DataModel;
    for (const schema of [
      BINDABLE_OBJECT,
      BINDABLE_ARRAY,
      BINDABLE_STRING,
      BINDABLE_NUMBER,
      BINDABLE_BOOLEAN,
    ]) {
      expect(rejectionFor("data:a", model, schema)).toBe("schema_mismatch");
    }
  });

  it("rejects a revoked proxy handed in as the prop schema", () => {
    expect(rejectionFor("data:metrics.revenue", MODEL, revokedProxy())).toBe("invalid_prop_schema");
  });

  it("rejects a prop schema whose keyword getters throw", () => {
    const throwing = (keyword: string): Record<string, unknown> => {
      const base: Record<string, unknown> = {
        type: "number",
        guidance: "",
        bindable: true,
        enum: undefined,
        minimum: 0,
        maximum: 100,
      };
      Object.defineProperty(base, keyword, {
        enumerable: true,
        get(): unknown {
          throw new Error(`hostile ${keyword} getter`);
        },
      });
      return base;
    };
    for (const keyword of ["type", "bindable", "enum", "minimum", "maximum"]) {
      expect(rejectionFor("data:metrics.orders", MODEL, throwing(keyword))).toBe(
        "invalid_prop_schema",
      );
    }
  });

  it("rejects a structured prop schema whose key enumeration throws", () => {
    // The structured branch walks `Object.keys(propSchema)` to enforce its
    // closed keyword set, so a proxy that refuses to enumerate reaches it.
    const hostile = new Proxy(
      { type: "array", guidance: "", bindable: true },
      {
        ownKeys(): string[] {
          throw new Error("hostile ownKeys trap");
        },
      },
    );
    expect(rejectionFor("data:sales.rows", MODEL, hostile)).toBe("invalid_prop_schema");
  });

  it("rejects an enum whose membership test throws", () => {
    class HostileEnum extends Array<unknown> {
      override includes(_searchElement: unknown, _fromIndex?: number): boolean {
        throw new Error("hostile includes");
      }
    }
    const strings = new HostileEnum();
    strings.push("active");
    expect(
      rejectionFor("data:status", MODEL, { type: "string", bindable: true, enum: strings }),
    ).toBe("invalid_prop_schema");

    const numbers = new HostileEnum();
    numbers.push(42);
    expect(
      rejectionFor("data:metrics.orders", MODEL, { type: "number", bindable: true, enum: numbers }),
    ).toBe("invalid_prop_schema");
  });

  it("rejects an enum whose element reads throw", () => {
    const elements: unknown[] = [];
    Object.defineProperty(elements, "0", {
      enumerable: true,
      get(): unknown {
        throw new Error("hostile element getter");
      },
    });
    Object.defineProperty(elements, "length", { value: 1, writable: true });
    expect(
      rejectionFor("data:status", MODEL, { type: "string", bindable: true, enum: elements }),
    ).toBe("invalid_prop_schema");
  });

  it("rejects a model container whose own-property lookup throws", () => {
    const hostile = new Proxy(
      { a: "value" },
      {
        getOwnPropertyDescriptor(): PropertyDescriptor {
          throw new Error("hostile getOwnPropertyDescriptor trap");
        },
      },
    );
    expect(rejectionFor("data:a", hostile as DataModel, BINDABLE_STRING)).toBe("path_not_found");
  });

  it("still resolves every sibling that is well-formed, alongside a hostile one", () => {
    // The defect's real cost: a throw here erased sibling props that had
    // resolved perfectly. A model may hold one hostile value and many sound
    // ones, and the sound ones must still resolve.
    const model = { good: "kept", bad: revokedProxy() } as unknown as DataModel;
    expect(rejectionFor("data:bad", model, BINDABLE_STRING)).toBe("schema_mismatch");
    expect(valueOf("data:good", BINDABLE_STRING, model)).toBe("kept");
  });
});
