import { HttpAgent } from "@ag-ui/client";
import { EventType } from "@ag-ui/core";
import type { BaseEvent, RunAgentInput } from "@ag-ui/core";
import type {
  ClientEvent,
  CollectedEvent,
  FacetTransport,
  ServerMessage,
  VisitorContext,
} from "@facet/core";

import { agUiEventToServerMessages } from "./events.js";

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
export type AgUiRunFunction = (input: RunAgentInput) => AgUiRunResult;

export interface AgUiAgentLike {
  run(input: RunAgentInput): AgUiRunResult;
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

type AgUiTransportSource = AgUiAgentLike | AgUiRunFunction | AgUiEventStream;
type Submission =
  | { readonly kind: "event"; readonly value: ClientEvent }
  | { readonly kind: "record"; readonly value: CollectedEvent };

const DEFAULT_RUN_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_QUEUE = 100;

interface RunState {
  active: boolean;
  readonly textBuffers: Map<string, TextMessageBuffer>;
  readonly textOrder: string[];
  cancel?: () => void;
}

interface TextMessageBuffer {
  readonly parts: string[];
  complete: boolean;
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

function runFunctionFor(source: AgUiTransportSource): AgUiRunFunction {
  if (typeof source === "function") return source;
  if (isAgentLike(source)) return (input) => source.run(input);
  return () => source;
}

function withSeq<T extends ClientEvent | CollectedEvent>(
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
    this.threadId = options.threadId ?? `facet-${options.visitor.visitorId}`;
  }

  send(event: ClientEvent): void {
    this.enqueue({ kind: "event", value: event });
  }

  record(event: CollectedEvent): void {
    this.enqueue({ kind: "record", value: event });
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
      .catch((error: unknown) => {
        const label = submission.kind === "record" ? "record" : "event";
        console.error(`[facet/ag-ui] ${label} run failed:`, error);
      })
      .finally(() => {
        this.pendingRuns -= 1;
      });
  }

  private async runSubmission(submission: Submission): Promise<void> {
    this.seq += 1;
    const seq = this.seq;
    const forwarded =
      submission.kind === "event"
        ? { facet: { visitor: this.options.visitor, event: withSeq(submission.value, seq) } }
        : { facet: { visitor: this.options.visitor, record: withSeq(submission.value, seq) } };

    const runState: RunState = { active: true, textBuffers: new Map(), textOrder: [] };
    try {
      await this.consumeRunResult(
        this.run({
          threadId: this.threadId,
          runId: this.nextRunId(),
          state: {},
          messages: [],
          tools: [],
          context: [],
          forwardedProps: forwarded,
        }),
        runState,
      );
    } finally {
      runState.active = false;
      runState.cancel?.();
      runState.textBuffers.clear();
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
        runState.cancel?.();
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
        void iterator.return?.();
      };
      while (runState.active) {
        const next = await iterator.next();
        if (next.done === true) break;
        this.handleAgUiEvent(next.value, runState);
      }
      return;
    }
    if (isIterable(stream)) {
      for (const event of stream) {
        if (!runState.active) break;
        this.handleAgUiEvent(event, runState);
      }
      return;
    }
    if (isObservableLike(stream)) {
      await this.consumeObservable(stream, runState);
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
          release();
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

  private handleAgUiEvent(event: unknown, runState: RunState): void {
    try {
      if (this.handleTextEvent(event, runState)) return;
      for (const message of agUiEventToServerMessages(event)) {
        this.emit(message);
      }
    } catch {
      // Malformed AG-UI input is ignored; Facet renderers only see narrowed native messages.
    }
  }

  private handleTextEvent(event: unknown, runState: RunState): boolean {
    if (!isObject(event)) return false;
    switch (event["type"]) {
      case EventType.TEXT_MESSAGE_START:
        this.startTextMessage(event["messageId"], runState);
        return true;
      case EventType.TEXT_MESSAGE_CONTENT:
        this.appendTextMessage(event["messageId"], event["delta"], runState);
        return true;
      case EventType.TEXT_MESSAGE_END:
        this.endTextMessage(event["messageId"], runState);
        return true;
      default:
        return false;
    }
  }

  private startTextMessage(messageId: unknown, runState: RunState): void {
    if (typeof messageId !== "string") return;
    if (!runState.textBuffers.has(messageId)) runState.textOrder.push(messageId);
    runState.textBuffers.set(messageId, { parts: [], complete: false });
  }

  private appendTextMessage(messageId: unknown, delta: unknown, runState: RunState): void {
    if (typeof messageId !== "string" || typeof delta !== "string") return;
    const buffer = runState.textBuffers.get(messageId);
    if (buffer === undefined) return;
    buffer.parts.push(delta);
  }

  private endTextMessage(messageId: unknown, runState: RunState): void {
    if (typeof messageId !== "string") return;
    const buffer = runState.textBuffers.get(messageId);
    if (buffer === undefined) return;
    buffer.complete = true;
    this.flushCompletedTextMessages(runState);
  }

  private flushCompletedTextMessages(runState: RunState): void {
    while (runState.textOrder.length > 0) {
      const messageId = runState.textOrder[0];
      if (messageId === undefined) return;
      const buffer = runState.textBuffers.get(messageId);
      if (buffer === undefined) {
        runState.textOrder.shift();
        continue;
      }
      if (!buffer.complete) return;
      runState.textOrder.shift();
      runState.textBuffers.delete(messageId);
      this.emit({ kind: "say", text: buffer.parts.join("") });
    }
  }

  private emit(message: ServerMessage): void {
    for (const listener of this.listeners) {
      listener(message);
    }
  }
}

export function createHttpAgUiTransport(
  url: string,
  options: CreateHttpAgUiTransportOptions,
): AgUiTransport {
  const agentConfig: ConstructorParameters<typeof HttpAgent>[0] = {
    url,
    ...(options.headers === undefined ? {} : { headers: options.headers }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  };
  return new AgUiTransport(new HttpAgent(agentConfig), options);
}
