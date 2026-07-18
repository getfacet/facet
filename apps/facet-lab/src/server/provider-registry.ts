import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_OPENAI_MODEL,
  createAnthropicProvider,
  createOpenAiProvider,
} from "@facet/reference-agent";
import type { ReferenceProvider } from "@facet/reference-agent";

import { DETERMINISTIC_MODEL } from "./deterministic-provider.js";

export type ProviderName = ReferenceProvider["name"];

export interface ProviderCapability<Name extends ProviderName = ProviderName> {
  readonly provider: Name;
  readonly available: boolean;
  readonly models: readonly string[];
  readonly defaultModel: string;
}

export interface ProviderRegistryCapabilities {
  readonly deterministic: {
    readonly mode: "deterministic";
    readonly provider: "openai";
    readonly available: true;
    readonly models: readonly [typeof DETERMINISTIC_MODEL];
    readonly defaultModel: typeof DETERMINISTIC_MODEL;
  };
  readonly providers: {
    readonly openai: ProviderCapability<"openai">;
    readonly anthropic: ProviderCapability<"anthropic">;
  };
}

export interface ProviderRegistry {
  readonly capabilities: ProviderRegistryCapabilities;
  createProvider(provider: ProviderName, model: string): ReferenceProvider;
}

export interface ProviderRegistryOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly fetchImpl?: typeof fetch;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function readKey(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function readModelAllowlist(value: string | undefined, fallback: string, label: string): string[] {
  if (value === undefined) return [fallback];
  const models = value.split(",").map((model) => model.trim());
  if (
    models.length === 0 ||
    models.some((model) => model.length === 0 || model.length > 200 || hasControlCharacter(model))
  ) {
    throw new Error(`${label} model allowlist must contain comma-separated 1–200 character IDs`);
  }
  return [...new Set(models)];
}

/** Keeps raw provider keys in closure scope and exposes only safe UI capabilities. */
export function createProviderRegistry(options: ProviderRegistryOptions = {}): ProviderRegistry {
  const environment = options.environment ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const openAiKey = readKey(environment.OPENAI_API_KEY);
  const anthropicKey = readKey(environment.ANTHROPIC_API_KEY);
  const openAiModels = readModelAllowlist(
    environment.FACET_LAB_OPENAI_MODELS,
    DEFAULT_OPENAI_MODEL,
    "OpenAI",
  );
  const anthropicModels = readModelAllowlist(
    environment.FACET_LAB_ANTHROPIC_MODELS,
    DEFAULT_ANTHROPIC_MODEL,
    "Anthropic",
  );

  const capabilities = deepFreeze({
    deterministic: {
      mode: "deterministic" as const,
      provider: "openai" as const,
      available: true as const,
      models: [DETERMINISTIC_MODEL] as const,
      defaultModel: DETERMINISTIC_MODEL,
    },
    providers: {
      openai: {
        provider: "openai" as const,
        available: openAiKey !== undefined,
        models: openAiModels,
        defaultModel: openAiModels[0]!,
      },
      anthropic: {
        provider: "anthropic" as const,
        available: anthropicKey !== undefined,
        models: anthropicModels,
        defaultModel: anthropicModels[0]!,
      },
    },
  } satisfies ProviderRegistryCapabilities);

  const createProvider = (provider: ProviderName, model: string): ReferenceProvider => {
    if (provider !== "openai" && provider !== "anthropic") {
      throw new Error("unsupported provider");
    }
    const capability = capabilities.providers[provider];
    if (!capability.models.includes(model)) {
      throw new Error(`${provider} model is not allowlisted`);
    }
    if (!capability.available) {
      throw new Error(`${provider} provider is unavailable because its server key is missing`);
    }
    if (provider === "openai") {
      if (openAiKey === undefined) throw new Error("openai provider is unavailable");
      return createOpenAiProvider(openAiKey, fetchImpl, { model });
    }
    if (anthropicKey === undefined) throw new Error("anthropic provider is unavailable");
    return createAnthropicProvider(anthropicKey, fetchImpl, { model });
  };

  return Object.freeze({ capabilities, createProvider });
}
