import { describe, expect, it } from "vitest";

import { MIN_REFERENCE_AGENT_OBSERVATION_CHARS } from "./budget.js";
import {
  appendAssistantToolCalls,
  appendProviderStepTranscript,
  boundObservationText,
  finalProseForProviderStop,
} from "./transcript.js";
import type { ReferenceAgentTraceEvent } from "./trace.js";
import type { ProviderStep, ToolCall, TurnMessage } from "../provider.js";

const toolCalls = [
  { id: "call_1", name: "inspect_stage", input: { maxNodes: 2 } },
  { id: "call_2", name: "say", input: { text: "Done" } },
] as const satisfies readonly ToolCall[];

describe("provider transcript helpers", () => {
  it("appends assistant tool calls and ordered tool_result observations before the next provider call", () => {
    const messages: TurnMessage[] = [{ role: "user", content: "Update the page." }];
    const step: ProviderStep = {
      text: "I will inspect the page before responding.",
      toolCalls,
    };

    appendProviderStepTranscript(
      messages,
      step,
      [
        { callId: "call_1", content: "ok: root has two children" },
        { callId: "call_2", content: "ok: said Done" },
      ],
      { maxObservationChars: 200 },
    );

    expect(messages).toEqual([
      { role: "user", content: "Update the page." },
      {
        role: "assistant_tools",
        text: "I will inspect the page before responding.",
        toolCalls,
      },
      { role: "tool_result", callId: "call_1", content: "ok: root has two children" },
      { role: "tool_result", callId: "call_2", content: "ok: said Done" },
    ]);
  });

  it("preserves ordered observations even when a provider repeats a tool call id", () => {
    const messages: TurnMessage[] = [];
    const duplicateStep: ProviderStep = {
      text: "",
      toolCalls: [
        { id: "call_dup", name: "inspect_stage", input: {} },
        { id: "call_dup", name: "say", input: { text: "second" } },
      ],
    };

    appendProviderStepTranscript(
      messages,
      duplicateStep,
      [
        { callId: "call_dup", content: "first observation" },
        { callId: "call_dup", content: "second observation" },
      ],
      { maxObservationChars: 200 },
    );

    expect(messages).toEqual([
      {
        role: "assistant_tools",
        text: "",
        toolCalls: duplicateStep.toolCalls,
      },
      { role: "tool_result", callId: "call_dup", content: "first observation" },
      { role: "tool_result", callId: "call_dup", content: "second observation" },
    ]);
  });

  it("bounds long observations with an explicit truncation marker", () => {
    const messages: TurnMessage[] = [];
    const traceEvents: ReferenceAgentTraceEvent[] = [];
    const longObservation = "node summary ".repeat(20);

    const [bounded] = appendProviderStepTranscript(
      messages,
      { text: "", toolCalls: [toolCalls[0]] },
      [{ callId: "call_1", content: longObservation }],
      {
        maxObservationChars: 72,
        trace: (event) => {
          traceEvents.push(event);
        },
      },
    );

    expect(bounded?.truncated).toBe(true);
    expect(bounded?.omittedChars).toBeGreaterThan(0);
    const result = messages[1];
    expect(result).toMatchObject({ role: "tool_result", callId: "call_1" });
    if (result?.role !== "tool_result") throw new Error("expected tool_result");
    expect(result.content).toHaveLength(72);
    expect(result.content).toMatch(/\[truncated: \d+ chars omitted\]$/);
    expect(traceEvents).toEqual([
      {
        type: "tool_result",
        toolName: "inspect_stage",
        callId: "call_1",
        observationChars: 72,
        truncated: true,
        omittedChars: bounded?.omittedChars ?? 0,
      },
    ]);
  });

  it.each(["get_pattern", "get_preset", "get_brick_spec", "get_style_choices"])(
    "preserves complete %s results while generic observations stay bounded",
    (exactToolName) => {
      const messages: TurnMessage[] = [];
      const exactObservation = JSON.stringify({
        status: "ok",
        data: { data: JSON.stringify({ name: "large-reference", nodes: "x".repeat(5_000) }) },
      });
      const genericObservation = `inspection ${"y".repeat(5_000)}`;
      const step: ProviderStep = {
        text: "",
        toolCalls: [
          { id: "asset-1", name: exactToolName, input: { name: "large-reference" } },
          { id: "inspect-1", name: "inspect_stage", input: {} },
        ],
      };

      const bounded = appendProviderStepTranscript(
        messages,
        step,
        [
          { callId: "asset-1", content: exactObservation },
          { callId: "inspect-1", content: genericObservation },
        ],
        { maxObservationChars: 4_000 },
      );

      expect(exactObservation.length).toBeGreaterThan(4_000);
      expect(bounded[0]).toEqual({
        callId: "asset-1",
        content: exactObservation,
        originalChars: exactObservation.length,
        truncated: false,
        omittedChars: 0,
      });
      expect(bounded[1]).toMatchObject({
        callId: "inspect-1",
        originalChars: genericObservation.length,
        truncated: true,
      });
      const exactResult = messages[1];
      expect(exactResult).toEqual({
        role: "tool_result",
        callId: "asset-1",
        content: exactObservation,
      });
      const genericResult = messages[2];
      expect(genericResult).toMatchObject({ role: "tool_result", callId: "inspect-1" });
      if (genericResult?.role !== "tool_result") throw new Error("expected generic tool_result");
      expect(genericResult.content).toHaveLength(4_000);
      expect(genericResult.content).toMatch(/\[truncated: \d+ chars omitted\]$/);
    },
  );

  it("uses the provider call identity instead of producer-supplied tool metadata", () => {
    const messages: TurnMessage[] = [];
    const longObservation = "x".repeat(5_000);

    const [bounded] = appendProviderStepTranscript(
      messages,
      {
        text: "",
        toolCalls: [{ id: "inspect-1", name: "inspect_stage", input: {} }],
      },
      [{ callId: "inspect-1", content: longObservation, toolName: "get_pattern" }],
      { maxObservationChars: 4_000 },
    );

    expect(bounded?.truncated).toBe(true);
    expect(bounded?.content).toHaveLength(4_000);
  });

  it("keeps the truncation marker whole even when a tiny observation cap is requested", () => {
    const bounded = boundObservationText("long observation ".repeat(20), 10);

    expect(bounded.truncated).toBe(true);
    expect(bounded.content.length).toBeLessThanOrEqual(MIN_REFERENCE_AGENT_OBSERVATION_CHARS);
    expect(bounded.content).toMatch(/\[truncated: \d+ chars omitted\]$/);
    expect(bounded.content.match(/\[truncated:/g)).toHaveLength(1);
  });

  it("preserves provider step text without treating tool-step prose as final prose", () => {
    const messages: TurnMessage[] = [];
    const toolStep: ProviderStep = {
      text: "Internal step text that should not become chat output.",
      toolCalls: [toolCalls[0]],
    };

    appendAssistantToolCalls(messages, toolStep);

    expect(messages).toEqual([
      {
        role: "assistant_tools",
        text: "Internal step text that should not become chat output.",
        toolCalls: [toolCalls[0]],
      },
    ]);
    expect(finalProseForProviderStop(toolStep)).toBe("");
    expect(
      finalProseForProviderStop({
        text: "  Clean final answer for the visitor.  ",
        toolCalls: [],
      }),
    ).toBe("Clean final answer for the visitor.");
  });
});
