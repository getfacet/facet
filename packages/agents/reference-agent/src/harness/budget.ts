import { truncatedMarker } from "./compaction.js";

export type ReferenceAgentBudgetPreset = "quickstart" | "hosted" | "local-dev";

export interface ReferenceAgentBudget {
  readonly maxSteps: number;
  readonly maxToolCallsPerStep: number;
  readonly maxContextChars: number;
  readonly maxHistoryTurns: number;
  readonly maxHistoryChars: number;
  readonly maxStageJsonChars: number;
  readonly maxStageSummaryNodes: number;
  readonly maxObservationChars: number;
  readonly maxFinalTextChars: number;
  readonly maxProviderRetries: number;
  readonly retryBackoffMs: number;
  /** Per-preset token cap, derived from `maxContextChars` at the default chars-per-token (÷4). */
  readonly maxContextTokens: number;
  /** Fraction of the effective token budget at which compaction is triggered. */
  readonly compactionTriggerRatio: number;
  /** In-turn landing target (fraction of the effective token budget): compaction
   * keeps as many recent step groups verbatim as still fit under this target,
   * never fewer than `minRecentStepsVerbatim`. Must stay below the trigger ratio. */
  readonly compactionTargetRatio: number;
  /** Cross-turn tail of recent turns kept verbatim (never summarized). */
  readonly minRecentTurnsVerbatim: number;
  /** In-turn tail of recent step groups kept verbatim. */
  readonly minRecentStepsVerbatim: number;
  /** Self-cap on a generated summary (deterministic truncation), in tokens. */
  readonly maxSummaryTokens: number;
  /** Summarizer call budget in milliseconds. */
  readonly summarizerTimeoutMs: number;
  /** Summarizer retries before falling back to deterministic compaction. */
  readonly summarizerRetries: number;
  /** Cap on total rendered-history chars fed to ONE cross-turn summarizer call. A
   * longer backlog folds forward incrementally across background runs, so a
   * pre-existing long sink or a summarizer outage can never build one
   * always-failing megabyte request. Per preset = `maxContextChars / 2`. */
  readonly maxSummarizerInputChars: number;
  /** Min-gain + cooldown guard against re-trigger loops, in steps. */
  readonly compactionCooldownSteps: number;
  /** Context window used when a provider declares no `contextWindowTokens`. */
  readonly contextWindowTokensDefault: number;
}

export type ReferenceAgentBudgetOverrides = Partial<ReferenceAgentBudget>;

export interface ReferenceAgentBudgetOptions {
  readonly budgetPreset?: ReferenceAgentBudgetPreset;
  readonly budget?: ReferenceAgentBudgetOverrides;
  /** Legacy alias. Used only when budget.maxSteps is absent or invalid. */
  readonly maxSteps?: number;
  /** Legacy alias. Used only when budget.maxHistoryTurns is absent or invalid. */
  readonly historyTurns?: number;
}

export const DEFAULT_REFERENCE_AGENT_BUDGET_PRESET: ReferenceAgentBudgetPreset = "quickstart";

/** Compaction policy constants shared verbatim across all budget presets. */
const COMPACTION_POLICY = {
  compactionTriggerRatio: 0.75,
  compactionTargetRatio: 0.5,
  minRecentTurnsVerbatim: 4,
  minRecentStepsVerbatim: 4,
  maxSummaryTokens: 1_200,
  summarizerTimeoutMs: 30_000,
  summarizerRetries: 1,
  compactionCooldownSteps: 4,
  contextWindowTokensDefault: 100_000,
} as const;

export const REFERENCE_AGENT_BUDGET_PRESETS = {
  quickstart: {
    maxSteps: 50,
    maxToolCallsPerStep: 32,
    maxContextChars: 96_000,
    maxHistoryTurns: 20,
    maxHistoryChars: 24_000,
    maxStageJsonChars: 48_000,
    maxStageSummaryNodes: 80,
    maxObservationChars: 4_000,
    maxFinalTextChars: 4_000,
    maxProviderRetries: 1,
    retryBackoffMs: 250,
    maxContextTokens: 24_000,
    maxSummarizerInputChars: 48_000,
    ...COMPACTION_POLICY,
  },
  hosted: {
    maxSteps: 120,
    maxToolCallsPerStep: 32,
    maxContextChars: 160_000,
    maxHistoryTurns: 40,
    maxHistoryChars: 48_000,
    maxStageJsonChars: 80_000,
    maxStageSummaryNodes: 160,
    maxObservationChars: 8_000,
    maxFinalTextChars: 8_000,
    maxProviderRetries: 2,
    retryBackoffMs: 500,
    maxContextTokens: 40_000,
    maxSummarizerInputChars: 80_000,
    ...COMPACTION_POLICY,
  },
  "local-dev": {
    maxSteps: 240,
    maxToolCallsPerStep: 64,
    maxContextChars: 240_000,
    maxHistoryTurns: 80,
    maxHistoryChars: 96_000,
    maxStageJsonChars: 120_000,
    maxStageSummaryNodes: 320,
    maxObservationChars: 12_000,
    maxFinalTextChars: 12_000,
    maxProviderRetries: 2,
    retryBackoffMs: 0,
    maxContextTokens: 60_000,
    maxSummarizerInputChars: 120_000,
    ...COMPACTION_POLICY,
  },
} as const satisfies Record<ReferenceAgentBudgetPreset, ReferenceAgentBudget>;

export const REFERENCE_AGENT_STOP_REASONS = [
  "provider_stop",
  "max_steps",
  "tool_call_limit",
  "context_limit",
  "provider_error",
  "retry_exhausted",
  "sink_error",
  "unresolved_buffer",
  "empty_turn",
] as const;

export type ReferenceAgentStopReason = (typeof REFERENCE_AGENT_STOP_REASONS)[number];

export type ReferenceAgentProviderFailureReason =
  | "abort"
  | "timeout"
  | "network"
  | "http_status"
  | "malformed_response"
  | "configuration_error"
  | "unknown";

export interface ReferenceAgentProviderFailureClassification {
  readonly retryable: boolean;
  readonly reason: ReferenceAgentProviderFailureReason;
  readonly httpStatus?: number;
}

export const REFERENCE_AGENT_RETRYABLE_HTTP_STATUSES = [
  408, 409, 425, 429, 500, 502, 503, 504,
] as const;

export const REFERENCE_AGENT_NON_RETRYABLE_HTTP_STATUSES = [400, 401, 403, 404, 422] as const;

type BudgetField = keyof ReferenceAgentBudget;

/** Fields normalized as fractions in (0, 1], not floored integers. */
type RatioBudgetField = "compactionTriggerRatio" | "compactionTargetRatio";
type IntegerBudgetField = Exclude<BudgetField, RatioBudgetField>;

const BUDGET_FIELDS = [
  "maxSteps",
  "maxToolCallsPerStep",
  "maxContextChars",
  "maxHistoryTurns",
  "maxHistoryChars",
  "maxStageJsonChars",
  "maxStageSummaryNodes",
  "maxObservationChars",
  "maxFinalTextChars",
  "maxProviderRetries",
  "retryBackoffMs",
  "maxContextTokens",
  "minRecentTurnsVerbatim",
  "minRecentStepsVerbatim",
  "maxSummaryTokens",
  "summarizerTimeoutMs",
  "summarizerRetries",
  "maxSummarizerInputChars",
  "compactionCooldownSteps",
  "contextWindowTokensDefault",
] as const satisfies readonly IntegerBudgetField[];

export const MIN_REFERENCE_AGENT_OBSERVATION_CHARS = truncatedMarker(1_000_000_000).length;

const MIN_BUDGET_VALUES = {
  maxSteps: 1,
  maxToolCallsPerStep: 1,
  maxContextChars: 1,
  maxHistoryTurns: 0,
  maxHistoryChars: 1,
  maxStageJsonChars: 1,
  maxStageSummaryNodes: 0,
  maxObservationChars: MIN_REFERENCE_AGENT_OBSERVATION_CHARS,
  maxFinalTextChars: 1,
  maxProviderRetries: 0,
  retryBackoffMs: 0,
  maxContextTokens: 1,
  minRecentTurnsVerbatim: 0,
  minRecentStepsVerbatim: 0,
  maxSummaryTokens: 1,
  summarizerTimeoutMs: 0,
  summarizerRetries: 0,
  maxSummarizerInputChars: 1,
  compactionCooldownSteps: 0,
  contextWindowTokensDefault: 1,
} as const satisfies Record<IntegerBudgetField, number>;

const RATIO_BUDGET_FIELDS = [
  "compactionTriggerRatio",
  "compactionTargetRatio",
] as const satisfies readonly RatioBudgetField[];

const MAX_BUDGET_VALUE = 1_000_000_000;

const RETRYABLE_HTTP_STATUS_SET = new Set<number>(REFERENCE_AGENT_RETRYABLE_HTTP_STATUSES);

export function normalizeBudget(options: ReferenceAgentBudgetOptions = {}): ReferenceAgentBudget {
  const preset =
    REFERENCE_AGENT_BUDGET_PRESETS[options.budgetPreset ?? DEFAULT_REFERENCE_AGENT_BUDGET_PRESET];
  const out: Record<BudgetField, number> = { ...preset };

  for (const field of BUDGET_FIELDS) {
    out[field] = chooseBudgetValue(field, preset[field], options);
  }

  const ratios = normalizeRatios(preset, options);
  for (const field of RATIO_BUDGET_FIELDS) {
    out[field] = ratios[field];
  }

  return out;
}

/**
 * The token budget actually available for a turn: the smaller of the preset's
 * `maxContextTokens` cap and the provider's declared context window (falling
 * back to `contextWindowTokensDefault` when the provider declares none).
 */
export function effectiveTokenBudget(
  budget: ReferenceAgentBudget,
  contextWindowTokens?: number,
): number {
  const providerWindow =
    typeof contextWindowTokens === "number" &&
    Number.isFinite(contextWindowTokens) &&
    contextWindowTokens > 0
      ? contextWindowTokens
      : budget.contextWindowTokensDefault;
  return Math.min(budget.maxContextTokens, providerWindow);
}

function normalizeRatios(
  preset: ReferenceAgentBudget,
  options: ReferenceAgentBudgetOptions,
): Record<RatioBudgetField, number> {
  const trigger =
    normalizeRatioValue(options.budget?.compactionTriggerRatio) ?? preset.compactionTriggerRatio;
  const target =
    normalizeRatioValue(options.budget?.compactionTargetRatio) ?? preset.compactionTargetRatio;
  // Trigger must sit strictly above the post-compaction floor; an override that
  // breaks the ordering reverts BOTH to the preset's coherent pair.
  if (trigger <= target) {
    return {
      compactionTriggerRatio: preset.compactionTriggerRatio,
      compactionTargetRatio: preset.compactionTargetRatio,
    };
  }
  return { compactionTriggerRatio: trigger, compactionTargetRatio: target };
}

function normalizeRatioValue(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value <= 0 || value > 1) return undefined;
  return value;
}

export function classifyProviderFailure(
  error: unknown,
): ReferenceAgentProviderFailureClassification {
  const httpStatus = httpStatusOf(error);
  if (httpStatus !== undefined) {
    const retryable = RETRYABLE_HTTP_STATUS_SET.has(httpStatus);
    return {
      retryable,
      reason: "http_status",
      httpStatus,
    };
  }

  const name = errorNameOf(error);
  const message = errorMessageOf(error);
  const lowerMessage = message.toLowerCase();

  if (name === "AbortError" || lowerMessage.includes("aborted")) {
    return { retryable: true, reason: "abort" };
  }
  if (
    name === "TimeoutError" ||
    lowerMessage.includes("timeout") ||
    lowerMessage.includes("timed out")
  ) {
    return { retryable: true, reason: "timeout" };
  }
  if (error instanceof TypeError) {
    return { retryable: true, reason: "network" };
  }
  if (
    error instanceof SyntaxError ||
    lowerMessage.includes("malformed") ||
    lowerMessage.includes("unexpected shape") ||
    lowerMessage.includes("invalid json") ||
    lowerMessage.includes("json parse")
  ) {
    return { retryable: false, reason: "malformed_response" };
  }
  if (
    lowerMessage.includes("unknown provider") ||
    lowerMessage.includes("provider flag") ||
    lowerMessage.includes("api_key")
  ) {
    return { retryable: false, reason: "configuration_error" };
  }

  return { retryable: false, reason: "unknown" };
}

export function isRetryableProviderFailure(error: unknown): boolean {
  return classifyProviderFailure(error).retryable;
}

function chooseBudgetValue(
  field: IntegerBudgetField,
  presetValue: number,
  options: ReferenceAgentBudgetOptions,
): number {
  const candidates = budgetCandidates(field, options);
  for (const candidate of candidates) {
    const normalized = normalizeBudgetValue(field, candidate);
    if (normalized !== undefined) return normalized;
  }
  return presetValue;
}

function budgetCandidates(
  field: IntegerBudgetField,
  options: ReferenceAgentBudgetOptions,
): readonly (number | undefined)[] {
  if (field === "maxSteps") return [options.budget?.maxSteps, options.maxSteps];
  if (field === "maxHistoryTurns") return [options.budget?.maxHistoryTurns, options.historyTurns];
  return [options.budget?.[field]];
}

function normalizeBudgetValue(
  field: IntegerBudgetField,
  value: number | undefined,
): number | undefined {
  if (typeof value !== "number") return undefined;
  if (!Number.isFinite(value) || value >= Number.MAX_SAFE_INTEGER || value > MAX_BUDGET_VALUE) {
    return undefined;
  }

  const integer = Math.floor(value);
  const minimum = MIN_BUDGET_VALUES[field];
  if (integer < minimum) {
    return value >= 0 ? minimum : undefined;
  }
  return integer;
}

function httpStatusOf(error: unknown): number | undefined {
  const explicitStatus = numberProperty(error, "status") ?? numberProperty(error, "statusCode");
  if (explicitStatus !== undefined) return explicitStatus;

  const match = /\bHTTP\s+(\d{3})\b/i.exec(errorMessageOf(error));
  if (match?.[1] === undefined) return undefined;

  const status = Number.parseInt(match[1], 10);
  return Number.isInteger(status) ? status : undefined;
}

function numberProperty(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) return undefined;
  const property = value[key];
  return typeof property === "number" && Number.isInteger(property) ? property : undefined;
}

function errorNameOf(error: unknown): string {
  if (error instanceof Error) return error.name;
  if (isRecord(error) && typeof error["name"] === "string") return error["name"];
  return "";
}

function errorMessageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (isRecord(error) && typeof error["message"] === "string") return error["message"];
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
