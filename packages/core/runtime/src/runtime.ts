import {
  BOUNDS,
  deriveMessageId,
  evaluateCandidateModel,
  isFacetIdentifier,
  resolveBinding,
  truncateConversationText,
  validateVisitorEvent,
  validateVisitorText,
  type VisitorEvent,
  type AuthorErrorCode,
  type AuthorValidationResult,
  type ConversationMessage,
  type ComponentDocument,
  type CollectedValueKind,
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
    readonly event: VisitorEvent;
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
  readonly turnTimeoutMs?: number;
}

export interface RuntimeEventInput {
  readonly sessionKey: string;
  readonly event: VisitorEvent;
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

type EventSessionValidationResult =
  { readonly ok: true } | { readonly ok: false; readonly code: string; readonly detail: string };

function scalarProp(document: ComponentDocument, nodeId: string, name: string): string | undefined {
  const prop = document.nodes[nodeId]?.props[name];
  return prop?.kind === "scalar" ? prop.value : undefined;
}

function collectedValueMatches(
  value: VisitorEvent["collect"][string] & { readonly kind: "value" },
  expected: CollectedValueKind,
): boolean {
  if (expected === "string") {
    return typeof value.value === "string";
  }
  if (expected === "boolean") {
    return typeof value.value === "boolean";
  }
  return Array.isArray(value.value) && value.value.every((item) => typeof item === "string");
}

interface CollectedFieldContract {
  readonly valueKind: CollectedValueKind;
  readonly sensitive: boolean;
}

const VISITOR_MESSAGE_KEYS: readonly string[] = [
  "kind",
  "messageId",
  "turnId",
  "role",
  "text",
  "at",
];

function snapshotVisitorMessage(value: unknown): ConversationMessage | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return undefined;
    }
    const record = value as Readonly<Record<string, unknown>>;
    let keyCount = 0;
    for (const key in record) {
      if (!Object.hasOwn(record, key)) continue;
      keyCount += 1;
      if (keyCount > VISITOR_MESSAGE_KEYS.length || !VISITOR_MESSAGE_KEYS.includes(key)) {
        return undefined;
      }
    }
    if (
      keyCount !== VISITOR_MESSAGE_KEYS.length ||
      Object.getOwnPropertySymbols(record).length > 0
    ) {
      return undefined;
    }

    const kind = record["kind"];
    const messageId = record["messageId"];
    const turnId = record["turnId"];
    const role = record["role"];
    const text = record["text"];
    const at = record["at"];
    if (
      kind !== "conversation" ||
      typeof messageId !== "string" ||
      typeof turnId !== "string" ||
      role !== "visitor" ||
      !validateVisitorText(text) ||
      typeof at !== "number" ||
      !Number.isFinite(at) ||
      at < 0
    ) {
      return undefined;
    }
    return Object.freeze({ kind, messageId, turnId, role, text, at });
  } catch {
    return undefined;
  }
}

function sensitiveField(session: Session, nodeId: string, tag: string): boolean {
  const spec = session.catalog.components.find((candidate) => candidate.tag === tag);
  const sensitiveProp = spec?.collect?.sensitiveProp;
  if (spec === undefined || sensitiveProp === undefined || session.document === null) {
    return false;
  }
  const schema = spec.props[sensitiveProp];
  if (schema?.type !== "boolean") {
    return true;
  }
  const stored = session.document.nodes[nodeId]?.props[sensitiveProp];
  if (stored === undefined) {
    return schema.default === true;
  }
  if (stored.kind === "scalar") {
    return stored.value === "true";
  }
  if (stored.scheme !== "data") {
    return true;
  }
  const resolved = resolveBinding(stored.target, session.data, schema);
  return !resolved.ok || resolved.value !== false;
}

function sameNames(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length && actual.every((name, index) => name === expected[index])
  );
}

function snapshotDataPath(value: unknown): DataPath | undefined {
  try {
    if (!Array.isArray(value)) {
      return undefined;
    }
    const length = value.length;
    if (!Number.isInteger(length) || length === 0 || length > BOUNDS.dataPathDepth) {
      return undefined;
    }
    const path: string[] = [];
    for (let index = 0; index < length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        return undefined;
      }
      const segment = value[index];
      if (!isFacetIdentifier(segment)) {
        return undefined;
      }
      path.push(segment);
    }
    return Object.freeze(path) as DataPath;
  } catch {
    return undefined;
  }
}

function validVisitorMessage(event: VisitorEvent, message: ConversationMessage): boolean {
  return (
    event.eventName === "message" &&
    event.sourceNodeId === "visitor" &&
    event.arg === undefined &&
    Object.keys(event.collect).length === 0 &&
    message.kind === "conversation" &&
    message.role === "visitor" &&
    message.turnId === event.eventId &&
    message.messageId === deriveMessageId(event.eventId, "visitor") &&
    validateVisitorText(message.text)
  );
}

function validFrameworkVisit(event: VisitorEvent): boolean {
  return (
    event.eventName === "visit" &&
    event.sourceNodeId === "visitor" &&
    event.arg === undefined &&
    Object.keys(event.collect).length === 0
  );
}

/** Checks client-reported collection against the active screen and catalog contract. */
function validateEventAgainstSession(
  event: VisitorEvent,
  session: Session,
  visitorMessage: ConversationMessage | undefined,
): EventSessionValidationResult {
  if (visitorMessage !== undefined) {
    return validVisitorMessage(event, visitorMessage)
      ? { ok: true }
      : {
          ok: false,
          code: "invalid_visitor_message_event",
          detail: "A visitor message must use the dedicated message event contract.",
        };
  }
  if (validFrameworkVisit(event)) {
    return { ok: true };
  }
  const names = Object.keys(event.collect).sort();
  const document = session.document;
  if (document === null) {
    return {
      ok: false,
      code: "collect_screen_unavailable",
      detail: "Collected values require a current Facet screen.",
    };
  }
  const screenId = document.screens.find(
    (nodeId) => scalarProp(document, nodeId, "name") === event.screen,
  );
  if (screenId === undefined) {
    return {
      ok: false,
      code: "collect_screen_unavailable",
      detail: `The collected screen \`${event.screen}\` is not current document content.`,
    };
  }

  const specs = new Map(session.catalog.components.map((spec) => [spec.tag, spec]));
  const fields = new Map<string, CollectedFieldContract | null>();
  const stack = [screenId];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const nodeId = stack.pop();
    if (nodeId === undefined || visited.has(nodeId)) {
      continue;
    }
    visited.add(nodeId);
    const node = document.nodes[nodeId];
    if (node === undefined) {
      continue;
    }
    const collect = specs.get(node.tag)?.collect;
    const name = scalarProp(document, nodeId, "name");
    if (collect?.collectable === true && name !== undefined) {
      fields.set(
        name,
        fields.has(name)
          ? null
          : {
              valueKind: collect.valueKind,
              sensitive: sensitiveField(session, nodeId, node.tag),
            },
      );
    }
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      const childId = node.children[index];
      if (childId !== undefined) {
        stack.push(childId);
      }
    }
  }

  const source = visited.has(event.sourceNodeId) ? document.nodes[event.sourceNodeId] : undefined;
  if (source === undefined) {
    return {
      ok: false,
      code: "unknown_event_source",
      detail: `Event source \`${event.sourceNodeId}\` is not on screen \`${event.screen}\`.`,
    };
  }
  const sourceSpec = specs.get(source.tag);
  const actionMatches = Object.entries(source.props).some(([name, prop]) => {
    const schema = sourceSpec?.props[name];
    return (
      schema?.type === "string" &&
      schema.action === true &&
      prop.kind === "reference" &&
      prop.scheme === "agent" &&
      prop.target === event.eventName
    );
  });
  if (!actionMatches) {
    return {
      ok: false,
      code: "event_action_mismatch",
      detail: `Event source \`${event.sourceNodeId}\` does not declare agent:${event.eventName}.`,
    };
  }
  const expectedArgument = scalarProp(document, event.sourceNodeId, "arg");
  if (event.arg !== expectedArgument) {
    return {
      ok: false,
      code: "event_arg_mismatch",
      detail: "The visitor event argument does not match its authored source.",
    };
  }
  const expectedNames = [
    ...new Set((scalarProp(document, event.sourceNodeId, "collect") ?? "").split(" ")),
  ]
    .filter((name) => name.length > 0)
    .sort();
  if (!sameNames(names, expectedNames)) {
    return {
      ok: false,
      code: "event_collect_mismatch",
      detail: "Collected fields must exactly match the authored source request.",
    };
  }

  for (const name of names) {
    const expected = fields.get(name);
    if (expected === undefined || expected === null) {
      return {
        ok: false,
        code: "unknown_collect_source",
        detail: `Collected field \`${name}\` does not name one unambiguous field on screen \`${event.screen}\`.`,
      };
    }
    const entry = event.collect[name];
    if (entry?.kind === "value" && expected.sensitive) {
      return {
        ok: false,
        code: "sensitive_collect_value",
        detail: `Sensitive field \`${name}\` cannot carry a value in an event.`,
      };
    }
    if (entry?.kind === "omitted_sensitive" && !expected.sensitive) {
      return {
        ok: false,
        code: "unexpected_sensitive_omission",
        detail: `Field \`${name}\` is not declared sensitive.`,
      };
    }
    if (entry?.kind === "value" && !collectedValueMatches(entry, expected.valueKind)) {
      return {
        ok: false,
        code: "collect_value_kind_mismatch",
        detail: `Collected field \`${name}\` must carry ${expected.valueKind}.`,
      };
    }
  }
  return { ok: true };
}

export class FacetRuntime {
  readonly #store: StageStore;
  readonly #sink: RuntimeSink;
  readonly #agent: RuntimeAgent;
  readonly #deliver: (entry: OutboxEntry) => Promise<void> | void;
  readonly #diagnostics: (diagnostic: RuntimeDiagnostic) => void;
  readonly #now: () => number;
  readonly #turnTimeoutMs: number | undefined;
  readonly #lanes = new Map<string, LaneState>();

  constructor(options: RuntimeOptions) {
    this.#store = options.store;
    this.#sink = options.sink;
    this.#agent = options.agent;
    this.#deliver = options.deliver ?? (() => {});
    this.#diagnostics = options.diagnostics ?? (() => {});
    this.#now = options.now ?? Date.now;
    this.#turnTimeoutMs = options.turnTimeoutMs;
  }

  async handle(input: RuntimeEventInput): Promise<RuntimeHandleResult> {
    const sessionKey = input.sessionKey;
    const visitorMessageInput = input.visitorMessage;
    const visitorMessage =
      visitorMessageInput === undefined ? undefined : snapshotVisitorMessage(visitorMessageInput);
    const validated = validateVisitorEvent(input.event);
    if (!validated.ok) {
      return { outcome: "failed", code: validated.code, detail: validated.detail };
    }
    const event = validated.event;
    if (visitorMessageInput !== undefined && visitorMessage === undefined) {
      return {
        outcome: "failed",
        code: "invalid_visitor_message_event",
        detail: "A visitor message must use the dedicated message event contract.",
      };
    }
    const lane = this.#lane(sessionKey);
    const admitted = lane.gate.admit(event.eventId);
    if (admitted.outcome === "busy") {
      return { outcome: "busy" };
    }
    if (admitted.outcome === "deduped") {
      return { outcome: "deduped" };
    }

    const authority: WriteAuthority = { kind: "turn", token: admitted.token };
    let terminal: TurnTerminal = "success";
    try {
      const loaded = await loadSession(this.#store, sessionKey);
      for (const issue of loaded.issues) {
        this.#diagnose(sessionKey, issue.code, issue.detail);
      }
      if (event.stageRevision !== loaded.session.stageRevision) {
        terminal = "conflict";
        return { outcome: "conflict", currentRevision: loaded.session.stageRevision };
      }
      const eventContract = validateEventAgainstSession(event, loaded.session, visitorMessage);
      if (!eventContract.ok) {
        terminal = "provider_error";
        return {
          outcome: "failed",
          code: eventContract.code,
          detail: eventContract.detail,
        };
      }

      if (visitorMessage !== undefined) {
        await this.#record(sessionKey, visitorMessage);
      }
      const adapter = this.#toolSession(sessionKey, loaded.session, authority, lane);
      const text = agentText(await this.#agent.run({ event, session: adapter }));
      if (text !== null) {
        const frame = conversationFrame(event.eventId, text, this.#now());
        const appended = lane.outbox.append(frame, authority);
        if (!appended.ok) {
          terminal = "provider_error";
          return { outcome: "failed", code: appended.code, detail: appended.detail };
        }
        if (appended.emitted) {
          await this.#deliver(appended.entry);
        }
        await this.#record(sessionKey, frame);
      }
      const receipt = lane.gate.settle(admitted.token, terminal);
      return { outcome: "accepted", receipt };
    } catch (error) {
      terminal = "provider_error";
      const detail = error instanceof Error ? error.message : "The runtime turn failed.";
      this.#diagnose(sessionKey, "runtime_turn_failed", detail);
      return { outcome: "failed", code: "runtime_turn_failed", detail };
    } finally {
      lane.gate.settle(admitted.token, terminal);
    }
  }

  async publishData(input: RuntimePublishInput): Promise<RuntimePublishResult> {
    const sessionKey = input.sessionKey;
    const expectedRevision = input.expectedRevision;
    const operationId = input.operationId;
    const path = snapshotDataPath(input.path);
    if (path === undefined) {
      return {
        outcome: "rejected",
        code: "invalid_data_path",
        detail: "Publish paths must be non-empty named-key paths within B-14.",
      };
    }
    const snapshot = evaluateCandidateModel({ a: input.value });
    if (!snapshot.ok) {
      return {
        outcome: "rejected",
        code: snapshot.reason,
        detail:
          snapshot.bound === null
            ? "The published value is not serializable JSON data."
            : `The published value exceeds ${snapshot.bound}.`,
      };
    }
    const value = snapshot.model["a"];
    const lane = this.#lane(sessionKey);
    const lease = lane.gate.mintHostLease(operationId);
    const authority: WriteAuthority = { kind: "host-lease", lease };
    try {
      const loaded = await loadSession(this.#store, sessionKey);
      for (const issue of loaded.issues) {
        this.#diagnose(sessionKey, issue.code, issue.detail);
      }
      const committed = await this.#commitPublish(
        sessionKey,
        loaded.session,
        path,
        value,
        expectedRevision,
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
    const gate = new TurnGate({
      now: this.#now,
      ...(this.#turnTimeoutMs === undefined ? {} : { timeoutMs: this.#turnTimeoutMs }),
    });
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
      get assetRegistry() {
        return current.assetRegistry;
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
