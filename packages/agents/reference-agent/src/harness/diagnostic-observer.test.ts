import type { StageToolBuffer, StageToolBufferOutcome } from "@facet/agent-tools";
import { EMPTY_TREE } from "@facet/core";
import type { ServerMessage } from "@facet/core";
import { describe, expect, it } from "vitest";

import type { ProviderStep } from "../provider.js";
import {
  createReferenceAgentDiagnosticEmitter,
  type ReferenceAgentDiagnosticEvent,
} from "./diagnostic-observer.js";
import { executeToolStep } from "./loop-batches.js";
import { normalizeBudget } from "./budget.js";

const MAX_DIAGNOSTIC_EVENTS = 10_000;
const MAX_DIAGNOSTIC_STRING_CHARS = 64 * 1024;
const MAX_DIAGNOSTIC_EVENT_BYTES = 1024 * 1024;

describe("reference-agent diagnostic observer", () => {
  it("captures bounded tool diagnostics with explicit overflow", () => {
    const sourceInput = hostileInput();
    const messages: readonly ServerMessage[] = [
      { kind: "patch", patches: [{ op: "replace", path: "/root", value: "root" }] },
      { kind: "say", text: "Bearer result-secret" },
    ];
    const outcome: StageToolBufferOutcome = {
      observation: `ok ${"x".repeat(MAX_DIAGNOSTIC_STRING_CHARS + 32)} sk-observation-secret`,
      messages,
      mutated: true,
      said: true,
      shadow: EMPTY_TREE,
    };
    const buffer = bufferReturning(outcome);
    const captured: ReferenceAgentDiagnosticEvent[] = [];
    const diagnostics = createReferenceAgentDiagnosticEmitter((event) => {
      captured.push(event);
      tryMutatingEvent(event);
    });
    const step: ProviderStep = {
      text: "",
      toolCalls: [{ id: "call-1", name: "render_page", input: sourceInput }],
      usage: { inputTokens: 12, outputTokens: 7 },
    };

    const result = executeToolStep({
      buffer,
      step,
      messages: [],
      budget: normalizeBudget({}),
      trace: undefined,
      diagnostics,
    });

    expect(result.batch).toEqual(messages);
    expect(captured.map((event) => event.kind)).toEqual(["tool-call", "tool-result", "batch"]);

    const call = captured[0];
    expect(call?.kind).toBe("tool-call");
    if (call?.kind !== "tool-call") throw new Error("missing tool-call diagnostic");
    expect(call.input === sourceInput).toBe(false);
    expect(call.truncated).toBe(true);
    expect(Object.isFrozen(call)).toBe(true);
    expect(Object.isFrozen(call.input)).toBe(true);
    expect(encodedBytes(call)).toBeLessThanOrEqual(MAX_DIAGNOSTIC_EVENT_BYTES);

    const callJson = JSON.stringify(call);
    expect(callJson).toContain("[redacted]");
    expect(callJson).toContain("[truncated]");
    expect(callJson).toContain("[circular]");
    expect(callJson).not.toContain("hunter2");
    expect(callJson).not.toContain("sk-input-secret");
    expect(callJson).not.toContain("getter-secret");
    expect("observer-write" in sourceInput).toBe(false);
    expect(Object.keys(call.input as Record<string, unknown>).length).toBeLessThanOrEqual(512);

    const toolResult = captured[1];
    expect(toolResult?.kind).toBe("tool-result");
    if (toolResult?.kind !== "tool-result") throw new Error("missing tool-result diagnostic");
    expect(toolResult.messages).not.toBe(messages);
    expect(toolResult.truncated).toBe(true);
    expect(Object.isFrozen(toolResult.messages)).toBe(true);
    expect(encodedBytes(toolResult)).toBeLessThanOrEqual(MAX_DIAGNOSTIC_EVENT_BYTES);
    expect(JSON.stringify(toolResult)).not.toContain("result-secret");
    expect(
      typeof toolResult.observation === "string" ? toolResult.observation.length : Infinity,
    ).toBeLessThanOrEqual(MAX_DIAGNOSTIC_STRING_CHARS);

    const batch = captured[2];
    expect(batch).toEqual({
      kind: "batch",
      callIds: ["call-1"],
      usage: { inputTokens: 12, outputTokens: 7 },
    });

    const oversized: ReferenceAgentDiagnosticEvent[] = [];
    createReferenceAgentDiagnosticEmitter((event) => oversized.push(event))({
      kind: "tool-call",
      callId: "large-call",
      name: "render_page",
      input: Array.from({ length: 20 }, () => "z".repeat(MAX_DIAGNOSTIC_STRING_CHARS)),
      truncated: false,
    });
    expect(oversized).toEqual([
      {
        kind: "tool-call",
        callId: "large-call",
        name: "render_page",
        input: "[truncated]",
        truncated: true,
      },
    ]);
    expect(encodedBytes(oversized[0])).toBeLessThanOrEqual(MAX_DIAGNOSTIC_EVENT_BYTES);

    const throwingDiagnostics = createReferenceAgentDiagnosticEmitter(() => {
      throw new Error("observer failure");
    });
    expect(() =>
      executeToolStep({
        buffer,
        step,
        messages: [],
        budget: normalizeBudget({}),
        trace: undefined,
        diagnostics: throwingDiagnostics,
      }),
    ).not.toThrow();

    const overflow: ReferenceAgentDiagnosticEvent[] = [];
    const capped = createReferenceAgentDiagnosticEmitter((event) => overflow.push(event));
    for (let index = 0; index < MAX_DIAGNOSTIC_EVENTS + 2; index += 1) {
      capped({ kind: "provider-attempt", attempt: index + 1 });
    }
    expect(overflow).toHaveLength(MAX_DIAGNOSTIC_EVENTS + 1);
    expect(overflow.at(-1)).toEqual({ kind: "overflow", dropped: 1 });
    expect(overflow.filter((event) => event.kind === "overflow")).toHaveLength(1);
  });
});

function hostileInput(): Record<string, unknown> {
  const input: Record<string, unknown> = {
    password: "hunter2",
    note: "sk-input-secret",
    huge: "y".repeat(MAX_DIAGNOSTIC_STRING_CHARS + 32),
  };
  let cursor = input;
  for (let depth = 0; depth < 10; depth += 1) {
    const child: Record<string, unknown> = {};
    cursor["child"] = child;
    cursor = child;
  }
  input["self"] = input;
  for (let index = 0; index < 520; index += 1) input[`entry-${String(index)}`] = index;
  Object.defineProperty(input, "explosive", {
    enumerable: true,
    get() {
      throw new Error("getter-secret");
    },
  });
  return input;
}

function bufferReturning(outcome: StageToolBufferOutcome): StageToolBuffer {
  return {
    run: () => outcome,
    resetEmittedPatchOps() {},
    drainUnresolved: () => [],
    shadow: EMPTY_TREE,
  };
}

function tryMutatingEvent(event: ReferenceAgentDiagnosticEvent): void {
  try {
    const mutable = event as { kind: string };
    mutable.kind = "mutated";
  } catch {
    // Frozen diagnostics reject writes in strict mode.
  }
  if (event.kind !== "tool-call" || typeof event.input !== "object" || event.input === null) return;
  try {
    const mutableInput = event.input as Record<string, unknown>;
    mutableInput["observer-write"] = true;
  } catch {
    // Frozen projections reject writes in strict mode.
  }
}

function encodedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
