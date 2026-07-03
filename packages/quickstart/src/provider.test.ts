import { describe, expect, it } from "vitest";

import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_OPENAI_MODEL,
  createAnthropicProvider,
  createOpenAiProvider,
  resolveProvider,
  type ProviderTurn,
  type QuickstartProvider,
  type ToolSpec,
} from "./provider.js";

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

interface CapturedRequest {
  readonly url: string;
  readonly init: RequestInit;
}

function createCapturingFetch(makeResponse: () => Response): {
  calls: CapturedRequest[];
  fetchImpl: typeof fetch;
} {
  const calls: CapturedRequest[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return Promise.resolve(makeResponse());
  };
  return { calls, fetchImpl };
}

function okJson(body: unknown): () => Response {
  return () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
}

function httpError(status: number): () => Response {
  return () => new Response(JSON.stringify({ error: "nope" }), { status });
}

/** Never resolves; rejects with an AbortError when the request signal fires. */
const hangingFetch: typeof fetch = (_input, init) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (signal == null) return;
    if (signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    signal.addEventListener("abort", () => {
      reject(new DOMException("aborted", "AbortError"));
    });
  });

function headersOf(request: CapturedRequest): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [key, value] of new Headers(request.init.headers)) {
    record[key.toLowerCase()] = value;
  }
  return record;
}

function bodyOf(request: CapturedRequest): Record<string, unknown> {
  return JSON.parse(String(request.init.body)) as Record<string, unknown>;
}

const TURN: ProviderTurn = {
  system: "You are the quickstart page agent.",
  messages: [
    { role: "user", content: "hello" },
    { role: "assistant", content: "hi there" },
    { role: "user", content: "make me a page" },
  ],
};

const TOOLS: readonly ToolSpec[] = [
  { name: "say", description: "Send a chat message.", parameters: { type: "object" } },
  { name: "render_page", description: "Replace the page.", parameters: { type: "object" } },
];

// ---------------------------------------------------------------------------
// Shared adapter contract — the SAME suite runs against both providers
// ---------------------------------------------------------------------------

interface AdapterCase {
  readonly label: "openai" | "anthropic";
  readonly create: (
    apiKey: string,
    fetchImpl?: typeof fetch,
    options?: { readonly timeoutMs?: number },
  ) => QuickstartProvider;
  readonly url: string;
  readonly defaultModel: string;
  readonly authHeader: string;
  readonly authValue: (apiKey: string) => string;
  readonly extraHeaders: Readonly<Record<string, string>>;
  /** A text-only response (no tool calls). */
  readonly textResponse: (text: string) => unknown;
  /** A single-tool-call response. */
  readonly toolResponse: (id: string, name: string, input: unknown) => unknown;
  /** A response missing the choices/content envelope. */
  readonly malformed: unknown;
  /** Assert the request maps system/messages correctly and offers the tools. */
  readonly assertRequest: (body: Record<string, unknown>, turn: ProviderTurn) => void;
}

const openaiCase: AdapterCase = {
  label: "openai",
  create: createOpenAiProvider,
  url: "https://api.openai.com/v1/chat/completions",
  defaultModel: DEFAULT_OPENAI_MODEL,
  authHeader: "authorization",
  authValue: (apiKey) => `Bearer ${apiKey}`,
  extraHeaders: {},
  textResponse: (text) => ({ choices: [{ message: { content: text } }] }),
  toolResponse: (id, name, input) => ({
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            { id, type: "function", function: { name, arguments: JSON.stringify(input) } },
          ],
        },
      },
    ],
  }),
  malformed: {},
  assertRequest: (body, turn) => {
    const messages = body["messages"] as ReadonlyArray<Record<string, unknown>>;
    expect(messages[0]).toEqual({ role: "system", content: turn.system });
    expect(messages.slice(1)).toEqual(turn.messages);
    expect("system" in body).toBe(false);
    // Tools are offered as OpenAI functions.
    const tools = body["tools"] as ReadonlyArray<Record<string, unknown>>;
    const names = tools.map((t) => (t["function"] as Record<string, unknown>)["name"]);
    expect(names).toContain("say");
    expect(names).toContain("render_page");
    expect(body["tool_choice"]).toBe("auto");
  },
};

const anthropicCase: AdapterCase = {
  label: "anthropic",
  create: createAnthropicProvider,
  url: "https://api.anthropic.com/v1/messages",
  defaultModel: DEFAULT_ANTHROPIC_MODEL,
  authHeader: "x-api-key",
  authValue: (apiKey) => apiKey,
  extraHeaders: { "anthropic-version": "2023-06-01" },
  textResponse: (text) => ({ content: [{ type: "text", text }] }),
  toolResponse: (id, name, input) => ({ content: [{ type: "tool_use", id, name, input }] }),
  malformed: {},
  assertRequest: (body, turn) => {
    expect(body["system"]).toBe(turn.system);
    expect(body["messages"]).toEqual(turn.messages);
    expect(typeof body["max_tokens"]).toBe("number");
    expect(body["max_tokens"]).toBeGreaterThan(0);
    const tools = body["tools"] as ReadonlyArray<Record<string, unknown>>;
    expect(tools.map((t) => t["name"])).toContain("say");
    expect(tools[0]).toHaveProperty("input_schema");
  },
};

describe.each([openaiCase, anthropicCase])("$label adapter contract", (adapter) => {
  const API_KEY = "test-key-123";

  it("POSTs the documented endpoint with the key in the auth header and the model in the body", async () => {
    const { calls, fetchImpl } = createCapturingFetch(okJson(adapter.textResponse("ok")));
    const provider = adapter.create(API_KEY, fetchImpl);

    await provider.run(TURN, TOOLS);

    expect(calls).toHaveLength(1);
    const request = calls[0]!;
    expect(request.url).toBe(adapter.url);
    expect(request.init.method).toBe("POST");
    const headers = headersOf(request);
    expect(headers[adapter.authHeader]).toBe(adapter.authValue(API_KEY));
    for (const [name, value] of Object.entries(adapter.extraHeaders)) {
      expect(headers[name]).toBe(value);
    }
    expect(bodyOf(request)["model"]).toBe(adapter.defaultModel);
  });

  it("maps system + messages and offers the tools", async () => {
    const { calls, fetchImpl } = createCapturingFetch(okJson(adapter.textResponse("ok")));
    const provider = adapter.create(API_KEY, fetchImpl);

    await provider.run(TURN, TOOLS);

    adapter.assertRequest(bodyOf(calls[0]!), TURN);
  });

  it("exposes its name and default model", () => {
    const provider = adapter.create(API_KEY, hangingFetch);
    expect(provider.name).toBe(adapter.label);
    expect(provider.model).toBe(adapter.defaultModel);
  });

  it("parses a text-only step (no tool calls)", async () => {
    const { fetchImpl } = createCapturingFetch(okJson(adapter.textResponse("just chatting")));
    const provider = adapter.create(API_KEY, fetchImpl);

    const step = await provider.run(TURN, TOOLS);
    expect(step.text).toBe("just chatting");
    expect(step.toolCalls).toHaveLength(0);
  });

  it("parses a tool-call step (name + parsed input)", async () => {
    const { fetchImpl } = createCapturingFetch(
      okJson(adapter.toolResponse("call-1", "say", { text: "hi there" })),
    );
    const provider = adapter.create(API_KEY, fetchImpl);

    const step = await provider.run(TURN, TOOLS);
    expect(step.toolCalls).toHaveLength(1);
    expect(step.toolCalls[0]).toMatchObject({
      id: "call-1",
      name: "say",
      input: { text: "hi there" },
    });
  });

  it("rejects on HTTP 4xx", async () => {
    const { fetchImpl } = createCapturingFetch(httpError(401));
    const provider = adapter.create(API_KEY, fetchImpl);
    await expect(provider.run(TURN, TOOLS)).rejects.toThrow(/401/);
  });

  it("rejects on HTTP 5xx", async () => {
    const { fetchImpl } = createCapturingFetch(httpError(500));
    const provider = adapter.create(API_KEY, fetchImpl);
    await expect(provider.run(TURN, TOOLS)).rejects.toThrow(/500/);
  });

  it("rejects on a malformed response envelope", async () => {
    const { fetchImpl } = createCapturingFetch(okJson(adapter.malformed));
    const provider = adapter.create(API_KEY, fetchImpl);
    await expect(provider.run(TURN, TOOLS)).rejects.toThrow();
  });

  it("aborts the attempt at the timeout", async () => {
    const provider = adapter.create(API_KEY, hangingFetch, { timeoutMs: 20 });
    await expect(provider.run(TURN, TOOLS)).rejects.toThrow();
  });

  it("never leaks the key outside the auth header (not in URL or body)", async () => {
    const { calls, fetchImpl } = createCapturingFetch(okJson(adapter.textResponse("ok")));
    const provider = adapter.create(API_KEY, fetchImpl);

    await provider.run(TURN, TOOLS);

    const request = calls[0]!;
    expect(request.url).not.toContain(API_KEY);
    expect(String(request.init.body)).not.toContain(API_KEY);
  });
});

// ---------------------------------------------------------------------------
// resolveProvider matrix
// ---------------------------------------------------------------------------

describe("resolveProvider", () => {
  it("prefers openai when both keys are present", () => {
    const provider = resolveProvider({}, { OPENAI_API_KEY: "o", ANTHROPIC_API_KEY: "a" });
    expect(provider?.name).toBe("openai");
  });

  it("uses anthropic when only its key is present", () => {
    const provider = resolveProvider({}, { ANTHROPIC_API_KEY: "a" });
    expect(provider?.name).toBe("anthropic");
  });

  it("uses openai when only its key is present", () => {
    const provider = resolveProvider({}, { OPENAI_API_KEY: "o" });
    expect(provider?.name).toBe("openai");
  });

  it("returns null when no key is present", () => {
    expect(resolveProvider({}, {})).toBeNull();
  });

  it("honors an explicit --provider override", () => {
    const provider = resolveProvider(
      { provider: "anthropic" },
      { OPENAI_API_KEY: "o", ANTHROPIC_API_KEY: "a" },
    );
    expect(provider?.name).toBe("anthropic");
  });

  it("throws naming the exact env var when --provider lacks its key", () => {
    expect(() => resolveProvider({ provider: "anthropic" }, { OPENAI_API_KEY: "o" })).toThrow(
      /ANTHROPIC_API_KEY/,
    );
    expect(() => resolveProvider({ provider: "openai" }, { ANTHROPIC_API_KEY: "a" })).toThrow(
      /OPENAI_API_KEY/,
    );
  });

  it("throws on an unknown --provider value", () => {
    expect(() => resolveProvider({ provider: "llama" }, {})).toThrow(/llama/);
  });
});
