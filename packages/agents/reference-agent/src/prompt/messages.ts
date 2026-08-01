import type { VisitorEvent, ConversationMessage, FacetToolSession } from "@facet/core";

import type { TurnMessage } from "../provider.js";
import { formatCurrentStageForPrompt, type StageSummaryOptions } from "./stage-summary.js";

/** How many conversation records the default prompt replay keeps. */
export const HISTORY_TURNS = 20;

const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]+\b/gu,
  /\bBearer\s+[A-Za-z0-9._-]+\b/giu,
  /("?(?:api[_-]?key|password|secret|token)"?\s*[:=]\s*)("[^"]*"|[^\s,}]+)/giu,
];

export function describeEvent(raw: unknown): string {
  if (!isRecord(raw)) return "(unknown event)";
  const eventName = stringField(raw, "eventName");
  const sourceNodeId = stringField(raw, "sourceNodeId");
  const screen = stringField(raw, "screen");
  const stageRevision = raw["stageRevision"];
  if (
    eventName === undefined ||
    sourceNodeId === undefined ||
    screen === undefined ||
    typeof stageRevision !== "number" ||
    !Number.isSafeInteger(stageRevision)
  ) {
    return "(unknown event)";
  }

  const parts = [
    `event=${safeJsonString(eventName)}`,
    `source=${safeJsonString(sourceNodeId)}`,
    `screen=${safeJsonString(screen)}`,
    `stageRevision=${String(stageRevision)}`,
  ];
  const arg = stringField(raw, "arg");
  if (arg !== undefined) parts.push(`arg=${safeJsonString(arg)}`);
  const collect = describeCollect(raw["collect"]);
  if (collect.length > 0) parts.push(`collect=${collect}`);
  return `(agent ${parts.join(" ")})`;
}

export function buildInitialMessages(
  event: VisitorEvent,
  session: FacetToolSession,
  history: readonly ConversationMessage[],
  limit: number,
  stageOptions?: StageSummaryOptions,
): TurnMessage[] {
  const messages: TurnMessage[] = [];
  const safeHistory = Array.isArray(history) ? history.filter(isConversationMessage) : [];
  for (const record of safeHistory.slice(-boundedLimit(limit))) {
    messages.push({
      role: record.role === "visitor" ? "user" : "assistant",
      content: record.text,
    });
  }
  messages.push({
    role: "user",
    content: `${describeEvent(event)}\n\n${formatCurrentStageForPrompt(
      session,
      stageOptions ?? {},
    )}`,
  });
  return messages;
}

export function redactSensitiveText(text: string): string {
  if (typeof text !== "string") return "";
  let out = text;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, (match: string, ...args: unknown[]) => {
      const captures = args.slice(0, -2);
      const prefix = captures.find((capture): capture is string => typeof capture === "string");
      return prefix === undefined ? "[redacted]" : `${prefix}[redacted]`;
    });
  }
  return out;
}

function describeCollect(value: unknown): string {
  if (!isRecord(value)) return "";
  const entries: string[] = [];
  for (const key of Object.keys(value).sort()) {
    const entry = value[key];
    if (!isRecord(entry) || typeof entry["kind"] !== "string") continue;
    if (entry["kind"] === "value" && typeof entry["value"] === "string") {
      entries.push(`${key}=${safeJsonString(entry["value"])}`);
      continue;
    }
    if (entry["kind"] === "omitted_sensitive" || entry["kind"] === "collect_source_unavailable") {
      entries.push(`${key}=${entry["kind"]}`);
    }
  }
  return entries.join(", ");
}

function isConversationMessage(value: unknown): value is ConversationMessage {
  return (
    isRecord(value) &&
    value["kind"] === "conversation" &&
    (value["role"] === "visitor" || value["role"] === "assistant") &&
    typeof value["text"] === "string"
  );
}

function boundedLimit(limit: number): number {
  return Number.isSafeInteger(limit) && limit > 0 ? limit : 0;
}

function stringField(record: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function safeJsonString(value: string): string {
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
