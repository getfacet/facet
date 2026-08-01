import { readFileSync } from "node:fs";

import { validateCatalog, validateTheme } from "@facet/core";
import type {
  VisitorEvent,
  AuthorValidationResult,
  CasOutcome,
  ComponentDocument,
  DataPath,
  FacetCatalog,
  FacetTargetedMutationInput,
  FacetTargetedMutationResult,
  FacetTheme,
  FacetToolSession,
  PayloadEvaluation,
  ServerFrame,
  StageRevision,
} from "@facet/core";
import {
  bootstrapSession,
  FacetRuntime,
  MemorySink,
  MemoryStageStore,
  type Session,
  type StageStore,
} from "@facet/runtime";
import { describe, expect, it } from "vitest";
import { defineAgent, defineStreamingAgent } from "./define-agent.js";

const STAGE_SOURCE = readFileSync(new URL("./stage.ts", import.meta.url), "utf8");
const DEFINE_AGENT_SOURCE = readFileSync(new URL("./define-agent.ts", import.meta.url), "utf8");

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
          value: { type: "string", guidance: "Text to show." },
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

const event: VisitorEvent = Object.freeze({
  eventId: "event1",
  eventName: "submit",
  sourceNodeId: "button",
  screen: "home",
  stageRevision: 0,
  collect: Object.freeze({}),
});

const DOCUMENT: ComponentDocument = Object.freeze({
  entry: "home",
  screens: Object.freeze(["n1"]),
  nodes: Object.freeze({
    n1: Object.freeze({
      tag: "Screen",
      props: Object.freeze({ name: Object.freeze({ kind: "scalar" as const, value: "home" }) }),
      children: Object.freeze([]),
    }),
  }),
});

class StubSession implements FacetToolSession {
  readonly catalog: FacetToolSession["catalog"] = Object.freeze({ components: Object.freeze([]) });
  readonly document: ComponentDocument | null = null;
  readonly data: FacetToolSession["data"] = Object.freeze({});
  readonly stageRevision: FacetToolSession["stageRevision"] = 0;
  readonly rendered: string[] = [];

  async applyAuthorMutation(markup: string): Promise<AuthorValidationResult> {
    this.rendered.push(markup);
    return { ok: true, document: DOCUMENT };
  }

  async applyTargetedMutation(
    _input: FacetTargetedMutationInput,
  ): Promise<FacetTargetedMutationResult> {
    return { ok: true, document: DOCUMENT };
  }

  async publishData(_path: DataPath, _value: unknown): Promise<PayloadEvaluation> {
    return { ok: true, chars: 0 };
  }
}

class DelayedStageStore implements StageStore {
  stored: Session;
  readonly saveStarted: Promise<void>;
  #resolveSaveStarted!: () => void;
  #releaseSave!: () => void;
  #released: Promise<void>;
  #hasStarted = false;

  constructor(stored: Session) {
    this.stored = stored;
    this.saveStarted = new Promise((resolve) => {
      this.#resolveSaveStarted = resolve;
    });
    this.#released = new Promise((resolve) => {
      this.#releaseSave = resolve;
    });
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
    if (!this.#hasStarted) {
      this.#hasStarted = true;
      this.#resolveSaveStarted();
    }
    await this.#released;
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

  release(): void {
    this.#releaseSave();
  }
}

async function expectStillPending<T>(promise: Promise<T>): Promise<void> {
  let settled = false;
  promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await Promise.resolve();
  await Promise.resolve();
  expect(settled).toBe(false);
}

function bootRuntimeSession(): Session {
  const boot = bootstrapSession({ catalog: validCatalog(), theme: validTheme() });
  if (!boot.ok) {
    throw new Error(`expected bootstrap acceptance, got ${boot.code}`);
  }
  return boot.session;
}

describe("defineAgent", () => {
  it("returns an InProcessFacetAgent over run({ event, session })", async () => {
    const session = new StubSession();
    const agent = defineAgent(async ({ event: receivedEvent, session: receivedSession, stage }) => {
      expect(receivedEvent).toBe(event);
      expect(receivedSession).toBe(session);
      await stage.render('<Facet entry="home"><Screen name="home" /></Facet>');
      stage.message("done");
    });

    expect("run" in agent).toBe(true);
    expect("handleEvent" in agent).toBe(false);
    await expect(agent.run({ event, session })).resolves.toEqual({ text: "done" });
    expect(session.rendered).toEqual(['<Facet entry="home"><Screen name="home" /></Facet>']);
  });

  it("does not import @facet/agent-tools or @facet/runtime in production code", () => {
    expect(`${DEFINE_AGENT_SOURCE}\n${STAGE_SOURCE}`).not.toMatch(
      /@facet\/agent-tools|@facet\/runtime/u,
    );
  });

  it("renders through a real FacetRuntime session into an authorized document patch", async () => {
    const store = new MemoryStageStore();
    const sink = new MemorySink();
    const deliveries: { readonly seq: number; readonly frame: ServerFrame }[] = [];
    const boot = bootstrapSession({ catalog: validCatalog(), theme: validTheme() });
    if (!boot.ok) {
      throw new Error(`expected bootstrap acceptance, got ${boot.code}`);
    }
    const saved = await store.save("session-a", boot.session, 0);
    if (!saved.ok) {
      throw new Error("expected seed save");
    }
    const agent = defineAgent(async ({ stage }) => {
      await stage.render(
        '<Facet entry="home"><Screen name="home"><Text value="Hello from runtime" /></Screen></Facet>',
      );
      stage.message("rendered");
    });
    const runtime = new FacetRuntime({
      store,
      sink,
      agent,
      deliver: (entry) => {
        deliveries.push(entry);
      },
    });

    await expect(runtime.handle({ sessionKey: "session-a", event })).resolves.toMatchObject({
      outcome: "accepted",
      receipt: { triggerId: "event1" },
    });

    const patchFrame = deliveries[0]?.frame;
    expect(patchFrame?.kind).toBe("patch");
    if (patchFrame?.kind !== "patch") {
      throw new Error("expected a patch frame");
    }
    expect(patchFrame.ops).toHaveLength(1);
    const [operation] = patchFrame.ops;
    if (operation?.op !== "replace") {
      throw new Error("expected a replace operation");
    }
    expect(operation.path).toBe("/document");
    expect(typeof operation.value).toBe("object");
    expect(operation.value).toHaveProperty("nodes");
    expect(deliveries[1]?.frame).toMatchObject({
      kind: "conversation",
      text: "rendered",
    });

    const loaded = await store.get("session-a");
    expect(loaded).toMatchObject({ stageRevision: 1, phase: "live" });
  });

  it("drains fire-and-forget renders before the runtime turn returns", async () => {
    const store = new DelayedStageStore(bootRuntimeSession());
    const sink = new MemorySink();
    const deliveries: ServerFrame[] = [];
    const agent = defineAgent(({ stage }) => {
      void stage.render(
        '<Facet entry="home"><Screen name="home"><Text value="Fire and forget" /></Screen></Facet>',
      );
      stage.message("render queued");
    });
    const runtime = new FacetRuntime({
      store,
      sink,
      agent,
      deliver: (entry) => {
        deliveries.push(entry.frame);
      },
    });

    const turn = runtime.handle({ sessionKey: "session-a", event });
    await store.saveStarted;
    await expectStillPending(turn);
    store.release();

    await expect(turn).resolves.toMatchObject({ outcome: "accepted" });
    expect(deliveries.map((frame) => frame.kind)).toEqual(["patch", "conversation"]);
    expect(store.stored).toMatchObject({ stageRevision: 1, phase: "live" });
  });

  it("drains fire-and-forget data publishes before the runtime turn returns", async () => {
    const store = new DelayedStageStore(bootRuntimeSession());
    const sink = new MemorySink();
    const deliveries: ServerFrame[] = [];
    const agent = defineAgent(({ stage }) => {
      void stage.publishData(Object.freeze(["status"]), "ready");
      stage.message("publish queued");
    });
    const runtime = new FacetRuntime({
      store,
      sink,
      agent,
      deliver: (entry) => {
        deliveries.push(entry.frame);
      },
    });

    const turn = runtime.handle({ sessionKey: "session-a", event });
    await store.saveStarted;
    await expectStillPending(turn);
    store.release();

    await expect(turn).resolves.toMatchObject({ outcome: "accepted" });
    expect(deliveries.map((frame) => frame.kind)).toEqual(["patch", "conversation"]);
    expect(store.stored).toMatchObject({ data: { status: "ready" }, stageRevision: 1 });
  });
});

describe("defineStreamingAgent", () => {
  it("consumes yielded boundaries and returns the final flushed text", async () => {
    const session = new StubSession();
    const agent = defineStreamingAgent(async function* ({ stage }) {
      await stage.render('<Facet entry="home"><Screen name="home" /></Facet>');
      yield;
      stage.message("tail");
    });

    await expect(agent.run({ event, session })).resolves.toEqual({ text: "tail" });
    expect(session.rendered).toEqual(['<Facet entry="home"><Screen name="home" /></Facet>']);
  });
});
