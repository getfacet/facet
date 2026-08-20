import type { IncomingMessage } from "node:http";
import {
  BOUNDS,
  deriveMessageId,
  validateVisitorEvent,
  validateTurnOutcome,
  validateVisitorText,
} from "@facet/core";
import type { AgentControlFrame, VisitorEvent, ConversationMessage } from "@facet/core";

const MAX_BODY_BYTES = BOUNDS.visitorRequestBodyBytes;

export function readJson(
  req: IncomingMessage,
  maxBytes: number = MAX_BODY_BYTES,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      size += Buffer.byteLength(chunk, "utf8");
      if (size > maxBytes) {
        reject(new Error("request body exceeds size cap"));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error instanceof Error ? error : new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSessionKey(value: Record<string, unknown>): string | undefined {
  const direct = value["sessionKey"];
  if (typeof direct === "string" && direct.length > 0) return direct;
  return undefined;
}

export function normalizeEventBody(
  body: unknown,
): { readonly sessionKey: string; readonly event: VisitorEvent } | undefined {
  if (!isRecord(body)) return undefined;
  const sessionKey = readSessionKey(body);
  const event = validateVisitorEvent(body["event"]);
  return sessionKey === undefined || !event.ok
    ? undefined
    : Object.freeze({ sessionKey, event: event.event });
}

export function normalizeMessageBody(
  body: unknown,
  now: () => number = Date.now,
):
  | {
      readonly sessionKey: string;
      readonly event: VisitorEvent;
      readonly visitorMessage: ConversationMessage;
    }
  | undefined {
  if (!isRecord(body)) return undefined;
  const sessionKey = readSessionKey(body);
  const messageId = body["messageId"];
  const text = body["text"];
  const screen = body["screen"] ?? "home";
  const stageRevision = body["stageRevision"] ?? 0;
  if (
    sessionKey === undefined ||
    typeof messageId !== "string" ||
    messageId.length === 0 ||
    !validateVisitorText(text) ||
    typeof screen !== "string" ||
    typeof stageRevision !== "number"
  ) {
    return undefined;
  }
  const eventResult = validateVisitorEvent({
    eventId: messageId,
    eventName: "message",
    sourceNodeId: "visitor",
    screen,
    stageRevision,
    collect: {},
  });
  if (!eventResult.ok) return undefined;
  return Object.freeze({
    sessionKey,
    event: eventResult.event,
    visitorMessage: Object.freeze({
      kind: "conversation" as const,
      messageId: deriveMessageId(messageId, "visitor"),
      turnId: messageId,
      role: "visitor" as const,
      text,
      at: now(),
    }),
  });
}

export function isControlBody(body: unknown): body is AgentControlFrame {
  if (!isRecord(body)) return false;
  if (body["kind"] !== "agent_control") return false;
  if (typeof body["eventId"] !== "string" || body["eventId"].length === 0) return false;
  if (
    body["correlationId"] !== undefined &&
    (typeof body["correlationId"] !== "string" || body["correlationId"].length === 0)
  ) {
    return false;
  }
  const validated = validateTurnOutcome(body["outcome"]);
  return (
    validated.ok &&
    validated.outcome.patches.length === 0 &&
    (validated.outcome.conversation === undefined ||
      validated.outcome.conversation.turnId === body["eventId"])
  );
}
