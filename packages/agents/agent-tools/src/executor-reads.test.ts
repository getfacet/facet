import { describe, expect, it } from "vitest";

import { BOUNDS, validateCatalog } from "@facet/core";
import type {
  AuthorValidationResult,
  ComponentDocument,
  DataModel,
  FacetCatalog,
  FacetTargetedMutationInput,
  FacetTargetedMutationResult,
  PayloadEvaluation,
} from "@facet/core";

import { executeReadComponentSpec, executeReadData, executeReadScreen } from "./executor-reads.js";
import type { ReadDataResult } from "./executor-reads.js";
import type { FacetToolSession } from "./types.js";

function scalar(value: string): { readonly kind: "scalar"; readonly value: string } {
  return Object.freeze({ kind: "scalar" as const, value });
}

function catalog(): FacetCatalog {
  const result = validateCatalog({
    components: [
      {
        tag: "Screen",
        whenToUse: "Root screen.",
        props: {
          name: { type: "string", required: true, guidance: "Screen name." },
        },
        acceptsChildren: true,
      },
      {
        tag: "Text",
        whenToUse: "Short text.",
        props: { value: { type: "string", guidance: "Visible text." } },
        acceptsChildren: false,
      },
    ],
  });
  if (!result.ok) {
    throw new Error(`expected catalog acceptance, got ${result.code}`);
  }
  return result.catalog;
}

function document(): ComponentDocument {
  return Object.freeze({
    entry: "home",
    screens: Object.freeze(["screen"]),
    nodes: Object.freeze({
      screen: Object.freeze({
        tag: "Screen",
        props: Object.freeze({ name: scalar("home") }),
        children: Object.freeze(["text"]),
      }),
      text: Object.freeze({
        tag: "Text",
        props: Object.freeze({ value: scalar("Ready") }),
        children: Object.freeze([]),
      }),
    }),
  });
}

class StubSession implements FacetToolSession {
  readonly catalog = catalog();
  readonly document = document();
  stageRevision = 3;

  constructor(public data: DataModel = {}) {}

  async applyAuthorMutation(): Promise<AuthorValidationResult> {
    throw new Error("read executors must not mutate");
  }

  async applyTargetedMutation(
    _input: FacetTargetedMutationInput,
  ): Promise<FacetTargetedMutationResult> {
    throw new Error("read executors must not mutate");
  }

  async publishData(): Promise<PayloadEvaluation> {
    throw new Error("read executors must not publish");
  }
}

function snapshot(session: StubSession): string {
  return JSON.stringify({
    document: session.document,
    data: session.data,
    stageRevision: session.stageRevision,
  });
}

async function maxAcceptedString(): Promise<string> {
  let low = 0;
  let high = BOUNDS.readDataResult.chars;
  let accepted = "";
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const value = "x".repeat(mid);
    const result = await executeReadData({ path: "note" }, new StubSession({ note: value }));
    if (result.ok && !result.truncated) {
      accepted = value;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return accepted;
}

function expectBoundedReadResult(
  result: ReadDataResult,
): asserts result is Extract<ReadDataResult, { readonly ok: true }> {
  expect(result).toMatchObject({ ok: true, truncated: true, stageRevision: 3 });
  const json = JSON.stringify(result);
  expect(json.length).toBeLessThanOrEqual(BOUNDS.readDataResult.chars);
  expect(JSON.parse(json)).toEqual(result);
}

describe("read executors", () => {
  it("returns full component metadata or a not-found shape with the available index", async () => {
    const session = new StubSession();

    await expect(executeReadComponentSpec({ tag: "Text" }, session)).resolves.toMatchObject({
      ok: true,
      spec: { tag: "Text", props: { value: { guidance: "Visible text." } } },
      stageRevision: 3,
    });
    await expect(executeReadComponentSpec({ tag: "Missing" }, session)).resolves.toEqual({
      ok: false,
      code: "component_not_found",
      available: ["Screen", "Text"],
    });
  });

  it("reads a screen through the total serializer and changes no state", async () => {
    const session = new StubSession();
    const before = snapshot(session);

    const result = await executeReadScreen({ screen: "home" }, session);

    expect(result).toMatchObject({
      ok: true,
      screen: "home",
      stageRevision: 3,
      issues: [],
    });
    expect(result.ok ? result.markup : "").toContain('<Text value="Ready" id="text" />');
    expect(snapshot(session)).toBe(before);
  });

  it("rejects index-addressed data paths before reading", async () => {
    await expect(executeReadData({ path: "rows.0" }, new StubSession())).resolves.toEqual({
      ok: false,
      code: "invalid_data_path",
      detail: "read_data paths use named keys only.",
    });
  });

  it("treats inherited object members as absent data", async () => {
    await expect(executeReadData({ path: "constructor" }, new StubSession({}))).resolves.toEqual({
      ok: true,
      path: "constructor",
      value: null,
      count: 0,
      truncated: false,
      stageRevision: 3,
    });
  });

  it("accepts 100 array items and clamps 101 with the true original count", async () => {
    const acceptedRows = Array.from({ length: BOUNDS.readDataResult.items }, (_, id) => ({ id }));
    const overRows = Array.from({ length: BOUNDS.readDataResult.items + 1 }, (_, id) => ({ id }));

    const accepted = await executeReadData(
      { path: "rows" },
      new StubSession({ rows: acceptedRows }),
    );
    const clamped = await executeReadData({ path: "rows" }, new StubSession({ rows: overRows }));

    expect(accepted).toMatchObject({ ok: true, count: 100, truncated: false });
    expect(accepted.ok && Array.isArray(accepted.value) ? accepted.value : []).toHaveLength(100);
    expect(clamped).toMatchObject({ ok: true, count: 101, truncated: true });
    expect(clamped.ok && Array.isArray(clamped.value) ? clamped.value : []).toHaveLength(100);
  });

  it("accepts the largest B-21 character result and clamps one character past it", async () => {
    const acceptedText = await maxAcceptedString();
    const accepted = await executeReadData(
      { path: "note" },
      new StubSession({ note: acceptedText }),
    );
    const clamped = await executeReadData(
      { path: "note" },
      new StubSession({ note: `${acceptedText}x` }),
    );

    expect(JSON.stringify(accepted).length).toBeLessThanOrEqual(BOUNDS.readDataResult.chars);
    expect(accepted).toMatchObject({ ok: true, truncated: false });
    expect(JSON.stringify(clamped).length).toBeLessThanOrEqual(BOUNDS.readDataResult.chars);
    expect(clamped).toMatchObject({ ok: true, truncated: true });
  });

  it("keeps clamped non-array projections structured and byte-identical on session state", async () => {
    const session = new StubSession({
      payload: Object.fromEntries(
        Array.from({ length: 80 }, (_, index) => [`field${index}`, "x".repeat(600)]),
      ),
    });
    const before = snapshot(session);

    const result = await executeReadData({ path: "payload" }, session);

    expect(result).toMatchObject({ ok: true, truncated: true });
    expect(result.ok && typeof result.value === "object" && result.value !== null).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(BOUNDS.readDataResult.chars);
    expect(snapshot(session)).toBe(before);
  });

  it("projects unserializable scalar read values without throwing or mutating state", async () => {
    const data: DataModel = { bad: 1n };
    const session = new StubSession(data);
    const before = {
      document: session.document,
      data: session.data,
      stageRevision: session.stageRevision,
    };

    const result = await executeReadData({ path: "bad" }, session);

    expectBoundedReadResult(result);
    expect(result).toMatchObject({ path: "bad", value: null, count: 1 });
    expect(session.document).toBe(before.document);
    expect(session.data).toBe(before.data);
    expect(session.stageRevision).toBe(before.stageRevision);
  });

  it("projects cyclic read values without throwing or mutating state", async () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const data: DataModel = { payload: cycle };
    const session = new StubSession(data);
    const before = {
      document: session.document,
      data: session.data,
      stageRevision: session.stageRevision,
      self: cycle.self,
    };

    const result = await executeReadData({ path: "payload" }, session);

    expectBoundedReadResult(result);
    expect(result).toMatchObject({ path: "payload", value: {}, count: 1 });
    expect(cycle.self).toBe(before.self);
    expect(session.document).toBe(before.document);
    expect(session.data).toBe(before.data);
    expect(session.stageRevision).toBe(before.stageRevision);
  });
});
