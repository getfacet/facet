import {
  COLOR_MODES,
  MAX_MODEL_CODE_UNITS,
  MAX_PROMPT_CODE_UNITS,
  PROVIDERS,
  RUN_MODES,
  VIEWPORTS,
  type ProviderName,
  type RunConfiguration,
  type RunMode,
} from "../shared/run-contract.js";

export const MAX_SCENARIO_ID_CODE_UNITS = 200;
export const MAX_CONSTRAINT_CODE_UNITS = 1_000;

export interface BrowserProviderCapability {
  readonly provider: ProviderName;
  readonly available: boolean;
  readonly models: readonly string[];
  readonly defaultModel: string;
}

export interface LabCapabilities {
  readonly deterministic: {
    readonly mode: "deterministic";
    readonly provider: "openai";
    readonly available: true;
    readonly models: readonly string[];
    readonly defaultModel: string;
  };
  readonly providers: Readonly<Record<ProviderName, BrowserProviderCapability>>;
  readonly bounds?: {
    readonly maxHistory: number;
    readonly screenshotConditions: number;
  };
  readonly dataDirectory?: string;
  readonly retention?: number;
}

export type RunConfigurationIssueCode =
  | "invalid-shape"
  | "invalid-mode"
  | "invalid-provider"
  | "provider-unavailable"
  | "invalid-model"
  | "model-unavailable"
  | "invalid-scenario"
  | "invalid-prompt"
  | "invalid-constraint"
  | "invalid-viewport"
  | "invalid-color-mode";

export interface RunConfigurationIssue {
  readonly code: RunConfigurationIssueCode;
  readonly field: keyof RunConfiguration | "$";
  readonly message: string;
}

export type RunConfigurationValidation =
  | { readonly ok: true; readonly value: RunConfiguration }
  | { readonly ok: false; readonly issues: readonly RunConfigurationIssue[] };

const RUN_CONFIGURATION_FIELDS = [
  "mode",
  "provider",
  "model",
  "scenarioId",
  "prompt",
  "constraint",
  "viewport",
  "colorMode",
] as const satisfies readonly (keyof RunConfiguration)[];

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function oneOf<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === "string" && choices.some((choice) => choice === value);
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function boundedText(value: unknown, maximum: number, allowEmpty = false): value is string {
  return (
    typeof value === "string" &&
    value.length <= maximum &&
    (allowEmpty || value.length > 0) &&
    value.trim() === value &&
    !hasControlCharacter(value)
  );
}

function validConstraint(value: unknown): value is string | null {
  if (value === null) return true;
  if (!boundedText(value, MAX_CONSTRAINT_CODE_UNITS)) return false;
  const parts = value.split(":");
  return (
    (parts[0] === "brick" && parts.length === 2 && parts[1] !== "") ||
    (parts[0] === "pattern" && parts.length === 2 && parts[1] !== "") ||
    (parts[0] === "preset" && parts.length === 3 && parts[1] !== "" && parts[2] !== "")
  );
}

function issue(
  code: RunConfigurationIssueCode,
  field: RunConfigurationIssue["field"],
  message: string,
): RunConfigurationIssue {
  return Object.freeze({ code, field, message });
}

function modeCapability(
  mode: RunMode,
  provider: ProviderName,
  capabilities: LabCapabilities,
): BrowserProviderCapability | LabCapabilities["deterministic"] | undefined {
  return mode === "deterministic"
    ? provider === "openai"
      ? capabilities.deterministic
      : undefined
    : capabilities.providers[provider];
}

export function defaultProviderConfiguration(
  capabilities: LabCapabilities,
): Pick<RunConfiguration, "mode" | "provider" | "model"> {
  const capability = capabilities.providers.openai.available
    ? capabilities.providers.openai
    : capabilities.providers.anthropic.available
      ? capabilities.providers.anthropic
      : capabilities.providers.openai;
  return Object.freeze({
    mode: "provider",
    provider: capability.provider,
    model: capability.defaultModel,
  });
}

/**
 * Strict browser-side readiness check. The server repeats authoritative validation;
 * this function only prevents submitting an impossible or over-bound form.
 */
export function validateRunConfiguration(
  candidate: unknown,
  capabilities: LabCapabilities,
  scenarioIds?: readonly string[],
): RunConfigurationValidation {
  if (
    !isRecord(candidate) ||
    Object.keys(candidate).length !== RUN_CONFIGURATION_FIELDS.length ||
    !RUN_CONFIGURATION_FIELDS.every((field) => Object.hasOwn(candidate, field))
  ) {
    return {
      ok: false,
      issues: Object.freeze([
        issue("invalid-shape", "$", "Run configuration must contain only the required fields."),
      ]),
    };
  }

  const issues: RunConfigurationIssue[] = [];
  if (!oneOf(candidate.mode, RUN_MODES)) {
    issues.push(issue("invalid-mode", "mode", "Choose a supported run mode."));
  }
  if (!oneOf(candidate.provider, PROVIDERS)) {
    issues.push(issue("invalid-provider", "provider", "Choose a supported provider."));
  }
  if (!boundedText(candidate.model, MAX_MODEL_CODE_UNITS)) {
    issues.push(issue("invalid-model", "model", "Choose a bounded model identifier."));
  }
  if (!boundedText(candidate.scenarioId, MAX_SCENARIO_ID_CODE_UNITS)) {
    issues.push(issue("invalid-scenario", "scenarioId", "Choose a valid scenario."));
  } else if (scenarioIds !== undefined && !scenarioIds.includes(candidate.scenarioId)) {
    issues.push(issue("invalid-scenario", "scenarioId", "The selected scenario is unavailable."));
  }
  if (!boundedText(candidate.prompt, MAX_PROMPT_CODE_UNITS, true)) {
    issues.push(issue("invalid-prompt", "prompt", "Prompt text is invalid or too long."));
  }
  if (!validConstraint(candidate.constraint)) {
    issues.push(
      issue(
        "invalid-constraint",
        "constraint",
        "Choose a valid Brick, Preset, or Pattern constraint.",
      ),
    );
  }
  if (!oneOf(candidate.viewport, VIEWPORTS)) {
    issues.push(issue("invalid-viewport", "viewport", "Choose a supported viewport."));
  }
  if (!oneOf(candidate.colorMode, COLOR_MODES)) {
    issues.push(issue("invalid-color-mode", "colorMode", "Choose a supported color mode."));
  }

  if (
    oneOf(candidate.mode, RUN_MODES) &&
    oneOf(candidate.provider, PROVIDERS) &&
    boundedText(candidate.model, MAX_MODEL_CODE_UNITS)
  ) {
    const capability = modeCapability(candidate.mode, candidate.provider, capabilities);
    if (capability === undefined || !capability.available) {
      issues.push(
        issue("provider-unavailable", "provider", "The selected provider is unavailable."),
      );
    } else if (!capability.models.includes(candidate.model)) {
      issues.push(issue("model-unavailable", "model", "The selected model is unavailable."));
    }
  }

  if (issues.length > 0) return { ok: false, issues: Object.freeze(issues) };
  return {
    ok: true,
    value: Object.freeze({
      mode: candidate.mode as RunConfiguration["mode"],
      provider: candidate.provider as RunConfiguration["provider"],
      model: candidate.model as string,
      scenarioId: candidate.scenarioId as string,
      prompt: candidate.prompt as string,
      constraint: candidate.constraint as string | null,
      viewport: candidate.viewport as RunConfiguration["viewport"],
      colorMode: candidate.colorMode as RunConfiguration["colorMode"],
    }),
  };
}

export function defaultRunConfiguration(
  capabilities: LabCapabilities,
  scenarioId: string,
): RunConfiguration {
  return Object.freeze({
    ...defaultProviderConfiguration(capabilities),
    scenarioId,
    prompt: "",
    constraint: null,
    viewport: "desktop",
    colorMode: "light",
  });
}
