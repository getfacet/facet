import { describe, expect, it } from "vitest";

import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_OPENAI_MODEL,
  createAnthropicProvider,
  createOpenAiProvider,
  resolveProvider,
  type ProviderTurn,
  type QuickstartProvider,
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
  readonly success: (text: string) => unknown;
  readonly malformed: unknown;
  readonly assertPlacement: (body: Record<string, unknown>, turn: ProviderTurn) => void;
}

const openaiCase: AdapterCase = {
  label: "openai",
  create: createOpenAiProvider,
  url: "https://api.openai.com/v1/chat/completions",
  defaultModel: DEFAULT_OPENAI_MODEL,
  authHeader: "authorization",
  authValue: (apiKey) => `Bearer ${apiKey}`,
  extraHeaders: {},
  success: (text) => ({ choices: [{ message: { content: text } }] }),
  malformed: { choices: [{ message: {} }] },
  assertPlacement: (body, turn) => {
    // System prompt travels as the leading chat message.
    const messages = body["messages"] as ReadonlyArray<Record<string, unknown>>;
    expect(messages[0]).toEqual({ role: "system", content: turn.system });
    expect(messages.slice(1)).toEqual(turn.messages);
    expect("system" in body).toBe(false);
    // JSON mode is requested so the model can't answer in bare prose.
    expect(body["response_format"]).toEqual({ type: "json_object" });
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
  success: (text) => ({ content: [{ type: "text", text }] }),
  malformed: { content: [{ type: "tool_use" }] },
  assertPlacement: (body, turn) => {
    // System prompt travels top-level; max_tokens is explicit.
    expect(body["system"]).toBe(turn.system);
    expect(body["messages"]).toEqual(turn.messages);
    expect(typeof body["max_tokens"]).toBe("number");
    expect(body["max_tokens"]).toBeGreaterThan(0);
  },
};

describe.each([openaiCase, anthropicCase])("$label adapter contract", (adapter) => {
  const API_KEY = "test-key-123";

  it("POSTs the documented endpoint with the key in the auth header and the model in the body", async () => {
    const { calls, fetchImpl } = createCapturingFetch(okJson(adapter.success("ok")));
    const provider = adapter.create(API_KEY, fetchImpl);

    await provider.generate(TURN);

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

  it("places system and messages where the provider expects them", async () => {
    const { calls, fetchImpl } = createCapturingFetch(okJson(adapter.success("ok")));
    const provider = adapter.create(API_KEY, fetchImpl);

    await provider.generate(TURN);

    adapter.assertPlacement(bodyOf(calls[0]!), TURN);
  });

  it("exposes its name and default model", () => {
    const provider = adapter.create(API_KEY, hangingFetch);
    expect(provider.name).toBe(adapter.label);
    expect(provider.model).toBe(adapter.defaultModel);
  });

  it("extracts the reply text from a successful response", async () => {
    const { fetchImpl } = createCapturingFetch(okJson(adapter.success("the reply text")));
    const provider = adapter.create(API_KEY, fetchImpl);

    await expect(provider.generate(TURN)).resolves.toBe("the reply text");
  });

  it("rejects on HTTP 4xx", async () => {
    const { fetchImpl } = createCapturingFetch(httpError(401));
    const provider = adapter.create(API_KEY, fetchImpl);

    await expect(provider.generate(TURN)).rejects.toThrow(/401/);
  });

  it("rejects on HTTP 5xx", async () => {
    const { fetchImpl } = createCapturingFetch(httpError(500));
    const provider = adapter.create(API_KEY, fetchImpl);

    await expect(provider.generate(TURN)).rejects.toThrow(/500/);
  });

  it("rejects on a malformed response shape", async () => {
    const { fetchImpl } = createCapturingFetch(okJson(adapter.malformed));
    const provider = adapter.create(API_KEY, fetchImpl);

    await expect(provider.generate(TURN)).rejects.toThrow();
  });

  it("aborts the attempt at the timeout", async () => {
    const provider = adapter.create(API_KEY, hangingFetch, { timeoutMs: 20 });

    await expect(provider.generate(TURN)).rejects.toThrow();
  });

  it("never leaks the key outside the auth header (not in URL or body)", async () => {
    const { calls, fetchImpl } = createCapturingFetch(okJson(adapter.success("ok")));
    const provider = adapter.create(API_KEY, fetchImpl);

    await provider.generate(TURN);

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
    const provider = resolveProvider(
      {},
      { OPENAI_API_KEY: "sk-openai", ANTHROPIC_API_KEY: "sk-ant" },
    );
    expect(provider?.name).toBe("openai");
  });

  it("falls back to anthropic when only ANTHROPIC_API_KEY is present", () => {
    const provider = resolveProvider({}, { ANTHROPIC_API_KEY: "sk-ant" });
    expect(provider?.name).toBe("anthropic");
  });

  it("picks openai when only OPENAI_API_KEY is present", () => {
    const provider = resolveProvider({}, { OPENAI_API_KEY: "sk-openai" });
    expect(provider?.name).toBe("openai");
  });

  it("honors --provider anthropic even when the openai key is also present", () => {
    const provider = resolveProvider(
      { provider: "anthropic" },
      { OPENAI_API_KEY: "sk-openai", ANTHROPIC_API_KEY: "sk-ant" },
    );
    expect(provider?.name).toBe("anthropic");
  });

  it("throws naming ANTHROPIC_API_KEY when --provider anthropic lacks its key", () => {
    expect(() =>
      resolveProvider({ provider: "anthropic" }, { OPENAI_API_KEY: "sk-openai" }),
    ).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("throws naming OPENAI_API_KEY when --provider openai lacks its key", () => {
    expect(() => resolveProvider({ provider: "openai" }, { ANTHROPIC_API_KEY: "sk-ant" })).toThrow(
      /OPENAI_API_KEY/,
    );
  });

  it("returns null when no key is present and no provider is forced", () => {
    expect(resolveProvider({}, {})).toBeNull();
  });

  it("never echoes a key value in the missing-key error", () => {
    try {
      resolveProvider({ provider: "openai" }, { ANTHROPIC_API_KEY: "sk-ant-secret" });
      expect.unreachable("resolveProvider should have thrown");
    } catch (error) {
      expect(String(error)).not.toContain("sk-ant-secret");
    }
  });
});
