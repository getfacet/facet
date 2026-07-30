import {
  deriveMessageId,
  truncateConversationText,
  type AgentEvent,
  type AuthorErrorCode,
  type AuthorValidationResult,
  type ConversationMessage,
  type DataPath,
  type FacetTargetedMutationInput,
  type FacetTargetedMutationResult,
  type FacetToolSession,
  type JsonPatchOperation,
  type PayloadEvaluation,
  type StageRevision,
} from "@facet/core";

import {
  applyAuthorMutation,
  type AuthorMutationInput,
  type AuthorMutationKind,
} from "./mutate.js";
import { ConversationOutbox, type OutboxEntry } from "./outbox.js";
import { applyDataPublish } from "./publish.js";
import type { DataPublishResult } from "./publish.js";
import type { Session } from "./session.js";
import type { ConversationRecord, Sink } from "./sink.js";
import { loadSession } from "./stage-store.js";
import type { StageStore } from "./stage-store.js";
import { TurnGate } from "./turn-gate.js";
import type { TurnTerminal, WriteAuthority } from "./turn-gate.js";

export interface RuntimeDiagnostic {
  readonly code: string;
  readonly detail: string;
  readonly sessionKey: string;
}

export type RuntimeSink = Pick<Sink, "record" | "history">;

export interface RuntimeAgent {
  run(context: {
    readonly event: AgentEvent;
    readonly session: FacetToolSession;
  }): Promise<{ readonly text: string | null } | string | null | undefined>;
}

export type RuntimeHandleResult =
  | { readonly outcome: "accepted"; readonly receipt: { readonly triggerId: string } }
  | { readonly outcome: "busy" }
  | { readonly outcome: "conflict"; readonly currentRevision: StageRevision }
  | { readonly outcome: "deduped" }
  | { readonly outcome: "failed"; readonly code: string; readonly detail: string };

export type RuntimePublishResult =
  | { readonly outcome: "accepted"; readonly stageRevision: StageRevision }
  | { readonly outcome: "conflict"; readonly currentRevision: StageRevision }
  | { readonly outcome: "rejected"; readonly code: string; readonly detail: string };

export interface RuntimeOptions {
  readonly store: StageStore;
  readonly sink: RuntimeSink;
  readonly agent: RuntimeAgent;
  readonly deliver?: (entry: OutboxEntry) => Promise<void> | void;
  readonly diagnostics?: (diagnostic: RuntimeDiagnostic) => void;
  readonly now?: () => number;
}

export interface RuntimeEventInput {
  readonly sessionKey: string;
  readonly event: AgentEvent;
  readonly visitorMessage?: ConversationMessage;
}

export interface RuntimePublishInput {
  readonly sessionKey: string;
  readonly expectedRevision: StageRevision;
  readonly path: DataPath;
  readonly value: unknown;
  readonly operationId: string;
}

interface LaneState {
  readonly gate: TurnGate;
  readonly outbox: ConversationOutbox;
}

function patchFrame(
  stageRevision: StageRevision,
  ops: readonly JsonPatchOperation[],
): {
  readonly kind: "patch";
  readonly stageRevision: StageRevision;
  readonly ops: readonly JsonPatchOperation[];
} {
  return Object.freeze({ kind: "patch" as const, stageRevision, ops });
}

function conversationFrame(turnId: string, text: string, at: number): ConversationMessage {
  return Object.freeze({
    kind: "conversation" as const,
    messageId: deriveMessageId(turnId, "assistant"),
    turnId,
    role: "assistant" as const,
    text: truncateConversationText(text),
    at,
  });
}

function agentText(result: Awaited<ReturnType<RuntimeAgent["run"]>>): string | null {
  if (typeof result === "string") {
    return result;
  }
  if (result !== null && typeof result === "object" && typeof result.text === "string") {
    return result.text;
  }
  return null;
}

function authorValidationFrom(
  result: ReturnType<typeof applyAuthorMutation>,
): AuthorValidationResult {
  if (result.ok) {
    return { ok: true, document: result.document };
  }
  if (result.error !== undefined) {
    return { ok: false, error: result.error };
  }
  const code: AuthorErrorCode = "invalid-source";
  return {
    ok: false,
    error: Object.freeze({
      code,
      cause: result.detail,
      repair: result.detail,
      location: Object.freeze({ line: 1, column: 1, offset: 0 }),
    }),
  };
}

function targetedMutationFrom(
  result: ReturnType<typeof applyAuthorMutation>,
): FacetTargetedMutationResult {
  if (result.ok) {
    return { ok: true, document: result.document };
  }
  if (result.error !== undefined) {
    return { ok: false, error: result.error };
  }
  const failure = Object.freeze({
    ok: false as const,
    code: result.code,
    at: result.at,
    detail: result.detail,
  });
  return result.currentRevision === undefined
    ? failure
    : Object.freeze({ ...failure, currentRevision: result.currentRevision });
}

function payloadEvaluationFrom(result: DataPublishResult): PayloadEvaluation {
  if (result.ok) {
    return { ok: true, chars: 0 };
  }
  return {
    ok: false,
    reason: payloadReason(result.code),
    bound: result.bound ?? null,
    path: result.path ?? result.at,
  };
}

function payloadReason(code: string): Extract<PayloadEvaluation, { readonly ok: false }>["reason"] {
  switch (code) {
    case "data_not_serializable":
    case "data_model_not_an_object":
    case "data_model_chars_exceeded":
    case "data_model_values_exceeded":
    case "data_array_length_exceeded":
    case "data_object_keys_exceeded":
    case "data_string_chars_exceeded":
    case "publish_payload_chars_exceeded":
      return code;
    default:
      return "data_not_serializable";
  }
}

function currentRevision(session: Session): StageRevision {
  return session.stageRevision;
}

export class FacetRuntime {
  readonly #store: StageStore;
  readonly #sink: RuntimeSink;
  readonly #agent: RuntimeAgent;
  readonly #deliver: (entry: OutboxEntry) => Promise<void> | void;
  readonly #diagnostics: (diagnostic: RuntimeDiagnostic) => void;
  readonly #now: () => number;
  readonly #lanes = new Map<string, LaneState>();

  constructor(options: RuntimeOptions) {
    this.#store = options.store;
    this.#sink = options.sink;
    this.#agent = options.agent;
    this.#deliver = options.deliver ?? (() => {});
    this.#diagnostics = options.diagnostics ?? (() => {});
    this.#now = options.now ?? Date.now;
  }

  async handle(input: RuntimeEventInput): Promise<RuntimeHandleResult> {
    const lane = this.#lane(input.sessionKey);
    const admitted = lane.gate.admit(input.event.eventId);
    if (admitted.outcome === "busy") {
      return { outcome: "busy" };
    }
    if (admitted.outcome === "deduped") {
      return { outcome: "deduped" };
    }

    const authority: WriteAuthority = { kind: "turn", token: admitted.token };
    let terminal: TurnTerminal = "success";
    try {
      const loaded = await loadSession(this.#store, input.sessionKey);
      for (const issue of loaded.issues) {
        this.#diagnose(input.sessionKey, issue.code, issue.detail);
      }
      if (input.event.stageRevision !== loaded.session.stageRevision) {
        terminal = "conflict";
        return { outcome: "conflict", currentRevision: loaded.session.stageRevision };
      }

      if (input.visitorMessage !== undefined) {
        await this.#record(input.sessionKey, input.visitorMessage);
      }
      const adapter = this.#toolSession(input.sessionKey, loaded.session, authority, lane);
      const text = agentText(await this.#agent.run({ event: input.event, session: adapter }));
      if (text !== null) {
        const frame = conversationFrame(input.event.eventId, text, this.#now());
        const appended = lane.outbox.append(frame, authority);
        if (!appended.ok) {
          terminal = "provider_error";
          return { outcome: "failed", code: appended.code, detail: appended.detail };
        }
        if (appended.emitted) {
          await this.#deliver(appended.entry);
        }
        await this.#record(input.sessionKey, frame);
      }
      const receipt = lane.gate.settle(admitted.token, terminal);
      return { outcome: "accepted", receipt };
    } catch (error) {
      terminal = "provider_error";
      const detail = error instanceof Error ? error.message : "The runtime turn failed.";
      this.#diagnose(input.sessionKey, "runtime_turn_failed", detail);
      return { outcome: "failed", code: "runtime_turn_failed", detail };
    } finally {
      lane.gate.settle(admitted.token, terminal);
    }
  }

  async publishData(input: RuntimePublishInput): Promise<RuntimePublishResult> {
    const lane = this.#lane(input.sessionKey);
    const lease = lane.gate.mintHostLease(input.operationId);
    const authority: WriteAuthority = { kind: "host-lease", lease };
    try {
      const loaded = await loadSession(this.#store, input.sessionKey);
      for (const issue of loaded.issues) {
        this.#diagnose(input.sessionKey, issue.code, issue.detail);
      }
      const committed = await this.#commitPublish(
        input.sessionKey,
        loaded.session,
        input.path,
        input.value,
        input.expectedRevision,
        authority,
        lane,
      );
      if (!committed.ok) {
        if (committed.code === "stale_revision" && committed.currentRevision !== undefined) {
          return { outcome: "conflict", currentRevision: committed.currentRevision };
        }
        return { outcome: "rejected", code: committed.code, detail: committed.detail };
      }
      return { outcome: "accepted", stageRevision: committed.stageRevision };
    } finally {
      lane.gate.fence(authority);
    }
  }

  #lane(sessionKey: string): LaneState {
    const existing = this.#lanes.get(sessionKey);
    if (existing !== undefined) {
      return existing;
    }
    const gate = new TurnGate({ now: this.#now });
    const lane = Object.freeze({ gate, outbox: new ConversationOutbox(gate) });
    this.#lanes.set(sessionKey, lane);
    return lane;
  }

  #toolSession(
    sessionKey: string,
    initial: Session,
    authority: WriteAuthority,
    lane: LaneState,
  ): FacetToolSession {
    let current = initial;
    const update = (next: Session): void => {
      current = next;
    };
    const toolSession = {
      sessionKey,
      get catalog() {
        return current.catalog;
      },
      get document() {
        return current.document;
      },
      get data() {
        return current.data;
      },
      get stageRevision() {
        return currentRevision(current);
      },
      applyAuthorMutation: async (markup: string) => {
        const result = await this.#commitMutation(
          sessionKey,
          current,
          "render_page",
          { markup },
          current.stageRevision,
          authority,
          lane,
        );
        if (result.ok) {
          update(result.session);
        }
        return authorValidationFrom(result);
      },
      applyTargetedMutation: async (input: FacetTargetedMutationInput) => {
        const result = await this.#commitMutation(
          sessionKey,
          current,
          input.kind,
          input,
          current.stageRevision,
          authority,
          lane,
        );
        if (result.ok) {
          update(result.session);
        }
        return targetedMutationFrom(result);
      },
      publishData: async (path: DataPath, value: unknown) => {
        const result = await this.#commitPublish(
          sessionKey,
          current,
          path,
          value,
          current.stageRevision,
          authority,
          lane,
        );
        if (result.ok) {
          update(result.session);
        }
        return payloadEvaluationFrom(result);
      },
    };
    return toolSession;
  }

  async #commitMutation(
    sessionKey: string,
    session: Session,
    kind: AuthorMutationKind,
    input: AuthorMutationInput,
    expectedRevision: StageRevision,
    authority: WriteAuthority,
    lane: LaneState,
  ): Promise<ReturnType<typeof applyAuthorMutation>> {
    const result = applyAuthorMutation(
      session,
      kind,
      input,
      expectedRevision,
      authority,
      lane.gate,
    );
    if (!result.ok) {
      return result;
    }
    const saved = await this.#store.save(sessionKey, result.session, expectedRevision, () =>
      lane.gate.present(authority),
    );
    if (!saved.ok) {
      return {
        ok: false,
        code: "stale_revision",
        at: "expectedRevision",
        detail: `The mutation expected revision ${expectedRevision}, but the session is at revision ${saved.currentRevision}.`,
        currentRevision: saved.currentRevision,
      };
    }
    await this.#appendPatch(lane, result.stageRevision, result.patches);
    return result;
  }

  async #commitPublish(
    sessionKey: string,
    session: Session,
    path: DataPath,
    value: unknown,
    expectedRevision: StageRevision,
    authority: WriteAuthority,
    lane: LaneState,
  ): Promise<DataPublishResult> {
    const result = applyDataPublish(session, path, value, expectedRevision, authority, lane.gate);
    if (!result.ok) {
      return result;
    }
    const saved = await this.#store.save(sessionKey, result.session, expectedRevision, () =>
      lane.gate.present(authority),
    );
    if (!saved.ok) {
      return {
        ok: false,
        code: "stale_revision",
        at: "expectedRevision",
        detail: `The publish expected revision ${expectedRevision}, but the session is at revision ${saved.currentRevision}.`,
        currentRevision: saved.currentRevision,
      };
    }
    await this.#appendPatch(lane, result.stageRevision, result.patches);
    return result;
  }

  async #appendPatch(
    lane: LaneState,
    stageRevision: StageRevision,
    patches: readonly JsonPatchOperation[],
  ): Promise<void> {
    const appended = lane.outbox.appendCommitted(patchFrame(stageRevision, patches));
    if (!appended.ok) {
      throw new Error(appended.detail);
    }
    if (appended.emitted) {
      await this.#deliver(appended.entry);
    }
  }

  async #record(sessionKey: string, record: ConversationRecord): Promise<void> {
    const result = await this.#sink.record(sessionKey, record);
    if (!result.ok) {
      this.#diagnose(sessionKey, result.code, result.detail);
    }
  }

  #diagnose(sessionKey: string, code: string, detail: string): void {
    this.#diagnostics(Object.freeze({ sessionKey, code, detail }));
  }
}
