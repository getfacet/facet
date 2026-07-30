import { deriveMessageId, type ConversationMessage } from "@facet/core";
import { describe, expect, it } from "vitest";

import { MIN_REFERENCE_AGENT_OBSERVATION_CHARS } from "./budget.js";
import {
  appendAssistantToolCalls,
  appendProviderStepTranscript,
  boundObservationText,
  conversationHistoryToMessages,
  finalProseForProviderStop,
} from "./transcript.js";
import type { ReferenceAgentTraceEvent } from "./trace.js";
import type { ProviderStep, ToolCall, TurnMessage } from "../provider.js";

const toolCalls = [
  { id: "call_1", name: "read_screen", input: { screen: "home" } },
  { id: "call_2", name: "render_page", input: { markup: '<Facet entry="home" />' } },
] as const satisfies readonly ToolCall[];

describe("provider transcript helpers", () => {
  it("appends assistant tool calls and ordered tool_result observations before the next provider call", () => {
    const messages: TurnMessage[] = [{ role: "user", content: "Update the page." }];
    const step: ProviderStep = {
      text: "I will read the screen before responding.",
      toolCalls,
    };

    appendProviderStepTranscript(
      messages,
      step,
      [
        { callId: "call_1", content: "ok: home screen has two children" },
        { callId: "call_2", content: "ok: page rendered" },
      ],
      { maxObservationChars: 200 },
    );

    expect(messages).toEqual([
      { role: "user", content: "Update the page." },
      {
        role: "assistant_tools",
        text: "I will read the screen before responding.",
        toolCalls,
      },
      { role: "tool_result", callId: "call_1", content: "ok: home screen has two children" },
      { role: "tool_result", callId: "call_2", content: "ok: page rendered" },
    ]);
  });

  it("carries opaque provider continuation state into the next tool step", () => {
    const providerState = [{ type: "reasoning", encrypted_content: "opaque" }];
    const messages: TurnMessage[] = [];
    appendAssistantToolCalls(messages, {
      text: "Checking.",
      toolCalls: [toolCalls[0]],
      providerState,
    });

    expect(messages).toEqual([
      {
        role: "assistant_tools",
        text: "Checking.",
        toolCalls: [toolCalls[0]],
        providerState,
      },
    ]);
  });

  it("preserves ordered observations even when a provider repeats a tool call id", () => {
    const messages: TurnMessage[] = [];
    const duplicateStep: ProviderStep = {
      text: "",
      toolCalls: [
        { id: "call_dup", name: "read_screen", input: { screen: "home" } },
        { id: "call_dup", name: "render_page", input: { markup: '<Facet entry="home" />' } },
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
        toolName: "read_screen",
        callId: "call_1",
        observationChars: 72,
        truncated: true,
        omittedChars: bounded?.omittedChars ?? 0,
      },
    ]);
  });

  it("bounds every tool observation, including read_component_spec", () => {
    const messages: TurnMessage[] = [];
    const longObservation = JSON.stringify({
      status: "ok",
      spec: { tag: "Text", guidance: "x".repeat(5_000) },
    });
    const bounded = appendProviderStepTranscript(
      messages,
      {
        text: "",
        toolCalls: [{ id: "spec-1", name: "read_component_spec", input: { tag: "Text" } }],
      },
      [{ callId: "spec-1", content: longObservation }],
      { maxObservationChars: 4_000 },
    );

    expect(longObservation.length).toBeGreaterThan(4_000);
    expect(bounded[0]).toMatchObject({
      callId: "spec-1",
      originalChars: longObservation.length,
      truncated: true,
    });
    const result = messages[1];
    expect(result).toMatchObject({ role: "tool_result", callId: "spec-1" });
    if (result?.role !== "tool_result") throw new Error("expected tool_result");
    expect(result.content).toHaveLength(4_000);
    expect(result.content).toMatch(/\[truncated: \d+ chars omitted\]$/);
  });

  it("uses the provider call identity instead of producer-supplied tool metadata", () => {
    const messages: TurnMessage[] = [];
    const traceEvents: ReferenceAgentTraceEvent[] = [];
    const observation = "x".repeat(5_000);

    appendProviderStepTranscript(
      messages,
      {
        text: "",
        toolCalls: [{ id: "screen-1", name: "read_screen", input: { screen: "home" } }],
      },
      [{ callId: "screen-1", content: observation, toolName: "publish_data" }],
      {
        maxObservationChars: 4_000,
        trace: (event) => {
          traceEvents.push(event);
        },
      },
    );

    expect(traceEvents[0]).toMatchObject({ toolName: "read_screen" });
    const result = messages[1];
    if (result?.role !== "tool_result") throw new Error("expected tool_result");
    expect(result.content).toHaveLength(4_000);
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

  it("converts ConversationMessage records and folds duplicate messageIds deterministically", () => {
    const duplicateId = deriveMessageId("turn-1", "visitor");
    const transcript = conversationHistoryToMessages(
      [
        { ...conversation("turn-0", "visitor", "dropped") },
        { ...conversation("turn-1", "visitor", "stale"), messageId: duplicateId },
        { ...conversation("turn-1", "visitor", "fresh"), messageId: duplicateId },
        conversation("turn-1", "assistant", "reply"),
      ],
      1,
    );

    expect(transcript.duplicateMessageCount).toBe(1);
    expect(transcript.droppedTurnCount).toBe(1);
    expect(transcript.records.map((record) => record.messageId)).toEqual([
      duplicateId,
      deriveMessageId("turn-1", "assistant"),
    ]);
    expect(transcript.messages).toEqual([
      { role: "user", content: "fresh" },
      { role: "assistant", content: "reply" },
    ]);
  });

  it("bounds by whole turns instead of slicing a visitor/assistant pair mid-turn", () => {
    const transcript = conversationHistoryToMessages(
      [
        conversation("turn-0", "visitor", "old visitor"),
        conversation("turn-0", "assistant", "old assistant"),
        conversation("turn-1", "visitor", "kept visitor"),
        conversation("turn-1", "assistant", "kept assistant"),
        conversation("turn-2", "visitor", "latest visitor"),
        conversation("turn-2", "assistant", "latest assistant"),
      ],
      2,
    );

    expect(transcript.droppedTurnCount).toBe(1);
    expect(transcript.records.map((record) => record.turnId)).toEqual([
      "turn-1",
      "turn-1",
      "turn-2",
      "turn-2",
    ]);
    expect(transcript.messages).toEqual([
      { role: "user", content: "kept visitor" },
      { role: "assistant", content: "kept assistant" },
      { role: "user", content: "latest visitor" },
      { role: "assistant", content: "latest assistant" },
    ]);
  });
});

function conversation(
  turnId: string,
  role: ConversationMessage["role"],
  text: string,
): ConversationMessage {
  return {
    kind: "conversation",
    turnId,
    role,
    messageId: deriveMessageId(turnId, role),
    text,
    at: 0,
  };
}
