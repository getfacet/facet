import type { ServerMessage } from "@facet/core";
import {
  REDACTED_SENSITIVE_VALUE,
  redactSensitiveText,
  shouldRedactSensitiveField,
} from "@facet/runtime";

import type { ProviderUsage } from "../provider.js";

export type ReferenceAgentDiagnosticEvent =
  | { readonly kind: "provider-attempt"; readonly attempt: number }
  | {
      readonly kind: "tool-call";
      readonly callId: string;
      readonly name: string;
      readonly input: unknown;
      readonly truncated: boolean;
    }
  | {
      readonly kind: "tool-result";
      readonly callId: string;
      readonly observation: unknown;
      readonly messages: readonly ServerMessage[];
      readonly mutated: boolean;
      readonly said: boolean;
      readonly truncated: boolean;
    }
  | {
      readonly kind: "batch";
      readonly callIds: readonly string[];
      readonly usage?: ProviderUsage;
    }
  | { readonly kind: "overflow"; readonly dropped: number }
  | {
      readonly kind: "stop";
      readonly reason: "complete" | "budget" | "aborted" | "provider-error" | "invalid-output";
    };

export type ReferenceAgentDiagnosticObserver = (event: ReferenceAgentDiagnosticEvent) => void;

/** A per-agent-run emission function. Raw values are projected before the observer sees them. */
export type ReferenceAgentDiagnosticEmitter = (event: ReferenceAgentDiagnosticEvent) => void;

type DiagnosticStopReason = Extract<
  ReferenceAgentDiagnosticEvent,
  { readonly kind: "stop" }
>["reason"];

const MAX_DIAGNOSTIC_DEPTH = 8;
const MAX_DIAGNOSTIC_ENTRIES = 512;
const MAX_DIAGNOSTIC_STRING_CHARS = 64 * 1024;
const MAX_DIAGNOSTIC_EVENT_BYTES = 1024 * 1024;
const MAX_DIAGNOSTIC_EVENTS = 10_000;
const MAX_DIAGNOSTIC_COUNT = 1_000_000_000;
const TRUNCATED = "[truncated]";
const CIRCULAR = "[circular]";
const UNSUPPORTED = "[unsupported]";

interface ProjectionState {
  entries: number;
  truncated: boolean;
  readonly seen: WeakSet<object>;
}

interface Projection {
  readonly value: unknown;
  readonly truncated: boolean;
}

/**
 * Wrap one opt-in observer for one agent run. Delivery is synchronous, bounded,
 * detached, deeply frozen, and non-controlling. After 10,000 ordinary events,
 * exactly one overflow notice is delivered and all later events are ignored.
 */
export function createReferenceAgentDiagnosticEmitter(
  observer: ReferenceAgentDiagnosticObserver | undefined,
): ReferenceAgentDiagnosticEmitter {
  let emitted = 0;
  let overflowed = false;

  return (event) => {
    if (observer === undefined) return;
    if (emitted >= MAX_DIAGNOSTIC_EVENTS) {
      if (!overflowed) {
        overflowed = true;
        invokeObserver(observer, deepFreeze({ kind: "overflow", dropped: 1 }));
      }
      return;
    }

    emitted += 1;
    const sanitized = sanitizeDiagnosticEvent(event);
    if (sanitized.kind === "overflow") {
      if (overflowed) return;
      overflowed = true;
    }
    invokeObserver(observer, sanitized);
  };
}

function sanitizeDiagnosticEvent(
  event: ReferenceAgentDiagnosticEvent,
): ReferenceAgentDiagnosticEvent {
  try {
    const sanitized = sanitizeKnownDiagnosticEvent(event);
    const bounded = boundEncodedEvent(sanitized);
    return deepFreeze(bounded);
  } catch {
    return deepFreeze({ kind: "overflow", dropped: 1 });
  }
}

function sanitizeKnownDiagnosticEvent(
  event: ReferenceAgentDiagnosticEvent,
): ReferenceAgentDiagnosticEvent {
  switch (event.kind) {
    case "provider-attempt":
      return { kind: "provider-attempt", attempt: safeCount(event.attempt) };
    case "tool-call": {
      const input = projectDiagnosticValue(event.input);
      const callId = projectDiagnosticString(event.callId);
      const name = projectDiagnosticString(event.name);
      return {
        kind: "tool-call",
        callId: callId.value,
        name: name.value,
        input: input.value,
        truncated: event.truncated || callId.truncated || name.truncated || input.truncated,
      };
    }
    case "tool-result": {
      const state = createProjectionState();
      const callId = projectString(event.callId, state);
      const observation = projectValue(event.observation, 0, state);
      const messages = projectValue(event.messages, 0, state);
      return {
        kind: "tool-result",
        callId,
        observation,
        messages: isServerMessageArray(messages) ? messages : [],
        mutated: event.mutated === true,
        said: event.said === true,
        truncated: event.truncated || state.truncated || !isServerMessageArray(messages),
      };
    }
    case "batch":
      return {
        kind: "batch",
        callIds: sanitizeCallIds(event.callIds),
        ...(event.usage === undefined ? {} : { usage: sanitizeUsage(event.usage) }),
      };
    case "overflow":
      return { kind: "overflow", dropped: Math.max(1, safeCount(event.dropped)) };
    case "stop":
      return { kind: "stop", reason: sanitizeStopReason(event.reason) };
  }
}

function sanitizeCallIds(callIds: readonly string[]): readonly string[] {
  const truncated = callIds.length > MAX_DIAGNOSTIC_ENTRIES;
  const retained = callIds
    .slice(0, truncated ? MAX_DIAGNOSTIC_ENTRIES - 1 : MAX_DIAGNOSTIC_ENTRIES)
    .map((callId) => projectDiagnosticString(callId).value);
  return truncated ? [...retained, TRUNCATED] : retained;
}

function projectDiagnosticValue(value: unknown): Projection {
  const state = createProjectionState();
  return { value: projectValue(value, 0, state), truncated: state.truncated };
}

function projectDiagnosticString(value: string): {
  readonly value: string;
  readonly truncated: boolean;
} {
  const state = createProjectionState();
  return { value: projectString(value, state), truncated: state.truncated };
}

function createProjectionState(): ProjectionState {
  return { entries: 0, truncated: false, seen: new WeakSet<object>() };
}

function projectValue(value: unknown, depth: number, state: ProjectionState): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return projectString(value, state);
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    state.truncated = true;
    return UNSUPPORTED;
  }
  if (typeof value !== "object") {
    state.truncated = true;
    return UNSUPPORTED;
  }
  if (depth >= MAX_DIAGNOSTIC_DEPTH) {
    state.truncated = true;
    return TRUNCATED;
  }
  if (state.seen.has(value)) {
    state.truncated = true;
    return CIRCULAR;
  }

  state.seen.add(value);
  try {
    return Array.isArray(value)
      ? projectArray(value, depth, state)
      : projectRecord(value, depth, state);
  } finally {
    state.seen.delete(value);
  }
}

function projectArray(value: readonly unknown[], depth: number, state: ProjectionState): unknown[] {
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const projected: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!reserveEntry(state)) break;
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined || !("value" in descriptor)) {
      state.truncated = true;
      projected.push(UNSUPPORTED);
      continue;
    }
    projected.push(projectValue(descriptor.value, depth + 1, state));
  }
  if (projected.length < value.length) state.truncated = true;
  return projected;
}

function projectRecord(
  value: object,
  depth: number,
  state: ProjectionState,
): Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    state.truncated = true;
    return { value: UNSUPPORTED };
  }

  const projected: Record<string, unknown> = {};
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [rawKey, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable) continue;
    if (!reserveEntry(state)) break;
    const key = projectPropertyKey(rawKey, state);
    if (!("value" in descriptor)) {
      state.truncated = true;
      defineProjectedProperty(projected, key, UNSUPPORTED);
      continue;
    }
    const child = shouldRedactSensitiveField(rawKey, descriptor.value)
      ? REDACTED_SENSITIVE_VALUE
      : projectValue(descriptor.value, depth + 1, state);
    defineProjectedProperty(projected, key, child);
  }
  return projected;
}

function reserveEntry(state: ProjectionState): boolean {
  if (state.entries >= MAX_DIAGNOSTIC_ENTRIES) {
    state.truncated = true;
    return false;
  }
  state.entries += 1;
  return true;
}

function projectPropertyKey(key: string, state: ProjectionState): string {
  return projectString(key, state);
}

function defineProjectedProperty(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function projectString(value: string, state: ProjectionState): string {
  const redacted = redactSensitiveText(value);
  if (
    value.length <= MAX_DIAGNOSTIC_STRING_CHARS &&
    redacted.length <= MAX_DIAGNOSTIC_STRING_CHARS
  ) {
    return redacted;
  }
  state.truncated = true;
  return `${redacted.slice(0, MAX_DIAGNOSTIC_STRING_CHARS - TRUNCATED.length)}${TRUNCATED}`;
}

function boundEncodedEvent(event: ReferenceAgentDiagnosticEvent): ReferenceAgentDiagnosticEvent {
  if (encodedBytes(event) <= MAX_DIAGNOSTIC_EVENT_BYTES) return event;
  switch (event.kind) {
    case "tool-call":
      return { ...event, input: TRUNCATED, truncated: true };
    case "tool-result":
      return { ...event, observation: TRUNCATED, messages: [], truncated: true };
    case "batch":
      return { ...event, callIds: [TRUNCATED] };
    default:
      return event;
  }
}

function sanitizeUsage(usage: ProviderUsage): ProviderUsage {
  return {
    ...(usage.inputTokens === undefined ? {} : { inputTokens: safeCount(usage.inputTokens) }),
    ...(usage.outputTokens === undefined ? {} : { outputTokens: safeCount(usage.outputTokens) }),
  };
}

function sanitizeStopReason(reason: DiagnosticStopReason): DiagnosticStopReason {
  switch (reason) {
    case "complete":
    case "budget":
    case "aborted":
    case "provider-error":
      return reason;
    default:
      return "invalid-output";
  }
}

function safeCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_DIAGNOSTIC_COUNT, Math.floor(value)));
}

function encodedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function isServerMessageArray(value: unknown): value is ServerMessage[] {
  return Array.isArray(value);
}

function deepFreeze<Value>(value: Value): Value {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function invokeObserver(
  observer: ReferenceAgentDiagnosticObserver,
  event: ReferenceAgentDiagnosticEvent,
): void {
  try {
    const result: unknown = observer(event);
    if (isPromiseLike(result)) void Promise.resolve(result).catch(() => undefined);
  } catch {
    // Diagnostics are opt-in evidence only and must never alter the agent turn.
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}
