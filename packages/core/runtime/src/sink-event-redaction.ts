import type { CollectedEvent, FieldValues } from "@facet/core";
import { REDACTED_SENSITIVE_VALUE, shouldRedactSensitiveField } from "./redaction.js";

/** Produce the log-safe event body stored by a conversation Sink. */
export function sanitizeEventForSink(event: CollectedEvent): CollectedEvent {
  if (event.kind === "visit") {
    return {
      ...event,
      visitor: { ...event.visitor, visitorId: REDACTED_SENSITIVE_VALUE },
    };
  }
  if (event.kind === "message") return { ...event };
  if (event.fields === undefined) return { ...event };
  return { ...event, fields: sanitizeFieldsForSink(event.fields) };
}

function sanitizeFieldsForSink(fields: FieldValues): FieldValues {
  const sanitized: Record<string, string | boolean> = {};
  for (const [name, value] of Object.entries(fields)) {
    sanitized[name] = shouldRedactSensitiveField(name, value) ? REDACTED_SENSITIVE_VALUE : value;
  }
  return sanitized;
}
