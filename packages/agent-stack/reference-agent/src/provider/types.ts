import type { ToolCall as AgentToolCall, ToolSpec as AgentToolSpec } from "@facet/agent-tools";

/** A tool offered to the model: a name, a description, and a JSON-schema for its input. */
export type ToolSpec = AgentToolSpec;

/** One tool call the model wants to make, with its arguments already parsed. */
export type ToolCall = AgentToolCall;

/** One model step: any prose it emitted plus the tool calls it requested. */
export interface ProviderStep {
  readonly text: string;
  readonly toolCalls: readonly ToolCall[];
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

export interface QuickstartProvider {
  readonly name: "openai" | "anthropic";
  readonly model: string;
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
