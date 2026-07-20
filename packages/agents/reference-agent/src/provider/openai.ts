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

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_CONTEXT_WINDOW_TOKENS = 128_000;
const OPENAI_PRO_TURN_TIMEOUT_MS = 10 * TURN_TIMEOUT_MS;

function requiresResponsesApi(model: string): boolean {
  return ["gpt-5.5-pro", "gpt-5.4-pro"].some(
    (family) => model === family || model.startsWith(`${family}-`),
  );
}

function requiresNoneReasoningForChatTools(model: string): boolean {
  return model === "gpt-5.6" || model.startsWith("gpt-5.6-");
}

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

/** Translate the same provider-agnostic history into stateless Responses input items. */
function toOpenAiResponsesInput(messages: readonly TurnMessage[]): unknown[] {
  const out: unknown[] = [];
  for (const message of messages) {
    if (message.role === "user" || message.role === "assistant") {
      out.push({ role: message.role, content: message.content });
    } else if (message.role === "assistant_tools") {
      if (Array.isArray(message.providerState)) {
        out.push(...message.providerState);
        continue;
      }
      if (message.text.length > 0) {
        out.push({ role: "assistant", content: message.text });
      }
      for (const call of message.toolCalls) {
        out.push({
          type: "function_call",
          call_id: call.id,
          name: call.name,
          arguments: JSON.stringify(call.input),
        });
      }
    } else {
      out.push({
        type: "function_call_output",
        call_id: message.callId,
        output: message.content,
      });
    }
  }
  return out;
}

function parseToolArguments(argumentsValue: unknown): unknown {
  if (typeof argumentsValue !== "string") return {};
  try {
    return JSON.parse(argumentsValue) as unknown;
  } catch {
    return { __parseError: argumentsValue };
  }
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
    toolCalls.push({ id, name, input: parseToolArguments(fn["arguments"]) });
  }
  const usage = readProviderUsage(body["usage"], "prompt_tokens", "completion_tokens");
  return { text, toolCalls, ...(usage !== undefined ? { usage } : {}) };
}

function parseOpenAiResponsesStep(body: unknown): ProviderStep {
  if (!isRecord(body) || !Array.isArray(body["output"])) {
    throw new Error("openai Responses response had an unexpected shape (no output[])");
  }
  if (body["status"] !== "completed") {
    throw new Error(`openai Responses response was not complete (${String(body["status"])})`);
  }

  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];
  for (const item of body["output"]) {
    if (!isRecord(item)) {
      throw new Error("openai Responses response had a malformed output item");
    }
    if (typeof item["status"] === "string" && item["status"] !== "completed") {
      throw new Error(`openai Responses response contained an unfinished ${String(item["type"])}`);
    }
    if (item["type"] === "message") {
      if (!Array.isArray(item["content"])) {
        throw new Error("openai Responses response had a malformed message item");
      }
      for (const content of item["content"]) {
        if (isRecord(content) && content["type"] === "output_text") {
          if (typeof content["text"] !== "string") {
            throw new Error("openai Responses response had malformed output text");
          }
          textParts.push(content["text"]);
        } else if (isRecord(content) && content["type"] === "refusal") {
          if (typeof content["refusal"] !== "string") {
            throw new Error("openai Responses response had a malformed refusal");
          }
          textParts.push(content["refusal"]);
        }
      }
      continue;
    }
    if (item["type"] === "function_call") {
      const id = typeof item["call_id"] === "string" ? item["call_id"] : undefined;
      const name = typeof item["name"] === "string" ? item["name"] : undefined;
      if (id === undefined || id.length === 0 || name === undefined || name.length === 0) {
        throw new Error("openai Responses response had a malformed function_call id/name");
      }
      toolCalls.push({
        id,
        name,
        input: parseToolArguments(item["arguments"]),
      });
    }
  }

  const usage = readProviderUsage(body["usage"], "input_tokens", "output_tokens");
  return {
    text: textParts.join(""),
    toolCalls,
    ...(usage !== undefined ? { usage } : {}),
    providerState: body["output"],
  };
}

export function createOpenAiProvider(
  apiKey: string,
  fetchImpl: FetchImpl = fetch,
  options: ProviderOptions = {},
): ReferenceProvider {
  const model = resolveProviderModel(options.model, DEFAULT_OPENAI_MODEL);
  const useResponsesApi = requiresResponsesApi(model);
  const timeoutMs =
    options.timeoutMs ?? (useResponsesApi ? OPENAI_PRO_TURN_TIMEOUT_MS : TURN_TIMEOUT_MS);
  return {
    name: "openai",
    model,
    contextWindowTokens: OPENAI_CONTEXT_WINDOW_TOKENS,
    async run(turn, tools, context) {
      if (useResponsesApi) {
        const json = await postJson(
          fetchImpl,
          OPENAI_RESPONSES_URL,
          { Authorization: `Bearer ${apiKey}` },
          {
            model,
            instructions: turn.system,
            input: toOpenAiResponsesInput(turn.messages),
            include: ["reasoning.encrypted_content"],
            tools: tools.map((tool) => ({
              type: "function",
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            })),
            tool_choice: "auto",
            store: false,
          },
          timeoutMs,
          "openai",
          context?.signal,
        );
        return parseOpenAiResponsesStep(json);
      }

      const json = await postJson(
        fetchImpl,
        OPENAI_CHAT_URL,
        { Authorization: `Bearer ${apiKey}` },
        {
          model,
          messages: toOpenAiMessages(turn.system, turn.messages),
          tools: tools.map((t) => ({
            type: "function",
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
          tool_choice: "auto",
          ...(tools.length > 0 && requiresNoneReasoningForChatTools(model)
            ? { reasoning_effort: "none" }
            : {}),
        },
        timeoutMs,
        "openai",
        context?.signal,
      );
      return parseOpenAiStep(json);
    },
  };
}
