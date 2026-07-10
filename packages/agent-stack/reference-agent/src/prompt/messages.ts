import type {
  ClientEvent,
  CollectedEvent,
  FacetAction,
  FacetSession,
  FieldValues,
} from "@facet/core";
import type { StoredEvent } from "@facet/runtime";

import type { TurnMessage } from "../provider.js";
import { formatCurrentStageForPrompt, type StageSummaryOptions } from "./stage-summary.js";

/** How many sink entries (visitor event + agent reply pairs) layer 3 replays. */
export const HISTORY_TURNS = 20;

const REDACTED_PROMPT_VALUE = "[redacted]";
const SENSITIVE_FIELD_NAME =
  /(?:password|passcode|secret|token|api[_-]?key|authorization|bearer|provider[_-]?key)/i;
const SENSITIVE_FIELD_VALUE = /\b(?:sk-[A-Za-z0-9_-]+|Bearer\s+[A-Za-z0-9._~+/=-]+)\b/i;

const SENSITIVE_FIELD_VALUE_GLOBAL = new RegExp(SENSITIVE_FIELD_VALUE.source, "gi");
// The key-name quantifiers are BOUNDED ({0,256}): with unbounded `[^"]*` on both
// sides of the alternation, an unclosed quote followed by repeated sensitive
// words backtracks quadratically (seconds of synchronous event-loop work at a
// few hundred KB). No realistic secret field name exceeds 256 chars.
const SENSITIVE_FIELD_PAIR_GLOBAL = new RegExp(
  `("[^"]{0,256}(?:${SENSITIVE_FIELD_NAME.source})[^"]{0,256}"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`,
  "gi",
);

/** Ceiling on text fed to the redaction regexes. Summary fields are capped far
 * below this later (`MAX_SUMMARY_FIELD_CHARS`), so truncating a pathological
 * pre-cap input loses nothing that would survive validation. */
const MAX_REDACTION_INPUT_CHARS = 100_000;

/**
 * Redact sensitive substrings (`sk-…` / `Bearer …`) and the quoted values of
 * sensitive field names (`"password": "…"`) inside free text. Reuses the same
 * private patterns that gate input-field redaction so summary output and input
 * are scrubbed to the same rule. Pure; never throws.
 */
export function redactSensitiveText(text: string): string {
  const bounded =
    text.length > MAX_REDACTION_INPUT_CHARS ? text.slice(0, MAX_REDACTION_INPUT_CHARS) : text;
  return bounded
    .replace(
      SENSITIVE_FIELD_PAIR_GLOBAL,
      (_match, prefix: string) => `${prefix}"${REDACTED_PROMPT_VALUE}"`,
    )
    .replace(SENSITIVE_FIELD_VALUE_GLOBAL, REDACTED_PROMPT_VALUE);
}

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
        const fields = safeFieldsJson(event["fields"] ?? {});
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

function safeFieldsJson(value: unknown): string {
  if (!isRecord(value)) return "{}";
  const fields: Record<string, unknown> = {};
  for (const [name, fieldValue] of Object.entries(value)) {
    fields[name] = shouldRedactField(name, fieldValue) ? REDACTED_PROMPT_VALUE : fieldValue;
  }
  return safeJson(fields);
}

function shouldRedactField(name: string, value: unknown): boolean {
  return (
    SENSITIVE_FIELD_NAME.test(name) ||
    (typeof value === "string" && SENSITIVE_FIELD_VALUE.test(value))
  );
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
  /** Stage rendering bounds; omit for the built-in defaults. Pass the budget's
   * bounds when the result must mirror the real context assembly. */
  stageOptions?: StageSummaryOptions,
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
    content: `${describeEvent(event)}\n\n${formatCurrentStageForPrompt(session.stage, stageOptions ?? {})}`,
  });
  return messages;
}

/**
 * Render ONE stored history entry to its plain `user:`/`assistant:` summarizer-input
 * lines, reusing the exact `describeEvent`/`describeReplies` rendering the live prompt
 * uses (without the current-turn event/stage block `buildInitialMessages` appends).
 * Never touches the stage, so a caller bounding a long backlog can render lazily —
 * one entry at a time under a char cap — instead of materializing every entry's full
 * prompt (event + ~48K stage) first. Zero behavior change to `buildInitialMessages`.
 */
export function renderHistoryEntry(entry: StoredEvent): string {
  const event = isRecord(entry) ? entry["event"] : undefined;
  const replies = isRecord(entry) ? entry["messages"] : undefined;
  return `user: ${describeEvent(event as CollectedEvent)}\nassistant: ${describeReplies(replies)}`;
}
