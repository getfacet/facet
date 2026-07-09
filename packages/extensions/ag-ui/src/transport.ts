import { HttpAgent } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/core";
import { MAX_FIELD_VALUE_CHARS, MAX_FIELDS_KEYS } from "@facet/core";
import type {
  ClientEvent,
  CollectedEvent,
  FacetTransport,
  ServerMessage,
  TapEffect,
  VisitorContext,
} from "@facet/core";

import { AgUiServerMessageAccumulator } from "./events.js";

export interface AgUiObservableObserver<T> {
  next?(value: T): void;
  error?(error: unknown): void;
  complete?(): void;
}

export interface AgUiObservableSubscription {
  unsubscribe(): void;
}

export interface AgUiObservableLike<T> {
  subscribe(observer: AgUiObservableObserver<T>): AgUiObservableSubscription | (() => void) | void;
}

export type AgUiEventStream =
  AsyncIterable<BaseEvent> | Iterable<BaseEvent> | AgUiObservableLike<BaseEvent>;
export type AgUiRunResult = AgUiEventStream | Promise<AgUiEventStream>;
type FacetAgUiRecordBase = Omit<
  Extract<CollectedEvent, { readonly kind: "tap" }>,
  "action" | "effect" | "seq"
> & {
  readonly kind: "tap";
  readonly effect: TapEffect;
  readonly action?: never;
};
type FacetAgUiRecordSubmission = FacetAgUiRecordBase & {
  readonly seq?: number;
};
export type FacetAgUiRecordEvent = FacetAgUiRecordBase & {
  readonly seq: number;
};
export type FacetAgUiForwardedProps =
  | {
      readonly facet: {
        readonly visitor: VisitorContext;
        readonly event: ClientEvent & { readonly seq: number };
        readonly record?: never;
      };
    }
  | {
      readonly facet: {
        readonly visitor: VisitorContext;
        readonly event?: never;
        readonly record: FacetAgUiRecordEvent;
      };
    };
export type FacetAgUiRunInput = Omit<RunAgentInput, "forwardedProps" | "state"> & {
  readonly forwardedProps: FacetAgUiForwardedProps;
  readonly state: Record<string, never>;
};
export type AgUiRunFunction = (input: FacetAgUiRunInput) => AgUiRunResult;

export interface AgUiAgentLike {
  run(input: FacetAgUiRunInput): AgUiRunResult;
}

export interface AgUiAbortableAgentLike extends AgUiAgentLike {
  abortRun(): void;
}

export interface AgUiTransportOptions {
  readonly visitor: VisitorContext;
  readonly threadId?: string;
  readonly runId?: () => string;
  readonly runTimeoutMs?: number | false;
  readonly maxQueue?: number;
}

export interface CreateHttpAgUiTransportOptions extends AgUiTransportOptions {
  readonly headers?: Record<string, string>;
  readonly fetch?: (url: string, requestInit: RequestInit) => Promise<Response>;
}

type AgUiTransportSource =
  AgUiAbortableAgentLike | AgUiAgentLike | AgUiRunFunction | AgUiEventStream;
type Submission =
  | { readonly kind: "event"; readonly value: ClientEvent }
  | { readonly kind: "record"; readonly value: FacetAgUiRecordSubmission };

const DEFAULT_RUN_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_QUEUE = 100;
const SYNC_ITERABLE_YIELD_EVERY = 64;
type HttpAgentConfig = ConstructorParameters<typeof HttpAgent>[0];

interface RunState {
  active: boolean;
  readonly accumulator: AgUiServerMessageAccumulator;
  readonly silent: boolean;
  cancel?: () => void;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    isObject(value) &&
    typeof (value as { readonly [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] ===
      "function"
  );
}

function isIterable(value: unknown): value is Iterable<unknown> {
  return (
    isObject(value) &&
    typeof (value as { readonly [Symbol.iterator]?: unknown })[Symbol.iterator] === "function"
  );
}

function isObservableLike(value: unknown): value is AgUiObservableLike<unknown> {
  return (
    isObject(value) && typeof (value as { readonly subscribe?: unknown }).subscribe === "function"
  );
}

function isAgentLike(value: unknown): value is AgUiAgentLike {
  return isObject(value) && typeof (value as { readonly run?: unknown }).run === "function";
}

function isAbortableAgentLike(value: unknown): value is AgUiAbortableAgentLike {
  return (
    isAgentLike(value) && typeof (value as { readonly abortRun?: unknown }).abortRun === "function"
  );
}

function runFunctionFor(source: AgUiTransportSource): AgUiRunFunction {
  if (typeof source === "function") return source;
  if (isAgentLike(source)) return (input) => source.run(input);
  return () => source;
}

function withSeq<T extends ClientEvent | FacetAgUiRecordSubmission>(
  event: T,
  seq: number,
): T & { readonly seq: number } {
  return { ...event, seq };
}

function fallbackRunId(seq: number): string {
  return `facet-run-${seq}`;
}

/**
 * Browser-safe Facet transport over an AG-UI agent stream.
 *
 * Client submissions are serialized through one promise chain, stamped with a
 * local monotonic Facet seq, and encoded under forwardedProps.facet. AG-UI state
 * and custom events are converted back to native Facet ServerMessage values.
 */
export class AgUiTransport implements FacetTransport {
  private readonly listeners = new Set<(message: ServerMessage) => void>();
  private readonly run: AgUiRunFunction;
  private readonly abortSourceRun: (() => void) | undefined;
  private readonly threadId: string;
  private runChain: Promise<void> = Promise.resolve();
  private pendingRuns = 0;
  private seq = 0;
  private runSeq = 0;

  constructor(
    source: AgUiTransportSource,
    private readonly options: AgUiTransportOptions,
  ) {
    this.run = runFunctionFor(source);
    this.abortSourceRun = isAbortableAgentLike(source) ? () => source.abortRun() : undefined;
    this.threadId = options.threadId ?? `facet-${options.visitor.visitorId}`;
  }

  send(event: ClientEvent): void {
    this.enqueue({ kind: "event", value: event });
  }

  record(event: CollectedEvent): void {
    let record: FacetAgUiRecordSubmission | undefined;
    try {
      if (isLocalTapRecord(event)) record = event;
    } catch {
      record = undefined;
    }
    if (record === undefined) {
      console.error("[facet/ag-ui] record dropped: unsupported record event");
      return;
    }
    this.enqueue({ kind: "record", value: record });
  }

  subscribe(onMessage: (message: ServerMessage) => void): () => void {
    this.listeners.add(onMessage);
    return () => {
      this.listeners.delete(onMessage);
    };
  }

  private enqueue(submission: Submission): void {
    const maxQueue = this.options.maxQueue ?? DEFAULT_MAX_QUEUE;
    if (this.pendingRuns >= maxQueue) {
      const label = submission.kind === "record" ? "record" : "event";
      console.error(`[facet/ag-ui] ${label} run dropped: queue limit reached`);
      return;
    }
    this.pendingRuns += 1;
    this.runChain = this.runChain
      .then(() => this.runSubmission(submission))
      .catch(() => {
        const label = submission.kind === "record" ? "record" : "event";
        console.error(`[facet/ag-ui] ${label} run failed`);
      })
      .finally(() => {
        this.pendingRuns -= 1;
      });
  }

  private async runSubmission(submission: Submission): Promise<void> {
    this.seq += 1;
    const seq = this.seq;
    const forwarded: FacetAgUiForwardedProps =
      submission.kind === "event"
        ? { facet: { visitor: this.options.visitor, event: withSeq(submission.value, seq) } }
        : { facet: { visitor: this.options.visitor, record: withSeq(submission.value, seq) } };

    const runState: RunState = {
      active: true,
      accumulator: new AgUiServerMessageAccumulator(),
      silent: submission.kind === "record",
    };
    try {
      const input: FacetAgUiRunInput = {
        threadId: this.threadId,
        runId: this.nextRunId(),
        state: {},
        messages: [],
        tools: [],
        context: [],
        forwardedProps: forwarded,
      };
      await this.consumeRunResult(this.run(input), runState);
    } finally {
      if (runState.active) this.emitAll(runState.accumulator.flush());
      else runState.accumulator.discard();
      runState.active = false;
      this.cancelRun(runState);
    }
  }

  private runInputTimeoutMs(): number | false {
    return this.options.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
  }

  private async withRunTimeout(runState: RunState, consume: Promise<void>): Promise<void> {
    const timeoutMs = this.runInputTimeoutMs();
    if (timeoutMs === false) {
      await consume;
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        runState.active = false;
        this.abortActiveRun();
        this.cancelRun(runState);
        reject(new Error(`AG-UI run timed out after ${String(timeoutMs)}ms`));
      }, timeoutMs);
    });

    try {
      await Promise.race([consume, timeout]);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (timedOut) consume.catch(() => undefined);
    }
  }

  private nextRunId(): string {
    this.runSeq += 1;
    return this.options.runId?.() ?? fallbackRunId(this.runSeq);
  }

  private async consumeRunResult(result: AgUiRunResult, runState: RunState): Promise<void> {
    await this.withRunTimeout(runState, this.consumeRunResultWithoutTimeout(result, runState));
  }

  private async consumeRunResultWithoutTimeout(
    result: AgUiRunResult,
    runState: RunState,
  ): Promise<void> {
    const stream = await result;
    if (!runState.active) return;
    if (isAsyncIterable(stream)) {
      const iterator = stream[Symbol.asyncIterator]();
      runState.cancel = () => {
        try {
          const returned = iterator.return?.();
          if (returned !== undefined) {
            void Promise.resolve(returned).catch((error: unknown) => {
              this.logCleanupFailure(error);
            });
          }
        } catch (error: unknown) {
          this.logCleanupFailure(error);
        }
      };
      while (runState.active) {
        const next = await iterator.next();
        if (!runState.active) break;
        if (next.done === true) break;
        this.handleAgUiEvent(next.value, runState);
      }
      return;
    }
    if (isIterable(stream)) {
      await this.consumeIterable(stream, runState);
      return;
    }
    if (isObservableLike(stream)) {
      await this.consumeObservable(stream, runState);
    }
  }

  private async consumeIterable(stream: Iterable<unknown>, runState: RunState): Promise<void> {
    const timeoutMs = this.runInputTimeoutMs();
    const deadline = timeoutMs === false ? Number.POSITIVE_INFINITY : Date.now() + timeoutMs;
    const iterator = stream[Symbol.iterator]();
    let processed = 0;
    let completed = false;

    try {
      while (runState.active) {
        if (Date.now() >= deadline) {
          runState.active = false;
          throw new Error(`AG-UI run timed out after ${String(timeoutMs)}ms`);
        }
        const next = iterator.next();
        if (next.done === true) {
          completed = true;
          break;
        }
        if (Date.now() >= deadline) {
          runState.active = false;
          throw new Error(`AG-UI run timed out after ${String(timeoutMs)}ms`);
        }

        if (!runState.active) break;
        this.handleAgUiEvent(next.value, runState);
        processed += 1;
        if (processed % SYNC_ITERABLE_YIELD_EVERY === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
    } finally {
      if (!completed) {
        try {
          iterator.return?.();
        } catch (error: unknown) {
          this.logCleanupFailure(error);
        }
      }
    }
  }

  private consumeObservable(
    stream: AgUiObservableLike<unknown>,
    runState: RunState,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let unsubscribe: (() => void) | undefined;
      const cleanup = (): void => {
        if (unsubscribe !== undefined) {
          const release = unsubscribe;
          unsubscribe = undefined;
          try {
            release();
          } catch (error: unknown) {
            this.logCleanupFailure(error);
          }
        }
      };
      const settle = (done: () => void): void => {
        if (settled) return;
        settled = true;
        cleanup();
        done();
      };

      const subscription = stream.subscribe({
        next: (event) => {
          if (runState.active) this.handleAgUiEvent(event, runState);
        },
        error: (error) => settle(() => reject(error)),
        complete: () => settle(resolve),
      });
      unsubscribe =
        typeof subscription === "function" ? subscription : () => subscription?.unsubscribe();
      runState.cancel = cleanup;
      if (settled) cleanup();
      if (settled || !runState.active) settle(resolve);
    });
  }

  private cancelRun(runState: RunState): void {
    const cancel = runState.cancel;
    delete runState.cancel;
    try {
      cancel?.();
    } catch (error: unknown) {
      this.logCleanupFailure(error);
    }
  }

  private abortActiveRun(): void {
    try {
      this.abortSourceRun?.();
    } catch (error: unknown) {
      this.logCleanupFailure(error);
    }
  }

  private logCleanupFailure(error: unknown): void {
    const errorKind = error instanceof Error ? error.name : typeof error;
    console.error(`[facet/ag-ui] run cleanup failed: ${errorKind}`);
  }

  private handleAgUiEvent(event: unknown, runState: RunState): void {
    try {
      if (runState.silent) return;
      this.emitAll(runState.accumulator.accept(event));
    } catch {
      // Malformed AG-UI input is ignored; Facet renderers only see narrowed native messages.
    }
  }

  private emit(message: ServerMessage): void {
    for (const listener of this.listeners) {
      listener(message);
    }
  }

  private emitAll(messages: readonly ServerMessage[]): void {
    for (const message of messages) this.emit(message);
  }
}

export function createHttpAgUiTransport(
  url: string,
  options: CreateHttpAgUiTransportOptions,
): AgUiTransport {
  const agentConfig: HttpAgentConfig = {
    url,
    ...(options.headers === undefined ? {} : { headers: options.headers }),
    fetch: normalizeAgUiFetch(options.fetch),
  };
  return new AgUiTransport(new PerRunHttpAgentSource(agentConfig), options);
}

class PerRunHttpAgentSource implements AgUiAbortableAgentLike {
  private activeAgent: HttpAgent | undefined;

  constructor(private readonly config: HttpAgentConfig) {}

  run(input: FacetAgUiRunInput): AgUiRunResult {
    const agent = new HttpAgent(this.config);
    this.activeAgent = agent;
    return agent.run(input);
  }

  abortRun(): void {
    this.activeAgent?.abortRun();
    this.activeAgent = undefined;
  }
}

function normalizeAgUiFetch(
  fetchImpl: CreateHttpAgUiTransportOptions["fetch"],
): (url: string, requestInit: RequestInit) => Promise<Response> {
  const runFetch = fetchImpl ?? ((requestUrl, requestInit) => fetch(requestUrl, requestInit));
  return async (requestUrl, requestInit) => {
    const response = await runFetch(requestUrl, requestInit);
    if (response.ok || !isEventStreamResponse(response)) return response;
    return new Response(response.body, {
      status: 200,
      statusText: "OK",
      headers: response.headers,
    });
  };
}

function isEventStreamResponse(response: Response): boolean {
  return response.headers.get("Content-Type")?.toLowerCase().includes("text/event-stream") === true;
}

function isLocalTapRecord(event: CollectedEvent): event is FacetAgUiRecordSubmission {
  if (event.kind !== "tap") return false;
  if (event.action !== undefined) return false;
  if (event.effect === undefined || !isTapEffect(event.effect)) return false;
  if (event.target !== undefined && !isBoundedString(event.target)) return false;
  if (event.fields !== undefined && !isFieldsRecord(event.fields)) return false;
  if (event.seq !== undefined && !Number.isFinite(event.seq)) return false;
  return true;
}

function isTapEffect(effect: unknown): boolean {
  if (!isObject(effect)) return false;
  const navigate = effect["navigate"];
  const toggle = effect["toggle"];
  if (navigate !== undefined) {
    return isBoundedString(navigate) && toggle === undefined;
  }
  if (toggle !== undefined) {
    return isBoundedString(toggle) && navigate === undefined;
  }
  return false;
}

function isFieldsRecord(fields: unknown): boolean {
  if (!isObject(fields) || Array.isArray(fields)) return false;
  const entries = Object.entries(fields);
  if (entries.length > MAX_FIELDS_KEYS) return false;
  return entries.every(
    ([key, value]) =>
      isBoundedString(key) &&
      (typeof value === "boolean" || (typeof value === "string" && isBoundedString(value))),
  );
}

function isBoundedString(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_FIELD_VALUE_CHARS;
}
