import { Buffer } from "node:buffer";
import type { IncomingMessage, ServerResponse } from "node:http";

import { EventType, RunAgentInputSchema } from "@ag-ui/core";
import type { AGUIEvent, RunAgentInput } from "@ag-ui/core";
import {
  MAX_FIELD_VALUE_CHARS,
  MAX_FIELDS_KEYS,
  createSerialQueue,
  foldPatchIntoStage,
} from "@facet/core";
import type {
  ClientEvent,
  CollectedEvent,
  FacetAction,
  FacetTree,
  FieldValues,
  ServerMessage,
  TapEffect,
  VisitorContext,
} from "@facet/core";
import type { FacetRuntime, RuntimeFrameContext, TurnResult } from "@facet/runtime";

import { facetStageToStateSnapshot, serverMessageToAgUiEvents } from "./events.js";

const DEFAULT_MAX_BODY_BYTES = 1_000_000;
const DEFAULT_SNAPSHOT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_IN_FLIGHT_RUNS = 64;
const DEFAULT_MAX_BUFFERED_SSE_EVENTS = 1_024;
const RUNTIME_ERROR_MESSAGE = "Facet runtime failed";
const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
} as const;

export type FacetRuntimeForAgUi = Pick<FacetRuntime, "handle" | "record" | "stageFor">;

export interface FacetAgUiVisitorResolutionInput {
  readonly threadId: string;
  readonly runId: string;
  readonly parentRunId?: string;
  readonly forwardedVisitor?: VisitorContext;
}

export interface RunFacetAsAgUiOptions {
  readonly includeSnapshot?: boolean;
  readonly snapshotTimeoutMs?: number | false;
  readonly maxInFlightRuns?: number | false;
  readonly allowForwardedVisitor?: boolean;
  readonly authorizedVisitor?: VisitorContext;
  readonly resolveVisitor?: (
    input: FacetAgUiVisitorResolutionInput,
  ) => VisitorContext | undefined | Promise<VisitorContext | undefined>;
}

export interface HandleAgUiRequestOptions extends Omit<
  RunFacetAsAgUiOptions,
  "authorizedVisitor" | "resolveVisitor"
> {
  readonly maxBodyBytes?: number;
  readonly maxBufferedSseEvents?: number | false;
  readonly resolveVisitor?: (
    req: IncomingMessage,
    input: FacetAgUiVisitorResolutionInput,
  ) => VisitorContext | undefined | Promise<VisitorContext | undefined>;
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

type AgUiRuntimeExecutionOptions = Pick<
  RunFacetAsAgUiOptions,
  "includeSnapshot" | "snapshotTimeoutMs" | "maxInFlightRuns"
>;

type AgUiHttpExecutionOptions = AgUiRuntimeExecutionOptions &
  Pick<HandleAgUiRequestOptions, "maxBufferedSseEvents">;

interface StageSnapshotState {
  stage: FacetTree | undefined;
}

const runtimeRunCounts = new WeakMap<object, number>();
const runtimeVisitorQueues = new WeakMap<
  object,
  (key: string, task: () => Promise<unknown>) => Promise<unknown>
>();
const runtimeQueuedRunCounts = new WeakMap<object, Map<string, number>>();

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

  let runInput = parsed.data;
  const events: AGUIEvent[] = [runStarted(runInput)];
  let releaseRun: (() => void) | undefined;
  let releaseAfter: Promise<unknown> | undefined;
  try {
    releaseRun = acquireRuntimeRun(runtime, options);
    const scheduledRun = await withRuntimeAuthorizationRun(runtime, runInput, options, async () => {
      const authorizedRunInput = await authorizeDirectRunInput(runInput, options);
      const facetInput = requireFacetInput(authorizedRunInput);

      const queuedRun = withRuntimeVisitorRun(runtime, facetInput.visitor, async () => {
        try {
          const stageState: StageSnapshotState = { stage: undefined };
          if (options.includeSnapshot === true) {
            stageState.stage = await appendSnapshot(events, runtime, facetInput.visitor, options);
          }

          if (facetInput.kind === "record") {
            releaseAfter = recordWithoutThrow(runtime, facetInput.visitor, facetInput.record);
          } else {
            await appendHandledEvents(events, runtime, facetInput, authorizedRunInput, stageState);
          }
        } catch (error) {
          releaseAfter = pendingWorkForTimeout(error);
          throw error;
        }
      });

      return { runInput: authorizedRunInput, queuedRun };
    });
    runInput = scheduledRun.runInput;
    await scheduledRun.queuedRun;
    events.push(runFinished(runInput));
  } catch (error) {
    if (error instanceof AgUiHttpInputError) {
      events.push(runError(error.message, error.code, runInput));
    } else {
      logInternalFailure("runtime failed", error);
      events.push(runError(RUNTIME_ERROR_MESSAGE, runtimeErrorCode(error), runInput));
    }
  } finally {
    if (releaseRun !== undefined) releaseRuntimeRun(releaseRun, releaseAfter);
  }

  return events;
}

function requireFacetInput(input: RunAgentInput): FacetAgUiInput {
  try {
    const facetInput = facetInputFromRunAgentInput(input);
    if (facetInput !== undefined) return facetInput;
  } catch {
    // Fall through to the uniform BAD_REQUEST below.
  }
  throw new AgUiHttpInputError(400, "BAD_REQUEST", "Malformed Facet forwardedProps");
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

    const releaseRun = acquireRuntimeRun(runtime, options);
    let handedToWriter = false;
    let closedBeforeWriter = false;
    let resolveClosedBeforeWriter: (() => void) | undefined;
    const closedBeforeWriterPromise = new Promise<void>((resolve) => {
      resolveClosedBeforeWriter = resolve;
    });
    const cleanupPreWriterCloseWatch = (): void => {
      res.off("close", onClosedBeforeWriter);
      res.off("error", onClosedBeforeWriter);
    };
    const onClosedBeforeWriter = (): void => {
      closedBeforeWriter = true;
      cleanupPreWriterCloseWatch();
      releaseRun();
      resolveClosedBeforeWriter?.();
    };
    res.once("close", onClosedBeforeWriter);
    res.once("error", onClosedBeforeWriter);
    try {
      if (isResponseClosed(res)) {
        onClosedBeforeWriter();
        return;
      }
      const authorizedRun = withRuntimeAuthorizationRun(runtime, parsed.data, options, async () => {
        if (closedBeforeWriter || isResponseClosed(res)) return { kind: "closed" as const };
        const runInput = await authorizeHttpRunInputUntilOpen(
          req,
          parsed.data,
          options,
          closedBeforeWriterPromise,
        );
        if (runInput === undefined || closedBeforeWriter || isResponseClosed(res)) {
          return { kind: "closed" as const };
        }
        cleanupPreWriterCloseWatch();
        handedToWriter = true;
        return {
          kind: "writer" as const,
          writerRun: writeAgUiRunResponse(res, runtime, runInput, options, releaseRun),
        };
      });
      const completed = await Promise.race([
        authorizedRun,
        closedBeforeWriterPromise.then(() => ({ kind: "closed" as const })),
      ]);
      if (completed.kind === "closed") {
        void authorizedRun.catch((error: unknown) => {
          logInternalFailure("authorization failed after response close", error);
        });
        return;
      }
      await completed.writerRun;
    } finally {
      cleanupPreWriterCloseWatch();
      if (!handedToWriter) releaseRun();
    }
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
  res.write(agUiSseFrame(event));
}

function agUiSseFrame(event: AGUIEvent): string {
  try {
    const json = JSON.stringify(event);
    if (json !== undefined) return `data: ${json}\n\n`;
  } catch {
    // Fall through to the safe terminal event below.
  }
  return `data: ${JSON.stringify(runError("Malformed AG-UI SSE event", "BAD_REQUEST"))}\n\n`;
}

function writeAgUiSseResponse(
  res: ServerResponse,
  statusCode: number,
  events: readonly AGUIEvent[],
): void {
  try {
    if (isResponseClosed(res)) return;
    if (!res.headersSent) res.writeHead(statusCode, SSE_HEADERS);
    for (const event of events) {
      if (isResponseClosed(res)) return;
      writeAgUiSseEvent(res, event);
    }
    endResponse(res);
  } catch {
    closeResponseForWriteFailure(res);
  }
}

async function writeAgUiRunResponse(
  res: ServerResponse,
  runtime: FacetRuntimeForAgUi,
  runInput: RunAgentInput,
  options: AgUiHttpExecutionOptions,
  releaseRun: () => void,
): Promise<void> {
  if (!res.headersSent) res.writeHead(200, SSE_HEADERS);
  const writeQueue = createSseWriteQueue(res, options.maxBufferedSseEvents);
  const write = (event: AGUIEvent): void => writeQueue.enqueue(event);
  let runReleased = false;
  const releaseActiveRun = (): void => {
    if (runReleased) return;
    runReleased = true;
    releaseRun();
  };
  const finishWithoutRuntime = async (): Promise<void> => {
    releaseActiveRun();
    await writeQueue.flush();
    endResponse(res);
  };

  write(runStarted(runInput));
  let facetInput: FacetAgUiInput;
  try {
    facetInput = requireFacetInput(runInput);
  } catch (error) {
    const code = error instanceof AgUiHttpInputError ? error.code : "BAD_REQUEST";
    const message =
      error instanceof AgUiHttpInputError ? error.message : "Malformed Facet forwardedProps";
    write(runError(message, code, runInput));
    await finishWithoutRuntime();
    return;
  }

  try {
    if (isResponseClosed(res)) {
      releaseActiveRun();
      return;
    }
    let queuedTaskStarted = false;
    let abortedBeforeStart = false;
    let resolveClosedBeforeStart: (() => void) | undefined;
    const closedBeforeStart = new Promise<void>((resolve) => {
      resolveClosedBeforeStart = resolve;
    });
    const cleanupCloseWatch = (): void => {
      res.off("close", onClosedBeforeStart);
      res.off("error", onClosedBeforeStart);
    };
    const onClosedBeforeStart = (): void => {
      if (queuedTaskStarted) return;
      abortedBeforeStart = true;
      cleanupCloseWatch();
      releaseActiveRun();
      resolveClosedBeforeStart?.();
    };
    res.once("close", onClosedBeforeStart);
    res.once("error", onClosedBeforeStart);
    if (isResponseClosed(res)) {
      onClosedBeforeStart();
      return;
    }

    let releaseQueuedRun: (() => void) | undefined;
    let queuedRunReleased = false;
    const releaseQueuedRunOnce = (): void => {
      if (queuedRunReleased) return;
      queuedRunReleased = true;
      releaseQueuedRun?.();
    };
    try {
      releaseQueuedRun = acquireRuntimeQueuedRun(runtime, facetInput.visitor, options);
    } catch (error) {
      cleanupCloseWatch();
      releaseActiveRun();
      throw error;
    }

    const queuedRun = withRuntimeVisitorRun(runtime, facetInput.visitor, async () => {
      releaseQueuedRunOnce();
      queuedTaskStarted = true;
      cleanupCloseWatch();
      if (abortedBeforeStart) return;
      if (res.destroyed || res.writableEnded) {
        releaseActiveRun();
        return;
      }
      let releaseAfter: Promise<unknown> | undefined;
      try {
        const stageState: StageSnapshotState = { stage: undefined };
        if (options.includeSnapshot === true) {
          const stage = await withSnapshotTimeout(
            runtime.stageFor(facetInput.visitor.visitorId),
            options,
          );
          stageState.stage = stage;
          if (stage !== undefined) write(facetStageToStateSnapshot(stage));
        }

        if (facetInput.kind === "record") {
          releaseAfter = recordWithoutThrow(runtime, facetInput.visitor, facetInput.record);
        } else {
          await writeHandledEvents(write, runtime, facetInput, runInput, stageState);
        }
      } catch (error) {
        releaseAfter = pendingWorkForTimeout(error);
        throw error;
      } finally {
        releaseRuntimeRun(releaseActiveRun, releaseAfter);
      }

      write(runFinished(runInput));
    });
    const completed = await Promise.race([
      queuedRun.then(() => true),
      closedBeforeStart.then(() => false),
    ]);
    if (!completed) {
      void queuedRun.catch((error: unknown) => {
        logInternalFailure("queued run failed after response close", error);
      });
      return;
    }
  } catch (error) {
    if (error instanceof AgUiHttpInputError) {
      write(runError(error.message, error.code, runInput));
    } else {
      logInternalFailure("runtime failed", error);
      write(runError(RUNTIME_ERROR_MESSAGE, runtimeErrorCode(error), runInput));
    }
  }

  await writeQueue.flush();
  endResponse(res);
}

function createSseWriteQueue(
  res: ServerResponse,
  maxBufferedEvents: number | false = DEFAULT_MAX_BUFFERED_SSE_EVENTS,
): {
  readonly enqueue: (event: AGUIEvent) => void;
  readonly flush: () => Promise<void>;
} {
  const maxBuffered = normalizeMaxBufferedSseEvents(maxBufferedEvents);
  let closed = false;
  let pumping = false;
  const queue: AGUIEvent[] = [];
  const flushWaiters: Array<() => void> = [];
  const onClose = (): void => {
    closed = true;
    queue.length = 0;
    resolveFlushWaiters();
  };
  const resolveFlushWaiters = (): void => {
    if (!closed && (pumping || queue.length > 0)) return;
    res.off("close", onClose);
    res.off("error", onClose);
    while (flushWaiters.length > 0) flushWaiters.shift()?.();
  };
  res.once("close", onClose);
  res.once("error", onClose);
  const closeQueueForWriteFailure = (): void => {
    closed = true;
    queue.length = 0;
    closeResponseForWriteFailure(res);
    resolveFlushWaiters();
  };
  const startPump = (): void => {
    void pump().catch(closeQueueForWriteFailure);
  };
  const pump = async (): Promise<void> => {
    if (pumping) return;
    pumping = true;
    try {
      while (!closed && queue.length > 0 && !res.destroyed && !res.writableEnded) {
        const event = queue.shift();
        if (event === undefined) continue;
        try {
          const blocked = writeAgUiSseEventWithBackpressure(res, event);
          if (blocked !== undefined) await blocked;
        } catch {
          closeQueueForWriteFailure();
          break;
        }
      }
    } finally {
      pumping = false;
      resolveFlushWaiters();
      if (!closed && queue.length > 0) startPump();
    }
  };
  return {
    enqueue: (event) => {
      if (closed || res.destroyed || res.writableEnded) return;
      if (pumping && maxBuffered !== false && queue.length >= maxBuffered) {
        closed = true;
        closeResponseForOverflow(res);
        resolveFlushWaiters();
        return;
      }
      queue.push(event);
      startPump();
    },
    flush: () =>
      !closed && (pumping || queue.length > 0)
        ? new Promise((resolve) => {
            flushWaiters.push(resolve);
          })
        : Promise.resolve(),
  };
}

function normalizeMaxBufferedSseEvents(value: number | false): number | false {
  if (value === false) return false;
  if (!Number.isFinite(value)) return DEFAULT_MAX_BUFFERED_SSE_EVENTS;
  return Math.max(1, Math.floor(value));
}

function closeResponseForOverflow(res: ServerResponse): void {
  closeResponseForWriteFailure(res);
}

function closeResponseForWriteFailure(res: ServerResponse): void {
  if (res.destroyed || res.writableEnded) return;
  try {
    res.destroy();
  } catch {
    endResponse(res);
  }
}

function writeAgUiSseEventWithBackpressure(
  res: ServerResponse,
  event: AGUIEvent,
): Promise<void> | undefined {
  if (res.destroyed || res.writableEnded) return undefined;
  if (res.write(agUiSseFrame(event))) return undefined;

  return new Promise((resolve) => {
    const cleanup = (): void => {
      res.off("drain", onDrain);
      res.off("close", onClose);
      res.off("error", onError);
    };
    const settle = (): void => {
      cleanup();
      resolve();
    };
    const onDrain = (): void => settle();
    const onClose = (): void => settle();
    const onError = (): void => settle();
    res.once("drain", onDrain);
    res.once("close", onClose);
    res.once("error", onError);
  });
}

function endResponse(res: ServerResponse): void {
  if (!res.destroyed && !res.writableEnded) res.end();
}

function isResponseClosed(res: ServerResponse): boolean {
  return res.destroyed || res.writableEnded;
}

async function appendSnapshot(
  events: AGUIEvent[],
  runtime: FacetRuntimeForAgUi,
  visitor: VisitorContext,
  options: AgUiRuntimeExecutionOptions,
): Promise<FacetTree | undefined> {
  const stage = await withSnapshotTimeout(runtime.stageFor(visitor.visitorId), options);
  if (stage !== undefined) events.push(facetStageToStateSnapshot(stage));
  return stage;
}

async function appendHandledEvents(
  events: AGUIEvent[],
  runtime: FacetRuntimeForAgUi,
  input: Extract<FacetAgUiInput, { readonly kind: "event" }>,
  runInput: RunAgentInput,
  stageState: StageSnapshotState,
): Promise<void> {
  const textState: TextMessageState = { nextIndex: 1 };
  let deliveredFrame = false;
  let delivery = Promise.resolve();
  const resultPromise = invokeRuntimeHandle(runtime, input, (messages, context) => {
    deliveredFrame = true;
    delivery = delivery.then(async () => {
      await appendServerMessages(events, messages, textState, runInput, stageState, context);
    });
  });
  const result = await resultPromise;
  await delivery;
  if (!deliveredFrame) {
    appendTurnResult(events, result, textState, runInput, stageState);
  }
}

async function writeHandledEvents(
  write: (event: AGUIEvent) => void,
  runtime: FacetRuntimeForAgUi,
  input: Extract<FacetAgUiInput, { readonly kind: "event" }>,
  runInput: RunAgentInput,
  stageState: StageSnapshotState,
): Promise<void> {
  const events: AGUIEvent[] = [];
  const textState: TextMessageState = { nextIndex: 1 };
  let deliveredFrame = false;
  let delivery = Promise.resolve();
  const resultPromise = invokeRuntimeHandle(runtime, input, (messages, context) => {
    deliveredFrame = true;
    delivery = delivery.then(async () => {
      const frameEvents: AGUIEvent[] = [];
      await appendServerMessages(frameEvents, messages, textState, runInput, stageState, context);
      for (const event of frameEvents) write(event);
    });
  });
  const result = await resultPromise;
  await delivery;
  if (!deliveredFrame) {
    appendTurnResult(events, result, textState, runInput, stageState);
    for (const event of events) write(event);
  }
}

function invokeRuntimeHandle(
  runtime: FacetRuntimeForAgUi,
  input: Extract<FacetAgUiInput, { readonly kind: "event" }>,
  onFrame: (messages: readonly ServerMessage[], context?: RuntimeFrameContext) => void,
): Promise<TurnResult> {
  return Promise.resolve().then(() => runtime.handle(input.visitor, input.event, onFrame));
}

function acquireRuntimeRun(
  runtime: FacetRuntimeForAgUi,
  options: AgUiRuntimeExecutionOptions,
): () => void {
  const maxInFlight = options.maxInFlightRuns ?? DEFAULT_MAX_IN_FLIGHT_RUNS;
  if (maxInFlight === false) return () => {};
  const current = runtimeRunCounts.get(runtime) ?? 0;
  if (current >= maxInFlight) {
    throw new AgUiHttpInputError(429, "TOO_MANY_RUNS", "Too many AG-UI runs");
  }
  runtimeRunCounts.set(runtime, current + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (runtimeRunCounts.get(runtime) ?? 1) - 1;
    if (next <= 0) {
      runtimeRunCounts.delete(runtime);
    } else {
      runtimeRunCounts.set(runtime, next);
    }
  };
}

function acquireRuntimeQueuedRun(
  runtime: FacetRuntimeForAgUi,
  visitor: VisitorContext,
  options: AgUiRuntimeExecutionOptions,
): () => void {
  const maxQueued = options.maxInFlightRuns ?? DEFAULT_MAX_IN_FLIGHT_RUNS;
  if (maxQueued === false) return () => {};

  let counts = runtimeQueuedRunCounts.get(runtime);
  if (counts === undefined) {
    counts = new Map();
    runtimeQueuedRunCounts.set(runtime, counts);
  }
  const key = visitor.visitorId;
  const current = counts.get(key) ?? 0;
  if (current >= maxQueued) {
    throw new AgUiHttpInputError(429, "TOO_MANY_RUNS", "Too many queued AG-UI runs");
  }
  counts.set(key, current + 1);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const latestCounts = runtimeQueuedRunCounts.get(runtime);
    if (latestCounts === undefined) return;
    const next = (latestCounts.get(key) ?? 1) - 1;
    if (next <= 0) latestCounts.delete(key);
    else latestCounts.set(key, next);
    if (latestCounts.size === 0) runtimeQueuedRunCounts.delete(runtime);
  };
}

async function withSnapshotTimeout<T>(
  work: Promise<T>,
  options: AgUiRuntimeExecutionOptions,
): Promise<T> {
  const timeoutMs = options.snapshotTimeoutMs ?? DEFAULT_SNAPSHOT_TIMEOUT_MS;
  if (timeoutMs === false) return work;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const settledWork = work.then(
    () => undefined,
    () => undefined,
  );
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      reject(new AgUiRunTimeoutError(timeoutMs, settledWork));
    }, timeoutMs);
  });

  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (timedOut) void settledWork;
  }
}

class AgUiRunTimeoutError extends Error {
  constructor(
    timeoutMs: number,
    readonly pendingWork: Promise<unknown>,
  ) {
    super(`AG-UI run timed out after ${String(timeoutMs)}ms`);
  }
}

function pendingWorkForTimeout(error: unknown): Promise<unknown> | undefined {
  return error instanceof AgUiRunTimeoutError ? error.pendingWork : undefined;
}

function releaseRuntimeRun(releaseRun: () => void, releaseAfter?: Promise<unknown>): void {
  if (releaseAfter === undefined) {
    releaseRun();
    return;
  }
  void releaseAfter.finally(releaseRun);
}

function recordWithoutThrow(
  runtime: FacetRuntimeForAgUi,
  visitor: VisitorContext,
  record: CollectedEvent,
): Promise<void> {
  return Promise.resolve()
    .then(() => runtime.record(visitor, record))
    .catch((error: unknown) => {
      logInternalFailure("record failed", error);
    });
}

function runtimeErrorCode(error: unknown): string {
  return error instanceof AgUiRunTimeoutError ? "RUNTIME_TIMEOUT" : "RUNTIME_ERROR";
}

async function withRuntimeVisitorRun<T>(
  runtime: FacetRuntimeForAgUi,
  visitor: VisitorContext,
  task: () => Promise<T>,
): Promise<T> {
  return withRuntimeQueueKey(runtime, `visitor:${visitor.visitorId}`, task);
}

function authorizationQueueKey(
  input: RunAgentInput,
  options: RunFacetAsAgUiOptions | HandleAgUiRequestOptions,
): string {
  if (options.resolveVisitor !== undefined) return "authorize:runtime";
  if ("authorizedVisitor" in options && options.authorizedVisitor !== undefined) {
    return `authorize:visitor:${options.authorizedVisitor.visitorId}`;
  }
  const forwardedVisitor = forwardedVisitorFromRunAgentInput(input);
  if (forwardedVisitor !== undefined) return `authorize:visitor:${forwardedVisitor.visitorId}`;
  return `authorize:thread:${input.threadId}`;
}

async function withRuntimeAuthorizationRun<T>(
  runtime: FacetRuntimeForAgUi,
  input: RunAgentInput,
  options: RunFacetAsAgUiOptions | HandleAgUiRequestOptions,
  task: () => Promise<T>,
): Promise<T> {
  return withRuntimeQueueKey(runtime, authorizationQueueKey(input, options), task);
}

async function withRuntimeQueueKey<T>(
  runtime: FacetRuntimeForAgUi,
  key: string,
  task: () => Promise<T>,
): Promise<T> {
  let queue = runtimeVisitorQueues.get(runtime);
  if (queue === undefined) {
    queue = createSerialQueue<unknown>();
    runtimeVisitorQueues.set(runtime, queue);
  }
  return (await queue(key, task as () => Promise<unknown>)) as T;
}

async function authorizeDirectRunInput(
  input: RunAgentInput,
  options: RunFacetAsAgUiOptions,
): Promise<RunAgentInput> {
  const forwardedVisitor = forwardedVisitorFromRunAgentInput(input);
  if (options.authorizedVisitor !== undefined) {
    return withAuthorizedVisitor(input, options.authorizedVisitor);
  }
  if (options.resolveVisitor !== undefined) {
    const visitor = await options.resolveVisitor(visitorResolutionInput(input, forwardedVisitor));
    if (visitor === undefined) {
      throw new AgUiHttpInputError(403, "FORBIDDEN", "AG-UI visitor is not authorized");
    }
    return withAuthorizedVisitor(input, visitor);
  }
  if (options.allowForwardedVisitor === true) return input;
  throw new AgUiHttpInputError(403, "FORBIDDEN", "AG-UI visitor resolver required");
}

async function authorizeHttpRunInput(
  req: IncomingMessage,
  input: RunAgentInput,
  options: HandleAgUiRequestOptions,
): Promise<RunAgentInput> {
  const forwardedVisitor = forwardedVisitorFromRunAgentInput(input);
  if (options.resolveVisitor !== undefined) {
    const visitor = await options.resolveVisitor(
      req,
      visitorResolutionInput(input, forwardedVisitor),
    );
    if (visitor === undefined) {
      throw new AgUiHttpInputError(403, "FORBIDDEN", "AG-UI visitor is not authorized");
    }
    return withAuthorizedVisitor(input, visitor);
  }
  if (options.allowForwardedVisitor === true) return input;
  throw new AgUiHttpInputError(403, "FORBIDDEN", "AG-UI visitor resolver required");
}

async function authorizeHttpRunInputUntilOpen(
  req: IncomingMessage,
  input: RunAgentInput,
  options: HandleAgUiRequestOptions,
  closed: Promise<void>,
): Promise<RunAgentInput | undefined> {
  const authorization = authorizeHttpRunInput(req, input, options);
  const result = await Promise.race([
    authorization.then(
      (runInput) => ({ kind: "authorized" as const, runInput }),
      (error: unknown) => ({ kind: "error" as const, error }),
    ),
    closed.then(() => ({ kind: "closed" as const })),
  ]);

  if (result.kind === "closed") {
    void authorization.catch((error: unknown) => {
      logInternalFailure("authorization failed after response close", error);
    });
    return undefined;
  }
  if (result.kind === "error") throw result.error;
  return result.runInput;
}

function visitorResolutionInput(
  input: RunAgentInput,
  forwardedVisitor: VisitorContext | undefined,
): FacetAgUiVisitorResolutionInput {
  return {
    threadId: input.threadId,
    runId: input.runId,
    ...(input.parentRunId === undefined ? {} : { parentRunId: input.parentRunId }),
    ...(forwardedVisitor === undefined ? {} : { forwardedVisitor }),
  };
}

function forwardedVisitorFromRunAgentInput(input: RunAgentInput): VisitorContext | undefined {
  try {
    const forwardedProps: unknown = input.forwardedProps;
    if (!isObject(forwardedProps)) return undefined;
    const facet = forwardedProps["facet"];
    if (!isObject(facet)) return undefined;
    return normalizeVisitor(facet["visitor"]);
  } catch {
    return undefined;
  }
}

function withAuthorizedVisitor(input: RunAgentInput, visitor: VisitorContext): RunAgentInput {
  try {
    const forwardedProps: Record<string, unknown> = isObject(input.forwardedProps)
      ? input.forwardedProps
      : {};
    const facet: Record<string, unknown> = isObject(forwardedProps["facet"])
      ? forwardedProps["facet"]
      : {};
    const event = authorizedEventValue(facet["event"], visitor);
    return {
      ...input,
      forwardedProps: {
        ...forwardedProps,
        facet: {
          ...facet,
          visitor,
          ...(event === undefined ? {} : { event }),
        },
      },
    };
  } catch {
    throw new AgUiHttpInputError(400, "BAD_REQUEST", "Malformed Facet forwardedProps");
  }
}

function authorizedEventValue(event: unknown, visitor: VisitorContext): unknown {
  if (!isObject(event) || event["kind"] !== "visit") return event;
  return { ...event, visitor };
}

function appendTurnResult(
  events: AGUIEvent[],
  result: TurnResult,
  textState: TextMessageState,
  runInput: RunAgentInput,
  stageState: StageSnapshotState,
): void {
  appendServerMessages(events, result.messages, textState, runInput, stageState);
}

function appendServerMessages(
  events: AGUIEvent[],
  messages: readonly ServerMessage[],
  textState: TextMessageState,
  runInput: RunAgentInput,
  stageState: StageSnapshotState,
  context?: RuntimeFrameContext,
): void {
  let contextStageRead = false;
  let contextStage: FacetTree | undefined;
  const readContextStage = (): FacetTree | undefined => {
    if (!contextStageRead) {
      contextStageRead = true;
      contextStage = context?.stage;
      if (contextStage !== undefined) stageState.stage = contextStage;
    }
    return contextStage;
  };
  for (const message of messages) {
    if (message.kind === "say") {
      const messageId = `facet-${runInput.runId}-message-${String(textState.nextIndex)}`;
      textState.nextIndex += 1;
      events.push(...serverMessageToAgUiEvents(message, { messageId }));
    } else {
      const converted = serverMessageToAgUiEvents(message);
      if (message.kind === "patch" && message.patches.length > 0 && converted.length === 0) {
        if (readContextStage() === undefined) updateStageShadow(stageState, message);
        if (stageState.stage !== undefined)
          events.push(facetStageToStateSnapshot(stageState.stage));
      } else {
        if (message.kind === "patch" && readContextStage() === undefined) {
          updateStageShadow(stageState, message);
        }
        events.push(...converted);
      }
    }
  }
}

function updateStageShadow(stageState: StageSnapshotState, message: ServerMessage): void {
  if (message.kind !== "patch" || stageState.stage === undefined) return;
  stageState.stage = foldPatchIntoStage(stageState.stage, message.patches).tree;
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

  if (kind !== "tap") return undefined;
  if (value["action"] !== undefined) return undefined;
  const effect = optionalTapEffect(value);
  const fields = optionalFields(value);
  const target = optionalBoundedString(value, "target");
  if (effect === undefined || effect === null || fields === null || target === null) {
    return undefined;
  }

  return {
    kind,
    ...(target === undefined ? {} : { target }),
    effect,
    ...(fields === undefined ? {} : { fields }),
    ...(seq === undefined ? {} : { seq }),
  };
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
