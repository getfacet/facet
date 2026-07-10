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
    // One ephemeral cache breakpoint on the system block caches the stable
    // tools+system prefix (see the reference-agent anthropic adapter).
    expect(body["system"]).toEqual([
      { type: "text", text: turn.system, cache_control: { type: "ephemeral" } },
    ]);
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
// Tool-loop wire translation — the assistant_tools/tool_result mapping that
// carries the multi-step loop (a field-name or shape regression here silently
// breaks every multi-turn conversation).
// ---------------------------------------------------------------------------

const API_KEY = "wire-key";

/** A turn mid-loop: user prompt → the model called two tools → two observations. */
const TOOL_LOOP_TURN: ProviderTurn = {
  system: "sys",
  messages: [
    { role: "user", content: "make a page" },
    {
      role: "assistant_tools",
      text: "",
      toolCalls: [
        { id: "t1", name: "render_page", input: { tree: { root: "root" } } },
        { id: "t2", name: "say", input: { text: "done" } },
      ],
    },
    { role: "tool_result", callId: "t1", content: "ok: page replaced" },
    { role: "tool_result", callId: "t2", content: "ok: said" },
  ],
};

describe("openai tool-loop wire translation", () => {
  it("maps assistant_tools to tool_calls and each tool_result to a role:tool message", async () => {
    const { calls, fetchImpl } = createCapturingFetch(okJson(openaiCase.textResponse("")));
    await createOpenAiProvider(API_KEY, fetchImpl).run(TOOL_LOOP_TURN, TOOLS);
    const messages = bodyOf(calls[0]!)["messages"] as Array<Record<string, unknown>>;

    const assistant = messages.find((m) => m["role"] === "assistant" && "tool_calls" in m)!;
    const toolCalls = assistant["tool_calls"] as Array<Record<string, unknown>>;
    expect(toolCalls.map((c) => c["id"])).toEqual(["t1", "t2"]);
    expect((toolCalls[0]!["function"] as Record<string, unknown>)["name"]).toBe("render_page");

    const toolMsgs = messages.filter((m) => m["role"] === "tool");
    expect(toolMsgs.map((m) => m["tool_call_id"])).toEqual(["t1", "t2"]);
    expect(toolMsgs[0]!["content"]).toBe("ok: page replaced");
  });

  it("captures an unparseable tool-argument string as a __parseError", async () => {
    const badArgs = {
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: "x", type: "function", function: { name: "say", arguments: "{not json" } },
            ],
          },
        },
      ],
    };
    const { fetchImpl } = createCapturingFetch(okJson(badArgs));
    const step = await createOpenAiProvider(API_KEY, fetchImpl).run(TURN, TOOLS);
    expect(step.toolCalls[0]!.input).toMatchObject({ __parseError: "{not json" });
  });
});

describe("anthropic tool-loop wire translation", () => {
  it("maps assistant_tools to tool_use blocks and MERGES consecutive tool_results into one user message", async () => {
    const { calls, fetchImpl } = createCapturingFetch(okJson(anthropicCase.textResponse("")));
    await createAnthropicProvider(API_KEY, fetchImpl).run(TOOL_LOOP_TURN, TOOLS);
    const messages = bodyOf(calls[0]!)["messages"] as Array<Record<string, unknown>>;

    // assistant turn carries both tool_use blocks
    const assistant = messages.find((m) => m["role"] === "assistant")!;
    const blocks = assistant["content"] as Array<Record<string, unknown>>;
    const uses = blocks.filter((b) => b["type"] === "tool_use");
    expect(uses.map((b) => b["id"])).toEqual(["t1", "t2"]);

    // both tool_results collapse into ONE user message (Anthropic rejects
    // consecutive same-role messages)
    const userMsgs = messages.filter((m) => m["role"] === "user");
    const resultUser = userMsgs.find((m) => Array.isArray(m["content"]))!;
    const results = resultUser["content"] as Array<Record<string, unknown>>;
    expect(results).toHaveLength(2);
    expect(results.map((r) => r["tool_use_id"])).toEqual(["t1", "t2"]);
    expect(results[0]!["type"]).toBe("tool_result");
    // …and no two consecutive user messages exist in the final body.
    const roles = messages.map((m) => m["role"]);
    for (let i = 1; i < roles.length; i += 1) {
      expect(roles[i] === "user" && roles[i - 1] === "user").toBe(false);
    }
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
