import { createAnthropicProvider } from "./anthropic.js";
import { createOpenAiProvider } from "./openai.js";
import type { QuickstartProvider } from "./types.js";

export interface ResolveProviderFlags {
  readonly provider?: string;
}

/**
 * Deterministic key/flag resolution (spec Decision 4):
 * - explicit `--provider` wins and REQUIRES its own key (missing => throw
 *   naming exactly `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` -- the name only);
 * - no flag => `OPENAI_API_KEY` => openai (also when both keys are present),
 *   else `ANTHROPIC_API_KEY` => anthropic, else `null`.
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
    throw new Error(`Unknown provider "${flags.provider}" -- expected "openai" or "anthropic"`);
  }

  if (openaiKey) return createOpenAiProvider(openaiKey);
  if (anthropicKey) return createAnthropicProvider(anthropicKey);
  return null;
}
