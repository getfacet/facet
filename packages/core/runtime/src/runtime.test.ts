import { describe, expect, it } from "vitest";

import { BOUNDS, deriveMessageId, parseDataPath, validateCatalog } from "@facet/core";
import type {
  VisitorEvent,
  CasOutcome,
  ComponentDocument,
  ConversationMessage,
  DataPath,
  FacetCatalog,
  FacetTheme,
  StageRevision,
} from "@facet/core";

import { bootstrapSession } from "./bootstrap.js";
import { FacetRuntime } from "./runtime.js";
import type { RuntimeDiagnostic, RuntimeSink } from "./runtime.js";
import type { Session } from "./session.js";
import type { ConversationRecord, Sink } from "./sink.js";
import { MemoryStageStore } from "./stage-store.js";
import type { StageStore } from "./stage-store.js";
import { validTestTheme } from "../../../../test-support/theme-fixture.js";

const MARKUP_READY = `<Facet entry="home">
  <Screen name="home">
    <Text value="Ready" />
    <ChoiceGroup name="regions" label="Regions" />
    <Button label="Submit" action="agent:submit" />
    <Button label="Submit regions" action="agent:selected" collect="regions" />
  </Screen>
</Facet>`;

const MARKUP_UPDATED = `<Facet entry="home">
  <Screen name="home">
    <Text value="Updated" />
  </Screen>
</Facet>`;

function catalogRecord(): Record<string, unknown> {
  return {
    components: [
      {
        tag: "Screen",
        whenToUse: "Root screen used to render a page.",
        props: {
          name: {
            type: "string",
            required: true,
            guidance: "The route name selected by the Facet entry.",
          },
        },
        content: { mode: "children" },
      },
      {
        tag: "Text",
        whenToUse: "Short visible text.",
        props: {
          value: { type: "string", bindable: true, guidance: "Text to show." },
          arg: { type: "string", guidance: "Argument emitted with a visitor event." },
        },
        content: { mode: "none" },
      },
      {
        tag: "Field",
        whenToUse: "Collect one short text value.",
        props: {
          name: { type: "string", required: true, guidance: "Collection address." },
          label: { type: "string", required: true, guidance: "Visible field label." },
          value: { type: "string", default: "", guidance: "Current field value." },
          secret: { type: "boolean", default: false, guidance: "Withhold the value." },
        },
        content: { mode: "none" },
        collect: {
          collectable: true,
          valueProp: "value",
          valueKind: "string",
          sensitiveProp: "secret",
        },
      },
      {
        tag: "ChoiceGroup",
        whenToUse: "Collect multiple selected values.",
        props: {
          name: { type: "string", required: true, guidance: "Collection address." },
          label: { type: "string", required: true, guidance: "Visible group label." },
          options: {
            type: "array",
            bindable: true,
            guidance: "Available choices.",
          },
          value: { type: "array", bindable: true, guidance: "Selected values." },
        },
        content: { mode: "none" },
        collect: { collectable: true, valueProp: "value", valueKind: "string[]" },
      },
      {
        tag: "Button",
        whenToUse: "Send one explicit visitor action.",
        props: {
          label: { type: "string", required: true, guidance: "Visible action label." },
          action: {
            type: "string",
            required: true,
            action: true,
            guidance: "Agent action reference.",
          },
          collect: { type: "string", guidance: "Fields sent with the action." },
          arg: { type: "string", guidance: "Literal argument sent with the action." },
        },
        content: { mode: "none" },
      },
    ],
  };
}

function validCatalog(): FacetCatalog {
  const result = validateCatalog(catalogRecord());
  if (!result.ok) {
    throw new Error(`expected catalog acceptance, got ${result.code}`);
  }
  return result.catalog;
}

function validTheme(): FacetTheme {
  return validTestTheme();
}

function pathOf(value: string): DataPath {
  const parsed = parseDataPath(value);
  if (parsed === null) {
    throw new Error(`test fixture uses invalid data path ${value}`);
  }
  return parsed;
}

function textValues(document: ComponentDocument | null): readonly string[] {
  if (document === null) {
    return [];
  }
  return Object.values(document.nodes)
    .filter((node) => node.tag === "Text")
    .map((node) => node.props["value"])
    .map((prop) => (prop?.kind === "scalar" ? prop.value : ""));
}

function visitorEvent(eventId = "event1", stageRevision = 0): VisitorEvent {
  return {
    eventId,
    eventName: "submit",
    sourceNodeId: "n4",
    screen: "home",
    stageRevision,
    collect: {},
  };
}

function messageEvent(eventId: string, stageRevision = 0): VisitorEvent {
  return {
    eventId,
    eventName: "message",
    sourceNodeId: "visitor",
    screen: "home",
    stageRevision,
    collect: {},
  };
}

function visitorRecord(turnId = "event1", text = "question"): ConversationRecord {
  return {
    kind: "conversation",
    messageId: deriveMessageId(turnId, "visitor"),
    turnId,
    role: "visitor",
    text,
    at: 1,
  };
}

async function seededStore(markup = MARKUP_READY): Promise<MemoryStageStore> {
  const store = new MemoryStageStore();
  const boot = bootstrapSession({
    catalog: validCatalog(),
    theme: validTheme(),
    initialMarkup: markup,
  });
  if (!boot.ok) {
    throw new Error(`expected bootstrap acceptance, got ${boot.code}`);
  }
  const saved = await store.save("session-a", boot.session, 0);
  if (!saved.ok) {
    throw new Error("expected seed save");
  }
  return store;
}

class RecordingSink implements RuntimeSink, Sink {
  readonly records: ConversationRecord[] = [];

  async record(_key: string, record: ConversationRecord): Promise<{ readonly ok: true }> {
    this.records.push(record);
    return { ok: true };
  }

  async history(): Promise<readonly ConversationRecord[]> {
    return this.records;
  }
}

class FailingSink implements RuntimeSink, Sink {
  async record(): Promise<{
    readonly ok: false;
    readonly code: "sink_down";
    readonly detail: "sink refused";
  }> {
    return { ok: false, code: "sink_down", detail: "sink refused" };
  }

  async history(): Promise<readonly ConversationRecord[]> {
    return [];
  }
}

class CommitGuardStore implements StageStore {
  stored: Session;
  readonly #beforeCommit: () => void;

  constructor(stored: Session, beforeCommit: () => void) {
    this.stored = stored;
    this.#beforeCommit = beforeCommit;
  }

  async get(): Promise<unknown | null> {
    return this.stored;
  }

  async save(
    _key: string,
    session: Session,
    expectedRevision: StageRevision,
    guard?: () => boolean,
  ): Promise<CasOutcome> {
    this.#beforeCommit();
    const currentRevision = this.stored.stageRevision;
    if (currentRevision !== expectedRevision) {
      return { ok: false, reason: "conflict", currentRevision };
    }
    if (guard !== undefined && !guard()) {
      return { ok: false, reason: "conflict", currentRevision };
    }
    this.stored = session;
    return { ok: true, revision: session.stageRevision };
  }
}

class PostCommitStore implements StageStore {
  stored: Session;
  readonly #afterCommit: () => void;

  constructor(stored: Session, afterCommit: () => void) {
    this.stored = stored;
    this.#afterCommit = afterCommit;
  }

  async get(): Promise<unknown | null> {
    return this.stored;
  }

  async save(
    _key: string,
    session: Session,
    expectedRevision: StageRevision,
    guard?: () => boolean,
  ): Promise<CasOutcome> {
    const currentRevision = this.stored.stageRevision;
    if (currentRevision !== expectedRevision) {
      return { ok: false, reason: "conflict", currentRevision };
    }
    if (guard !== undefined && !guard()) {
      return { ok: false, reason: "conflict", currentRevision };
    }
    this.stored = session;
    this.#afterCommit();
    return { ok: true, revision: session.stageRevision };
  }
}

function diagnostics(): {
  readonly sink: (diagnostic: RuntimeDiagnostic) => void;
  readonly records: RuntimeDiagnostic[];
} {
  const records: RuntimeDiagnostic[] = [];
  return {
    records,
    sink: (diagnostic) => records.push(diagnostic),
  };
}

describe("FacetRuntime", () => {
  it("snapshots the session key before awaiting session load", async () => {
    const seeded = await seededStore();
    const session = (await seeded.get("session-a")) as Session;
    const keys: string[] = [];
    let release: (() => void) | undefined;
    const store: StageStore = {
      get: async (key) => {
        keys.push(key);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return session;
      },
      save: async (key, next) => {
        keys.push(key);
        return { ok: true, revision: next.stageRevision };
      },
    };
    const input = { sessionKey: "session-a", event: visitorEvent() };
    const runtime = new FacetRuntime({
      store,
      sink: new RecordingSink(),
      agent: { run: async () => null },
    });

    const pending = runtime.handle(input);
    (input as { sessionKey: string }).sessionKey = "session-b";
    release?.();
    await pending;

    expect(keys).toEqual(["session-a"]);
  });

  it("admits a strict framework visit while the first page is still preparing", async () => {
    const store = new MemoryStageStore();
    const boot = bootstrapSession({ catalog: validCatalog(), theme: validTheme() });
    if (!boot.ok) throw new Error(`expected bootstrap acceptance, got ${boot.code}`);
    await store.save("session-a", boot.session, 0);
    let calls = 0;
    const runtime = new FacetRuntime({
      store,
      sink: new RecordingSink(),
      agent: {
        run: async () => {
          calls += 1;
          return null;
        },
      },
    });

    const result = await runtime.handle({
      sessionKey: "session-a",
      event: {
        eventId: "initial-visit",
        eventName: "visit",
        sourceNodeId: "visitor",
        screen: "home",
        stageRevision: 0,
        collect: {},
      },
    });

    expect(result.outcome).toBe("accepted");
    expect(calls).toBe(1);
  });

  it("snapshots collected arrays before awaiting session load", async () => {
    const seeded = await seededStore();
    const session = (await seeded.get("session-a")) as Session;
    let release: (() => void) | undefined;
    const store: StageStore = {
      get: async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return session;
      },
      save: async (_key, next) => ({ ok: true, revision: next.stageRevision }),
    };
    const selections = ["north"];
    const event: VisitorEvent = {
      ...visitorEvent(),
      eventName: "selected",
      sourceNodeId: "n5",
      collect: { regions: { kind: "value", value: selections } },
    };
    let seen: VisitorEvent | undefined;
    const runtime = new FacetRuntime({
      store,
      sink: new RecordingSink(),
      agent: {
        run: async ({ event: accepted }) => {
          seen = accepted;
          return null;
        },
      },
    });

    const pending = runtime.handle({ sessionKey: "session-a", event });
    selections.push("west");
    release?.();
    await pending;

    expect(seen?.collect["regions"]).toEqual({ kind: "value", value: ["north"] });
    expect(Object.isFrozen((seen?.collect["regions"] as { value?: unknown })?.value)).toBe(true);
  });

  it("rejects a collected value that contradicts the active component spec", async () => {
    const store = await seededStore(`<Facet entry="home">
      <Screen name="home">
        <Field name="email" label="Email" />
        <Button label="Submit" action="agent:submit" collect="email" />
      </Screen>
    </Facet>`);
    let calls = 0;
    const runtime = new FacetRuntime({
      store,
      sink: new RecordingSink(),
      agent: {
        run: async () => {
          calls += 1;
          return null;
        },
      },
    });

    const result = await runtime.handle({
      sessionKey: "session-a",
      event: {
        ...visitorEvent(),
        sourceNodeId: "n3",
        collect: { email: { kind: "value", value: true } },
      },
    });

    expect(result).toMatchObject({
      outcome: "failed",
      code: "collect_value_kind_mismatch",
    });
    expect(calls).toBe(0);
  });

  it("rejects a collection address that is absent from the active screen", async () => {
    const store = await seededStore();
    let calls = 0;
    const runtime = new FacetRuntime({
      store,
      sink: new RecordingSink(),
      agent: {
        run: async () => {
          calls += 1;
          return null;
        },
      },
    });

    const result = await runtime.handle({
      sessionKey: "session-a",
      event: {
        ...visitorEvent(),
        collect: { forged: { kind: "value", value: "value" } },
      },
    });

    expect(result).toMatchObject({ outcome: "failed", code: "event_collect_mismatch" });
    expect(calls).toBe(0);
  });

  it("never forwards a value forged for a sensitive field", async () => {
    const store = await seededStore(`<Facet entry="home">
      <Screen name="home">
        <Field name="token" label="Token" secret="true" />
        <Button label="Submit" action="agent:submit" collect="token" />
      </Screen>
    </Facet>`);
    let calls = 0;
    const runtime = new FacetRuntime({
      store,
      sink: new RecordingSink(),
      agent: {
        run: async () => {
          calls += 1;
          return null;
        },
      },
    });

    const result = await runtime.handle({
      sessionKey: "session-a",
      event: {
        ...visitorEvent(),
        sourceNodeId: "n3",
        collect: { token: { kind: "value", value: "TOP-SECRET" } },
      },
    });

    expect(result).toMatchObject({ outcome: "failed", code: "sensitive_collect_value" });
    expect(calls).toBe(0);
  });

  it("fails closed when a persisted sensitivity prop contradicts its boolean schema", async () => {
    const seeded = await seededStore(`<Facet entry="home">
      <Screen name="home">
        <Field name="token" label="Token" secret="true" />
        <Button label="Submit" action="agent:submit" collect="token" />
      </Screen>
    </Facet>`);
    const persisted = structuredClone((await seeded.get("session-a")) as Session) as {
      document: { nodes: Record<string, { props: Record<string, { value?: string }> }> };
    };
    const secret = persisted.document.nodes["n2"]?.props["secret"];
    if (secret === undefined) {
      throw new Error("expected persisted sensitivity prop");
    }
    secret.value = "yes";
    const store: StageStore = {
      get: async () => persisted,
      save: async (_key, next) => ({ ok: true, revision: next.stageRevision }),
    };
    let calls = 0;
    const runtime = new FacetRuntime({
      store,
      sink: new RecordingSink(),
      agent: {
        run: async () => {
          calls += 1;
          return null;
        },
      },
    });

    const result = await runtime.handle({
      sessionKey: "session-a",
      event: {
        ...visitorEvent(),
        sourceNodeId: "n3",
        collect: { token: { kind: "value", value: "TOP-SECRET" } },
      },
    });

    expect(result).toMatchObject({ outcome: "failed", code: "unknown_collect_source" });
    expect(calls).toBe(0);
  });

  it.each([
    {
      name: "an event source outside the active screen",
      markup: MARKUP_READY,
      event: { ...visitorEvent(), sourceNodeId: "n99" },
      code: "unknown_event_source",
    },
    {
      name: "an action that the source does not declare",
      markup: MARKUP_READY,
      event: { ...visitorEvent(), eventName: "deleteAccount" },
      code: "event_action_mismatch",
    },
    {
      name: "an argument that differs from the authored source",
      markup: `<Facet entry="home"><Screen name="home"><Button label="Open" action="agent:open" arg="north" /></Screen></Facet>`,
      event: {
        ...visitorEvent(),
        eventName: "open",
        sourceNodeId: "n2",
        arg: "south",
      },
      code: "event_arg_mismatch",
    },
    {
      name: "a sensitive omission for an ordinary field",
      markup: `<Facet entry="home"><Screen name="home"><Field name="email" label="Email" /><Button label="Submit" action="agent:submit" collect="email" /></Screen></Facet>`,
      event: {
        ...visitorEvent(),
        sourceNodeId: "n3",
        collect: { email: { kind: "omitted_sensitive" as const } },
      },
      code: "unexpected_sensitive_omission",
    },
  ])("rejects $name before invoking side effects", async ({ markup, event, code }) => {
    const store = await seededStore(markup);
    const sink = new RecordingSink();
    let calls = 0;
    const runtime = new FacetRuntime({
      store,
      sink,
      agent: {
        run: async () => {
          calls += 1;
          return null;
        },
      },
    });

    const result = await runtime.handle({ sessionKey: "session-a", event });

    expect(result).toMatchObject({ outcome: "failed", code });
    expect(calls).toBe(0);
    expect(sink.records).toEqual([]);
  });

  it("rejects an ambiguous collected field restored from a corrupt store", async () => {
    const seeded = await seededStore(
      `<Facet entry="home"><Screen name="home"><Field name="email" label="Primary" /><Field name="backup" label="Backup" /><Button label="Submit" action="agent:submit" collect="email" /></Screen></Facet>`,
    );
    const persisted = structuredClone((await seeded.get("session-a")) as Session) as {
      document: { nodes: Record<string, { props: Record<string, { value?: string }> }> };
    };
    const duplicateName = persisted.document.nodes["n3"]?.props["name"];
    if (duplicateName === undefined) {
      throw new Error("expected persisted field name");
    }
    duplicateName.value = "email";
    const store: StageStore = {
      get: async () => persisted,
      save: async (_key, next) => ({ ok: true, revision: next.stageRevision }),
    };
    const sink = new RecordingSink();
    let calls = 0;
    const runtime = new FacetRuntime({
      store,
      sink,
      agent: {
        run: async () => {
          calls += 1;
          return null;
        },
      },
    });

    const result = await runtime.handle({
      sessionKey: "session-a",
      event: {
        ...visitorEvent(),
        sourceNodeId: "n4",
        collect: { email: { kind: "value", value: "a@b.c" } },
      },
    });

    expect(result).toMatchObject({ outcome: "failed", code: "unknown_collect_source" });
    expect(calls).toBe(0);
    expect(sink.records).toEqual([]);
  });

  it("rejects a visitor message paired with a non-message event before side effects", async () => {
    const store = await seededStore();
    const sink = new RecordingSink();
    let calls = 0;
    const runtime = new FacetRuntime({
      store,
      sink,
      agent: {
        run: async () => {
          calls += 1;
          return null;
        },
      },
    });

    const result = await runtime.handle({
      sessionKey: "session-a",
      event: visitorEvent(),
      visitorMessage: visitorRecord(),
    });

    expect(result).toMatchObject({ outcome: "failed", code: "invalid_visitor_message_event" });
    expect(calls).toBe(0);
    expect(sink.records).toEqual([]);
  });

  it("rejects an over-bound visitor message before turn admission or side effects", async () => {
    const store = await seededStore();
    const sink = new RecordingSink();
    let calls = 0;
    const runtime = new FacetRuntime({
      store,
      sink,
      agent: {
        run: async () => {
          calls += 1;
          return null;
        },
      },
    });
    const event = messageEvent("msg-over-bound");

    const rejected = await runtime.handle({
      sessionKey: "session-a",
      event,
      visitorMessage: visitorRecord(
        "msg-over-bound",
        "x".repeat(BOUNDS.conversationMessageChars + 1),
      ),
    });
    const retry = await runtime.handle({
      sessionKey: "session-a",
      event,
      visitorMessage: visitorRecord("msg-over-bound", "valid retry"),
    });

    expect(rejected).toMatchObject({
      outcome: "failed",
      code: "invalid_visitor_message_event",
    });
    expect(retry.outcome).toBe("accepted");
    expect(calls).toBe(1);
    expect(sink.records.map((record) => record.text)).toEqual(["valid retry"]);
  });

  it("closes and validates the visitor-message snapshot before turn admission", async () => {
    const store = await seededStore();
    const sink = new RecordingSink();
    let calls = 0;
    const runtime = new FacetRuntime({
      store,
      sink,
      agent: {
        run: async () => {
          calls += 1;
          return null;
        },
      },
    });
    const event = messageEvent("closed-message");
    const revoked = Proxy.revocable(visitorRecord("closed-message"), {});
    revoked.revoke();
    const malformed: readonly unknown[] = [
      { ...visitorRecord("closed-message"), at: Number.POSITIVE_INFINITY },
      { ...visitorRecord("closed-message"), extraSecret: "must not persist" },
      revoked.proxy,
    ];

    for (const visitorMessage of malformed) {
      await expect(
        runtime.handle({
          sessionKey: "session-a",
          event,
          visitorMessage: visitorMessage as ConversationMessage,
        }),
      ).resolves.toMatchObject({ outcome: "failed", code: "invalid_visitor_message_event" });
    }
    const accepted = await runtime.handle({
      sessionKey: "session-a",
      event,
      visitorMessage: visitorRecord("closed-message", "valid"),
    });

    expect(accepted.outcome).toBe("accepted");
    expect(calls).toBe(1);
    expect(sink.records).toEqual([visitorRecord("closed-message", "valid")]);
  });

  it("delivers committed UI patches before the turn's single conversation message", async () => {
    const store = await seededStore();
    const sink = new RecordingSink();
    const events: string[] = [];
    const runtime = new FacetRuntime({
      store,
      sink,
      agent: {
        run: async ({ session }) => {
          await session.applyAuthorMutation(MARKUP_UPDATED);
          return { text: "done" };
        },
      },
      deliver: async (entry) => {
        events.push(`${entry.seq}:${entry.frame.kind}`);
      },
    });

    const result = await runtime.handle({ sessionKey: "session-a", event: visitorEvent() });

    expect(result.outcome).toBe("accepted");
    expect(events).toEqual(["1:patch", "2:conversation"]);
    expect(sink.records).toEqual([
      {
        kind: "conversation",
        messageId: deriveMessageId("event1", "assistant"),
        turnId: "event1",
        role: "assistant",
        text: "done",
        at: expect.any(Number) as number,
      },
    ]);
    const restored = await store.get("session-a");
    expect(textValues((restored as { readonly document: ComponentDocument }).document)).toEqual([
      "Updated",
    ]);
  });

  it("honors a custom turn timeout for slower in-process agents", async () => {
    const store = await seededStore();
    const sink = new RecordingSink();
    let now = 0;
    const runtime = new FacetRuntime({
      store,
      sink,
      now: () => now,
      turnTimeoutMs: 60_000,
      agent: {
        run: async () => {
          now = 45_000;
          return { text: "slow but still active" };
        },
      },
      deliver: async () => {},
    });

    const result = await runtime.handle({ sessionKey: "session-a", event: visitorEvent() });

    expect(result.outcome).toBe("accepted");
    expect(sink.records.map((record) => record.text)).toEqual(["slow but still active"]);
  });

  it("commits explicit targeted session mutations through the runtime lane", async () => {
    const store = await seededStore();
    const delivered: string[] = [];
    const runtime = new FacetRuntime({
      store,
      sink: new RecordingSink(),
      agent: {
        run: async ({ session }) => {
          const targetId = Object.entries(session.document?.nodes ?? {}).find(
            ([, node]) => node.tag === "Text",
          )?.[0];
          if (targetId === undefined) {
            throw new Error("expected Text target");
          }
          const applied = await session.applyTargetedMutation({
            kind: "update_node",
            targetId,
            markup: '<Text value="Targeted" />',
          });
          if (!applied.ok) {
            throw new Error("detail" in applied ? applied.detail : applied.error.cause);
          }
          return { text: null };
        },
      },
      deliver: async (entry) => {
        delivered.push(entry.frame.kind);
      },
    });

    const result = await runtime.handle({ sessionKey: "session-a", event: visitorEvent() });
    const restored = await store.get("session-a");

    expect(result.outcome).toBe("accepted");
    expect(delivered).toEqual(["patch"]);
    expect(textValues((restored as { readonly document: ComponentDocument }).document)).toEqual([
      "Targeted",
    ]);
  });

  it("emits zero patches and preserves document/data/stageRevision for a conversation-only turn", async () => {
    const store = await seededStore();
    const before = await store.get("session-a");
    const runtime = new FacetRuntime({
      store,
      sink: new RecordingSink(),
      agent: { run: async () => ({ text: "hello" }) },
      deliver: async () => {},
    });

    const result = await runtime.handle({ sessionKey: "session-a", event: visitorEvent() });
    const after = await store.get("session-a");

    expect(result.outcome).toBe("accepted");
    expect(after).toEqual(before);
  });

  it("rejects a stale browser event before agent code can mutate the current stage", async () => {
    const store = await seededStore();
    await store.save(
      "session-a",
      {
        ...((await store.get("session-a")) as Session),
        stageRevision: 1,
      },
      0,
    );
    const before = await store.get("session-a");
    const sink = new RecordingSink();
    const delivered: string[] = [];
    let agentRan = false;
    const runtime = new FacetRuntime({
      store,
      sink,
      agent: {
        run: async ({ session }) => {
          agentRan = true;
          await session.applyAuthorMutation(MARKUP_UPDATED);
          return { text: "should not run" };
        },
      },
      deliver: async (entry) => {
        delivered.push(entry.frame.kind);
      },
    });

    const result = await runtime.handle({
      sessionKey: "session-a",
      event: visitorEvent("stale-event", 0),
      visitorMessage: visitorRecord("stale-event"),
    });
    const retry = await runtime.handle({
      sessionKey: "session-a",
      event: visitorEvent("stale-event", 0),
      visitorMessage: visitorRecord("stale-event", "retry"),
    });

    expect(result).toEqual({ outcome: "conflict", currentRevision: 1 });
    expect(retry).toEqual({ outcome: "conflict", currentRevision: 1 });
    expect(agentRan).toBe(false);
    expect(delivered).toEqual([]);
    expect(sink.records).toEqual([]);
    expect(await store.get("session-a")).toEqual(before);
  });

  it("records an admitted visitor message once before the agent response", async () => {
    const store = await seededStore();
    const sink = new RecordingSink();
    let recordsAtAgent: readonly ConversationRecord[] = [];
    const runtime = new FacetRuntime({
      store,
      sink,
      agent: {
        run: async () => {
          recordsAtAgent = [...sink.records];
          return { text: "answer" };
        },
      },
      deliver: async () => {},
    });

    const result = await runtime.handle({
      sessionKey: "session-a",
      event: messageEvent("msg1"),
      visitorMessage: visitorRecord("msg1"),
    });
    const duplicate = await runtime.handle({
      sessionKey: "session-a",
      event: messageEvent("msg1"),
      visitorMessage: visitorRecord("msg1", "retry"),
    });

    expect(result.outcome).toBe("accepted");
    expect(duplicate.outcome).toBe("deduped");
    expect(recordsAtAgent.map((record) => record.messageId)).toEqual(["msg1:visitor"]);
    expect(sink.records.map((record) => record.messageId)).toEqual([
      "msg1:visitor",
      "msg1:assistant",
    ]);
  });

  it("does not record an optional visitor message for a busy turn", async () => {
    const store = await seededStore();
    const sink = new RecordingSink();
    let release!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runtime = new FacetRuntime({
      store,
      sink,
      agent: {
        run: async () => {
          started();
          await hold;
          return { text: "done" };
        },
      },
      deliver: async () => {},
    });

    const first = runtime.handle({ sessionKey: "session-a", event: visitorEvent("event1") });
    await startedPromise;
    const busy = await runtime.handle({
      sessionKey: "session-a",
      event: messageEvent("msg2"),
      visitorMessage: visitorRecord("msg2"),
    });
    release();
    await first;

    expect(busy.outcome).toBe("busy");
    expect(sink.records.map((record) => record.messageId)).not.toContain("msg2:visitor");
  });

  it("keeps the stage commit and delivery accepted when the Sink write fails", async () => {
    const store = await seededStore();
    const seen = diagnostics();
    const delivered: string[] = [];
    const runtime = new FacetRuntime({
      store,
      sink: new FailingSink(),
      agent: {
        run: async ({ session }) => {
          await session.applyAuthorMutation(MARKUP_UPDATED);
          return { text: "visible despite sink failure" };
        },
      },
      deliver: async (entry) => {
        delivered.push(entry.frame.kind);
      },
      diagnostics: seen.sink,
    });

    const result = await runtime.handle({ sessionKey: "session-a", event: visitorEvent() });
    const restored = await store.get("session-a");

    expect(result.outcome).toBe("accepted");
    expect(delivered).toEqual(["patch", "conversation"]);
    expect(textValues((restored as { readonly document: ComponentDocument }).document)).toEqual([
      "Updated",
    ]);
    expect(seen.records).toContainEqual({
      code: "sink_down",
      detail: "sink refused",
      sessionKey: "session-a",
    });
  });

  it("runs a corrupt persisted session through loadSession and finishes bounded with diagnostics", async () => {
    const oversizedArg = "x".repeat(BOUNDS.collectedValueChars + 1);
    const good = bootstrapSession({
      catalog: validCatalog(),
      theme: validTheme(),
      initialMarkup:
        '<Facet entry="home"><Screen name="home"><Text arg="ok" value="Ok" /></Screen></Facet>',
    });
    if (!good.ok) {
      throw new Error(`expected bootstrap acceptance, got ${good.code}`);
    }
    const corrupt = {
      ...good.session,
      document: {
        ...good.session.document,
        nodes: {
          ...good.session.document?.nodes,
          n2: {
            tag: "Text",
            props: {
              value: { kind: "scalar", value: "Ok" },
              arg: { kind: "scalar", value: oversizedArg },
            },
            children: [],
          },
        },
      },
    };
    const store: StageStore = {
      get: async () => corrupt,
      save: async (_key, session, _expectedRevision) => ({
        ok: true,
        revision: session.stageRevision,
      }),
    };
    const seen = diagnostics();
    const runtime = new FacetRuntime({
      store,
      sink: new RecordingSink(),
      agent: { run: async () => ({ text: "safe" }) },
      deliver: async () => {},
      diagnostics: seen.sink,
    });

    const result = await runtime.handle({
      sessionKey: "session-a",
      event: messageEvent("event2", 0),
      visitorMessage: visitorRecord("event2"),
    });

    expect(result.outcome).toBe("accepted");
    expect(seen.records).toContainEqual({
      code: "event_arg_too_long",
      detail: "The persisted event argument exceeds B-23.",
      sessionKey: "session-a",
    });
  });

  it("serializes host publishes through the same lane and returns structured conflicts", async () => {
    const store = await seededStore();
    const runtime = new FacetRuntime({
      store,
      sink: new RecordingSink(),
      agent: { run: async () => ({ text: null }) },
      deliver: async () => {},
    });

    const accepted = await runtime.publishData({
      sessionKey: "session-a",
      expectedRevision: 0,
      path: pathOf("trusted"),
      value: "host",
      operationId: "op1",
    });
    const stale = await runtime.publishData({
      sessionKey: "session-a",
      expectedRevision: 0,
      path: pathOf("loser"),
      value: true,
      operationId: "op2",
    });

    expect(accepted).toMatchObject({ outcome: "accepted", stageRevision: 1 });
    expect(stale).toEqual({ outcome: "conflict", currentRevision: 1 });
  });

  it("rejects malformed host paths before iteration, copying, or store access", async () => {
    const store = await seededStore();
    let reads = 0;
    const guardedStore: StageStore = {
      get: async (key) => {
        reads += 1;
        return store.get(key);
      },
      save: async (key, session, expectedRevision, guard) =>
        store.save(key, session, expectedRevision, guard),
    };
    const runtime = new FacetRuntime({
      store: guardedStore,
      sink: new RecordingSink(),
      agent: { run: async () => null },
    });
    const inherited = new Array<string>(1);
    Object.setPrototypeOf(inherited, { 0: "forged" });
    const invalidPaths: readonly unknown[] = [
      null,
      Array.from({ length: BOUNDS.dataPathDepth + 1 }, () => "segment"),
      inherited,
    ];

    for (const path of invalidPaths) {
      const result = await runtime.publishData({
        sessionKey: "session-a",
        expectedRevision: 0,
        path: path as DataPath,
        value: true,
        operationId: "invalid-host-path",
      });

      expect(result).toMatchObject({ outcome: "rejected", code: "invalid_data_path" });
    }
    expect(reads).toBe(0);
  });

  it("snapshots a valid host path without invoking its iterator", async () => {
    const store = await seededStore();
    const runtime = new FacetRuntime({
      store,
      sink: new RecordingSink(),
      agent: { run: async () => null },
    });
    const path = Object.assign(["safe"], {
      [Symbol.iterator](): never {
        throw new Error("must not iterate");
      },
    });

    const result = await runtime.publishData({
      sessionKey: "session-a",
      expectedRevision: 0,
      path: path as unknown as DataPath,
      value: true,
      operationId: "non-iterated-host-path",
    });

    expect(result).toMatchObject({ outcome: "accepted", stageRevision: 1 });
    expect(((await store.get("session-a")) as Session).data).toEqual({ safe: true });
  });

  it("snapshots host publish inputs before awaiting session load", async () => {
    const seeded = await seededStore();
    let stored = (await seeded.get("session-a")) as Session;
    const keys: string[] = [];
    let release: (() => void) | undefined;
    const store: StageStore = {
      get: async (key) => {
        keys.push(key);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return stored;
      },
      save: async (key, next) => {
        keys.push(key);
        stored = next;
        return { ok: true, revision: next.stageRevision };
      },
    };
    const path = ["trusted"] as [string, ...string[]];
    const value = { nested: { accepted: true } };
    const input = {
      sessionKey: "session-a",
      expectedRevision: 0,
      path,
      value,
      operationId: "snapshot-host-publish",
    };
    const runtime = new FacetRuntime({
      store,
      sink: new RecordingSink(),
      agent: { run: async () => null },
    });

    const pending = runtime.publishData(input);
    (input as { sessionKey: string }).sessionKey = "session-b";
    path[0] = "forged";
    value.nested.accepted = false;
    release?.();
    const result = await pending;

    expect(result).toMatchObject({ outcome: "accepted", stageRevision: 1 });
    expect(keys).toEqual(["session-a", "session-a"]);
    expect(stored).toMatchObject({
      data: { trusted: { nested: { accepted: true } } },
    });
  });

  it("rejects exotic host values before snapshotting can turn them into plain data", async () => {
    class HostRow {
      constructor(readonly amount: number) {}
    }
    const store = await seededStore();
    const runtime = new FacetRuntime({
      store,
      sink: new RecordingSink(),
      agent: { run: async () => null },
    });

    const result = await runtime.publishData({
      sessionKey: "session-a",
      expectedRevision: 0,
      path: pathOf("rows"),
      value: new HostRow(7),
      operationId: "reject-exotic-host-value",
    });

    expect(result).toMatchObject({ outcome: "rejected", code: "data_not_serializable" });
    expect(((await store.get("session-a")) as Session).data).toEqual({});
  });

  it("does not add artificial key overhead to a host value at the model-size boundary", async () => {
    const full = "x".repeat(BOUNDS.dataModelStringChars);
    const fullCount = Math.floor(
      (BOUNDS.dataModelCanonicalJsonChars - 7) / (BOUNDS.dataModelStringChars + 3),
    );
    const value = Array.from({ length: fullCount }, () => full);
    const remaining = BOUNDS.dataModelCanonicalJsonChars - JSON.stringify({ a: value }).length;
    if (remaining >= 3) value.push("x".repeat(remaining - 3));
    expect(JSON.stringify({ a: value })).toHaveLength(BOUNDS.dataModelCanonicalJsonChars);
    expect(JSON.stringify({ value })).toHaveLength(BOUNDS.dataModelCanonicalJsonChars + 4);
    const store = await seededStore();
    const runtime = new FacetRuntime({
      store,
      sink: new RecordingSink(),
      agent: { run: async () => null },
    });

    const result = await runtime.publishData({
      sessionKey: "session-a",
      expectedRevision: 0,
      path: pathOf("a"),
      value,
      operationId: "boundary-host-value",
    });

    expect(result).toMatchObject({ outcome: "accepted", stageRevision: 1 });
  });

  it("rejects a delayed turn mutation at the store commit point without emitting side effects", async () => {
    let now = 0;
    const initial = (await (await seededStore()).get("session-a")) as Session;
    const store = new CommitGuardStore(initial, () => {
      now = 30_001;
    });
    const sink = new RecordingSink();
    const delivered: string[] = [];
    let toolRejected = false;
    const runtime = new FacetRuntime({
      store,
      sink,
      agent: {
        run: async ({ session }) => {
          const result = await session.applyAuthorMutation(MARKUP_UPDATED);
          toolRejected = !result.ok;
          return { text: null };
        },
      },
      deliver: async (entry) => {
        delivered.push(entry.frame.kind);
      },
      now: () => now,
    });

    const result = await runtime.handle({ sessionKey: "session-a", event: visitorEvent() });

    expect(result.outcome).toBe("accepted");
    expect(toolRejected).toBe(true);
    expect(delivered).toEqual([]);
    expect(sink.records).toEqual([]);
    expect(textValues(store.stored.document)).toEqual(["Ready"]);
    expect(store.stored.data).toEqual({});
    expect(store.stored.stageRevision).toBe(0);
  });

  it("rejects a delayed host publish at the store commit point without emitting side effects", async () => {
    let now = 0;
    const initial = (await (await seededStore()).get("session-a")) as Session;
    const store = new CommitGuardStore(initial, () => {
      now = 30_001;
    });
    const sink = new RecordingSink();
    const delivered: string[] = [];
    const runtime = new FacetRuntime({
      store,
      sink,
      agent: { run: async () => ({ text: null }) },
      deliver: async (entry) => {
        delivered.push(entry.frame.kind);
      },
      now: () => now,
    });

    const result = await runtime.publishData({
      sessionKey: "session-a",
      expectedRevision: 0,
      path: pathOf("trusted"),
      value: { nested: true },
      operationId: "slow-host-publish",
    });

    expect(result).toEqual({ outcome: "conflict", currentRevision: 0 });
    expect(delivered).toEqual([]);
    expect(sink.records).toEqual([]);
    expect(textValues(store.stored.document)).toEqual(["Ready"]);
    expect(store.stored.data).toEqual({});
    expect(store.stored.stageRevision).toBe(0);
  });

  it("emits a patch once the guarded store commit has accepted the write", async () => {
    let now = 0;
    const initial = (await (await seededStore()).get("session-a")) as Session;
    const store = new PostCommitStore(initial, () => {
      now = 30_001;
    });
    const sink = new RecordingSink();
    const delivered: string[] = [];
    const runtime = new FacetRuntime({
      store,
      sink,
      agent: {
        run: async ({ session }) => {
          await session.applyAuthorMutation(MARKUP_UPDATED);
          return { text: null };
        },
      },
      deliver: async (entry) => {
        delivered.push(`${entry.seq}:${entry.frame.kind}`);
      },
      now: () => now,
    });

    const result = await runtime.handle({ sessionKey: "session-a", event: visitorEvent() });

    expect(result.outcome).toBe("accepted");
    expect(delivered).toEqual(["1:patch"]);
    expect(textValues(store.stored.document)).toEqual(["Updated"]);
    expect(store.stored.stageRevision).toBe(1);
  });
});
