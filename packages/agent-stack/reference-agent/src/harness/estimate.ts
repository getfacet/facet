import type { ToolSpec, TurnMessage } from "../provider.js";
import { estimateMessagesChars } from "./compaction.js";

/** Conservative chars-per-token used before any provider usage is observed. */
export const CHARS_PER_TOKEN_DEFAULT = 4;
/** Lower calibration clamp: dense, token-efficient text still costs >= 1.5 chars/token. */
export const CHARS_PER_TOKEN_MIN = 1.5;
/** Upper calibration clamp: whitespace/markup-heavy text is capped at 6 chars/token. */
export const CHARS_PER_TOKEN_MAX = 6;

/** Fallback serialized length charged for a tool spec that cannot be JSON-stringified. */
const UNSERIALIZABLE_TOOL_CHARS = 256;

export interface TokenEstimator {
  /** chars -> estimated tokens at the current calibration (ceil, >= 0). */
  estimateTokens(chars: number): number;
  /** Feed one observed (chars sent, provider-reported inputTokens) pair; ignores undefined/invalid tokens. */
  calibrate(observedChars: number, reportedInputTokens: number | undefined): void;
  charsPerToken(): number;
}

function clampCharsPerToken(value: number): number {
  if (!Number.isFinite(value)) return CHARS_PER_TOKEN_DEFAULT;
  if (value < CHARS_PER_TOKEN_MIN) return CHARS_PER_TOKEN_MIN;
  if (value > CHARS_PER_TOKEN_MAX) return CHARS_PER_TOKEN_MAX;
  return value;
}

export function createTokenEstimator(initialCharsPerToken?: number): TokenEstimator {
  const seed =
    typeof initialCharsPerToken === "number" && Number.isFinite(initialCharsPerToken)
      ? clampCharsPerToken(initialCharsPerToken)
      : CHARS_PER_TOKEN_DEFAULT;

  // Running average seeded with the initial estimate as one pseudo-observation,
  // so calibration converges gradually toward observed ratios rather than
  // snapping on the first sample.
  let ratioSum = seed;
  let ratioCount = 1;

  const currentRatio = (): number => clampCharsPerToken(ratioSum / ratioCount);

  return {
    estimateTokens(chars: number): number {
      if (!Number.isFinite(chars) || chars <= 0) return 0;
      return Math.ceil(chars / currentRatio());
    },
    calibrate(observedChars: number, reportedInputTokens: number | undefined): void {
      if (typeof reportedInputTokens !== "number") return;
      if (!Number.isFinite(observedChars) || observedChars <= 0) return;
      if (!Number.isFinite(reportedInputTokens) || reportedInputTokens <= 0) return;
      // Clamp each sample's ratio into the plausible band BEFORE accumulating,
      // so one anomalous provider report (e.g. an inflated chars/token from a
      // cached-prefix under-count) can never pin the running mean at a clamp
      // edge — the mean is clamped too, but only after the fact.
      ratioSum += clampCharsPerToken(observedChars / reportedInputTokens);
      ratioCount += 1;
    },
    charsPerToken(): number {
      return currentRatio();
    },
  };
}

/** Full turn size in chars: system + messages (via estimateMessagesChars) + JSON size of tool specs. */
export function estimateTurnChars(
  system: string,
  messages: readonly TurnMessage[],
  tools: readonly ToolSpec[],
): number {
  let total = system.length + estimateMessagesChars(messages);
  for (const tool of tools) {
    total += toolSpecChars(tool);
  }
  return total;
}

function toolSpecChars(tool: ToolSpec): number {
  try {
    const serialized = JSON.stringify(tool);
    return typeof serialized === "string" ? serialized.length : UNSERIALIZABLE_TOOL_CHARS;
  } catch {
    return UNSERIALIZABLE_TOOL_CHARS;
  }
}

/**
 * Chars of a provider turn WITHOUT tool schemas (the legacy `maxContextChars`
 * accounting): system line + messages. `estimateTurnChars` adds the tools.
 */
export function estimateProviderTurnChars(
  system: string,
  messages: readonly TurnMessage[],
): number {
  return `system: ${system}\n`.length + estimateMessagesChars(messages);
}
