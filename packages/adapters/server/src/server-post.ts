import type { IncomingMessage, ServerResponse } from "node:http";
import type { AgentControlFrame, AgentEvent, ConversationMessage } from "@facet/core";
import type { FacetRuntime } from "@facet/runtime";
import type { AgentChannel } from "./agent-channel.js";
import { emitFacetServerObservation, type FacetServerObserver } from "./observer.js";
import {
  isControlBody,
  normalizeEventBody,
  normalizeMessageBody,
  readJson,
} from "./server-validation.js";

export interface PostHandlerDeps {
  readonly runtimeFor: (sessionKey: string) => FacetRuntime;
  readonly ensureSession: (sessionKey: string) => Promise<void>;
  readonly observer?: FacetServerObserver;
}

async function runEvent(
  deps: PostHandlerDeps,
  sessionKey: string,
  event: AgentEvent,
  visitorMessage?: ConversationMessage,
): Promise<{ readonly status: number; readonly body: unknown }> {
  await deps.ensureSession(sessionKey);
  emitFacetServerObservation(deps.observer, { kind: "ui-in", sessionKey, event });
  const result = await deps
    .runtimeFor(sessionKey)
    .handle(
      visitorMessage === undefined ? { sessionKey, event } : { sessionKey, event, visitorMessage },
    );
  if (result.outcome === "busy") {
    emitFacetServerObservation(deps.observer, { kind: "busy", sessionKey, eventId: event.eventId });
    return { status: 409, body: result };
  }
  if (result.outcome === "conflict") {
    return { status: 409, body: result };
  }
  if (result.outcome === "failed") {
    return { status: 500, body: result };
  }
  return { status: 202, body: result };
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export function handleEvent(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PostHandlerDeps,
): void {
  readJson(req)
    .then(async (body) => {
      const normalized = normalizeEventBody(body);
      if (normalized === undefined) {
        res.writeHead(400);
        res.end();
        return;
      }
      const result = await runEvent(deps, normalized.sessionKey, normalized.event);
      writeJson(res, result.status, result.body);
    })
    .catch(() => {
      res.writeHead(400);
      res.end();
    });
}

export function handleMessage(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PostHandlerDeps,
): void {
  readJson(req)
    .then(async (body) => {
      const normalized = normalizeMessageBody(body);
      if (normalized === undefined) {
        res.writeHead(400);
        res.end();
        return;
      }
      const result = await runEvent(
        deps,
        normalized.sessionKey,
        normalized.event,
        normalized.visitorMessage,
      );
      writeJson(res, result.status, result.body);
    })
    .catch(() => {
      res.writeHead(400);
      res.end();
    });
}

export function handleControl(
  req: IncomingMessage,
  res: ServerResponse,
  channel: AgentChannel,
): void {
  readJson(req)
    .then((body) => {
      if (!isControlBody(body)) {
        res.writeHead(400);
        res.end();
        return;
      }
      channel.resolve(body as AgentControlFrame);
      res.writeHead(202);
      res.end();
    })
    .catch(() => {
      res.writeHead(400);
      res.end();
    });
}
