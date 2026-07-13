import type { IncomingMessage } from "node:http";
import {
  asAgentServerMessage,
  MAX_PATCH_OPS,
  normalizeClientEvent,
  normalizeLocalCollectedEvent,
  normalizeVisitorContext,
  type AgentControlFrame,
  type ClientEvent,
  type LocalCollectedEvent,
  type VisitorContext,
} from "@facet/core";

/** Max accepted request body. A single-operator reference transport still shouldn't
 * buffer an unbounded upload into memory, so both POST channels (/event and
 * /agent/control) cap here. Raise it if a legitimate payload (a large stage patch)
 * grows past this; lower it to tighten the DoS surface. */
const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MiB

export function readJson(
  req: IncomingMessage,
  maxBytes: number = MAX_BODY_BYTES,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    // utf8 decoding must happen on the stream (a multibyte char split across
    // two chunks corrupts under per-chunk String()).
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      size += Buffer.byteLength(chunk, "utf8");
      if (size > maxBytes) {
        // Past the cap: stop buffering, shed the rest of the upload, and reject so
        // the caller's existing `.catch` answers 400.
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

/** Normalize an untrusted native `/event` envelope through the core contract. */
export function normalizeEventBody(
  body: unknown,
): { readonly visitor: VisitorContext; readonly event: ClientEvent } | undefined {
  try {
    if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
    const value = body as Record<string, unknown>;
    const visitor = normalizeVisitorContext(value["visitor"]);
    const event = normalizeClientEvent(value["event"]);
    return visitor === undefined || event === undefined ? undefined : { visitor, event };
  } catch {
    return undefined;
  }
}

/** Normalize an untrusted native `/record` envelope through the core contract. */
export function normalizeRecordBody(
  body: unknown,
): { readonly visitor: VisitorContext; readonly event: LocalCollectedEvent } | undefined {
  try {
    if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
    const value = body as Record<string, unknown>;
    const visitor = normalizeVisitorContext(value["visitor"]);
    const event = normalizeLocalCollectedEvent(value["event"]);
    return visitor === undefined || event === undefined ? undefined : { visitor, event };
  } catch {
    return undefined;
  }
}

/** Shape-check an /agent/control body before resolving a pending request with it —
 * per-kind, so a malformed message can't smuggle a non-array `patches` or a
 * non-string `text` into the runtime and the browser. */
export function isControlBody(body: unknown): body is AgentControlFrame {
  if (typeof body !== "object" || body === null) return false;
  const { requestId, messages } = body as { requestId?: unknown; messages?: unknown };
  if (typeof requestId !== "number") return false;
  if (!Array.isArray(messages)) return false;
  // Cap the op count at the wire boundary on the per-FRAME AGGREGATE (running total
  // across the frame's patch messages), not per message: the runtime coalesces all
  // of a turn's patch messages and folds ONCE, so a split body (k messages of
  // ≤MAX_PATCH_OPS ops each) whose total exceeds the cap would be 202-accepted here
  // then silently dropped WHOLE at the fold. A hostile 5 MiB batch (~1M junk ops),
  // split or not, is 400-rejected here before it can reach the runtime's fold path.
  let totalOps = 0;
  return messages.every((m) => {
    const message = asAgentServerMessage(m);
    if (message === undefined) return false;
    if (message.kind === "patch") {
      totalOps += message.patches.length;
      return totalOps <= MAX_PATCH_OPS;
    }
    return true;
  });
}
