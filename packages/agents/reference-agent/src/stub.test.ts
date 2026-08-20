import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_CATALOG, DEFAULT_THEME } from "@facet/assets";

import {
  deriveMessageId,
  parseMarkup,
  serializeDocument,
  validateAuthorMarkup,
  type VisitorEvent,
  type AuthorValidationResult,
  type ComponentDocument,
  type ComponentNode,
  type ConversationMessage,
  type DataModel,
  type DataPath,
  type FacetTargetedMutationInput,
  type FacetTargetedMutationResult,
  type FacetToolSession,
  type PayloadEvaluation,
  type ServerFrame,
  type StageRevision,
} from "@facet/core";
import {
  FacetRuntime,
  MemorySink,
  MemoryStageStore,
  bootstrapSession,
  loadSession,
} from "@facet/runtime";
import { STUB_MARKUP, createStubAgent } from "./stub.js";

function validateDefaultMarkup(markup: string): AuthorValidationResult {
  const parsed = parseMarkup(markup);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  return validateAuthorMarkup(parsed.ast, DEFAULT_CATALOG, {});
}

function acceptedDocument(markup: string): ComponentDocument {
  const result = validateDefaultMarkup(markup);
  if (!result.ok) {
    throw new Error(`expected accepted markup, got ${result.error.code}`);
  }
  return result.document;
}

function propText(node: ComponentNode | undefined, name: string): string | undefined {
  const prop = node?.props[name];
  if (prop === undefined) return undefined;
  return prop.kind === "scalar" ? prop.value : `${prop.scheme}:${prop.target}`;
}

function fieldNames(document: ComponentDocument): readonly string[] {
  return Object.values(document.nodes)
    .filter((node) => node.tag === "Field")
    .map((node) => propText(node, "name") ?? "")
    .sort();
}

function buttonActions(document: ComponentDocument): readonly string[] {
  return Object.values(document.nodes)
    .filter((node) => node.tag === "Button")
    .map((node) => propText(node, "action") ?? "")
    .sort();
}

function event(
  eventId: string,
  collect: VisitorEvent["collect"] = {},
  eventName = "submit",
): VisitorEvent {
  return {
    eventId,
    eventName,
    sourceNodeId: eventName === "message" ? "visitor" : "submit",
    screen: "home",
    stageRevision: 0,
    collect,
  };
}

function visitorMessage(eventId: string): ConversationMessage {
  return {
    kind: "conversation",
    messageId: deriveMessageId(eventId, "visitor"),
    turnId: eventId,
    role: "visitor",
    text: "Start",
    at: 1,
  };
}

class RecordingSession implements FacetToolSession {
  readonly catalog = DEFAULT_CATALOG;
  readonly data: DataModel = {};
  document: ComponentDocument | null = null;
  stageRevision: StageRevision = 0;
  readonly appliedMarkup: string[] = [];

  async applyAuthorMutation(markup: string): Promise<AuthorValidationResult> {
    this.appliedMarkup.push(markup);
    const result = validateDefaultMarkup(markup);
    if (result.ok) {
      this.document = result.document;
      this.stageRevision += 1;
    }
    return result;
  }

  async applyTargetedMutation(
    input: FacetTargetedMutationInput,
  ): Promise<FacetTargetedMutationResult> {
    const markup = input.kind === "remove_subtree" ? STUB_MARKUP : input.markup;
    const result = validateDefaultMarkup(markup);
    if (result.ok) {
      this.document = result.document;
      this.stageRevision += 1;
    }
    return result;
  }

  async publishData(_path: DataPath, _value: unknown): Promise<PayloadEvaluation> {
    return { ok: true, chars: 0 };
  }
}

describe("createStubAgent", () => {
  it("authors default-catalog component markup, not the retired tree fixture", () => {
    const source = readFileSync(new URL("./stub.ts", import.meta.url), "utf8");
    expect(source).not.toContain("STUB_TREE");
    expect(source).not.toContain("FacetTree"); // component-hard-cut: allowed-negative
    expect(source).not.toContain("validateTree");

    const document = acceptedDocument(STUB_MARKUP);
    const serialized = serializeDocument(document);
    expect(serialized.issues).toEqual([]);
    expect(serialized.text).toContain('<Facet entry="home">');
    expect(serialized.text).toContain("<Screen");

    expect(document.entry).toBe("home");
    expect(fieldNames(document)).toEqual(["email", "name"]);
    expect(buttonActions(document)).toEqual(["agent:submit", "nav:about", "nav:home"]);

    const submit = Object.values(document.nodes).find(
      (node) => node.tag === "Button" && propText(node, "action") === "agent:submit",
    );
    expect(propText(submit, "collect")).toBe("name email");
  });

  it("renders STUB_MARKUP once through the runtime session and returns sorted collect text", async () => {
    const agent = createStubAgent();
    const session = new RecordingSession();
    const collect: VisitorEvent["collect"] = {
      name: { kind: "value", value: "Ada" },
      token: { kind: "omitted_sensitive" },
      email: { kind: "value", value: "a@b.c" },
      enabled: { kind: "value", value: true },
      interests: { kind: "value", value: ["design", "systems"] },
      missing: { kind: "collect_source_unavailable" },
    };

    const first = await agent.run({ event: event("turn1", collect), session });
    const second = await agent.run({ event: event("turn1", collect), session });

    expect(session.appliedMarkup).toEqual([STUB_MARKUP]);
    expect(session.document).toEqual(acceptedDocument(STUB_MARKUP));
    expect(first.text).toBe(
      'submit: email=a@b.c enabled=true interests=["design","systems"] missing=collect_source_unavailable name=Ada token=omitted_sensitive',
    );
    expect(second).toEqual(first);
  });

  it("renders through real FacetRuntime with one authorized document patch and one revision", async () => {
    const boot = bootstrapSession({ catalog: DEFAULT_CATALOG, theme: DEFAULT_THEME });
    if (!boot.ok) throw new Error(`bootstrap failed: ${boot.code}`);
    const store = new MemoryStageStore();
    const sink = new MemorySink();
    const delivered: ServerFrame[] = [];
    const saved = await store.save("quickstart:v1", boot.session, 0);
    expect(saved.ok).toBe(true);

    const runtime = new FacetRuntime({
      store,
      sink,
      agent: createStubAgent(),
      deliver(entry) {
        delivered.push(entry.frame);
      },
      now: () => 123,
    });

    const result = await runtime.handle({
      sessionKey: "quickstart:v1",
      event: event("turn-runtime", {}, "message"),
      visitorMessage: visitorMessage("turn-runtime"),
    });
    const loaded = await loadSession(store, "quickstart:v1");
    const expectedDocument = acceptedDocument(STUB_MARKUP);
    const patch = delivered.find((frame) => frame.kind === "patch");

    expect(result).toMatchObject({ outcome: "accepted", receipt: { triggerId: "turn-runtime" } });
    expect(loaded.session.document).toEqual(expectedDocument);
    expect(loaded.session.stageRevision).toBe(1);
    expect(patch).toBeDefined();
    if (patch?.kind !== "patch") throw new Error("expected patch frame");
    expect(patch.stageRevision).toBe(1);
    expect(patch.ops).toHaveLength(1);
    expect(patch.ops[0]).toEqual({
      op: "replace",
      path: "/document",
      value: expectedDocument,
    });
    expect(
      patch.ops.some((op) => op.path === "/document" && "value" in op && op.value === STUB_MARKUP),
    ).toBe(false);
  });

  it("keeps non-collect events deterministic and argument-aware", async () => {
    const agent = createStubAgent();
    const session = new RecordingSession();
    const input: VisitorEvent = { ...event("turn2", {}, "refresh"), arg: "north" };

    expect(await agent.run({ event: input, session })).toEqual({ text: "stub: refresh north" });
    expect(await agent.run({ event: input, session })).toEqual({ text: "stub: refresh north" });
    expect(session.appliedMarkup).toEqual([STUB_MARKUP]);
  });

  it("does not expose an invented patch-producing handleEvent path", () => {
    const agent = createStubAgent();
    const source = readFileSync(new URL("./stub.ts", import.meta.url), "utf8");

    expect("handleEvent" in agent).toBe(false);
    expect(source).not.toMatch(
      /TurnOutcome|deriveMessageId|patches:\s*Object\.freeze|value:\s*STUB_MARKUP/u,
    );
  });
});
