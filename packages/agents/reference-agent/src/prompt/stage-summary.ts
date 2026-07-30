import { buildTurnObservation } from "@facet/agent-tools";
import type { FacetToolSession, TurnObservation } from "@facet/agent-tools";

export const DEFAULT_STAGE_MARKUP_CHAR_LIMIT = 48_000;
export const DEFAULT_STAGE_SUMMARY_NODE_LIMIT = 80;

const TRUNCATED_MARKER = "\n…[truncated]";

export interface StageSummaryOptions {
  readonly maxMarkupChars?: number;
  readonly maxSummaryNodes?: number;
}

export function formatCurrentStageForPrompt(
  session: FacetToolSession,
  options: StageSummaryOptions = {},
): string {
  return `CURRENT FACET OBSERVATION\n${summarizeStageForPrompt(safeObservation(session), options)}`;
}

export function summarizeStageForPrompt(
  observation: TurnObservation,
  options: StageSummaryOptions = {},
): string {
  const maxMarkupChars = safeNonNegativeInteger(
    options.maxMarkupChars,
    DEFAULT_STAGE_MARKUP_CHAR_LIMIT,
  );
  const maxSummaryNodes = safeNonNegativeInteger(
    options.maxSummaryNodes,
    DEFAULT_STAGE_SUMMARY_NODE_LIMIT,
  );
  const components = observation.components.slice(0, maxSummaryNodes);
  const omittedComponents = observation.components.length - components.length;

  const lines = [
    `stageRevision=${String(observation.stageRevision)}`,
    `currentScreen=${observation.currentScreen?.name ?? "(none)"}`,
    `screens=${observation.screens.length === 0 ? "(none)" : observation.screens.join(", ")}`,
    "components:",
    ...components.map((component) => `- ${component.tag}: ${component.whenToUse}`),
  ];

  if (omittedComponents > 0) {
    lines.push(`... ${String(omittedComponents)} more components omitted`);
  }

  lines.push("data:");
  if (observation.data.length === 0) {
    lines.push("- (none)");
  } else {
    for (const entry of observation.data) {
      const fields = entry.fields.length === 0 ? "(none)" : entry.fields.join(", ");
      lines.push(
        `- ${entry.path}: shape=${entry.shape} fields=${fields} count=${String(entry.count)}`,
      );
    }
  }

  if (observation.currentScreen === null) {
    lines.push("currentScreenMarkup=(none)");
  } else {
    lines.push("currentScreenMarkup:");
    lines.push(boundedText(observation.currentScreen.markup, maxMarkupChars));
  }

  if (observation.issues.length > 0) {
    lines.push(`issues=${observation.issues.join(", ")}`);
  }

  return lines.join("\n");
}

function safeObservation(session: FacetToolSession): TurnObservation {
  try {
    return buildTurnObservation(session);
  } catch {
    return Object.freeze({
      stageRevision: 0,
      currentScreen: null,
      screens: Object.freeze([]),
      components: Object.freeze([]),
      data: Object.freeze([]),
      issues: Object.freeze(["observation_unavailable"]),
    });
  }
}

function safeNonNegativeInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (value < 0) return fallback;
  return Math.floor(value);
}

function boundedText(text: string, maxChars: number): string {
  if (maxChars <= 0) return "(omitted by character limit)";
  if (text.length <= maxChars) return text;
  const cut = Math.max(0, maxChars - TRUNCATED_MARKER.length);
  return `${text.slice(0, cut)}${TRUNCATED_MARKER}`;
}
