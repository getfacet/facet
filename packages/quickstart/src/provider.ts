/**
 * Provider layer for the quickstart's built-in agent (spec Decision 4).
 *
 * Raw `fetch`, no SDK dependencies: each adapter is one POST endpoint plus one
 * JSON response shape, so the official SDKs would add two heavyweight
 * dependency trees to an npx-first package for zero capability. `fetchImpl`
 * is injectable so the shared contract suite exercises both adapters against
 * mocked HTTP with no network.
 *
 * API keys are read from env by `resolveProvider`, travel ONLY in the
 * provider's auth header, and are never logged or echoed in errors (error
 * messages name the env VAR, never its value).
 */

export interface ProviderMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface ProviderTurn {
  readonly system: string;
  readonly messages: readonly ProviderMessage[];
}

export interface QuickstartProvider {
  readonly name: "openai" | "anthropic";
  readonly model: string;
  /** One completion. Rejects on HTTP error, malformed body, or the 60s timeout. */
  generate(turn: ProviderTurn): Promise<string>;
}

export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5";
/** Per-attempt abort deadline for one `generate` call. */
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

/**
 * Shared adapter plumbing: POST JSON with an AbortController deadline,
 * reject on !ok, return the parsed body for shape-specific extraction.
 */
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

function extractOpenAiText(body: unknown): string {
  if (isRecord(body) && Array.isArray(body["choices"])) {
    const first: unknown = body["choices"][0];
    if (isRecord(first) && isRecord(first["message"])) {
      const content = first["message"]["content"];
      if (typeof content === "string") return content;
    }
  }
  throw new Error("openai response had an unexpected shape (no choices[0].message.content)");
}

function extractAnthropicText(body: unknown): string {
  if (isRecord(body) && Array.isArray(body["content"])) {
    const first: unknown = body["content"][0];
    if (isRecord(first) && typeof first["text"] === "string") {
      return first["text"];
    }
  }
  throw new Error("anthropic response had an unexpected shape (no content[0].text)");
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
    async generate(turn) {
      const json = await postJson(
        fetchImpl,
        OPENAI_URL,
        { Authorization: `Bearer ${apiKey}` },
        {
          model,
          // JSON mode: force a syntactically valid JSON object so the model
          // can't answer a chat turn in bare prose (the contract already says
          // "ONE JSON object", which json_object mode requires in the prompt).
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: turn.system },
            ...turn.messages.map((m) => ({ role: m.role, content: m.content })),
          ],
        },
        timeoutMs,
        "openai",
      );
      return extractOpenAiText(json);
    },
  };
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
    async generate(turn) {
      const json = await postJson(
        fetchImpl,
        ANTHROPIC_URL,
        { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION },
        {
          model,
          max_tokens: ANTHROPIC_MAX_TOKENS,
          system: turn.system,
          messages: turn.messages.map((m) => ({ role: m.role, content: m.content })),
        },
        timeoutMs,
        "anthropic",
      );
      return extractAnthropicText(json);
    },
  };
}

export interface ResolveProviderFlags {
  readonly provider?: string;
}

/**
 * Deterministic key/flag resolution (spec Decision 4):
 * - explicit `--provider` wins and REQUIRES its own key (missing ⇒ throw
 *   naming exactly `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` — the name only,
 *   never a value);
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
