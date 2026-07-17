import type { ToolCall as AgentToolCall, ToolSpec as AgentToolSpec } from "@facet/agent-tools";

/** A tool offered to the model: a name, a description, and a JSON-schema for its input. */
export type ToolSpec = AgentToolSpec;

/** One tool call the model wants to make, with its arguments already parsed. */
export type ToolCall = AgentToolCall;

/** Provider-reported token counts for one step. Both fields are optional: a
 * provider may report neither, one, or both, and a custom adapter may omit
 * usage entirely. */
export interface ProviderUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

/** One model step: any prose it emitted plus the tool calls it requested. */
export interface ProviderStep {
  readonly text: string;
  readonly toolCalls: readonly ToolCall[];
  readonly usage?: ProviderUsage;
}

/**
 * A provider-agnostic conversation entry. Each adapter translates these into
 * its own wire shape (OpenAI `tool`/`tool_calls`, Anthropic `tool_use`/
 * `tool_result` content blocks).
 */
export type TurnMessage =
  | { readonly role: "user"; readonly content: string }
  | { readonly role: "assistant"; readonly content: string }
  | {
      readonly role: "assistant_tools";
      readonly text: string;
      readonly toolCalls: readonly ToolCall[];
    }
  | { readonly role: "tool_result"; readonly callId: string; readonly content: string };

export interface ProviderTurn {
  readonly system: string;
  readonly messages: readonly TurnMessage[];
}

export interface ReferenceProvider {
  readonly name: "openai" | "anthropic";
  readonly model: string;
  /** The model's total context window in tokens, when the adapter knows it. */
  readonly contextWindowTokens?: number;
  /** One tool-use step. Rejects on HTTP error, malformed body, or the timeout. */
  run(turn: ProviderTurn, tools: readonly ToolSpec[]): Promise<ProviderStep>;
}

/** Per-attempt abort deadline for one `run` call. */
export const TURN_TIMEOUT_MS = 60_000;

export interface ProviderOptions {
  /** Override the per-attempt timeout (tests inject a short one). */
  readonly timeoutMs?: number;
}

export type FetchImpl = typeof fetch;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Read a `ProviderUsage` out of a provider-specific usage record, given the
 * wire field names for the input/output counts. Only finite numbers survive;
 * missing or malformed counts are simply absent (this NEVER throws), and a
 * record with no usable count at all yields `undefined`.
 *
 * `additionalInputFields` are summed into `inputTokens` alongside `inputField`
 * (each term counted only when it is a finite number). Anthropic reports its
 * cached prefix in separate `cache_creation_input_tokens` /
 * `cache_read_input_tokens` fields that `input_tokens` excludes, so the
 * inclusive total must add them back; OpenAI's `prompt_tokens` already includes
 * cached tokens and passes no additional fields.
 */
export function readProviderUsage(
  usage: unknown,
  inputField: string,
  outputField: string,
  additionalInputFields: readonly string[] = [],
): ProviderUsage | undefined {
  if (!isRecord(usage)) return undefined;
  const readFinite = (field: string): number | undefined => {
    const raw = usage[field];
    return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
  };
  const inputParts = [inputField, ...additionalInputFields]
    .map(readFinite)
    .filter((value): value is number => value !== undefined);
  const rawOutput = readFinite(outputField);
  const hasInput = inputParts.length > 0;
  const hasOutput = rawOutput !== undefined;
  if (!hasInput && !hasOutput) return undefined;
  return {
    ...(hasInput ? { inputTokens: inputParts.reduce((sum, value) => sum + value, 0) } : {}),
    ...(hasOutput ? { outputTokens: rawOutput } : {}),
  };
}

export async function postJson(
  fetchImpl: FetchImpl,
  url: string,
  headers: Readonly<Record<string, string>>,
  body: unknown,
  timeoutMs: number,
  providerName: string,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`${providerName} request failed: HTTP ${response.status}`);
    }
    return (await response.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}
