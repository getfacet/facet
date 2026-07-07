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

export const REFERENCE_AGENT_BUDGET_PRESETS = {
  quickstart: {
    maxSteps: 50,
    maxToolCallsPerStep: 16,
    maxContextChars: 96_000,
    maxHistoryTurns: 20,
    maxHistoryChars: 24_000,
    maxStageJsonChars: 48_000,
    maxStageSummaryNodes: 80,
    maxObservationChars: 4_000,
    maxFinalTextChars: 4_000,
    maxProviderRetries: 1,
    retryBackoffMs: 250,
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
] as const satisfies readonly BudgetField[];

export const MIN_REFERENCE_AGENT_OBSERVATION_CHARS = "[truncated: 1000000000 chars omitted]".length;

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
} as const satisfies Record<BudgetField, number>;

const MAX_BUDGET_VALUE = 1_000_000_000;

const RETRYABLE_HTTP_STATUS_SET = new Set<number>(REFERENCE_AGENT_RETRYABLE_HTTP_STATUSES);

export function normalizeBudget(options: ReferenceAgentBudgetOptions = {}): ReferenceAgentBudget {
  const preset =
    REFERENCE_AGENT_BUDGET_PRESETS[options.budgetPreset ?? DEFAULT_REFERENCE_AGENT_BUDGET_PRESET];
  const out: Record<BudgetField, number> = { ...preset };

  for (const field of BUDGET_FIELDS) {
    out[field] = chooseBudgetValue(field, preset[field], options);
  }

  return out;
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
  field: BudgetField,
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
  field: BudgetField,
  options: ReferenceAgentBudgetOptions,
): readonly (number | undefined)[] {
  if (field === "maxSteps") return [options.budget?.maxSteps, options.maxSteps];
  if (field === "maxHistoryTurns") return [options.budget?.maxHistoryTurns, options.historyTurns];
  return [options.budget?.[field]];
}

function normalizeBudgetValue(field: BudgetField, value: number | undefined): number | undefined {
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
