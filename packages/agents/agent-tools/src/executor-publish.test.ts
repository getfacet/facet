import { describe, expect, it } from "vitest";

import { BOUNDS, parseDataPath } from "@facet/core";
import type {
  AuthorValidationResult,
  ComponentDocument,
  DataModel,
  DataPath,
  FacetCatalog,
  FacetTargetedMutationInput,
  FacetTargetedMutationResult,
  PayloadEvaluation,
} from "@facet/core";

import { executePublishData } from "./executor-publish.js";
import type { FacetToolSession } from "./types.js";

function at(value: string): DataPath {
  const parsed = parseDataPath(value);
  if (parsed === null) {
    throw new Error(`invalid fixture path ${value}`);
  }
  return parsed;
}

class StubSession implements FacetToolSession {
  readonly catalog = { components: [] } as unknown as FacetCatalog;
  readonly document: ComponentDocument | null = null;
  data: DataModel = { before: true };
  stageRevision = 4;
  calls: readonly unknown[] = [];

  async applyAuthorMutation(): Promise<AuthorValidationResult> {
    throw new Error("publish_data must not author markup");
  }

  async applyTargetedMutation(
    _input: FacetTargetedMutationInput,
  ): Promise<FacetTargetedMutationResult> {
    throw new Error("publish_data must not author targeted markup");
  }

  async publishData(path: DataPath, value: unknown): Promise<PayloadEvaluation> {
    this.calls = [...this.calls, { path, value }];
    this.data = { ...this.data, [path.join(".")]: value };
    this.stageRevision += 1;
    return { ok: true, chars: JSON.stringify(value).length };
  }
}

function snapshot(session: StubSession): string {
  return JSON.stringify({
    data: session.data,
    stageRevision: session.stageRevision,
    calls: session.calls,
  });
}

describe("publish_data executor", () => {
  it("returns only a descriptor for bulk trusted data and omits row values", async () => {
    const session = new StubSession();
    const rows = Array.from({ length: 10_000 }, (_, index) => ({ name: `Name ${index}` }));

    const result = await executePublishData(
      { path: at("rows"), value: rows, trusted: true },
      session,
    );

    expect(result).toMatchObject({
      ok: true,
      descriptor: { path: "rows", shape: "array", fields: ["name"], count: 10000 },
      stageRevision: 5,
    });
    expect(JSON.stringify(result)).not.toContain("Name 9999");
    expect(session.calls).toHaveLength(1);
  });

  it("returns a success descriptor after commit for arrays with hostile iterators", async () => {
    const session = new StubSession();
    const rows = [{ name: "Ada" }];
    Object.defineProperty(rows, Symbol.iterator, {
      value: (): never => {
        throw new Error("hostile iterator");
      },
    });

    await expect(
      executePublishData({ path: at("rows"), value: rows, trusted: true }, session),
    ).resolves.toMatchObject({
      ok: true,
      descriptor: { path: "rows", shape: "array", fields: ["name"], count: 1 },
      stageRevision: 5,
    });
    expect(session.calls).toHaveLength(1);
  });

  it("accepts a B-20-at-limit payload and rejects one character past without state changes", async () => {
    const accepted = new StubSession();
    const rejected = new StubSession();
    const atLimit = "x".repeat(BOUNDS.publishDataPayloadChars - 2);
    const overLimit = "x".repeat(BOUNDS.publishDataPayloadChars - 1);
    const beforeRejected = snapshot(rejected);

    await expect(
      executePublishData({ path: at("note"), value: atLimit }, accepted),
    ).resolves.toMatchObject({
      ok: true,
      stageRevision: 5,
    });
    await expect(
      executePublishData({ path: at("note"), value: overLimit }, rejected),
    ).resolves.toEqual({
      ok: false,
      code: "publish_payload_chars_exceeded",
      bound: "B-20",
      path: "",
    });
    expect(snapshot(rejected)).toBe(beforeRejected);
  });
});
