import { Buffer } from "node:buffer";
import type { IncomingMessage, ServerResponse } from "node:http";

import { EventType, RunAgentInputSchema } from "@ag-ui/core";
import type { AGUIEvent, RunAgentInput } from "@ag-ui/core";
import { MAX_FIELD_VALUE_CHARS, MAX_FIELDS_KEYS } from "@facet/core";
import type {
  ClientEvent,
  CollectedEvent,
  FacetAction,
  FieldValues,
  ServerMessage,
  TapEffect,
  VisitorContext,
} from "@facet/core";
import type { FacetRuntime, TurnResult } from "@facet/runtime";

import { facetStageToStateSnapshot, serverMessageToAgUiEvents } from "./events.js";

const DEFAULT_MAX_BODY_BYTES = 1_000_000;
const RUNTIME_ERROR_MESSAGE = "Facet runtime failed";
const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
} as const;

export type FacetRuntimeForAgUi = Pick<FacetRuntime, "handle" | "record" | "stageFor">;

export interface RunFacetAsAgUiOptions {
  readonly includeSnapshot?: boolean;
}

export interface HandleAgUiRequestOptions extends RunFacetAsAgUiOptions {
  readonly maxBodyBytes?: number;
}

export type FacetAgUiInput =
  | {
      readonly kind: "event";
      readonly visitor: VisitorContext;
      readonly event: ClientEvent;
    }
  | {
      readonly kind: "record";
      readonly visitor: VisitorContext;
      readonly record: CollectedEvent;
    };

type RunStartedAgUiEvent = Extract<AGUIEvent, { readonly type: EventType.RUN_STARTED }>;
type RunFinishedAgUiEvent = Extract<AGUIEvent, { readonly type: EventType.RUN_FINISHED }>;
type RunErrorAgUiEvent = Extract<AGUIEvent, { readonly type: EventType.RUN_ERROR }> & {
  readonly threadId?: string;
  readonly runId?: string;
};

interface TextMessageState {
  nextIndex: number;
}

class AgUiHttpInputError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function runFacetAsAgUi(
  runtime: FacetRuntimeForAgUi,
  input: unknown,
  options: RunFacetAsAgUiOptions = {},
): Promise<readonly AGUIEvent[]> {
  let parsed: ReturnType<typeof RunAgentInputSchema.safeParse>;
  try {
    parsed = RunAgentInputSchema.safeParse(input);
  } catch {
    return [runError("Malformed AG-UI run input", "BAD_REQUEST")];
  }
  if (!parsed.success) return [runError("Malformed AG-UI run input", "BAD_REQUEST")];

  const runInput = parsed.data;
  const events: AGUIEvent[] = [runStarted(runInput)];
  let facetInput: FacetAgUiInput | undefined;
  try {
    facetInput = facetInputFromRunAgentInput(runInput);
  } catch {
    events.push(runError("Malformed Facet forwardedProps", "BAD_REQUEST", runInput));
    return events;
  }
  if (facetInput === undefined) {
    events.push(runError("Malformed Facet forwardedProps", "BAD_REQUEST", runInput));
    return events;
  }

  try {
    if (options.includeSnapshot === true) {
      await appendSnapshot(events, runtime, facetInput.visitor);
    }

    if (facetInput.kind === "record") {
      void runtime.record(facetInput.visitor, facetInput.record).catch((error: unknown) => {
        logInternalFailure("record failed", error);
      });
    } else {
      await appendHandledEvents(events, runtime, facetInput, runInput);
    }

    events.push(runFinished(runInput));
  } catch (error) {
    logInternalFailure("runtime failed", error);
    events.push(runError(RUNTIME_ERROR_MESSAGE, "RUNTIME_ERROR", runInput));
  }

  return events;
}

export function facetInputFromRunAgentInput(input: RunAgentInput): FacetAgUiInput | undefined {
  const forwardedProps: unknown = input.forwardedProps;
  if (!isObject(forwardedProps)) return undefined;
  const facet = forwardedProps["facet"];
  if (!isObject(facet)) return undefined;

  const visitor = normalizeVisitor(facet["visitor"]);
  if (visitor === undefined) return undefined;

  const eventValue = facet["event"];
  const recordValue = facet["record"];
  if (eventValue !== undefined && recordValue !== undefined) return undefined;
  if (eventValue !== undefined) {
    const event = normalizeClientEvent(eventValue);
    return event === undefined ? undefined : { kind: "event", visitor, event };
  }
  if (recordValue !== undefined) {
    const record = normalizeCollectedEvent(recordValue);
    return record === undefined ? undefined : { kind: "record", visitor, record };
  }

  return undefined;
}

export async function handleAgUiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  runtime: FacetRuntimeForAgUi,
  options: HandleAgUiRequestOptions = {},
): Promise<void> {
  try {
    if (req.method !== undefined && req.method !== "POST") {
      writeAgUiSseResponse(res, 405, [runError("Method not allowed", "METHOD_NOT_ALLOWED")]);
      return;
    }

    const body = await readRequestBody(req, options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES);
    const json = parseRequestJson(body);
    const parsed = RunAgentInputSchema.safeParse(json);
    if (!parsed.success) {
      writeAgUiSseResponse(res, 400, [runError("Malformed AG-UI run input", "BAD_REQUEST")]);
      return;
    }

    await writeAgUiRunResponse(res, runtime, parsed.data, options);
  } catch (error) {
    const statusCode = error instanceof AgUiHttpInputError ? error.statusCode : 500;
    const code = error instanceof AgUiHttpInputError ? error.code : "INTERNAL_ERROR";
    const message =
      error instanceof AgUiHttpInputError ? errorMessage(error) : RUNTIME_ERROR_MESSAGE;
    if (!(error instanceof AgUiHttpInputError)) logInternalFailure("handler failed", error);
    writeAgUiSseResponse(res, statusCode, [runError(message, code)]);
  }
}

export function writeAgUiSseEvent(res: ServerResponse, event: AGUIEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function writeAgUiSseResponse(
  res: ServerResponse,
  statusCode: number,
  events: readonly AGUIEvent[],
): void {
  if (!res.headersSent) res.writeHead(statusCode, SSE_HEADERS);
  for (const event of events) {
    writeAgUiSseEvent(res, event);
  }
  res.end();
}

async function writeAgUiRunResponse(
  res: ServerResponse,
  runtime: FacetRuntimeForAgUi,
  runInput: RunAgentInput,
  options: RunFacetAsAgUiOptions,
): Promise<void> {
  if (!res.headersSent) res.writeHead(200, SSE_HEADERS);
  const writeQueue = createSseWriteQueue(res);
  const write = (event: AGUIEvent): void => writeQueue.enqueue(event);

  write(runStarted(runInput));
  let facetInput: FacetAgUiInput | undefined;
  try {
    facetInput = facetInputFromRunAgentInput(runInput);
  } catch {
    write(runError("Malformed Facet forwardedProps", "BAD_REQUEST", runInput));
    await writeQueue.flush();
    res.end();
    return;
  }
  if (facetInput === undefined) {
    write(runError("Malformed Facet forwardedProps", "BAD_REQUEST", runInput));
    await writeQueue.flush();
    res.end();
    return;
  }

  try {
    if (options.includeSnapshot === true) {
      const stage = await runtime.stageFor(facetInput.visitor.visitorId);
      if (stage !== undefined) write(facetStageToStateSnapshot(stage));
    }

    if (facetInput.kind === "record") {
      void runtime.record(facetInput.visitor, facetInput.record).catch((error: unknown) => {
        logInternalFailure("record failed", error);
      });
    } else {
      await writeHandledEvents(write, runtime, facetInput, runInput);
    }

    write(runFinished(runInput));
  } catch (error) {
    logInternalFailure("runtime failed", error);
    write(runError(RUNTIME_ERROR_MESSAGE, "RUNTIME_ERROR", runInput));
  }

  await writeQueue.flush();
  res.end();
}

function createSseWriteQueue(res: ServerResponse): {
  readonly enqueue: (event: AGUIEvent) => void;
  readonly flush: () => Promise<void>;
} {
  let chain = Promise.resolve();
  return {
    enqueue: (event) => {
      chain = chain.then(() => writeAgUiSseEventWithBackpressure(res, event));
    },
    flush: () => chain,
  };
}

function writeAgUiSseEventWithBackpressure(res: ServerResponse, event: AGUIEvent): Promise<void> {
  return new Promise((resolve) => {
    if (res.write(`data: ${JSON.stringify(event)}\n\n`)) {
      resolve();
      return;
    }
    res.once("drain", resolve);
  });
}

async function appendSnapshot(
  events: AGUIEvent[],
  runtime: FacetRuntimeForAgUi,
  visitor: VisitorContext,
): Promise<void> {
  const stage = await runtime.stageFor(visitor.visitorId);
  if (stage !== undefined) events.push(facetStageToStateSnapshot(stage));
}

async function appendHandledEvents(
  events: AGUIEvent[],
  runtime: FacetRuntimeForAgUi,
  input: Extract<FacetAgUiInput, { readonly kind: "event" }>,
  runInput: RunAgentInput,
): Promise<void> {
  const textState: TextMessageState = { nextIndex: 1 };
  let deliveredFrame = false;
  const result = await runtime.handle(input.visitor, input.event, (messages) => {
    deliveredFrame = true;
    appendServerMessages(events, messages, textState, runInput);
  });
  if (!deliveredFrame) appendTurnResult(events, result, textState, runInput);
}

async function writeHandledEvents(
  write: (event: AGUIEvent) => void,
  runtime: FacetRuntimeForAgUi,
  input: Extract<FacetAgUiInput, { readonly kind: "event" }>,
  runInput: RunAgentInput,
): Promise<void> {
  const events: AGUIEvent[] = [];
  const textState: TextMessageState = { nextIndex: 1 };
  let deliveredFrame = false;
  const result = await runtime.handle(input.visitor, input.event, (messages) => {
    deliveredFrame = true;
    const frameEvents: AGUIEvent[] = [];
    appendServerMessages(frameEvents, messages, textState, runInput);
    for (const event of frameEvents) write(event);
  });
  if (!deliveredFrame) {
    appendTurnResult(events, result, textState, runInput);
    for (const event of events) write(event);
  }
}

function appendTurnResult(
  events: AGUIEvent[],
  result: TurnResult,
  textState: TextMessageState,
  runInput: RunAgentInput,
): void {
  appendServerMessages(events, result.messages, textState, runInput);
}

function appendServerMessages(
  events: AGUIEvent[],
  messages: readonly ServerMessage[],
  textState: TextMessageState,
  runInput: RunAgentInput,
): void {
  for (const message of messages) {
    if (message.kind === "say") {
      const messageId = `facet-${runInput.runId}-message-${String(textState.nextIndex)}`;
      textState.nextIndex += 1;
      events.push(...serverMessageToAgUiEvents(message, { messageId }));
    } else {
      events.push(...serverMessageToAgUiEvents(message));
    }
  }
}

async function readRequestBody(req: IncomingMessage, maxBodyBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for await (const chunk of req as AsyncIterable<unknown>) {
    const buffer = bodyChunkToBuffer(chunk);
    receivedBytes += buffer.byteLength;
    if (receivedBytes > maxBodyBytes) {
      throw new AgUiHttpInputError(413, "PAYLOAD_TOO_LARGE", "AG-UI request body is too large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function bodyChunkToBuffer(chunk: unknown): Buffer {
  if (typeof chunk === "string") return Buffer.from(chunk);
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  throw new AgUiHttpInputError(400, "BAD_REQUEST", "Unsupported AG-UI request body chunk");
}

function parseRequestJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new AgUiHttpInputError(400, "BAD_REQUEST", "Malformed JSON body");
  }
}

function runStarted(input: RunAgentInput): RunStartedAgUiEvent {
  return {
    type: EventType.RUN_STARTED,
    threadId: input.threadId,
    runId: input.runId,
    ...(input.parentRunId === undefined ? {} : { parentRunId: input.parentRunId }),
  } satisfies RunStartedAgUiEvent;
}

function runFinished(input: RunAgentInput): RunFinishedAgUiEvent {
  return {
    type: EventType.RUN_FINISHED,
    threadId: input.threadId,
    runId: input.runId,
    outcome: { type: "success" },
  } satisfies RunFinishedAgUiEvent;
}

function runError(message: string, code?: string, input?: RunAgentInput): RunErrorAgUiEvent {
  return {
    type: EventType.RUN_ERROR,
    message,
    ...(code === undefined ? {} : { code }),
    ...(input === undefined ? {} : { threadId: input.threadId, runId: input.runId }),
  } satisfies RunErrorAgUiEvent;
}

function normalizeVisitor(value: unknown): VisitorContext | undefined {
  if (!isObject(value)) return undefined;
  const visitorId = value["visitorId"];
  if (typeof visitorId !== "string") return undefined;

  const referrer = optionalString(value, "referrer");
  const locale = optionalString(value, "locale");
  const relationship = optionalString(value, "relationship");
  if (referrer === null || locale === null || relationship === null) return undefined;

  return {
    visitorId,
    ...(referrer === undefined ? {} : { referrer }),
    ...(locale === undefined ? {} : { locale }),
    ...(relationship === undefined ? {} : { relationship }),
  };
}

function normalizeClientEvent(value: unknown): ClientEvent | undefined {
  if (!isObject(value)) return undefined;
  const kind = value["kind"];
  const seq = optionalSeq(value);
  if (seq === null) return undefined;

  if (kind === "visit") {
    const eventVisitor = normalizeVisitor(value["visitor"]);
    return eventVisitor === undefined
      ? undefined
      : { kind: "visit", visitor: eventVisitor, ...(seq === undefined ? {} : { seq }) };
  }
  if (kind === "message") {
    const text = value["text"];
    return typeof text === "string"
      ? { kind, text, ...(seq === undefined ? {} : { seq }) }
      : undefined;
  }
  if (kind === "tap") {
    const action = normalizeAgentAction(value["action"]);
    if (action === undefined) return undefined;
    const fields = optionalFields(value);
    if (fields === null) return undefined;
    if (value["effect"] !== undefined || value["target"] !== undefined) return undefined;
    return {
      kind,
      action,
      ...(fields === undefined ? {} : { fields }),
      ...(seq === undefined ? {} : { seq }),
    };
  }

  return undefined;
}

function normalizeCollectedEvent(value: unknown): CollectedEvent | undefined {
  if (!isObject(value)) return undefined;
  const kind = value["kind"];
  const seq = optionalSeq(value);
  if (seq === null) return undefined;

  if (kind === "visit") {
    const eventVisitor = normalizeVisitor(value["visitor"]);
    return eventVisitor === undefined
      ? undefined
      : { kind: "visit", visitor: eventVisitor, ...(seq === undefined ? {} : { seq }) };
  }
  if (kind === "message") {
    const text = value["text"];
    return typeof text === "string"
      ? { kind, text, ...(seq === undefined ? {} : { seq }) }
      : undefined;
  }
  if (kind !== "tap") return undefined;

  const action = optionalFacetAction(value);
  const effect = optionalTapEffect(value);
  const fields = optionalFields(value);
  const target = optionalBoundedString(value, "target");
  if (action === null || effect === null || fields === null || target === null) return undefined;

  return {
    kind,
    ...(target === undefined ? {} : { target }),
    ...(effect === undefined ? {} : { effect }),
    ...(action === undefined ? {} : { action }),
    ...(fields === undefined ? {} : { fields }),
    ...(seq === undefined ? {} : { seq }),
  };
}

function optionalFacetAction(object: Record<string, unknown>): FacetAction | undefined | null {
  const action = object["action"];
  if (action === undefined) return undefined;
  if (!isObject(action)) return null;
  const kind = action["kind"];
  if (kind === "navigate") {
    const to = optionalBoundedString(action, "to");
    return typeof to === "string" ? { kind, to } : null;
  }
  if (kind === "toggle") {
    const target = optionalBoundedString(action, "target");
    return typeof target === "string" ? { kind, target } : null;
  }
  return normalizeAgentAction(action) ?? null;
}

function normalizeAgentAction(value: unknown): FacetAction | undefined {
  if (!isObject(value)) return undefined;
  const kind = value["kind"];
  if (kind !== undefined && kind !== "agent") return undefined;

  const name = value["name"];
  if (typeof name !== "string") return undefined;
  const payload = optionalPayload(value);
  const collect = optionalString(value, "collect");
  if (payload === null || collect === null) return undefined;

  return {
    ...(kind === "agent" ? { kind } : {}),
    name,
    ...(payload === undefined ? {} : { payload }),
    ...(collect === undefined ? {} : { collect }),
  };
}

function optionalTapEffect(object: Record<string, unknown>): TapEffect | undefined | null {
  const effect = object["effect"];
  if (effect === undefined) return undefined;
  if (!isObject(effect)) return null;
  const navigate = effect["navigate"];
  const toggle = effect["toggle"];
  if (
    typeof navigate === "string" &&
    navigate.length <= MAX_FIELD_VALUE_CHARS &&
    toggle === undefined
  )
    return { navigate };
  if (
    typeof toggle === "string" &&
    toggle.length <= MAX_FIELD_VALUE_CHARS &&
    navigate === undefined
  )
    return { toggle };
  return null;
}

function optionalFields(object: Record<string, unknown>): FieldValues | undefined | null {
  const fields = object["fields"];
  if (fields === undefined) return undefined;
  if (!isObject(fields)) return null;
  const entries = Object.entries(fields);
  if (entries.length > MAX_FIELDS_KEYS) return null;
  const normalized: Record<string, string | boolean> = {};
  for (const [name, value] of entries) {
    if (name.length > MAX_FIELD_VALUE_CHARS) return null;
    if (typeof value !== "string" && typeof value !== "boolean") return null;
    if (typeof value === "string" && value.length > MAX_FIELD_VALUE_CHARS) return null;
    normalized[name] = value;
  }
  return normalized;
}

function optionalPayload(
  object: Record<string, unknown>,
): Readonly<Record<string, string | number | boolean>> | undefined | null {
  const payload = object["payload"];
  if (payload === undefined) return undefined;
  if (!isObject(payload)) return null;
  const normalized: Record<string, string | number | boolean> = {};
  for (const [name, value] of Object.entries(payload)) {
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")
      return null;
    if (typeof value === "number" && !Number.isFinite(value)) return null;
    normalized[name] = value;
  }
  return normalized;
}

function optionalString(object: Record<string, unknown>, key: string): string | undefined | null {
  const value = object[key];
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : null;
}

function optionalBoundedString(
  object: Record<string, unknown>,
  key: string,
): string | undefined | null {
  const value = optionalString(object, key);
  if (value === null || value === undefined) return value;
  return value.length <= MAX_FIELD_VALUE_CHARS ? value : null;
}

function optionalSeq(object: Record<string, unknown>): number | undefined | null {
  const seq = object["seq"];
  if (seq === undefined) return undefined;
  return typeof seq === "number" && Number.isFinite(seq) ? seq : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "AG-UI run failed";
}

function logInternalFailure(label: string, error: unknown): void {
  const errorKind = error instanceof Error ? error.name : typeof error;
  console.error(`[facet/ag-ui] ${label}: ${errorKind}`);
}
