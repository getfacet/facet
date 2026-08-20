import { executeFacetTool, FACET_TOOL_SPECS } from "@facet/agent-tools";
import type { FacetToolSession, TurnOutcome } from "@facet/core";

import type { ProviderStep, TurnMessage } from "../provider.js";
import type { ReferenceAgentBudget } from "./budget.js";
import type {
  ReferenceAgentDiagnosticEmitter,
  ReferenceAgentDiagnosticEvent,
} from "./diagnostic-observer.js";
import { emitReferenceAgentTrace, type ReferenceAgentTrace } from "./trace.js";

const MUTATION_TOOLS: ReadonlySet<string> = new Set(
  FACET_TOOL_SPECS.filter((spec) => spec.mutatesStage).map((spec) => spec.name),
);

export interface ExecuteToolStepOptions {
  readonly session: FacetToolSession;
  readonly step: ProviderStep;
  readonly messages: TurnMessage[];
  readonly budget: ReferenceAgentBudget;
  readonly trace: ReferenceAgentTrace | undefined;
  readonly diagnostics?: ReferenceAgentDiagnosticEmitter;
}

export interface ExecuteToolStepResult {
  readonly fragments: readonly TurnOutcome[];
  readonly toolCallCount: number;
}

export async function executeToolStep(
  options: ExecuteToolStepOptions,
): Promise<ExecuteToolStepResult> {
  const fragments: TurnOutcome[] = [];
  const observations: { readonly callId: string; readonly content: string }[] = [];

  options.messages.push({
    role: "assistant_tools",
    text: options.step.text,
    toolCalls: options.step.toolCalls,
  });

  for (const call of options.step.toolCalls) {
    emitDiagnostic(options.diagnostics, {
      kind: "tool-call",
      callId: call.id,
      name: call.name,
      input: call.input,
      truncated: false,
    });
    const result = await executeFacetTool(call.name, call.input, options.session);
    const content = boundObservation(result, options.budget.maxObservationChars);
    observations.push({ callId: call.id, content });
    options.messages.push({ role: "tool_result", callId: call.id, content });

    const stageRevision = mutationStageRevisionOf(call.name, result);
    if (stageRevision !== undefined) {
      fragments.push({ stageRevision, patches: [] });
    }

    emitDiagnostic(options.diagnostics, {
      kind: "tool-result",
      callId: call.id,
      observation: result,
      messages: [],
      mutated: stageRevision !== undefined,
      conversationDelivered: false,
      truncated: content.endsWith("…"),
    });
    emitReferenceAgentTrace(options.trace, {
      type: "tool_result",
      callId: call.id,
      toolName: call.name,
      observationChars: content.length,
      truncated: content.endsWith("…"),
    });
  }

  emitDiagnostic(options.diagnostics, {
    kind: "batch",
    callIds: observations.map((observation) => observation.callId),
    ...(options.step.usage === undefined ? {} : { usage: options.step.usage }),
  });

  return { fragments, toolCallCount: options.step.toolCalls.length };
}

export function emitBatchYieldTrace(
  trace: ReferenceAgentTrace | undefined,
  fragments: readonly TurnOutcome[],
): void {
  emitReferenceAgentTrace(trace, {
    type: "batch_yield",
    messageCount: fragments.length,
    patchCount: fragments.reduce((sum, fragment) => sum + fragment.patches.length, 0),
    conversationCount: fragments.filter((fragment) => fragment.conversation !== undefined).length,
  });
}

export function hasPatchBatch(fragments: readonly TurnOutcome[]): boolean {
  return fragments.some((fragment) => fragment.patches.length > 0);
}

function mutationStageRevisionOf(toolName: string, result: unknown): number | undefined {
  if (!MUTATION_TOOLS.has(toolName)) return undefined;
  if (!isRecord(result) || result["ok"] !== true) return undefined;
  const stageRevision = result["stageRevision"];
  return typeof stageRevision === "number" && Number.isSafeInteger(stageRevision)
    ? stageRevision
    : undefined;
}

function boundObservation(value: unknown, maxChars: number): string {
  const serialized = safeJson(value);
  if (serialized.length <= maxChars) return serialized;
  if (maxChars <= 1) return "…";
  return `${serialized.slice(0, maxChars - 1)}…`;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return '{"ok":false,"code":"unserializable_tool_result"}';
  }
}

function emitDiagnostic(
  diagnostics: ReferenceAgentDiagnosticEmitter | undefined,
  event: ReferenceAgentDiagnosticEvent,
): void {
  try {
    diagnostics?.(event);
  } catch {
    // Diagnostics are non-controlling.
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
