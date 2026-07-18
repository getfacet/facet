import {
  TURN_TIMEOUT_MS,
  isRecord,
  postJson,
  readProviderUsage,
  resolveProviderModel,
  type FetchImpl,
  type ProviderOptions,
  type ProviderStep,
  type ReferenceProvider,
  type ToolCall,
  type TurnMessage,
} from "./types.js";

export const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_CONTEXT_WINDOW_TOKENS = 128_000;

/** Translate provider-agnostic messages into OpenAI chat messages. */
function toOpenAiMessages(system: string, messages: readonly TurnMessage[]): unknown[] {
  const out: unknown[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user" || m.role === "assistant") {
      out.push({ role: m.role, content: m.content });
    } else if (m.role === "assistant_tools") {
      out.push({
        role: "assistant",
        content: m.text.length > 0 ? m.text : null,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: JSON.stringify(c.input) },
        })),
      });
    } else {
      out.push({ role: "tool", tool_call_id: m.callId, content: m.content });
    }
  }
  return out;
}

function parseOpenAiStep(body: unknown): ProviderStep {
  if (!isRecord(body) || !Array.isArray(body["choices"])) {
    throw new Error("openai response had an unexpected shape (no choices[])");
  }
  const message: unknown = isRecord(body["choices"][0]) ? body["choices"][0]["message"] : undefined;
  if (!isRecord(message)) {
    throw new Error("openai response had an unexpected shape (no choices[0].message)");
  }
  const text = typeof message["content"] === "string" ? message["content"] : "";
  const toolCallsValue = message["tool_calls"];
  if (toolCallsValue !== undefined && toolCallsValue !== null && !Array.isArray(toolCallsValue)) {
    throw new Error("openai response had malformed tool_calls");
  }
  const rawCalls = Array.isArray(toolCallsValue) ? toolCallsValue : [];
  const toolCalls: ToolCall[] = [];
  for (const raw of rawCalls) {
    if (!isRecord(raw) || !isRecord(raw["function"])) {
      throw new Error("openai response had a malformed tool_call");
    }
    const fn = raw["function"];
    const id = typeof raw["id"] === "string" ? raw["id"] : undefined;
    const name = typeof fn["name"] === "string" ? fn["name"] : undefined;
    if (id === undefined || id.length === 0 || name === undefined || name.length === 0) {
      throw new Error("openai response had a malformed tool_call id/name");
    }
    let input: unknown = {};
    if (typeof fn["arguments"] === "string") {
      try {
        input = JSON.parse(fn["arguments"]);
      } catch {
        input = { __parseError: fn["arguments"] };
      }
    }
    toolCalls.push({ id, name, input });
  }
  const usage = readProviderUsage(body["usage"], "prompt_tokens", "completion_tokens");
  return { text, toolCalls, ...(usage !== undefined ? { usage } : {}) };
}

export function createOpenAiProvider(
  apiKey: string,
  fetchImpl: FetchImpl = fetch,
  options: ProviderOptions = {},
): ReferenceProvider {
  const timeoutMs = options.timeoutMs ?? TURN_TIMEOUT_MS;
  const model = resolveProviderModel(options.model, DEFAULT_OPENAI_MODEL);
  return {
    name: "openai",
    model,
    contextWindowTokens: OPENAI_CONTEXT_WINDOW_TOKENS,
    async run(turn, tools, context) {
      const json = await postJson(
        fetchImpl,
        OPENAI_URL,
        { Authorization: `Bearer ${apiKey}` },
        {
          model,
          messages: toOpenAiMessages(turn.system, turn.messages),
          tools: tools.map((t) => ({
            type: "function",
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
          tool_choice: "auto",
        },
        timeoutMs,
        "openai",
        context?.signal,
      );
      return parseOpenAiStep(json);
    },
  };
}
