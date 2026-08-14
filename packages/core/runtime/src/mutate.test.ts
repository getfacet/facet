import { describe, expect, it } from "vitest";

import type { ComponentDocument, DataModel, FacetCatalog } from "@facet/core";

import { validTestTheme } from "../../../../test-support/theme-fixture.js";
import { bootstrapSession } from "./bootstrap.js";
import { applyAuthorMutation } from "./mutate.js";
import type { AuthorMutationKind } from "./mutate.js";
import type { Session } from "./session.js";
import { TurnGate } from "./turn-gate.js";
import type { TurnToken } from "./turn-gate.js";

const MARKUP_READY = `<Facet entry="home">
  <Screen name="home">
    <Text value="Ready" />
  </Screen>
</Facet>`;

const MARKUP_UPDATED = `<Facet entry="home">
  <Screen name="home">
    <Text value="Updated" />
  </Screen>
</Facet>`;

const MARKUP_NESTED = `<Facet entry="home">
  <Screen name="home">
    <Stack>
      <Text value="Ready" />
    </Stack>
  </Screen>
</Facet>`;

const MUTATIONS_REQUIRING_A_PAGE: readonly AuthorMutationKind[] = [
  "insert_subtree",
  "replace_subtree",
  "update_node",
  "remove_subtree",
];

function catalogRecord(): Record<string, unknown> {
  return {
    components: [
      {
        tag: "Screen",
        whenToUse: "Root screen used to render a page.",
        authoring: {
          role: "display",
          informationTypes: ["test_content"],
          visualEmphasis: "supporting",
        } as const,
        props: {
          name: {
            type: "string",
            required: true,
            guidance: "The route name selected by the Facet entry.",
          },
        },
        acceptsChildren: true,
      },
      {
        tag: "Text",
        whenToUse: "Short visible text.",
        authoring: {
          role: "display",
          informationTypes: ["test_content"],
          visualEmphasis: "supporting",
        } as const,
        props: { value: { type: "string", guidance: "Text to show." } },
        acceptsChildren: false,
      },
      {
        tag: "Stack",
        whenToUse: "Flow container.",
        authoring: {
          role: "display",
          informationTypes: ["test_content"],
          visualEmphasis: "supporting",
        } as const,
        props: {},
        acceptsChildren: true,
      },
    ],
  };
}

function boot(initialMarkup?: string): Session {
  const result = bootstrapSession({
    catalog: catalogRecord() as unknown as FacetCatalog,
    theme: validTestTheme(),
    ...(initialMarkup === undefined ? {} : { initialMarkup }),
  });
  if (!result.ok) {
    throw new Error(`expected bootstrap acceptance, got ${result.code}`);
  }
  return result.session;
}

function withData(session: Session, data: DataModel): Session {
  return Object.freeze({ ...session, data });
}

function withRevision(session: Session, stageRevision: number): Session {
  return Object.freeze({ ...session, stageRevision });
}

let nextTriggerId = 0;

function admitted(gate: TurnGate): TurnToken {
  nextTriggerId += 1;
  const result = gate.admit(`mutate-event-${nextTriggerId}`);
  if (result.outcome !== "admitted") {
    throw new Error(`expected admitted, got ${result.outcome}`);
  }
  return result.token;
}

function documentText(document: ComponentDocument | null): readonly string[] {
  if (document === null) {
    return [];
  }
  return Object.values(document.nodes)
    .filter((node) => node.tag === "Text")
    .map((node) => node.props["value"])
    .map((prop) => (prop?.kind === "scalar" ? prop.value : ""));
}

function nodeIdByTag(document: ComponentDocument | null, tag: string): string {
  const id = Object.entries(document?.nodes ?? {}).find(([, node]) => node.tag === tag)?.[0];
  if (id === undefined) {
    throw new Error(`expected ${tag} node`);
  }
  return id;
}

function snapshot(session: Session): {
  readonly document: ComponentDocument | null;
  readonly data: DataModel;
  readonly stageRevision: number;
} {
  return {
    document: session.document,
    data: session.data,
    stageRevision: session.stageRevision,
  };
}

function expectUnchanged(session: Session, before: ReturnType<typeof snapshot>): void {
  expect(snapshot(session)).toEqual(before);
}

describe("applyAuthorMutation", () => {
  it("lets render_page create the first document and produces one stage-rooted patch", () => {
    const gate = new TurnGate();
    const session = withData(boot(), { status: "kept" });
    const token = admitted(gate);

    const result = applyAuthorMutation(
      session,
      "render_page",
      { markup: MARKUP_READY },
      0,
      {
        kind: "turn",
        token,
      },
      gate,
    );

    expect(result).toMatchObject({ ok: true, stageRevision: 1 });
    if (!result.ok) {
      throw new Error(`expected mutation acceptance, got ${result.code}`);
    }
    expect(result.session.stageRevision).toBe(1);
    expect(result.session.phase).toBe("live");
    expect(result.session.data).toEqual({ status: "kept" });
    expect(documentText(result.session.document)).toEqual(["Ready"]);
    expect(result.patches).toEqual([{ op: "replace", path: "/document", value: result.document }]);
  });

  it.each(MUTATIONS_REQUIRING_A_PAGE)(
    "rejects %s while preparing and names render_page",
    (kind) => {
      const gate = new TurnGate();
      const session = boot();
      const before = snapshot(session);
      const token = admitted(gate);

      const result = applyAuthorMutation(
        session,
        kind,
        { targetId: "n1", markup: MARKUP_READY },
        0,
        { kind: "turn", token },
        gate,
      );

      expect(result).toMatchObject({
        ok: false,
        code: "page_not_rendered",
        at: "document",
      });
      if (!result.ok) {
        expect(result.detail).toContain("render_page");
      }
      expectUnchanged(session, before);
    },
  );

  it("rejects stale revisions before parsing or repairing the document", () => {
    const gate = new TurnGate();
    const session = withRevision(boot(MARKUP_READY), 3);
    const before = snapshot(session);
    const token = admitted(gate);

    const result = applyAuthorMutation(
      session,
      "render_page",
      { markup: MARKUP_UPDATED },
      2,
      {
        kind: "turn",
        token,
      },
      gate,
    );

    expect(result).toEqual({
      ok: false,
      code: "stale_revision",
      at: "expectedRevision",
      detail: "The mutation expected revision 2, but the session is at revision 3.",
      currentRevision: 3,
    });
    expectUnchanged(session, before);
  });

  it("rejects stale targeted revisions before parsing the fragment", () => {
    const gate = new TurnGate();
    const session = withRevision(boot(MARKUP_READY), 3);
    const before = snapshot(session);
    const textId = nodeIdByTag(session.document, "Text");
    const token = admitted(gate);

    const result = applyAuthorMutation(
      session,
      "update_node",
      { targetId: textId, markup: "<Text" },
      2,
      { kind: "turn", token },
      gate,
    );

    expect(result).toEqual({
      ok: false,
      code: "stale_revision",
      at: "expectedRevision",
      detail: "The mutation expected revision 2, but the session is at revision 3.",
      currentRevision: 3,
    });
    expectUnchanged(session, before);
  });

  it("rejects a fenced authority before parsing or mutation", () => {
    const gate = new TurnGate();
    const session = boot(MARKUP_READY);
    const before = snapshot(session);
    const token = admitted(gate);
    gate.fence({ kind: "turn", token });

    const result = applyAuthorMutation(
      session,
      "render_page",
      { markup: "<Facet" },
      0,
      {
        kind: "turn",
        token,
      },
      gate,
    );

    expect(result).toEqual({
      ok: false,
      code: "mutation_authority_rejected",
      at: "authority",
      detail: "The write authority is not active.",
    });
    expectUnchanged(session, before);
  });

  it("rejects a fenced targeted authority before parsing or mutation", () => {
    const gate = new TurnGate();
    const session = boot(MARKUP_READY);
    const before = snapshot(session);
    const textId = nodeIdByTag(session.document, "Text");
    const token = admitted(gate);
    gate.fence({ kind: "turn", token });

    const result = applyAuthorMutation(
      session,
      "update_node",
      { targetId: textId, markup: "<Text" },
      0,
      { kind: "turn", token },
      gate,
    );

    expect(result).toEqual({
      ok: false,
      code: "mutation_authority_rejected",
      at: "authority",
      detail: "The write authority is not active.",
    });
    expectUnchanged(session, before);
  });

  it("rejects unknown target IDs atomically", () => {
    const gate = new TurnGate();
    const session = boot(MARKUP_READY);
    const before = snapshot(session);
    const token = admitted(gate);

    const result = applyAuthorMutation(
      session,
      "replace_subtree",
      { targetId: "ghost", markup: MARKUP_UPDATED },
      0,
      { kind: "turn", token },
      gate,
    );

    expect(result).toEqual({
      ok: false,
      code: "unknown_target_id",
      at: "targetId",
      detail: 'Mutation target "ghost" does not exist.',
    });
    expectUnchanged(session, before);
  });

  it("commits a live non-render mutation at the next revision", () => {
    const gate = new TurnGate();
    const session = boot(MARKUP_READY);
    const token = admitted(gate);
    const textNodeId = Object.entries(session.document?.nodes ?? {}).find(
      ([, node]) => node.tag === "Text",
    )?.[0];

    if (textNodeId === undefined) {
      throw new Error("expected Text node");
    }

    const result = applyAuthorMutation(
      session,
      "update_node",
      { targetId: textNodeId, markup: '<Text value="Updated" />' },
      0,
      { kind: "turn", token },
      gate,
    );

    expect(result).toMatchObject({ ok: true, stageRevision: 1 });
    if (!result.ok) {
      throw new Error(`expected mutation acceptance, got ${result.code}`);
    }
    expect(documentText(result.session.document)).toEqual(["Updated"]);
    expect(result.patches).toEqual([{ op: "replace", path: "/document", value: result.document }]);
  });

  it("inserts one parsed subtree as the last child and keeps existing IDs stable", () => {
    const gate = new TurnGate();
    const session = boot(MARKUP_READY);
    const screenId = nodeIdByTag(session.document, "Screen");
    const textId = nodeIdByTag(session.document, "Text");
    const token = admitted(gate);

    const result = applyAuthorMutation(
      session,
      "insert_subtree",
      { targetId: screenId, markup: '<Text value="Later" />' },
      0,
      { kind: "turn", token },
      gate,
    );

    expect(result).toMatchObject({ ok: true, stageRevision: 1 });
    if (!result.ok) {
      throw new Error(`expected mutation acceptance, got ${result.code}`);
    }
    expect(result.document.nodes[screenId]?.children).toEqual([textId, "n3"]);
    expect(result.document.nodes[textId]?.props["value"]).toEqual({
      kind: "scalar",
      value: "Ready",
    });
    expect(documentText(result.session.document)).toEqual(["Ready", "Later"]);
  });

  it("replaces exactly the target subtree with freshly allocated IDs", () => {
    const gate = new TurnGate();
    const session = boot(MARKUP_READY);
    const screenId = nodeIdByTag(session.document, "Screen");
    const textId = nodeIdByTag(session.document, "Text");
    const token = admitted(gate);

    const result = applyAuthorMutation(
      session,
      "replace_subtree",
      { targetId: textId, markup: '<Text value="Replacement" />' },
      0,
      { kind: "turn", token },
      gate,
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) {
      throw new Error(`expected mutation acceptance, got ${result.code}`);
    }
    expect(Object.hasOwn(result.document.nodes, textId)).toBe(false);
    expect(result.document.nodes[screenId]?.children).toEqual(["n3"]);
    expect(documentText(result.session.document)).toEqual(["Replacement"]);
  });

  it("preserves target ID and child order when updating one childless declaration", () => {
    const gate = new TurnGate();
    const session = boot(MARKUP_NESTED);
    const stackId = nodeIdByTag(session.document, "Stack");
    const textId = nodeIdByTag(session.document, "Text");
    const token = admitted(gate);

    const result = applyAuthorMutation(
      session,
      "update_node",
      { targetId: stackId, markup: "<Stack />" },
      0,
      { kind: "turn", token },
      gate,
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) {
      throw new Error(`expected mutation acceptance, got ${result.code}`);
    }
    expect(result.document.nodes[stackId]?.tag).toBe("Stack");
    expect(result.document.nodes[stackId]?.children).toEqual([textId]);
    expect(documentText(result.session.document)).toEqual(["Ready"]);
  });

  it("rejects update_node fragments that author children", () => {
    const gate = new TurnGate();
    const session = boot(MARKUP_NESTED);
    const before = snapshot(session);
    const stackId = nodeIdByTag(session.document, "Stack");
    const token = admitted(gate);

    const result = applyAuthorMutation(
      session,
      "update_node",
      { targetId: stackId, markup: '<Stack><Text value="Nested" /></Stack>' },
      0,
      { kind: "turn", token },
      gate,
    );

    expect(result).toMatchObject({
      ok: false,
      code: "invalid_fragment",
      detail: "update_node markup must be one childless component declaration.",
    });
    expectUnchanged(session, before);
  });

  it("removes the target subtree and descendants", () => {
    const gate = new TurnGate();
    const session = boot(MARKUP_NESTED);
    const stackId = nodeIdByTag(session.document, "Stack");
    const textId = nodeIdByTag(session.document, "Text");
    const token = admitted(gate);

    const result = applyAuthorMutation(
      session,
      "remove_subtree",
      { targetId: stackId },
      0,
      { kind: "turn", token },
      gate,
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) {
      throw new Error(`expected mutation acceptance, got ${result.code}`);
    }
    expect(Object.hasOwn(result.document.nodes, stackId)).toBe(false);
    expect(Object.hasOwn(result.document.nodes, textId)).toBe(false);
    expect(documentText(result.session.document)).toEqual([]);
  });

  it("rejects catalog-invalid targeted candidates atomically", () => {
    const gate = new TurnGate();
    const session = boot(MARKUP_READY);
    const before = snapshot(session);
    const textId = nodeIdByTag(session.document, "Text");
    const token = admitted(gate);

    const result = applyAuthorMutation(
      session,
      "insert_subtree",
      { targetId: textId, markup: '<Text value="Nested" />' },
      0,
      { kind: "turn", token },
      gate,
    );

    expect(result).toMatchObject({ ok: false, code: "children-not-accepted" });
    expectUnchanged(session, before);
  });

  it("rejects malformed targeted fragments before changing the session", () => {
    const gate = new TurnGate();
    const session = boot(MARKUP_READY);
    const before = snapshot(session);
    const textId = nodeIdByTag(session.document, "Text");
    const token = admitted(gate);

    const result = applyAuthorMutation(
      session,
      "replace_subtree",
      { targetId: textId, markup: "<Text" },
      0,
      { kind: "turn", token },
      gate,
    );

    expect(result).toMatchObject({ ok: false, error: { code: "unterminated-tag" } });
    expectUnchanged(session, before);
  });

  it("enforces screen boundary and entry screen name invariants", () => {
    const session = boot(MARKUP_READY);
    const screenId = nodeIdByTag(session.document, "Screen");
    const textId = nodeIdByTag(session.document, "Text");
    const gateA = new TurnGate();
    const tokenA = admitted(gateA);
    const gateB = new TurnGate();
    const tokenB = admitted(gateB);
    const gateC = new TurnGate();
    const tokenC = admitted(gateC);
    const gateD = new TurnGate();
    const tokenD = admitted(gateD);

    const nonScreenReplace = applyAuthorMutation(
      session,
      "replace_subtree",
      { targetId: screenId, markup: '<Text value="Not a screen" />' },
      0,
      { kind: "turn", token: tokenA },
      gateA,
    );
    const screenInsert = applyAuthorMutation(
      session,
      "replace_subtree",
      { targetId: textId, markup: '<Screen name="details" />' },
      0,
      { kind: "turn", token: tokenB },
      gateB,
    );
    const nameChanged = applyAuthorMutation(
      session,
      "update_node",
      { targetId: screenId, markup: '<Screen name="details" />' },
      0,
      { kind: "turn", token: tokenC },
      gateC,
    );
    const entryReplace = applyAuthorMutation(
      session,
      "replace_subtree",
      { targetId: screenId, markup: '<Screen name="home"><Text value="Entry" /></Screen>' },
      0,
      { kind: "turn", token: tokenD },
      gateD,
    );

    expect(nonScreenReplace).toMatchObject({ ok: false, code: "screen_boundary_violation" });
    expect(screenInsert).toMatchObject({ ok: false, code: "screen_boundary_violation" });
    expect(nameChanged).toMatchObject({ ok: false, code: "screen_name_changed" });
    expect(entryReplace).toMatchObject({ ok: true });
  });
});
