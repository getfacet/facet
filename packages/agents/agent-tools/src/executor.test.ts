import { describe, expect, it } from "vitest";

import { validateCatalog } from "@facet/core";
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

import { executeFacetTool } from "./executor.js";
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
        authoring: {
          role: "display",
          informationTypes: ["test_content"],
          visualEmphasis: "supporting",
        } as const,
        props: { name: { type: "string", required: true, guidance: "Screen name." } },
        acceptsChildren: true,
      },
      {
        tag: "Text",
        whenToUse: "Short text.",
        authoring: {
          role: "display",
          informationTypes: ["test_content"],
          visualEmphasis: "supporting",
        } as const,
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
  document: ComponentDocument | null = document();
  data: DataModel = { rows: [{ name: "Ada" }] };
  stageRevision = 0;

  async applyAuthorMutation(): Promise<AuthorValidationResult> {
    this.stageRevision += 1;
    return { ok: true, document: document() };
  }

  async applyTargetedMutation(
    _input: FacetTargetedMutationInput,
  ): Promise<FacetTargetedMutationResult> {
    this.stageRevision += 1;
    return { ok: true, document: document() };
  }

  async publishData(path: DataPath, value: unknown): Promise<PayloadEvaluation> {
    this.data = { ...this.data, [path.join(".")]: value };
    this.stageRevision += 1;
    return { ok: true, chars: 1 };
  }
}

const MARKUP = '<Facet entry="home"><Screen name="home"><Text value="Next" /></Screen></Facet>';

describe("executeFacetTool", () => {
  it.each([
    ["render_page", { markup: MARKUP }],
    ["insert_subtree", { targetId: "text", markup: MARKUP }],
    ["replace_subtree", { targetId: "text", markup: MARKUP }],
    ["update_node", { targetId: "text", markup: MARKUP }],
    ["remove_subtree", { targetId: "text" }],
    ["read_component_spec", { tag: "Text" }],
    ["read_screen", { screen: "home" }],
    ["read_data", { path: "rows" }],
    ["publish_data", { path: "rows", value: [{ name: "Lin" }] }],
  ] as const)("dispatches %s", async (name, input) => {
    await expect(executeFacetTool(name, input, new StubSession())).resolves.not.toMatchObject({
      code: "unknown_tool",
    });
  });

  it("returns a structured unknown-tool result", async () => {
    await expect(executeFacetTool("say", {}, new StubSession())).resolves.toEqual({
      ok: false,
      code: "unknown_tool",
      detail: "Unknown Facet tool: say",
    });
  });

  it.each([
    ["render_page", {}],
    ["insert_subtree", { targetId: "text" }],
    ["replace_subtree", { targetId: "text", markup: MARKUP, extra: true }],
    ["update_node", { targetId: 7, markup: MARKUP }],
    ["remove_subtree", { targetId: "text", markup: MARKUP }],
    ["read_component_spec", { tag: "Text", extra: true }],
    ["read_screen", { screen: null }],
    ["read_data", []],
    ["publish_data", { value: 1 }],
  ] as const)("rejects %s inputs before dispatching", async (name, input) => {
    const session = new StubSession();

    await expect(executeFacetTool(name, input, session)).resolves.toMatchObject({
      ok: false,
      code: "invalid_tool_input",
    });
    expect(session.stageRevision).toBe(0);
    expect(session.data).toEqual({ rows: [{ name: "Ada" }] });
  });

  it("handles hostile input objects without throwing", async () => {
    const ownKeysThrow = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("ownKeys trap");
        },
      },
    );
    const getterThrow = Object.create(null, {
      path: {
        enumerable: true,
        get() {
          throw new Error("getter trap");
        },
      },
      value: { enumerable: true, value: 1 },
    });

    await expect(executeFacetTool("read_data", ownKeysThrow, new StubSession())).resolves.toEqual({
      ok: false,
      code: "invalid_tool_input",
      detail: "read_data input rejected: expected an object with exactly the declared schema keys.",
    });
    await expect(executeFacetTool("publish_data", getterThrow, new StubSession())).resolves.toEqual(
      {
        ok: false,
        code: "invalid_tool_input",
        detail: "publish_data input rejected: missing required key path.",
      },
    );
  });

  it("keeps publish_data's public input path as a string and parses it privately", async () => {
    const session = new StubSession();

    await expect(
      executeFacetTool("publish_data", { path: "rows.next", value: [{ name: "Lin" }] }, session),
    ).resolves.toMatchObject({
      ok: true,
      descriptor: { path: "rows.next" },
    });
    await expect(
      executeFacetTool("publish_data", { path: ["rows"], value: [] }, new StubSession()),
    ).resolves.toMatchObject({
      ok: false,
      code: "invalid_tool_input",
    });
    await expect(
      executeFacetTool("publish_data", { path: "rows.0", value: [] }, new StubSession()),
    ).resolves.toMatchObject({
      ok: false,
      code: "invalid_data_path",
    });
  });
});
