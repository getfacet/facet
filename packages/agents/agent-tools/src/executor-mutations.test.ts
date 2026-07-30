import { describe, expect, it } from "vitest";

import type {
  AuthorValidationResult,
  ComponentDocument,
  DataModel,
  FacetCatalog,
  FacetTargetedMutationInput,
  FacetTargetedMutationResult,
  PayloadEvaluation,
} from "@facet/core";

import {
  executeInsertSubtree,
  executeRemoveSubtree,
  executeRenderPage,
  executeReplaceSubtree,
  executeUpdateNode,
} from "./executor-mutations.js";
import type { FacetToolSession } from "./types.js";

const NEXT_MARKUP =
  '<Facet entry="home"><Screen name="home"><Text value="Next" /></Screen></Facet>';

function scalar(value: string): { readonly kind: "scalar"; readonly value: string } {
  return Object.freeze({ kind: "scalar" as const, value });
}

function componentDocument(): ComponentDocument {
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
  readonly catalog = { components: [] } as unknown as FacetCatalog;
  data: DataModel = {};
  stageRevision = 0;
  calls: string[] = [];
  targetedCalls: FacetTargetedMutationInput[] = [];

  constructor(
    public document: ComponentDocument | null,
    readonly result: AuthorValidationResult | FacetTargetedMutationResult = {
      ok: true,
      document: componentDocument(),
    },
  ) {}

  async applyAuthorMutation(markup: string): Promise<AuthorValidationResult> {
    this.calls.push(markup);
    if (this.result.ok) {
      this.document = this.result.document;
      this.stageRevision += 1;
      return this.result;
    }
    if ("error" in this.result) {
      return this.result;
    }
    throw new Error("non-author rejection fixture cannot be returned from applyAuthorMutation");
  }

  async applyTargetedMutation(
    input: FacetTargetedMutationInput,
  ): Promise<FacetTargetedMutationResult> {
    this.targetedCalls.push(input);
    if (this.document === null) {
      return {
        ok: false,
        code: "page_not_rendered",
        at: "document",
        detail: "This mutation requires an existing page. Use render_page first.",
      };
    }
    if (!Object.hasOwn(this.document.nodes, input.targetId)) {
      return {
        ok: false,
        code: "unknown_target_id",
        at: "targetId",
        detail: `Mutation target "${input.targetId}" does not exist.`,
      };
    }
    if (this.result.ok) {
      this.document = this.result.document;
      this.stageRevision += 1;
    }
    return this.result;
  }

  async publishData(): Promise<PayloadEvaluation> {
    return { ok: true, chars: 0 };
  }
}

function rejectedResult(): AuthorValidationResult {
  return {
    ok: false,
    error: {
      code: "unknown-tag",
      location: { line: 1, column: 32, offset: 31 },
      cause: "Widget is not registered.",
      repair: "Use a registered component.",
    },
  };
}

const mutationExecutors = [
  [
    "render_page",
    () =>
      executeRenderPage(
        { markup: NEXT_MARKUP },
        new StubSession(componentDocument(), rejectedResult()),
      ),
  ],
  [
    "insert_subtree",
    () =>
      executeInsertSubtree(
        { targetId: "text", markup: NEXT_MARKUP },
        new StubSession(componentDocument(), rejectedResult()),
      ),
  ],
  [
    "replace_subtree",
    () =>
      executeReplaceSubtree(
        { targetId: "text", markup: NEXT_MARKUP },
        new StubSession(componentDocument(), rejectedResult()),
      ),
  ],
  [
    "update_node",
    () =>
      executeUpdateNode(
        { targetId: "text", markup: NEXT_MARKUP },
        new StubSession(componentDocument(), rejectedResult()),
      ),
  ],
  [
    "remove_subtree",
    () =>
      executeRemoveSubtree(
        { targetId: "text" },
        new StubSession(componentDocument(), rejectedResult()),
      ),
  ],
] as const;

describe("mutation executors", () => {
  it("lets render_page create or replace the page through the runtime lane", async () => {
    const session = new StubSession(null);

    await expect(executeRenderPage({ markup: NEXT_MARKUP }, session)).resolves.toMatchObject({
      ok: true,
      stageRevision: 1,
    });
    expect(session.calls).toEqual([NEXT_MARKUP]);
  });

  it("rejects root insert while preparing with an error naming render_page", async () => {
    const session = new StubSession(null);

    await expect(
      executeInsertSubtree({ targetId: "screen", markup: NEXT_MARKUP }, session),
    ).resolves.toMatchObject({
      ok: false,
      code: "page_not_rendered",
      detail: expect.stringContaining("render_page") as string,
    });
    expect(session.calls).toEqual([]);
    expect(session.targetedCalls).toEqual([
      { kind: "insert_subtree", targetId: "screen", markup: NEXT_MARKUP },
    ]);
  });

  it("routes targeted mutations through the explicit targeted runtime lane", async () => {
    const session = new StubSession(componentDocument());

    await expect(
      executeUpdateNode({ targetId: "text", markup: '<Text value="Updated" />' }, session),
    ).resolves.toMatchObject({ ok: true, stageRevision: 1 });

    expect(session.calls).toEqual([]);
    expect(session.targetedCalls).toEqual([
      { kind: "update_node", targetId: "text", markup: '<Text value="Updated" />' },
    ]);
  });

  it.each(mutationExecutors)(
    "%s surfaces exactly one author error and changes no revision",
    async (_name, run) => {
      const result = await run();

      expect(result).toEqual({
        ok: false,
        code: "author_error",
        error: {
          code: "unknown-tag",
          location: { line: 1, column: 32, offset: 31 },
          cause: "Widget is not registered.",
          repair: "Use a registered component.",
        },
      });
    },
  );

  it("surfaces an unknown-target runtime rejection without local document mutation", async () => {
    const session = new StubSession(componentDocument());

    await expect(
      executeReplaceSubtree({ targetId: "missing", markup: NEXT_MARKUP }, session),
    ).resolves.toMatchObject({
      ok: false,
      code: "unknown_target_id",
      detail: expect.stringContaining("missing") as string,
    });
    expect(session.calls).toEqual([]);
    expect(session.targetedCalls).toEqual([
      { kind: "replace_subtree", targetId: "missing", markup: NEXT_MARKUP },
    ]);
    expect(session.stageRevision).toBe(0);
  });
});
