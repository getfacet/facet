import { describe, expect, expectTypeOf, it } from "vitest";

import * as reference from "./index.js";
import type {
  ProviderOptions,
  ProviderStep,
  ProviderTurn,
  PromptAssets,
  QuickstartAgentOptions,
  QuickstartProvider,
  ReferenceAgentOptions,
  ReferenceProvider,
  ResolveProviderFlags,
  ToolCall,
  ToolSpec,
  TurnMessage,
} from "./index.js";

describe("reference-agent barrel", () => {
  it("exports compatibility and canonical aliases", () => {
    expect(reference.createReferenceAgent).toBe(reference.createQuickstartAgent);

    const runtimeExports = [
      "createQuickstartAgent",
      "createReferenceAgent",
      "resolveProvider",
      "DEFAULT_OPENAI_MODEL",
      "DEFAULT_ANTHROPIC_MODEL",
      "TURN_TIMEOUT_MS",
      "createOpenAiProvider",
      "createAnthropicProvider",
      "HISTORY_TURNS",
      "DEFAULT_GUIDE",
      "buildSystem",
      "TOOLS",
      "describeEvent",
      "buildInitialMessages",
      "STUB_TREE",
      "createStubAgent",
    ] as const;

    for (const name of runtimeExports) {
      expect(reference).toHaveProperty(name);
    }
  });

  it("types every compatibility and canonical export row", () => {
    expectTypeOf<ReferenceAgentOptions>().toEqualTypeOf<QuickstartAgentOptions>();
    expectTypeOf<ReferenceProvider>().toEqualTypeOf<QuickstartProvider>();

    expectTypeOf<ToolSpec>().toMatchTypeOf<{
      readonly name: string;
      readonly description: string;
      readonly parameters: Readonly<Record<string, unknown>>;
    }>();
    expectTypeOf<ToolCall>().toMatchTypeOf<{
      readonly id: string;
      readonly name: string;
      readonly input: unknown;
    }>();
    expectTypeOf<ProviderStep>().toMatchTypeOf<{
      readonly text: string;
      readonly toolCalls: readonly ToolCall[];
    }>();
    expectTypeOf<TurnMessage>().toMatchTypeOf<
      | { readonly role: "user"; readonly content: string }
      | { readonly role: "assistant"; readonly content: string }
      | {
          readonly role: "assistant_tools";
          readonly text: string;
          readonly toolCalls: readonly ToolCall[];
        }
      | { readonly role: "tool_result"; readonly callId: string; readonly content: string }
    >();
    expectTypeOf<ProviderTurn>().toMatchTypeOf<{
      readonly system: string;
      readonly messages: readonly TurnMessage[];
    }>();
    expectTypeOf<ProviderOptions>().toMatchTypeOf<{ readonly timeoutMs?: number }>();
    expectTypeOf<ResolveProviderFlags>().toMatchTypeOf<{ readonly provider?: string }>();
    expectTypeOf<PromptAssets>().toMatchTypeOf<{
      readonly themes: readonly unknown[];
      readonly stamps: readonly unknown[];
    }>();
  });
});
