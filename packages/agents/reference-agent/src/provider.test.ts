import { describe, expect, it, vi } from "vitest";
import { FACET_STAGE_TOOL_SPECS } from "@facet/agent-tools";

import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_OPENAI_MODEL,
  TURN_TIMEOUT_MS,
  createAnthropicProvider,
  createOpenAiProvider,
  resolveProvider,
  type ProviderTurn,
  type ReferenceProvider,
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

const PROVIDER_TOOLS: readonly ToolSpec[] = [
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
    options?: { readonly timeoutMs?: number; readonly model?: string },
  ) => ReferenceProvider;
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

  it("provider adapters preserve request contracts", async () => {
    const { calls, fetchImpl } = createCapturingFetch(okJson(adapter.textResponse("ok")));
    const provider = adapter.create(API_KEY, fetchImpl);

    await provider.run(TURN, PROVIDER_TOOLS);

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

    await provider.run(TURN, PROVIDER_TOOLS);

    adapter.assertRequest(bodyOf(calls[0]!), TURN);
  });

  it("exposes its name and default model", () => {
    const provider = adapter.create(API_KEY, hangingFetch);
    expect(provider.name).toBe(adapter.label);
    expect(provider.model).toBe(adapter.defaultModel);
  });

  it("supports configured models and caller abort", async () => {
    const configuredModel = `${adapter.label}-configured-model`;
    const { calls, fetchImpl } = createCapturingFetch(okJson(adapter.textResponse("ok")));
    const configured = adapter.create(API_KEY, fetchImpl, {
      model: `  ${configuredModel}  `,
    });

    await configured.run(TURN, PROVIDER_TOOLS);

    expect(configured.model).toBe(configuredModel);
    expect(bodyOf(calls[0]!)["model"]).toBe(configuredModel);
    expect(() => adapter.create(API_KEY, fetchImpl, { model: "   " })).toThrow(/model/i);
    expect(() => adapter.create(API_KEY, fetchImpl, { model: "m".repeat(201) })).toThrow(/model/i);

    const caller = new AbortController();
    const addListener = vi.spyOn(caller.signal, "addEventListener");
    const removeListener = vi.spyOn(caller.signal, "removeEventListener");
    const abortable = adapter.create(API_KEY, hangingFetch, { timeoutMs: 10_000 });
    const request = abortable.run(TURN, PROVIDER_TOOLS, { signal: caller.signal });

    caller.abort();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(addListener).toHaveBeenCalledWith("abort", expect.any(Function), { once: true });
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));

    const twoArgumentProvider: ReferenceProvider = {
      name: adapter.label,
      model: adapter.defaultModel,
      run: async (_turn, _tools) => ({ text: "compatible", toolCalls: [] }),
    };
    await expect(
      twoArgumentProvider.run(TURN, PROVIDER_TOOLS, { signal: caller.signal }),
    ).resolves.toMatchObject({ text: "compatible" });
  });

  it("parses a text-only step (no tool calls)", async () => {
    const { fetchImpl } = createCapturingFetch(okJson(adapter.textResponse("just chatting")));
    const provider = adapter.create(API_KEY, fetchImpl);

    const step = await provider.run(TURN, PROVIDER_TOOLS);
    expect(step.text).toBe("just chatting");
    expect(step.toolCalls).toHaveLength(0);
  });

  it("parses a tool-call step (name + parsed input)", async () => {
    const { fetchImpl } = createCapturingFetch(
      okJson(adapter.toolResponse("call-1", "say", { text: "hi there" })),
    );
    const provider = adapter.create(API_KEY, fetchImpl);

    const step = await provider.run(TURN, PROVIDER_TOOLS);
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
    await expect(provider.run(TURN, PROVIDER_TOOLS)).rejects.toThrow(/401/);
  });

  it("rejects on HTTP 5xx", async () => {
    const { fetchImpl } = createCapturingFetch(httpError(500));
    const provider = adapter.create(API_KEY, fetchImpl);
    await expect(provider.run(TURN, PROVIDER_TOOLS)).rejects.toThrow(/500/);
  });

  it("rejects on a malformed response envelope", async () => {
    const { fetchImpl } = createCapturingFetch(okJson(adapter.malformed));
    const provider = adapter.create(API_KEY, fetchImpl);
    await expect(provider.run(TURN, PROVIDER_TOOLS)).rejects.toThrow();
  });

  it("aborts the attempt at the timeout", async () => {
    const provider = adapter.create(API_KEY, hangingFetch, { timeoutMs: 20 });
    await expect(provider.run(TURN, PROVIDER_TOOLS)).rejects.toThrow();
  });

  it("never leaks the key outside the auth header (not in URL or body)", async () => {
    const { calls, fetchImpl } = createCapturingFetch(okJson(adapter.textResponse("ok")));
    const provider = adapter.create(API_KEY, fetchImpl);

    await provider.run(TURN, PROVIDER_TOOLS);

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

const PATTERN_TOOL = FACET_STAGE_TOOL_SPECS.find((tool) => tool.name === "get_pattern")!;
const EXACT_PATTERN_RESULT = JSON.stringify({
  tool: "get_pattern",
  status: "ok",
  outcome: "no_stage_change",
  data: JSON.stringify({
    name: "hero",
    description: "A compact hero reference.",
    useWhen: "Use for one focused introduction.",
    root: "hero.root",
    nodes: { "hero.root": { id: "hero.root", type: "text", value: "Build boldly" } },
  }),
});
const PATTERN_WIRE_TURN: ProviderTurn = {
  system: "sys",
  messages: [
    { role: "user", content: "show me a reference" },
    {
      role: "assistant_tools",
      text: "",
      toolCalls: [{ id: "pattern-1", name: "get_pattern", input: { name: "hero" } }],
    },
    { role: "tool_result", callId: "pattern-1", content: EXACT_PATTERN_RESULT },
  ],
};

describe.each([openaiCase, anthropicCase])("$label canonical Pattern wire", (adapter) => {
  it("maps the shared name-only schema and exact result unchanged", async () => {
    const { calls, fetchImpl } = createCapturingFetch(okJson(adapter.textResponse("")));

    await adapter.create(API_KEY, fetchImpl).run(PATTERN_WIRE_TURN, [PATTERN_TOOL]);

    const body = bodyOf(calls[0]!);
    const tools = body["tools"] as Array<Record<string, unknown>>;
    if (adapter.label === "openai") {
      const fn = tools[0]!["function"] as Record<string, unknown>;
      expect(fn["name"]).toBe("get_pattern");
      expect(fn["parameters"]).toEqual(PATTERN_TOOL.parameters);

      const messages = body["messages"] as Array<Record<string, unknown>>;
      const assistant = messages.find((message) => message["role"] === "assistant")!;
      const calls = assistant["tool_calls"] as Array<Record<string, unknown>>;
      expect(calls[0]).toMatchObject({
        id: "pattern-1",
        function: { name: "get_pattern", arguments: JSON.stringify({ name: "hero" }) },
      });
      const result = messages.find((message) => message["role"] === "tool")!;
      expect(result["content"]).toBe(EXACT_PATTERN_RESULT);
      return;
    }

    expect(tools[0]!["name"]).toBe("get_pattern");
    expect(tools[0]!["input_schema"]).toEqual(PATTERN_TOOL.parameters);
    const messages = body["messages"] as Array<Record<string, unknown>>;
    const assistant = messages.find((message) => message["role"] === "assistant")!;
    const uses = assistant["content"] as Array<Record<string, unknown>>;
    expect(uses[0]).toEqual({
      type: "tool_use",
      id: "pattern-1",
      name: "get_pattern",
      input: { name: "hero" },
    });
    const resultMessage = messages.find(
      (message) =>
        Array.isArray(message["content"]) &&
        message["content"].some(
          (block: unknown) =>
            typeof block === "object" &&
            block !== null &&
            (block as Record<string, unknown>)["type"] === "tool_result",
        ),
    )!;
    const results = resultMessage["content"] as Array<Record<string, unknown>>;
    expect(results[0]).toEqual({
      type: "tool_result",
      tool_use_id: "pattern-1",
      content: EXACT_PATTERN_RESULT,
    });
  });
});

describe("openai tool-loop wire translation", () => {
  it("maps assistant_tools to tool_calls and each tool_result to a role:tool message", async () => {
    const { calls, fetchImpl } = createCapturingFetch(okJson(openaiCase.textResponse("")));
    await createOpenAiProvider(API_KEY, fetchImpl).run(TOOL_LOOP_TURN, PROVIDER_TOOLS);
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
    const step = await createOpenAiProvider(API_KEY, fetchImpl).run(TURN, PROVIDER_TOOLS);
    expect(step.toolCalls[0]!.input).toMatchObject({ __parseError: "{not json" });
  });

  it("rejects malformed tool_calls fields that are present but not arrays", async () => {
    const malformed = {
      choices: [
        {
          message: {
            content: null,
            tool_calls: { id: "call_1" },
          },
        },
      ],
    };
    const { fetchImpl } = createCapturingFetch(okJson(malformed));

    await expect(
      createOpenAiProvider(API_KEY, fetchImpl).run(TURN, PROVIDER_TOOLS),
    ).rejects.toThrow(/malformed tool_calls/);
  });

  it("rejects malformed tool calls that lack a usable id or name", async () => {
    for (const toolCall of [
      { id: "", type: "function", function: { name: "say", arguments: "{}" } },
      { id: "call_1", type: "function", function: { name: "", arguments: "{}" } },
      { id: "call_1", type: "function" },
    ]) {
      const malformed = {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [toolCall],
            },
          },
        ],
      };
      const { fetchImpl } = createCapturingFetch(okJson(malformed));

      await expect(
        createOpenAiProvider(API_KEY, fetchImpl).run(TURN, PROVIDER_TOOLS),
      ).rejects.toThrow(/malformed tool_call/);
    }
  });
});

describe("openai Responses API translation", () => {
  const RESPONSES_URL = "https://api.openai.com/v1/responses";

  it.each(["gpt-5.5-pro", "gpt-5.5-pro-2026-04-23", "gpt-5.4-pro", "gpt-5.4-pro-2026-03-05"])(
    "routes %s through Responses and preserves the tool loop",
    async (model) => {
      const { calls, fetchImpl } = createCapturingFetch(
        okJson({
          status: "completed",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "done" }],
            },
          ],
        }),
      );

      const step = await createOpenAiProvider(API_KEY, fetchImpl, { model }).run(
        TOOL_LOOP_TURN,
        PROVIDER_TOOLS,
      );

      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toBe(RESPONSES_URL);
      const body = bodyOf(calls[0]!);
      expect(body["model"]).toBe(model);
      expect(body["instructions"]).toBe(TOOL_LOOP_TURN.system);
      expect(body["tool_choice"]).toBe("auto");
      expect(body["include"]).toEqual(["reasoning.encrypted_content"]);
      expect(body["store"]).toBe(false);
      expect(body["tools"]).toEqual(
        PROVIDER_TOOLS.map((tool) => ({
          type: "function",
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        })),
      );

      const input = body["input"] as Array<Record<string, unknown>>;
      expect(input[0]).toEqual({ role: "user", content: "make a page" });
      expect(input[1]).toEqual({
        type: "function_call",
        call_id: "t1",
        name: "render_page",
        arguments: JSON.stringify({ tree: { root: "root" } }),
      });
      expect(input[2]).toEqual({
        type: "function_call",
        call_id: "t2",
        name: "say",
        arguments: JSON.stringify({ text: "done" }),
      });
      expect(input[3]).toEqual({
        type: "function_call_output",
        call_id: "t1",
        output: "ok: page replaced",
      });
      expect(input[4]).toEqual({
        type: "function_call_output",
        call_id: "t2",
        output: "ok: said",
      });
      expect(step).toMatchObject({ text: "done", toolCalls: [] });
    },
  );

  it("parses Responses text, function calls, and usage", async () => {
    const { fetchImpl } = createCapturingFetch(
      okJson({
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [
              { type: "output_text", text: "Working. " },
              { type: "output_text", text: "Done." },
            ],
          },
          {
            type: "function_call",
            call_id: "call-7",
            name: "say",
            arguments: JSON.stringify({ text: "hello" }),
          },
        ],
        usage: { input_tokens: 321, output_tokens: 45 },
      }),
    );

    const step = await createOpenAiProvider(API_KEY, fetchImpl, {
      model: "gpt-5.5-pro",
    }).run(TURN, PROVIDER_TOOLS);

    expect(step).toMatchObject({
      text: "Working. Done.",
      toolCalls: [{ id: "call-7", name: "say", input: { text: "hello" } }],
      usage: { inputTokens: 321, outputTokens: 45 },
      providerState: expect.any(Array),
    });
  });

  it("replays opaque reasoning items and assistant phases before tool results", async () => {
    const providerState = [
      {
        type: "reasoning",
        id: "reasoning-1",
        encrypted_content: "encrypted-state",
        summary: [],
      },
      {
        type: "message",
        id: "message-1",
        role: "assistant",
        status: "completed",
        phase: "commentary",
        content: [{ type: "output_text", text: "I will inspect it first." }],
      },
      {
        type: "function_call",
        id: "function-1",
        call_id: "call-1",
        name: "inspect_stage",
        arguments: "{}",
        status: "completed",
      },
    ] as const;
    const first = createCapturingFetch(okJson({ status: "completed", output: providerState }));
    const firstStep = await createOpenAiProvider(API_KEY, first.fetchImpl, {
      model: "gpt-5.5-pro",
    }).run(TURN, PROVIDER_TOOLS);

    expect(firstStep.providerState).toEqual(providerState);

    const second = createCapturingFetch(
      okJson({
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            status: "completed",
            phase: "final_answer",
            content: [{ type: "output_text", text: "Done." }],
          },
        ],
      }),
    );
    await createOpenAiProvider(API_KEY, second.fetchImpl, {
      model: "gpt-5.5-pro",
    }).run(
      {
        system: "sys",
        messages: [
          { role: "user", content: "Inspect the stage." },
          {
            role: "assistant_tools",
            text: firstStep.text,
            toolCalls: firstStep.toolCalls,
            providerState: firstStep.providerState,
          },
          { role: "tool_result", callId: "call-1", content: "stage is empty" },
        ],
      },
      PROVIDER_TOOLS,
    );

    expect(bodyOf(second.calls[0]!)["input"]).toEqual([
      { role: "user", content: "Inspect the stage." },
      ...providerState,
      { type: "function_call_output", call_id: "call-1", output: "stage is empty" },
    ]);
  });

  it("rejects non-completed Responses and unfinished output items", async () => {
    for (const response of [
      { output: [] },
      { status: null, output: [] },
      { status: 1, output: [] },
      { status: "incomplete", output: [] },
      { status: "failed", output: [] },
      {
        status: "completed",
        output: [
          {
            type: "function_call",
            call_id: "call-1",
            name: "say",
            arguments: "{}",
            status: "incomplete",
          },
        ],
      },
    ]) {
      const { fetchImpl } = createCapturingFetch(okJson(response));
      await expect(
        createOpenAiProvider(API_KEY, fetchImpl, { model: "gpt-5.4-pro" }).run(
          TURN,
          PROVIDER_TOOLS,
        ),
      ).rejects.toThrow(/not complete|unfinished/);
    }
  });

  it("surfaces a valid Responses refusal as provider text", async () => {
    const { fetchImpl } = createCapturingFetch(
      okJson({
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            status: "completed",
            phase: "final_answer",
            content: [{ type: "refusal", refusal: "I cannot help with that." }],
          },
        ],
      }),
    );

    const step = await createOpenAiProvider(API_KEY, fetchImpl, {
      model: "gpt-5.4-pro",
    }).run(TURN, PROVIDER_TOOLS);

    expect(step.text).toBe("I cannot help with that.");
    expect(step.toolCalls).toEqual([]);
  });

  it("keeps malformed Responses function arguments observable", async () => {
    const { fetchImpl } = createCapturingFetch(
      okJson({
        status: "completed",
        output: [
          {
            type: "function_call",
            call_id: "call-bad",
            name: "say",
            arguments: "{not json",
          },
        ],
      }),
    );

    const step = await createOpenAiProvider(API_KEY, fetchImpl, {
      model: "gpt-5.4-pro",
    }).run(TURN, PROVIDER_TOOLS);

    expect(step.toolCalls[0]!.input).toEqual({ __parseError: "{not json" });
  });

  it("rejects malformed Responses output items", async () => {
    for (const output of [
      undefined,
      [{ type: "function_call", call_id: "", name: "say", arguments: "{}" }],
      [{ type: "function_call", call_id: "call-1", name: "", arguments: "{}" }],
    ]) {
      const { fetchImpl } = createCapturingFetch(okJson({ status: "completed", output }));
      await expect(
        createOpenAiProvider(API_KEY, fetchImpl, { model: "gpt-5.4-pro" }).run(
          TURN,
          PROVIDER_TOOLS,
        ),
      ).rejects.toThrow(/openai Responses response/);
    }
  });

  it("gives slow Pro requests a bounded ten-minute default while preserving cancellation", async () => {
    vi.useFakeTimers();
    try {
      const caller = new AbortController();
      let settled = false;
      const request = createOpenAiProvider(API_KEY, hangingFetch, {
        model: "gpt-5.5-pro",
      })
        .run(TURN, PROVIDER_TOOLS, { signal: caller.signal })
        .then(
          () => {
            settled = true;
            return undefined;
          },
          (error: unknown) => {
            settled = true;
            return error;
          },
        );

      await vi.advanceTimersByTimeAsync(TURN_TIMEOUT_MS);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(9 * TURN_TIMEOUT_MS);
      await expect(request).resolves.toMatchObject({ name: "AbortError" });
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("anthropic tool-loop wire translation", () => {
  it("merges consecutive user text messages before sending the Anthropic request", async () => {
    const { calls, fetchImpl } = createCapturingFetch(okJson(anthropicCase.textResponse("")));
    await createAnthropicProvider(API_KEY, fetchImpl).run(
      {
        system: "sys",
        messages: [
          { role: "assistant", content: "[history compacted: dropped 1 older turn(s)]" },
          { role: "user", content: "kept history user" },
          { role: "user", content: "current request" },
        ],
      },
      PROVIDER_TOOLS,
    );
    const messages = bodyOf(calls[0]!)["messages"] as Array<Record<string, unknown>>;
    const roles = messages.map((m) => m["role"]);

    for (let i = 1; i < roles.length; i += 1) {
      expect(roles[i] === "user" && roles[i - 1] === "user").toBe(false);
    }
    expect(messages.at(-1)).toEqual({
      role: "user",
      content: "kept history user\n\ncurrent request",
    });
  });

  it("keeps a compacted Anthropic turn starting with user content", async () => {
    const { calls, fetchImpl } = createCapturingFetch(okJson(anthropicCase.textResponse("")));
    await createAnthropicProvider(API_KEY, fetchImpl).run(
      {
        system: "sys",
        messages: [
          { role: "user", content: "[history compacted: dropped 4 older turn(s)]" },
          { role: "user", content: "current request" },
        ],
      },
      PROVIDER_TOOLS,
    );
    const messages = bodyOf(calls[0]!)["messages"] as Array<Record<string, unknown>>;

    expect(messages[0]).toEqual({
      role: "user",
      content: "[history compacted: dropped 4 older turn(s)]\n\ncurrent request",
    });
  });

  it("rejects malformed tool_use blocks that lack a usable id or name", async () => {
    for (const block of [
      { type: "tool_use", id: "", name: "say", input: { text: "hello" } },
      { type: "tool_use", id: "tool_1", name: "", input: { text: "hello" } },
    ]) {
      const malformed = { content: [block] };
      const { fetchImpl } = createCapturingFetch(okJson(malformed));

      await expect(
        createAnthropicProvider(API_KEY, fetchImpl).run(TURN, PROVIDER_TOOLS),
      ).rejects.toThrow(/malformed tool_use/);
    }
  });

  it("maps assistant_tools to tool_use blocks and MERGES consecutive tool_results into one user message", async () => {
    const { calls, fetchImpl } = createCapturingFetch(okJson(anthropicCase.textResponse("")));
    await createAnthropicProvider(API_KEY, fetchImpl).run(TOOL_LOOP_TURN, PROVIDER_TOOLS);
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
// Provider-reported usage + context window (WU-4)
// ---------------------------------------------------------------------------

interface UsageCase {
  readonly label: "openai" | "anthropic";
  readonly create: (apiKey: string, fetchImpl?: typeof fetch) => ReferenceProvider;
  readonly contextWindowTokens: number;
  /** An ok text response carrying provider usage. */
  readonly usageResponse: (inputTokens: number, outputTokens: number) => unknown;
  /** An ok text response whose usage fields are the wrong types. */
  readonly malformedUsageResponse: unknown;
  /** An ok text response with a usage field where only the input count is valid. */
  readonly partialUsageResponse: unknown;
  /** An ok text response with no usage field at all. */
  readonly noUsageResponse: unknown;
}

const openaiUsageCase: UsageCase = {
  label: "openai",
  create: createOpenAiProvider,
  contextWindowTokens: 128_000,
  usageResponse: (inputTokens, outputTokens) => ({
    choices: [{ message: { content: "ok" } }],
    usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens },
  }),
  malformedUsageResponse: {
    choices: [{ message: { content: "ok" } }],
    usage: { prompt_tokens: "120", completion_tokens: null },
  },
  partialUsageResponse: {
    choices: [{ message: { content: "ok" } }],
    usage: { prompt_tokens: 77, completion_tokens: "nope" },
  },
  noUsageResponse: { choices: [{ message: { content: "ok" } }] },
};

const anthropicUsageCase: UsageCase = {
  label: "anthropic",
  create: createAnthropicProvider,
  contextWindowTokens: 200_000,
  usageResponse: (inputTokens, outputTokens) => ({
    content: [{ type: "text", text: "ok" }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  }),
  malformedUsageResponse: {
    content: [{ type: "text", text: "ok" }],
    usage: { input_tokens: "120", output_tokens: null },
  },
  partialUsageResponse: {
    content: [{ type: "text", text: "ok" }],
    usage: { input_tokens: 77, output_tokens: "nope" },
  },
  noUsageResponse: { content: [{ type: "text", text: "ok" }] },
};

describe.each([openaiUsageCase, anthropicUsageCase])(
  "$label provider usage + context window",
  (adapter) => {
    it("reports its contextWindowTokens", () => {
      const provider = adapter.create(API_KEY, hangingFetch);
      expect(provider.contextWindowTokens).toBe(adapter.contextWindowTokens);
    });

    it("maps present usage numbers onto the step", async () => {
      const { fetchImpl } = createCapturingFetch(okJson(adapter.usageResponse(123, 45)));
      const step = await adapter.create(API_KEY, fetchImpl).run(TURN, PROVIDER_TOOLS);
      expect(step.usage).toEqual({ inputTokens: 123, outputTokens: 45 });
    });

    it("leaves usage absent when the response omits it", async () => {
      const { fetchImpl } = createCapturingFetch(okJson(adapter.noUsageResponse));
      const step = await adapter.create(API_KEY, fetchImpl).run(TURN, PROVIDER_TOOLS);
      expect(step.usage).toBeUndefined();
    });

    it("never throws on fully malformed usage and drops the bad fields", async () => {
      const { fetchImpl } = createCapturingFetch(okJson(adapter.malformedUsageResponse));
      const step = await adapter.create(API_KEY, fetchImpl).run(TURN, PROVIDER_TOOLS);
      expect(step.usage).toBeUndefined();
    });

    it("keeps a valid usage field and drops a malformed sibling", async () => {
      const { fetchImpl } = createCapturingFetch(okJson(adapter.partialUsageResponse));
      const step = await adapter.create(API_KEY, fetchImpl).run(TURN, PROVIDER_TOOLS);
      expect(step.usage).toEqual({ inputTokens: 77 });
    });
  },
);

// ---------------------------------------------------------------------------
// Anthropic input_tokens is INCLUSIVE of the cached prefix: with prompt caching
// on, `input_tokens` reports only the uncached suffix, so the adapter must add
// cache_creation_input_tokens + cache_read_input_tokens back for the estimator
// to calibrate on the real prompt size.
// ---------------------------------------------------------------------------

describe("anthropic usage is inclusive of cached tokens", () => {
  it("sums input_tokens + cache creation + cache read into inputTokens", async () => {
    const { fetchImpl } = createCapturingFetch(
      okJson({
        content: [{ type: "text", text: "ok" }],
        usage: {
          input_tokens: 100,
          cache_creation_input_tokens: 900,
          cache_read_input_tokens: 0,
          output_tokens: 45,
        },
      }),
    );
    const step = await createAnthropicProvider(API_KEY, fetchImpl).run(TURN, PROVIDER_TOOLS);
    expect(step.usage).toEqual({ inputTokens: 1000, outputTokens: 45 });
  });

  it("counts cache_read alone when input_tokens is missing", async () => {
    const { fetchImpl } = createCapturingFetch(
      okJson({
        content: [{ type: "text", text: "ok" }],
        usage: { cache_read_input_tokens: 1500, output_tokens: 12 },
      }),
    );
    const step = await createAnthropicProvider(API_KEY, fetchImpl).run(TURN, PROVIDER_TOOLS);
    expect(step.usage).toEqual({ inputTokens: 1500, outputTokens: 12 });
  });

  it("ignores non-finite cache fields and keeps the base input_tokens", async () => {
    const { fetchImpl } = createCapturingFetch(
      okJson({
        content: [{ type: "text", text: "ok" }],
        usage: {
          input_tokens: 200,
          cache_creation_input_tokens: "nope",
          cache_read_input_tokens: null,
        },
      }),
    );
    const step = await createAnthropicProvider(API_KEY, fetchImpl).run(TURN, PROVIDER_TOOLS);
    expect(step.usage).toEqual({ inputTokens: 200 });
  });
});

// ---------------------------------------------------------------------------
// Anthropic prompt-caching request body: ONE cache breakpoint on the stable
// tools+system prefix; OpenAI request body stays byte-shape identical.
// ---------------------------------------------------------------------------

describe("anthropic prompt-caching request body", () => {
  it("sends system as one ephemeral cache breakpoint and leaves tools untouched", async () => {
    const { calls, fetchImpl } = createCapturingFetch(okJson(anthropicCase.textResponse("ok")));
    await createAnthropicProvider(API_KEY, fetchImpl).run(TURN, PROVIDER_TOOLS);
    const body = bodyOf(calls[0]!);

    expect(body["system"]).toEqual([
      { type: "text", text: TURN.system, cache_control: { type: "ephemeral" } },
    ]);
    const tools = body["tools"] as Array<Record<string, unknown>>;
    for (const tool of tools) {
      expect(Object.keys(tool).sort()).toEqual(["description", "input_schema", "name"]);
    }
  });
});

describe("openai request body has no cache fields (usage change is response-only)", () => {
  it("keeps the request body keys unchanged and system folded into messages", async () => {
    const { calls, fetchImpl } = createCapturingFetch(okJson(openaiCase.textResponse("ok")));
    await createOpenAiProvider(API_KEY, fetchImpl).run(TURN, PROVIDER_TOOLS);
    const body = bodyOf(calls[0]!);

    expect(Object.keys(body).sort()).toEqual(["messages", "model", "tool_choice", "tools"]);
    expect("system" in body).toBe(false);
    const messages = body["messages"] as Array<Record<string, unknown>>;
    expect(messages[0]).toEqual({ role: "system", content: TURN.system });
  });

  it("pins GPT-5.6 Chat Completions tool calls to reasoning none", async () => {
    const { calls, fetchImpl } = createCapturingFetch(okJson(openaiCase.textResponse("ok")));
    await createOpenAiProvider(API_KEY, fetchImpl, { model: "gpt-5.6-terra" }).run(
      TURN,
      PROVIDER_TOOLS,
    );

    expect(bodyOf(calls[0]!)["reasoning_effort"]).toBe("none");
  });

  it("keeps the GPT-5.6 provider default when a turn offers no tools", async () => {
    const { calls, fetchImpl } = createCapturingFetch(okJson(openaiCase.textResponse("ok")));
    await createOpenAiProvider(API_KEY, fetchImpl, { model: "gpt-5.6-sol" }).run(TURN, []);

    expect(bodyOf(calls[0]!)).not.toHaveProperty("reasoning_effort");
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

  it("never includes present provider key values in resolution errors", () => {
    const secret = "sk-resolution-secret";
    let message = "";
    try {
      resolveProvider({ provider: "anthropic" }, { OPENAI_API_KEY: secret });
    } catch (cause) {
      message = cause instanceof Error ? cause.message : String(cause);
    }

    expect(message).toContain("ANTHROPIC_API_KEY");
    expect(message).not.toContain(secret);
  });

  it("throws on an unknown --provider value", () => {
    expect(() => resolveProvider({ provider: "llama" }, {})).toThrow(/llama/);
  });
});
