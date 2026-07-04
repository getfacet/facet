/**
 * Provider layer for the quickstart's built-in agent (spec Decision 4).
 *
 * The built-in agent is a TOOL-CALLING loop, not a single-shot completion: each
 * turn the model calls tools (append/set/remove a node, render the whole page,
 * say a chat line) across multiple steps, observing each result. So a provider
 * here exposes native tool-use — `run(turn, tools)` returns the model's tool
 * calls (and any prose) for one step; the agent executes them and loops.
 *
 * Raw `fetch`, no SDK dependencies: each adapter is one POST endpoint plus one
 * response shape, so the official SDKs would add two heavyweight dependency
 * trees to an npx-first package for zero capability. `fetchImpl` is injectable
 * so the shared contract suite exercises both adapters against mocked HTTP.
 *
 * API keys are read from env by `resolveProvider`, travel ONLY in the provider's
 * auth header, and are never logged or echoed in errors (messages name the env
 * VAR, never its value).
 */

/** A tool offered to the model: a name, a description, and a JSON-schema for its input. */
export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

/** One tool call the model wants to make, with its arguments already parsed. */
export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

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

export const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5";
/** Per-attempt abort deadline for one `run` call. */
export const TURN_TIMEOUT_MS = 60_000;

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_MAX_TOKENS = 8192;

export interface ProviderOptions {
  /** Override the per-attempt timeout (tests inject a short one). */
  readonly timeoutMs?: number;
}

type FetchImpl = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function postJson(
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

// ── OpenAI (chat completions + function tools) ────────────────────────────────

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
  const rawCalls = Array.isArray(message["tool_calls"]) ? message["tool_calls"] : [];
  const toolCalls: ToolCall[] = [];
  for (const raw of rawCalls) {
    if (!isRecord(raw) || !isRecord(raw["function"])) continue;
    const fn = raw["function"];
    const id = typeof raw["id"] === "string" ? raw["id"] : "";
    const name = typeof fn["name"] === "string" ? fn["name"] : "";
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
  return { text, toolCalls };
}

export function createOpenAiProvider(
  apiKey: string,
  fetchImpl: FetchImpl = fetch,
  options: ProviderOptions = {},
): QuickstartProvider {
  const timeoutMs = options.timeoutMs ?? TURN_TIMEOUT_MS;
  const model = DEFAULT_OPENAI_MODEL;
  return {
    name: "openai",
    model,
    async run(turn, tools) {
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
      );
      return parseOpenAiStep(json);
    },
  };
}

// ── Anthropic (messages + tool_use) ───────────────────────────────────────────

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
      out.push({ role: "user", content: m.content });
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
      // Anthropic rejects consecutive same-role messages: MERGE every
      // tool_result for one tool_use turn into the SAME user message (a step
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
      const id = typeof block["id"] === "string" ? block["id"] : "";
      const name = typeof block["name"] === "string" ? block["name"] : "";
      toolCalls.push({ id, name, input: block["input"] ?? {} });
    }
  }
  return { text, toolCalls };
}

export function createAnthropicProvider(
  apiKey: string,
  fetchImpl: FetchImpl = fetch,
  options: ProviderOptions = {},
): QuickstartProvider {
  const timeoutMs = options.timeoutMs ?? TURN_TIMEOUT_MS;
  const model = DEFAULT_ANTHROPIC_MODEL;
  return {
    name: "anthropic",
    model,
    async run(turn, tools) {
      const json = await postJson(
        fetchImpl,
        ANTHROPIC_URL,
        { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION },
        {
          model,
          max_tokens: ANTHROPIC_MAX_TOKENS,
          system: turn.system,
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

// ── key/flag resolution ───────────────────────────────────────────────────────

export interface ResolveProviderFlags {
  readonly provider?: string;
}

/**
 * Deterministic key/flag resolution (spec Decision 4):
 * - explicit `--provider` wins and REQUIRES its own key (missing ⇒ throw
 *   naming exactly `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` — the name only);
 * - no flag ⇒ `OPENAI_API_KEY` ⇒ openai (also when both keys are present),
 *   else `ANTHROPIC_API_KEY` ⇒ anthropic, else `null`.
 */
export function resolveProvider(
  flags: ResolveProviderFlags,
  env: Readonly<Record<string, string | undefined>>,
): QuickstartProvider | null {
  const openaiKey = env["OPENAI_API_KEY"];
  const anthropicKey = env["ANTHROPIC_API_KEY"];

  if (flags.provider === "openai") {
    if (!openaiKey) {
      throw new Error("--provider openai requires OPENAI_API_KEY to be set");
    }
    return createOpenAiProvider(openaiKey);
  }
  if (flags.provider === "anthropic") {
    if (!anthropicKey) {
      throw new Error("--provider anthropic requires ANTHROPIC_API_KEY to be set");
    }
    return createAnthropicProvider(anthropicKey);
  }
  if (flags.provider !== undefined) {
    throw new Error(`Unknown provider "${flags.provider}" — expected "openai" or "anthropic"`);
  }

  if (openaiKey) return createOpenAiProvider(openaiKey);
  if (anthropicKey) return createAnthropicProvider(anthropicKey);
  return null;
}
