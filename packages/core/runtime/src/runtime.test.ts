import { describe, expect, it } from "vitest";

import {
  BOUNDS,
  deriveMessageId,
  parseDataPath,
  validateCatalog,
  validateTheme,
} from "@facet/core";
import type {
  AgentEvent,
  CasOutcome,
  ComponentDocument,
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
        acceptsChildren: true,
      },
      {
        tag: "Text",
        whenToUse: "Short visible text.",
        props: {
          value: { type: "string", bindable: true, guidance: "Text to show." },
          arg: { type: "string", guidance: "Argument emitted with an agent event." },
        },
        acceptsChildren: false,
      },
    ],
  };
}

function themeRecord(): Record<string, Record<string, string>> {
  return {
    color: {
      background: "#fff",
      surface: "#f9fafb",
      border: "#e5e7eb",
      text: "#111827",
      textMuted: "#6b7280",
      accent: "#2563eb",
      onAccent: "#fff",
      success: "#16a34a",
      warning: "#ca8a04",
      danger: "#dc2626",
    },
    space: { xs: "2px", sm: "4px", md: "8px", lg: "16px", xl: "24px" },
    radius: { sm: "4px", md: "8px", lg: "12px", full: "999px" },
    borderWidth: { thin: "1px", thick: "2px" },
    shadow: { sm: "none", md: "0 2px 8px #0002", lg: "0 8px 24px #0003" },
    fontFamily: { sans: "system-ui", mono: "ui-monospace" },
    fontSize: { xs: "12px", sm: "14px", md: "16px", lg: "18px", xl: "22px" },
    fontWeight: { regular: "400", medium: "500", bold: "700" },
    lineHeight: { tight: "1.1", normal: "1.4", relaxed: "1.8" },
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
  const result = validateTheme(themeRecord());
  if (!result.ok) {
    throw new Error(`expected theme acceptance, got ${result.code}`);
  }
  return result.theme;
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

function agentEvent(eventId = "event1", stageRevision = 0): AgentEvent {
  return {
    eventId,
    eventName: "submit",
    sourceNodeId: "node1",
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

    const result = await runtime.handle({ sessionKey: "session-a", event: agentEvent() });

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

    const result = await runtime.handle({ sessionKey: "session-a", event: agentEvent() });
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

    const result = await runtime.handle({ sessionKey: "session-a", event: agentEvent() });
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
      event: agentEvent("stale-event", 0),
      visitorMessage: visitorRecord("stale-event"),
    });
    const retry = await runtime.handle({
      sessionKey: "session-a",
      event: agentEvent("stale-event", 0),
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
      event: agentEvent("msg1"),
      visitorMessage: visitorRecord("msg1"),
    });
    const duplicate = await runtime.handle({
      sessionKey: "session-a",
      event: agentEvent("msg1"),
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

    const first = runtime.handle({ sessionKey: "session-a", event: agentEvent("event1") });
    await startedPromise;
    const busy = await runtime.handle({
      sessionKey: "session-a",
      event: agentEvent("msg2"),
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

    const result = await runtime.handle({ sessionKey: "session-a", event: agentEvent() });
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
      event: agentEvent("event2", 0),
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

    const result = await runtime.handle({ sessionKey: "session-a", event: agentEvent() });

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

    const result = await runtime.handle({ sessionKey: "session-a", event: agentEvent() });

    expect(result.outcome).toBe("accepted");
    expect(delivered).toEqual(["1:patch"]);
    expect(textValues(store.stored.document)).toEqual(["Updated"]);
    expect(store.stored.stageRevision).toBe(1);
  });
});
