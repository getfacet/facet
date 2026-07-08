import { HttpAgent } from "@ag-ui/client";
import { EventType } from "@ag-ui/core";
import type { RunAgentInput } from "@ag-ui/core";
import type { ClientEvent, CollectedEvent, FacetTransport, ServerMessage, VisitorContext } from "@facet/core";

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
  subscribe(
    observer: AgUiObservableObserver<T>,
  ): AgUiObservableSubscription | (() => void) | void;
}

export type AgUiEventStream = AsyncIterable<unknown> | Iterable<unknown> | AgUiObservableLike<unknown>;
export type AgUiRunResult = AgUiEventStream | Promise<AgUiEventStream>;
export type AgUiRunFunction = (input: RunAgentInput) => AgUiRunResult;

export interface AgUiAgentLike {
  run(input: RunAgentInput): AgUiRunResult;
}

export interface AgUiTransportOptions {
  readonly visitor: VisitorContext;
  readonly threadId?: string;
  readonly runId?: () => string;
}

export interface CreateHttpAgUiTransportOptions extends AgUiTransportOptions {
  readonly headers?: Record<string, string>;
  readonly fetch?: (url: string, requestInit: RequestInit) => Promise<Response>;
}

type AgUiTransportSource = AgUiAgentLike | AgUiRunFunction | AgUiEventStream;
type Submission =
  | { readonly kind: "event"; readonly value: ClientEvent }
  | { readonly kind: "record"; readonly value: CollectedEvent };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    isObject(value) &&
    typeof (value as { readonly [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function"
  );
}

function isIterable(value: unknown): value is Iterable<unknown> {
  return (
    isObject(value) &&
    typeof (value as { readonly [Symbol.iterator]?: unknown })[Symbol.iterator] === "function"
  );
}

function isObservableLike(value: unknown): value is AgUiObservableLike<unknown> {
  return isObject(value) && typeof (value as { readonly subscribe?: unknown }).subscribe === "function";
}

function isAgentLike(value: unknown): value is AgUiAgentLike {
  return isObject(value) && typeof (value as { readonly run?: unknown }).run === "function";
}

function runFunctionFor(source: AgUiTransportSource): AgUiRunFunction {
  if (typeof source === "function") return source;
  if (isAgentLike(source)) return (input) => source.run(input);
  return () => source;
}

function withSeq<T extends ClientEvent | CollectedEvent>(event: T, seq: number): T & { readonly seq: number } {
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
  private readonly textBuffers = new Map<string, string[]>();
  private runChain: Promise<void> = Promise.resolve();
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
    this.runChain = this.runChain
      .then(() => this.runSubmission(submission))
      .catch((error: unknown) => {
        const label = submission.kind === "record" ? "record" : "event";
        console.error(`[facet/ag-ui] ${label} run failed:`, error);
      });
  }

  private async runSubmission(submission: Submission): Promise<void> {
    this.seq += 1;
    const seq = this.seq;
    const forwarded =
      submission.kind === "event"
        ? { facet: { visitor: this.options.visitor, event: withSeq(submission.value, seq) } }
        : { facet: { visitor: this.options.visitor, record: withSeq(submission.value, seq) } };

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
    );
  }

  private nextRunId(): string {
    this.runSeq += 1;
    return this.options.runId?.() ?? fallbackRunId(this.runSeq);
  }

  private async consumeRunResult(result: AgUiRunResult): Promise<void> {
    const stream = await result;
    if (isAsyncIterable(stream)) {
      for await (const event of stream) {
        this.handleAgUiEvent(event);
      }
      return;
    }
    if (isIterable(stream)) {
      for (const event of stream) {
        this.handleAgUiEvent(event);
      }
      return;
    }
    if (isObservableLike(stream)) {
      await this.consumeObservable(stream);
    }
  }

  private consumeObservable(stream: AgUiObservableLike<unknown>): Promise<void> {
    return new Promise((resolve, reject) => {
      stream.subscribe({
        next: (event) => this.handleAgUiEvent(event),
        error: reject,
        complete: resolve,
      });
    });
  }

  private handleAgUiEvent(event: unknown): void {
    try {
      if (this.handleTextEvent(event)) return;
      for (const message of agUiEventToServerMessages(event)) {
        this.emit(message);
      }
    } catch {
      // Malformed AG-UI input is ignored; Facet renderers only see narrowed native messages.
    }
  }

  private handleTextEvent(event: unknown): boolean {
    if (!isObject(event)) return false;
    switch (event["type"]) {
      case EventType.TEXT_MESSAGE_START:
        this.startTextMessage(event["messageId"]);
        return true;
      case EventType.TEXT_MESSAGE_CONTENT:
        this.appendTextMessage(event["messageId"], event["delta"]);
        return true;
      case EventType.TEXT_MESSAGE_END:
        this.endTextMessage(event["messageId"]);
        return true;
      default:
        return false;
    }
  }

  private startTextMessage(messageId: unknown): void {
    if (typeof messageId !== "string") return;
    this.textBuffers.set(messageId, []);
  }

  private appendTextMessage(messageId: unknown, delta: unknown): void {
    if (typeof messageId !== "string" || typeof delta !== "string") return;
    const buffer = this.textBuffers.get(messageId);
    if (buffer === undefined) return;
    buffer.push(delta);
  }

  private endTextMessage(messageId: unknown): void {
    if (typeof messageId !== "string") return;
    const buffer = this.textBuffers.get(messageId);
    if (buffer === undefined) return;
    this.textBuffers.delete(messageId);
    this.emit({ kind: "say", text: buffer.join("") });
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
