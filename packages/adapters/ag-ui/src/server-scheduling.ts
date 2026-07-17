import type { RunAgentInput } from "@ag-ui/core";
import { createSerialQueue } from "@facet/core";
import type { CollectedEvent, VisitorContext } from "@facet/core";

import { forwardedVisitorFromRunAgentInput } from "./server-input.js";
import {
  AgUiHttpInputError,
  DEFAULT_MAX_IN_FLIGHT_RUNS,
  DEFAULT_SNAPSHOT_TIMEOUT_MS,
  logInternalFailure,
  type FacetRuntimeForAgUi,
  type HandleAgUiRequestOptions,
  type AgUiRuntimeExecutionOptions,
  type RunFacetAsAgUiOptions,
} from "./server-types.js";

const runtimeRunCounts = new WeakMap<object, number>();
const runtimeVisitorQueues = new WeakMap<
  object,
  (key: string, task: () => Promise<unknown>) => Promise<unknown>
>();
const runtimeQueuedRunCounts = new WeakMap<object, Map<string, number>>();

export function acquireRuntimeRun(
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

export function acquireRuntimeQueuedRun(
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

export async function withSnapshotTimeout<T>(
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

export function pendingWorkForTimeout(error: unknown): Promise<unknown> | undefined {
  return error instanceof AgUiRunTimeoutError ? error.pendingWork : undefined;
}

export function releaseRuntimeRun(releaseRun: () => void, releaseAfter?: Promise<unknown>): void {
  if (releaseAfter === undefined) {
    releaseRun();
    return;
  }
  void releaseAfter.finally(releaseRun);
}

export function recordWithoutThrow(
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

export function runtimeErrorCode(error: unknown): string {
  return error instanceof AgUiRunTimeoutError ? "RUNTIME_TIMEOUT" : "RUNTIME_ERROR";
}

export async function withRuntimeVisitorRun<T>(
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

export async function withRuntimeAuthorizationRun<T>(
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
