import type {
  ClientEvent,
  CollectedEvent,
  FacetAction,
  FacetSession,
  FieldValues,
} from "@facet/core";
import {
  REDACTED_SENSITIVE_VALUE,
  shouldRedactSensitiveField,
  type StoredEvent,
} from "@facet/runtime";

import type { TurnMessage } from "../provider.js";
import { formatCurrentStageForPrompt, type StageSummaryOptions } from "./stage-summary.js";

export { redactSensitiveText } from "@facet/runtime";

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

/**
 * How many `toggled` entries the inert view line renders inline. The boundary
 * sanitizer already caps `toggled` at `MAX_VIEW_TOGGLED_KEYS`; this is a second,
 * prompt-side bound so the line stays short regardless of upstream.
 */
const MAX_VIEW_TOGGLES_RENDERED = 16;

/**
 * Render the visitor's browser-owned `view` snapshot as ONE bounded, inert prompt
 * line (or "" when nothing renderable is present). Pure descriptive text the agent
 * reads to target its next patch at the screen the visitor is actually on — it is
 * NEVER routed to any executor/patch/fold call site (DC-005). Fail-safe: reads only
 * known flat fields and never throws, mirroring `describeEvent`'s contract.
 */
function describeView(view: unknown, revisit: boolean): string {
  if (!isRecord(view)) return "";
  const parts: string[] = [];

  const screen = view["screen"];
  if (typeof screen === "string") parts.push(`screen: ${JSON.stringify(screen)}`);

  const toggled = view["toggled"];
  if (isRecord(toggled)) {
    const shown: string[] = [];
    const hidden: string[] = [];
    for (const [key, value] of Object.entries(toggled)) {
      if (shown.length + hidden.length >= MAX_VIEW_TOGGLES_RENDERED) break;
      if (value === "shown") shown.push(key);
      else if (value === "hidden") hidden.push(key);
    }
    // Toggled keys are visitor-controlled node ids; escape each (as `screen` is)
    // so attacker text — newlines, fake role markers — cannot break out of this
    // inert line into the surrounding prompt.
    if (shown.length > 0) parts.push(`shown: ${shown.map((k) => JSON.stringify(k)).join(", ")}`);
    if (hidden.length > 0) parts.push(`hidden: ${hidden.map((k) => JSON.stringify(k)).join(", ")}`);
  }

  const device: string[] = [];
  const viewport = view["viewport"];
  if (typeof viewport === "string") device.push(viewport);
  const scheme = view["scheme"];
  if (typeof scheme === "string") device.push(scheme);
  if (device.length > 0) parts.push(`device: ${device.join(", ")}`);

  if (parts.length === 0) return "";
  const label = revisit ? "[visitor view, last visit]" : "[visitor view]";
  return `${label} ${parts.join("; ")}`;
}

/** One visitor event as a compact user-side line. */
export function describeEvent(raw: CollectedEvent): string {
  const event = normalizeLegacyEvent(raw);
  if (!isRecord(event) || typeof event["kind"] !== "string") return "(unknown event)";

  const base = describeEventBase(event);
  // A malformed event stays a bare "(unknown event)"; only decorate a real render.
  if (base === "(unknown event)") return base;
  const viewLine = describeView(event["view"], event["kind"] === "visit");
  return viewLine === "" ? base : `${base}\n${viewLine}`;
}

/** The per-kind base rendering; `describeEvent` appends the inert view line. */
function describeEventBase(event: Record<string, unknown>): string {
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
    fields[name] = shouldRedactSensitiveField(name, fieldValue)
      ? REDACTED_SENSITIVE_VALUE
      : fieldValue;
  }
  return safeJson(fields);
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
