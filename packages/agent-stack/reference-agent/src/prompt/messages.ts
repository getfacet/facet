import type {
  ClientEvent,
  CollectedEvent,
  FacetAction,
  FacetSession,
  FieldValues,
} from "@facet/core";
import type { StoredEvent } from "@facet/runtime";

import type { TurnMessage } from "../provider.js";
import { formatCurrentStageForPrompt } from "./stage-summary.js";

/** How many sink entries (visitor event + agent reply pairs) layer 3 replays. */
export const HISTORY_TURNS = 20;

function normalizeLegacyEvent(event: unknown): unknown {
  if (!isRecord(event) || event["kind"] !== "action") return event;
  const legacy = event as {
    readonly action?: FacetAction;
    readonly fields?: FieldValues;
  };
  return {
    kind: "tap",
    ...(legacy.action !== undefined ? { action: legacy.action } : {}),
    ...(legacy.fields !== undefined ? { fields: legacy.fields } : {}),
  };
}

/** One visitor event as a compact user-side line. */
export function describeEvent(raw: CollectedEvent): string {
  const event = normalizeLegacyEvent(raw);
  if (!isRecord(event) || typeof event["kind"] !== "string") return "(unknown event)";

  switch (event["kind"]) {
    case "visit": {
      const visitor = event["visitor"];
      if (!isRecord(visitor)) return "(unknown event)";
      const referrer = typeof visitor["referrer"] === "string" ? visitor["referrer"] : undefined;
      const locale = typeof visitor["locale"] === "string" ? visitor["locale"] : undefined;
      const relationship =
        typeof visitor["relationship"] === "string" ? visitor["relationship"] : undefined;
      return `(visit) context=${JSON.stringify({ referrer, locale, relationship })}`;
    }
    case "message": {
      const text = event["text"];
      return typeof text === "string" ? text : "(unknown event)";
    }
    case "tap": {
      const navLine = (to: string) => `(action navigate to=${to})`;
      const toggleLine = (target: string) => `(action toggle target=${target})`;
      const effect = event["effect"];
      if (effect !== undefined) {
        if (!isRecord(effect)) return "(unknown event)";
        const navigate = effect["navigate"];
        if (typeof navigate === "string") return navLine(navigate);
        const toggle = effect["toggle"];
        if (typeof toggle === "string") return toggleLine(toggle);
        return "(unknown event)";
      }
      const action = event["action"];
      if (isRecord(action)) {
        if (action["kind"] === "navigate" && typeof action["to"] === "string") {
          return navLine(action["to"]);
        }
        if (action["kind"] === "toggle" && typeof action["target"] === "string") {
          return toggleLine(action["target"]);
        }
        const name = action["name"];
        if (typeof name !== "string") return "(unknown event)";
        const payload = safeJson(action["payload"] ?? {});
        const fields = safeJson(event["fields"] ?? {});
        return `(action ${name} payload=${payload} fields=${fields})`;
      }
      return "(unknown event)";
    }
    default:
      return "(unknown event)";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function describeReplies(messages: unknown): string {
  if (!Array.isArray(messages)) return "(no reply)";
  const parts: string[] = [];
  for (const message of messages) {
    if (!isRecord(message)) continue;
    if (message["kind"] === "say" && typeof message["text"] === "string") {
      parts.push(message["text"]);
    }
  }
  if (messages.some((message) => isRecord(message) && message["kind"] === "patch")) {
    parts.push("(page updated)");
  }
  return parts.length > 0 ? parts.join("\n") : "(no reply)";
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "{}";
  } catch {
    return "{}";
  }
}

/**
 * Layer 3: recent stored interactions as alternating user/assistant messages,
 * then the current event plus either full stage JSON or a bounded stage summary.
 */
export function buildInitialMessages(
  event: ClientEvent,
  session: FacetSession,
  history: readonly StoredEvent[],
  limit: number,
): TurnMessage[] {
  const messages: TurnMessage[] = [];
  const safeHistory = Array.isArray(history) ? history : [];
  const replayed = limit > 0 ? safeHistory.slice(-limit) : [];
  for (const entry of replayed) {
    const event = isRecord(entry) ? entry["event"] : undefined;
    const replies = isRecord(entry) ? entry["messages"] : undefined;
    messages.push({ role: "user", content: describeEvent(event as CollectedEvent) });
    messages.push({ role: "assistant", content: describeReplies(replies) });
  }
  messages.push({
    role: "user",
    content: `${describeEvent(event)}\n\n${formatCurrentStageForPrompt(session.stage)}`,
  });
  return messages;
}
