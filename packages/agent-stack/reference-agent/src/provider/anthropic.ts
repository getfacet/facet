import {
  TURN_TIMEOUT_MS,
  isRecord,
  postJson,
  readProviderUsage,
  type FetchImpl,
  type ProviderOptions,
  type ProviderStep,
  type ReferenceProvider,
  type ToolCall,
  type TurnMessage,
} from "./types.js";

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_MAX_TOKENS = 8192;
const ANTHROPIC_CONTEXT_WINDOW_TOKENS = 200_000;

/** A user message carrying one or more `tool_result` blocks (Anthropic requires
 * ALL results for one assistant tool_use turn to sit in a SINGLE user message). */
interface ToolResultUserMessage {
  readonly role: "user";
  readonly content: Array<{ type: "tool_result"; tool_use_id: string; content: string }>;
}

function isToolResultUser(value: unknown): value is ToolResultUserMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { role?: unknown }).role === "user" &&
    Array.isArray((value as { content?: unknown }).content)
  );
}

/** Translate provider-agnostic messages into Anthropic messages. */
function toAnthropicMessages(messages: readonly TurnMessage[]): unknown[] {
  const out: unknown[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      appendAnthropicUserText(out, m.content);
    } else if (m.role === "assistant") {
      out.push({ role: "assistant", content: m.content });
    } else if (m.role === "assistant_tools") {
      const blocks: unknown[] = [];
      if (m.text.length > 0) blocks.push({ type: "text", text: m.text });
      for (const c of m.toolCalls) {
        blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.input });
      }
      out.push({ role: "assistant", content: blocks });
    } else {
      // Anthropic rejects consecutive same-role messages: merge every
      // tool_result for one tool_use turn into the same user message (a step
      // with N tool calls produces N tool_results in a row).
      const block = { type: "tool_result" as const, tool_use_id: m.callId, content: m.content };
      const last = out[out.length - 1];
      if (isToolResultUser(last)) {
        last.content.push(block);
      } else {
        out.push({ role: "user", content: [block] } satisfies ToolResultUserMessage);
      }
    }
  }
  return out;
}

function appendAnthropicUserText(out: unknown[], text: string): void {
  const last = out[out.length - 1];
  if (!isRecord(last) || last["role"] !== "user") {
    out.push({ role: "user", content: text });
    return;
  }

  const content = last["content"];
  if (typeof content === "string") {
    last["content"] = `${content}\n\n${text}`;
    return;
  }
  if (Array.isArray(content)) {
    content.push({ type: "text", text });
    return;
  }

  last["content"] = text;
}

function parseAnthropicStep(body: unknown): ProviderStep {
  if (!isRecord(body) || !Array.isArray(body["content"])) {
    throw new Error("anthropic response had an unexpected shape (no content[])");
  }
  let text = "";
  const toolCalls: ToolCall[] = [];
  for (const block of body["content"]) {
    if (!isRecord(block)) continue;
    if (block["type"] === "text" && typeof block["text"] === "string") {
      text += block["text"];
    } else if (block["type"] === "tool_use") {
      const id = typeof block["id"] === "string" ? block["id"] : undefined;
      const name = typeof block["name"] === "string" ? block["name"] : undefined;
      if (id === undefined || id.length === 0 || name === undefined || name.length === 0) {
        throw new Error("anthropic response had a malformed tool_use id/name");
      }
      toolCalls.push({ id, name, input: block["input"] ?? {} });
    }
  }
  // Anthropic's `input_tokens` EXCLUDES the cached prefix; add the cache
  // creation/read counts back so the estimator calibrates on the real prompt
  // size (with prompt caching on, most input tokens land in those two fields).
  const usage = readProviderUsage(body["usage"], "input_tokens", "output_tokens", [
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
  ]);
  return { text, toolCalls, ...(usage !== undefined ? { usage } : {}) };
}

export function createAnthropicProvider(
  apiKey: string,
  fetchImpl: FetchImpl = fetch,
  options: ProviderOptions = {},
): ReferenceProvider {
  const timeoutMs = options.timeoutMs ?? TURN_TIMEOUT_MS;
  const model = DEFAULT_ANTHROPIC_MODEL;
  return {
    name: "anthropic",
    model,
    contextWindowTokens: ANTHROPIC_CONTEXT_WINDOW_TOKENS,
    async run(turn, tools) {
      const json = await postJson(
        fetchImpl,
        ANTHROPIC_URL,
        { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION },
        {
          model,
          max_tokens: ANTHROPIC_MAX_TOKENS,
          // One cache breakpoint on `system` caches the stable tools+system
          // prefix (Anthropic's tools → system → messages cache hierarchy).
          system: [{ type: "text", text: turn.system, cache_control: { type: "ephemeral" } }],
          messages: toAnthropicMessages(turn.messages),
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters,
          })),
        },
        timeoutMs,
        "anthropic",
      );
      return parseAnthropicStep(json);
    },
  };
}
