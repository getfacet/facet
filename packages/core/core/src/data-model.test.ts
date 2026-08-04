import { describe, expect, it } from "vitest";

import { BOUNDS } from "./bounds.js";
import { evaluateCandidateModel, measurePublishPayload, writePath } from "./data-model.js";
import type { DataModel, DataModelEvaluation, PayloadEvaluation } from "./data-model.js";
import { parseDataPath } from "./identifiers.js";
import type { DataPath } from "./identifiers.js";

/** Parses a fixture path, failing loudly if the fixture itself is illegal. */
function at(value: string): DataPath {
  const parsed = parseDataPath(value);
  if (parsed === null) {
    throw new Error(`test fixture uses an illegal data path: ${value}`);
  }
  return parsed;
}

/** Evaluates a candidate that the test expects to be accepted. */
function accept(candidate: unknown): {
  model: DataModel;
  canonicalJson: string;
  valueCount: number;
} {
  const result = evaluateCandidateModel(candidate);
  if (!result.ok) {
    throw new Error(`expected an accepted candidate, got ${result.reason} at "${result.path}"`);
  }
  return {
    model: result.model,
    canonicalJson: result.canonicalJson,
    valueCount: result.valueCount,
  };
}

/** Evaluates a candidate that the test expects to be rejected. */
function reject(candidate: unknown): { reason: string; bound: string | null; path: string } {
  const result = evaluateCandidateModel(candidate);
  if (result.ok) {
    throw new Error(
      `expected a rejected candidate, got an accepted model of ${result.valueCount} values`,
    );
  }
  return { reason: result.reason, bound: result.bound, path: result.path };
}

/**
 * Builds a candidate whose canonical JSON is *exactly* `targetChars` long.
 *
 * The construction is self-calibrating: it measures one and two array items
 * through `evaluateCandidateModel` itself, derives the item cost, then sizes a
 * trailing string so the total lands on the target. The caller asserts the
 * final length, so a miscalibration fails the test rather than passing silently.
 */
function candidateOfCanonicalLength(targetChars: number): Record<string, unknown> {
  const chunk = "x".repeat(1_000);
  const emptyLen = accept({ a: [], b: "" }).canonicalJson.length;
  const oneLen = accept({ a: [chunk], b: "" }).canonicalJson.length;
  const twoLen = accept({ a: [chunk, chunk], b: "" }).canonicalJson.length;
  const firstItem = oneLen - emptyLen;
  const perItem = twoLen - oneLen;
  const count = Math.floor((targetChars - emptyLen - firstItem) / perItem) + 1;
  const items = Array.from({ length: count }, () => chunk);
  const arrayLen = emptyLen + firstItem + (count - 1) * perItem;
  const pad = targetChars - arrayLen;
  if (pad < 0 || pad > BOUNDS.dataModelStringChars) {
    throw new Error(`calibration produced an unusable pad of ${pad} characters`);
  }
  return { a: items, b: "y".repeat(pad) };
}

/** Runs `evaluateCandidateModel` and reports the wall-clock cost of the call. */
function timedEvaluation(candidate: unknown): { ok: boolean; elapsedMs: number } {
  const startedAt = Date.now();
  const result = evaluateCandidateModel(candidate);
  return { ok: result.ok, elapsedMs: Date.now() - startedAt };
}

/**
 * A generous ceiling: every walk in this module aborts at a bound, so a
 * pathological candidate must return in far less than this. The assertion
 * exists to catch a non-terminating walk, not to benchmark.
 */
const TERMINATION_BUDGET_MS = 5_000;

/**
 * The consumer-shaped proof that this module's two public result types can be
 * **named** by a cross-package caller.
 *
 * A caller that only ever narrows an outcome inline needs no name. A caller that
 * stores one, passes it on, or writes a helper over it must annotate — and an
 * unexported result type turns that into `TS2459: declares 'X' locally, but it
 * is not exported`, the exact wall that already forced `PayloadEvaluation` to be
 * exported. These two functions are that annotation, and they exist here because
 * **vitest cannot catch this regression**: `import type` is erased by esbuild, so
 * a missing type export runs green and only `tsc` sees it. The tests below call
 * them so the runtime behaviour is exercised too.
 */
function describeEvaluation(evaluation: DataModelEvaluation): string {
  return evaluation.ok ? `ok:${evaluation.valueCount}` : `reject:${evaluation.reason}`;
}

function describePayload(evaluation: PayloadEvaluation): string {
  return evaluation.ok ? `ok:${evaluation.chars}` : `reject:${evaluation.reason}`;
}

describe("the module's named public result types", () => {
  it("lets a consumer name and narrow an evaluation without restating its shape", () => {
    expect(describeEvaluation(evaluateCandidateModel({ a: 1 }))).toBe("ok:2");
    expect(describeEvaluation(evaluateCandidateModel(1n))).toBe("reject:data_not_serializable");
    expect(describeEvaluation(evaluateCandidateModel("root"))).toBe(
      "reject:data_model_not_an_object",
    );
  });

  it("lets a consumer name and narrow a payload measurement the same way", () => {
    expect(describePayload(measurePublishPayload([1, 2, 3]))).toBe("ok:7");
    expect(describePayload(measurePublishPayload(1n))).toBe("reject:data_not_serializable");
  });

  it("shares one reject branch between the two result types", () => {
    // `PayloadEvaluation`'s reject branch *is* `DataModelEvaluation`'s, so a
    // caller holding either can hand its rejection to one shared reporter. If
    // the two ever drift into separate declarations this stops compiling.
    const report = (rejection: Extract<DataModelEvaluation, { readonly ok: false }>): string =>
      `${rejection.reason}@${rejection.path}:${rejection.bound ?? "none"}`;

    const payload: PayloadEvaluation = measurePublishPayload({ total: 1n });
    if (payload.ok) {
      throw new Error("expected a rejected payload");
    }
    expect(report(payload)).toBe("data_not_serializable@total:none");

    const model: DataModelEvaluation = evaluateCandidateModel({ rows: [1n] });
    if (model.ok) {
      throw new Error("expected a rejected candidate");
    }
    expect(report(model)).toBe("data_not_serializable@rows[0]:none");
  });
});

describe("writePath", () => {
  it("writes a value at a single-segment path", () => {
    expect(writePath({}, at("total"), 42)).toEqual({ total: 42 });
  });

  it("creates the intermediate objects a nested path needs", () => {
    expect(writePath({}, at("sales.q3.revenue"), 10)).toEqual({
      sales: { q3: { revenue: 10 } },
    });
  });

  it("preserves untouched siblings at every level", () => {
    const prior: DataModel = { sales: { q2: 1, q3: 2 }, other: "keep" };
    expect(writePath(prior, at("sales.q3"), 99)).toEqual({
      sales: { q2: 1, q3: 99 },
      other: "keep",
    });
  });

  it("never mutates the prior model", () => {
    const prior = accept({ sales: { q3: 1 } });
    const before = prior.canonicalJson;
    writePath(prior.model, at("sales.q3"), 2);
    writePath(prior.model, at("sales.q4.deep"), 3);
    expect(accept(prior.model).canonicalJson).toBe(before);
  });

  it("replaces a non-object intermediate rather than reading through it", () => {
    expect(writePath({ sales: "not an object" }, at("sales.q3"), 1)).toEqual({
      sales: { q3: 1 },
    });
  });

  it("replaces an array intermediate, because a path never addresses into an array", () => {
    expect(writePath({ rows: [1, 2, 3] }, at("rows.total"), 6)).toEqual({
      rows: { total: 6 },
    });
  });

  it("produces a candidate that still has to be evaluated, carrying an unvalidated value", () => {
    const candidate = writePath({}, at("bad"), 1n);
    expect(reject(candidate).reason).toBe("data_not_serializable");
  });
});

describe("evaluateCandidateModel — structural precondition", () => {
  it("rejects a self-referential candidate as data_not_serializable", () => {
    const a: Record<string, unknown> = {};
    a["self"] = a;
    const result = reject(a);
    expect(result.reason).toBe("data_not_serializable");
    expect(result.bound).toBeNull();
    expect(result.path).toBe("self");
  });

  it("rejects a shared cycle between two objects", () => {
    const left: Record<string, unknown> = {};
    const right: Record<string, unknown> = { left };
    left["right"] = right;
    expect(reject({ left }).reason).toBe("data_not_serializable");
  });

  it("rejects a cycle through an array", () => {
    const rows: unknown[] = [];
    rows.push(rows);
    expect(reject({ rows }).reason).toBe("data_not_serializable");
  });

  it("rejects a BigInt value", () => {
    const result = reject({ sales: { total: 1n } });
    expect(result.reason).toBe("data_not_serializable");
    expect(result.path).toBe("sales.total");
  });

  it("rejects a function value", () => {
    expect(reject({ run: () => 1 }).reason).toBe("data_not_serializable");
  });

  it("rejects a Symbol value", () => {
    expect(reject({ tag: Symbol("tag") }).reason).toBe("data_not_serializable");
  });

  it("rejects undefined, which JSON would silently drop", () => {
    expect(reject({ missing: undefined }).reason).toBe("data_not_serializable");
  });

  it("rejects a non-finite number, which JSON would silently turn into null", () => {
    expect(reject({ ratio: Number.NaN }).reason).toBe("data_not_serializable");
    expect(reject({ ratio: Number.POSITIVE_INFINITY }).reason).toBe("data_not_serializable");
  });

  it("rejects a sparse array hole", () => {
    const rows = ["a", "b"];
    delete rows[0];
    expect(reject({ rows }).reason).toBe("data_not_serializable");
  });

  it("rejects a non-plain object such as a Date, Map or class instance", () => {
    class Row {}
    expect(reject({ at: new Date(0) }).reason).toBe("data_not_serializable");
    expect(reject({ index: new Map() }).reason).toBe("data_not_serializable");
    expect(reject({ row: new Row() }).reason).toBe("data_not_serializable");
  });

  it("rejects a property whose getter throws, instead of letting the throw escape", () => {
    const candidate = {
      get boom(): unknown {
        throw new Error("hostile getter");
      },
    };
    const result = reject(candidate);
    expect(result.reason).toBe("data_not_serializable");
    expect(result.path).toBe("boom");
  });

  it("accepts a shared but acyclic subtree, which is legal JSON", () => {
    const shared = { label: "shared" };
    const result = accept({ left: shared, right: shared });
    expect(result.canonicalJson).toBe('{"left":{"label":"shared"},"right":{"label":"shared"}}');
  });

  it("detaches an accepted model from caller-owned nested references", () => {
    const rows = [{ id: "a", values: [1, 2] }];
    const candidate = { table: { rows } };

    const accepted = accept(candidate);
    rows[0]?.values.push(3);
    rows.push({ id: "b", values: [4] });

    expect(accepted.model).toEqual({ table: { rows: [{ id: "a", values: [1, 2] }] } });
    expect(accept(accepted.model).canonicalJson).toBe(
      '{"table":{"rows":[{"id":"a","values":[1,2]}]}}',
    );
  });

  it("rejects a candidate whose root is not an object", () => {
    expect(reject("just a string").reason).toBe("data_model_not_an_object");
    expect(reject([1, 2, 3]).reason).toBe("data_model_not_an_object");
    expect(reject(null).reason).toBe("data_model_not_an_object");
  });

  it("accepts an empty model", () => {
    const result = accept({});
    expect(result.canonicalJson).toBe("{}");
    expect(result.valueCount).toBe(1);
  });
});

describe("evaluateCandidateModel — totality and termination", () => {
  it("never throws and terminates on a self-referential candidate", () => {
    const a: Record<string, unknown> = {};
    a["self"] = a;
    const run = (): { ok: boolean; elapsedMs: number } => timedEvaluation(a);
    expect(run).not.toThrow();
    expect(run().elapsedMs).toBeLessThan(TERMINATION_BUDGET_MS);
  });

  it("never throws and terminates on a BigInt candidate", () => {
    const candidate = { rows: [{ id: 1n }] };
    const run = (): { ok: boolean; elapsedMs: number } => timedEvaluation(candidate);
    expect(run).not.toThrow();
    expect(run().elapsedMs).toBeLessThan(TERMINATION_BUDGET_MS);
  });

  it("terminates on an acyclic graph whose expanded value count is astronomical", () => {
    let node: Record<string, unknown> = { leaf: true };
    for (let depth = 0; depth < 40; depth += 1) {
      node = { left: node, right: node };
    }
    const run = timedEvaluation({ bomb: node });
    expect(run.ok).toBe(false);
    expect(run.elapsedMs).toBeLessThan(TERMINATION_BUDGET_MS);
    expect(reject({ bomb: node }).bound).toBe("B-16");
  });

  it("terminates on a candidate nested far deeper than any document", () => {
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let depth = 0; depth < 200_000; depth += 1) {
      deep = { next: deep };
    }
    const run = timedEvaluation(deep);
    expect(run.ok).toBe(false);
    expect(run.elapsedMs).toBeLessThan(TERMINATION_BUDGET_MS);
  });

  it("returns a structured reject for every exotic input rather than throwing", () => {
    for (const candidate of [undefined, null, 0, "", true, Symbol("s"), 1n, () => 1, new Map()]) {
      expect(() => evaluateCandidateModel(candidate)).not.toThrow();
      expect(evaluateCandidateModel(candidate).ok).toBe(false);
    }
  });

  it("rejects a revoked proxy, whose very type test throws", () => {
    // A revoked proxy breaks a totality claim from below: the classifier throws
    // before any guard can run, so a `TypeError` escapes the single write
    // entrypoint instead of a structured reject reaching the fold. The first two
    // assertions prove the fixture is genuinely hostile — against an ordinary
    // object every assertion after them would hold vacuously.
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(() => Array.isArray(proxy)).toThrow(TypeError);
    expect(() => Object.getPrototypeOf(proxy)).toThrow(TypeError);

    expect(() => evaluateCandidateModel({ a: proxy })).not.toThrow();
    const nested = reject({ a: proxy });
    expect(nested.reason).toBe("data_not_serializable");
    expect(nested.path).toBe("a");

    expect(() => evaluateCandidateModel(proxy)).not.toThrow();
    expect(reject(proxy).reason).toBe("data_not_serializable");

    expect(() => measurePublishPayload(proxy)).not.toThrow();
    const payload: PayloadEvaluation = measurePublishPayload(proxy);
    expect(payload.ok).toBe(false);

    // Nested behind sound siblings, so the reject has to survive a walk that
    // has already cleared containers and is reported at the right path.
    const deep = reject({ rows: [{ label: "sound" }, { hostile: proxy }] });
    expect(deep.reason).toBe("data_not_serializable");
    expect(deep.path).toBe("rows[1].hostile");
  });

  it("rejects a proxy whose key enumeration or property read throws", () => {
    const hostileKeys = new Proxy(
      { a: 1 },
      {
        ownKeys(): string[] {
          throw new Error("hostile ownKeys trap");
        },
      },
    );
    expect(() => Object.keys(hostileKeys)).toThrow("hostile ownKeys trap");
    expect(() => evaluateCandidateModel({ a: hostileKeys })).not.toThrow();
    const keyFailure = reject({ a: hostileKeys });
    expect(keyFailure.reason).toBe("data_not_serializable");
    expect(keyFailure.path).toBe("a");

    const hostileGet = new Proxy(
      { a: 1 },
      {
        get(): unknown {
          throw new Error("hostile get trap");
        },
      },
    );
    expect(() => evaluateCandidateModel({ outer: hostileGet })).not.toThrow();
    expect(reject({ outer: hostileGet }).reason).toBe("data_not_serializable");
  });

  it("leaves the prior model byte-identical after a non-serializable candidate is rejected", () => {
    const prior = accept({ sales: { q3: 100 }, label: "keep" });
    const before = prior.canonicalJson;

    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    expect(reject(writePath(prior.model, at("sales.q4"), cyclic)).reason).toBe(
      "data_not_serializable",
    );
    expect(accept(prior.model).canonicalJson).toBe(before);

    expect(reject(writePath(prior.model, at("sales.q4"), 1n)).reason).toBe("data_not_serializable");
    expect(accept(prior.model).canonicalJson).toBe(before);
  });
});

describe("evaluateCandidateModel — canonical JSON", () => {
  it("sorts object keys so structurally equal models serialize identically", () => {
    const one = accept({ b: 1, a: 2 }).canonicalJson;
    const other = accept({ a: 2, b: 1 }).canonicalJson;
    expect(one).toBe(other);
    expect(one).toBe('{"a":2,"b":1}');
  });

  it("preserves array order and emits no whitespace", () => {
    expect(accept({ rows: [3, 1, 2] }).canonicalJson).toBe('{"rows":[3,1,2]}');
  });

  it("escapes strings the way JSON does", () => {
    expect(accept({ text: 'a "b"\n' }).canonicalJson).toBe('{"text":"a \\"b\\"\\n"}');
  });

  it("counts every node — the root, each container and each scalar", () => {
    expect(accept({ rows: [1, 2, 3] }).valueCount).toBe(5);
  });
});

describe("evaluateCandidateModel — B-15 canonical JSON characters", () => {
  it("accepts a model whose canonical JSON is exactly at the limit", () => {
    const candidate = candidateOfCanonicalLength(BOUNDS.dataModelCanonicalJsonChars);
    const result = accept(candidate);
    expect(result.canonicalJson.length).toBe(BOUNDS.dataModelCanonicalJsonChars);
  });

  it("rejects a model whose canonical JSON is one character past the limit", () => {
    const candidate = candidateOfCanonicalLength(BOUNDS.dataModelCanonicalJsonChars);
    const tail = candidate["b"];
    if (typeof tail !== "string") {
      throw new Error("calibration fixture lost its trailing string");
    }
    const result = reject({ ...candidate, b: `${tail}y` });
    expect(result.reason).toBe("data_model_chars_exceeded");
    expect(result.bound).toBe("B-15");
  });
});

describe("evaluateCandidateModel — B-16 total values", () => {
  it("accepts a model with exactly the limit of values", () => {
    const half = Math.floor((BOUNDS.dataModelValues - 3) / 2);
    const rest = BOUNDS.dataModelValues - 3 - half;
    const candidate = {
      a: Array.from({ length: half }, () => 1),
      b: Array.from({ length: rest }, () => 1),
    };
    expect(accept(candidate).valueCount).toBe(BOUNDS.dataModelValues);
  });

  it("rejects a model one value past the limit", () => {
    const half = Math.floor((BOUNDS.dataModelValues - 2) / 2);
    const rest = BOUNDS.dataModelValues - 2 - half;
    const candidate = {
      a: Array.from({ length: half }, () => 1),
      b: Array.from({ length: rest }, () => 1),
    };
    const result = reject(candidate);
    expect(result.reason).toBe("data_model_values_exceeded");
    expect(result.bound).toBe("B-16");
  });
});

describe("evaluateCandidateModel — B-17 array length", () => {
  it("accepts an array exactly at the limit", () => {
    const candidate = { rows: Array.from({ length: BOUNDS.dataModelArrayLength }, () => 1) };
    expect(accept(candidate).valueCount).toBe(BOUNDS.dataModelArrayLength + 2);
  });

  it("rejects an array one element past the limit", () => {
    const candidate = { rows: Array.from({ length: BOUNDS.dataModelArrayLength + 1 }, () => 1) };
    const result = reject(candidate);
    expect(result.reason).toBe("data_array_length_exceeded");
    expect(result.bound).toBe("B-17");
    expect(result.path).toBe("rows");
  });

  it("rejects a sparse array past the limit before materializing every index", () => {
    const rows: unknown[] = [];
    rows.length = BOUNDS.dataModelArrayLength + 1;
    const run = timedEvaluation({ rows });

    expect(run.ok).toBe(false);
    expect(run.elapsedMs).toBeLessThan(TERMINATION_BUDGET_MS);
    const result = reject({ rows });
    expect(result.reason).toBe("data_array_length_exceeded");
    expect(result.bound).toBe("B-17");
    expect(result.path).toBe("rows");
  });
});

describe("evaluateCandidateModel — B-18 object keys per object", () => {
  it("accepts an object with exactly the limit of keys", () => {
    const entries = Array.from({ length: BOUNDS.dataModelObjectKeys }, (_unused, index) => [
      `k${index}`,
      index,
    ]);
    expect(accept({ nested: Object.fromEntries(entries) }).valueCount).toBe(
      BOUNDS.dataModelObjectKeys + 2,
    );
  });

  it("rejects an object one key past the limit", () => {
    const entries = Array.from({ length: BOUNDS.dataModelObjectKeys + 1 }, (_unused, index) => [
      `k${index}`,
      index,
    ]);
    const result = reject({ nested: Object.fromEntries(entries) });
    expect(result.reason).toBe("data_object_keys_exceeded");
    expect(result.bound).toBe("B-18");
    expect(result.path).toBe("nested");
  });

  it("applies the same key limit to the model root", () => {
    const entries = Array.from({ length: BOUNDS.dataModelObjectKeys + 1 }, (_unused, index) => [
      `k${index}`,
      index,
    ]);
    const result = reject(Object.fromEntries(entries));
    expect(result.bound).toBe("B-18");
    expect(result.path).toBe("");
  });
});

describe("evaluateCandidateModel — B-19 string value characters", () => {
  it("accepts a string exactly at the limit", () => {
    const candidate = { note: "n".repeat(BOUNDS.dataModelStringChars) };
    expect(accept(candidate).valueCount).toBe(2);
  });

  it("rejects a string one character past the limit", () => {
    const candidate = { note: "n".repeat(BOUNDS.dataModelStringChars + 1) };
    const result = reject(candidate);
    expect(result.reason).toBe("data_string_chars_exceeded");
    expect(result.bound).toBe("B-19");
    expect(result.path).toBe("note");
  });
});

describe("measurePublishPayload — B-20 incoming agent payload", () => {
  /**
   * Measures a payload the test expects to be accepted, returning its size.
   *
   * The result is annotated with the exported `PayloadEvaluation`, which is the
   * named type a cross-package caller — `publish_data` in `@facet/agent-tools`
   * — must be able to name. The annotation fails to compile if the type stops
   * being exported, which is the only place that regression is visible.
   */
  function measured(payload: unknown): number {
    const result: PayloadEvaluation = measurePublishPayload(payload);
    if (!result.ok) {
      throw new Error(`expected an accepted payload, got ${result.reason}`);
    }
    return result.chars;
  }

  /** Measures a payload the test expects to be rejected. */
  function refused(payload: unknown): { reason: string; bound: string | null } {
    const result: PayloadEvaluation = measurePublishPayload(payload);
    if (result.ok) {
      throw new Error(`expected a rejected payload, got ${result.chars} characters`);
    }
    return { reason: result.reason, bound: result.bound };
  }

  /**
   * A payload whose canonical JSON is exactly `targetChars` long, built from
   * items that each stay well inside `B-19` so the payload is one a model could
   * legitimately hold. Calibrated through `measurePublishPayload` itself, and
   * the caller asserts the final length, so a miscalibration fails the test.
   */
  function payloadOfLength(targetChars: number): readonly string[] {
    const chunk = "p".repeat(1_000);
    const emptyLen = measured([""]);
    const perItem = measured([chunk, ""]) - emptyLen;
    const count = Math.floor((targetChars - emptyLen) / perItem);
    const pad = targetChars - emptyLen - count * perItem;
    if (pad < 0 || pad > BOUNDS.dataModelStringChars) {
      throw new Error(`calibration produced an unusable pad of ${pad} characters`);
    }
    return [...Array.from({ length: count }, () => chunk), "p".repeat(pad)];
  }

  it("accepts a payload exactly at the limit", () => {
    const payload = payloadOfLength(BOUNDS.publishDataPayloadChars);
    expect(measured(payload)).toBe(BOUNDS.publishDataPayloadChars);
  });

  it("rejects a payload one character past the limit", () => {
    const payload = payloadOfLength(BOUNDS.publishDataPayloadChars + 1);

    // Proves the fixture really is *one* character past rather than merely
    // over: dropping a single character from its tail lands exactly on B-20.
    const tail = payload[payload.length - 1];
    if (tail === undefined) {
      throw new Error("calibration fixture lost its trailing string");
    }
    expect(measured([...payload.slice(0, -1), tail.slice(0, -1)])).toBe(
      BOUNDS.publishDataPayloadChars,
    );

    const result = refused(payload);
    expect(result.reason).toBe("publish_payload_chars_exceeded");
    expect(result.bound).toBe("B-20");
  });

  it("measures the payload, not the model it would produce", () => {
    // A payload one character past B-20 still produces a model far inside every
    // model bound — B-15 is fifty times B-20 — so nothing `evaluateCandidateModel`
    // measures could ever catch this hand-in. Only B-20 does.
    const oversized = payloadOfLength(BOUNDS.publishDataPayloadChars + 1);
    expect(refused(oversized).bound).toBe("B-20");

    const wouldBe = accept(writePath({}, at("note"), oversized));
    expect(wouldBe.canonicalJson.length).toBeLessThan(BOUNDS.dataModelCanonicalJsonChars);
    expect(wouldBe.valueCount).toBeLessThan(BOUNDS.dataModelValues);
  });

  it("accepts a payload that is an array or a scalar, not only an object", () => {
    expect(measured([1, 2, 3])).toBe("[1,2,3]".length);
    expect(measured(42)).toBe(2);
    expect(measured(true)).toBe(4);
    expect(measured(null)).toBe(4);
    expect(measured({ a: 1 })).toBe('{"a":1}'.length);
  });

  it("rejects a huge sparse payload without materializing every index", () => {
    const payload: unknown[] = [];
    payload.length = BOUNDS.dataModelArrayLength + 1;
    const startedAt = Date.now();
    const result = measurePublishPayload(payload);

    expect(Date.now() - startedAt).toBeLessThan(TERMINATION_BUDGET_MS);
    expect(result).toEqual({
      ok: false,
      reason: "publish_payload_chars_exceeded",
      bound: "B-20",
      path: "",
    });
  });

  it("rejects a non-serializable payload before measuring it", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    expect(refused(cyclic).reason).toBe("data_not_serializable");
    expect(refused(cyclic).bound).toBeNull();
    expect(refused({ total: 1n }).reason).toBe("data_not_serializable");
    expect(refused(undefined).reason).toBe("data_not_serializable");
  });

  it("returns a structured PayloadEvaluation exactly where JSON.stringify throws", () => {
    // This is the property that makes the helper worth exporting rather than
    // re-deriving. A caller measuring `JSON.stringify(payload).length` instead
    // does not get a large-payload reject on either of these inputs — it gets a
    // thrown TypeError out of a bounds check, which is the fail-safe hole this
    // module exists to close.
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    const bigint = { sales: { total: 1n } };

    for (const payload of [cyclic, bigint]) {
      expect(() => JSON.stringify(payload)).toThrow();

      const evaluation: PayloadEvaluation = measurePublishPayload(payload);
      expect(() => measurePublishPayload(payload)).not.toThrow();
      expect(evaluation.ok).toBe(false);
      if (evaluation.ok) {
        throw new Error("expected a rejected payload");
      }
      expect(evaluation.reason).toBe("data_not_serializable");
      expect(evaluation.bound).toBeNull();
      expect(typeof evaluation.path).toBe("string");
    }
  });

  it("never throws and terminates on a pathological payload", () => {
    let node: Record<string, unknown> = { leaf: true };
    for (let depth = 0; depth < 40; depth += 1) {
      node = { left: node, right: node };
    }
    const startedAt = Date.now();
    expect(() => measurePublishPayload(node)).not.toThrow();
    expect(measurePublishPayload(node).ok).toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(TERMINATION_BUDGET_MS);

    for (const payload of [Symbol("s"), () => 1, new Map(), Number.NaN]) {
      expect(() => measurePublishPayload(payload)).not.toThrow();
      expect(measurePublishPayload(payload).ok).toBe(false);
    }
  });
});

describe("evaluateCandidateModel — accumulation across publishes", () => {
  it("rejects the publish that crosses B-15 and leaves prior data byte-identical", () => {
    const payload = Array.from({ length: 4 }, () => "x".repeat(BOUNDS.dataModelStringChars - 10));
    expect(JSON.stringify(payload).length).toBeLessThanOrEqual(BOUNDS.publishDataPayloadChars);

    let model: DataModel = {};
    let lastAccepted = accept(model).canonicalJson;
    let crossing: { reason: string; bound: string | null } | null = null;

    for (let publish = 0; publish < 200; publish += 1) {
      const candidate = writePath(model, at(`payload${publish}`), payload);
      const result = evaluateCandidateModel(candidate);
      if (!result.ok) {
        crossing = { reason: result.reason, bound: result.bound };
        break;
      }
      expect(result.canonicalJson.length).toBeLessThanOrEqual(BOUNDS.dataModelCanonicalJsonChars);
      model = result.model;
      lastAccepted = result.canonicalJson;
    }

    expect(crossing).not.toBeNull();
    expect(crossing?.bound).toBe("B-15");
    expect(crossing?.reason).toBe("data_model_chars_exceeded");
    expect(accept(model).canonicalJson).toBe(lastAccepted);
  });

  it("rejects the publish that crosses B-16 and leaves prior data byte-identical", () => {
    const payload = Array.from({ length: 5_000 }, () => 1);
    expect(JSON.stringify(payload).length).toBeLessThanOrEqual(BOUNDS.publishDataPayloadChars);

    let model: DataModel = {};
    let lastAccepted = accept(model).canonicalJson;
    let crossing: { reason: string; bound: string | null } | null = null;

    for (let publish = 0; publish < 200; publish += 1) {
      const candidate = writePath(model, at(`payload${publish}`), payload);
      const result = evaluateCandidateModel(candidate);
      if (!result.ok) {
        crossing = { reason: result.reason, bound: result.bound };
        break;
      }
      expect(result.valueCount).toBeLessThanOrEqual(BOUNDS.dataModelValues);
      model = result.model;
      lastAccepted = result.canonicalJson;
    }

    expect(crossing).not.toBeNull();
    expect(crossing?.bound).toBe("B-16");
    expect(crossing?.reason).toBe("data_model_values_exceeded");
    expect(accept(model).canonicalJson).toBe(lastAccepted);
  }, 60_000);
});
