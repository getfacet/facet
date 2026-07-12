import type { IncomingMessage } from "node:http";
import {
  asAgentServerMessage,
  isPrimitiveRecord,
  MAX_FIELD_VALUE_CHARS,
  MAX_FIELDS_KEYS,
  MAX_PATCH_OPS,
  sanitizeView,
  type AgentControlFrame,
  type ClientEvent,
  type CollectedEvent,
  type FieldValues,
  type TapEffect,
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

/** The body/visitor/event envelope shared by /event and /record: a body object
 * carrying a `visitor` with a string `visitorId` and a non-null `event` object.
 * Both validators layer their per-kind `event` narrowing on top of this. */
function isEventEnvelope(body: unknown): body is { visitor: VisitorContext; event: object } {
  if (typeof body !== "object" || body === null) return false;
  const { visitor, event } = body as { visitor?: unknown; event?: unknown };
  if (!isVisitorContext(visitor)) return false;
  return typeof event === "object" && event !== null;
}

function isVisitorContext(value: unknown): value is VisitorContext {
  if (typeof value !== "object" || value === null) return false;
  const { visitorId, referrer, locale, relationship } = value as {
    visitorId?: unknown;
    referrer?: unknown;
    locale?: unknown;
    relationship?: unknown;
  };
  return (
    typeof visitorId === "string" &&
    (referrer === undefined || typeof referrer === "string") &&
    (locale === undefined || typeof locale === "string") &&
    (relationship === undefined || typeof relationship === "string")
  );
}

/** `seq` is a forward-compatible wire field on every event variant (declared
 * `seq?: number`): tolerated absent, but a present value must be a number — else a
 * non-number would be persisted while the narrowed type claims `number | undefined`
 * (unsound). Shared by both validators. */
function isValidSeq(event: object): boolean {
  const seq = (event as { seq?: unknown }).seq;
  return seq === undefined || (typeof seq === "number" && Number.isFinite(seq));
}

/** Shape-check an untrusted browser /event body before trusting it — including
 * the per-kind payload (a kind-only check lets `{kind:"tap"}` without an
 * action object crash downstream consumers, e.g. the persistent bridge). */
export function isEventBody(
  body: unknown,
): body is { visitor: VisitorContext; event: ClientEvent } {
  if (!isEventEnvelope(body)) return false;
  const { event } = body;
  if (!isValidSeq(event)) return false;
  const { kind, text, action } = event as { kind?: unknown; text?: unknown; action?: unknown };
  if (kind === "visit") {
    const eventVisitor = (event as { visitor?: unknown }).visitor;
    return isVisitorContext(eventVisitor);
  }
  if (kind === "message") return typeof text === "string";
  if (kind === "tap") {
    if (typeof action !== "object" || action === null) return false;
    // Only agent actions travel over the transport — navigate/toggle are
    // client-local and the renderer never sends them. Reject any other kind so
    // a spoofed `{kind:"navigate"}` can't reach an agent typed as FacetAction.
    const actionKind = (action as { kind?: unknown }).kind;
    if (actionKind !== undefined && actionKind !== "agent") return false;
    if (typeof (action as { name?: unknown }).name !== "string") return false;
    // `collect` is a NodeId (string) if present — validate the sibling field as
    // strictly as `payload` below, so a spoofed client can't inject an
    // ill-typed collect into a FacetAction reaching the agent.
    const collect = (action as { collect?: unknown }).collect;
    if (collect !== undefined && typeof collect !== "string") return false;
    // Optional visitor-typed field values riding the event: absent is fine;
    // present must be a string/boolean record within the shared cap (see isFieldsRecord).
    const fields = (event as { fields?: unknown }).fields;
    if (fields !== undefined && !isFieldsRecord(fields)) return false;
    // `effect`/`target` are LOCAL-tap fields (a renderer-resolved navigate/toggle
    // that rides /record). An /event agent tap must carry `action` (+fields) only —
    // reject smuggled local-tap fields so they can't bypass the field cap. Symmetric
    // with isRecordBody's rejection of an `action` on a local tap.
    if ((event as { effect?: unknown }).effect !== undefined) return false;
    if ((event as { target?: unknown }).target !== undefined) return false;
    const payload = (action as { payload?: unknown }).payload;
    if (payload === undefined) return true;
    // Mirror core's asAction: the payload must be a plain (non-array) object whose
    // every value is a primitive — otherwise a nested object or an array would pass
    // a kind-only check and reach the agent. `isPrimitiveRecord` is the REJECTING
    // form of that rule (see core's validate.ts).
    return isFinitePrimitiveRecord(payload);
  }
  return false;
}

/**
 * Clamp the browser-owned `view` on an accepted `/event` at the untrusted
 * boundary — WITHOUT ever rejecting the event for view reasons. `isEventBody`
 * stays a pure accept/reject guard that ignores `view`; this runs AFTER it
 * passes and replaces `view` with the core `sanitizeView` result (the single
 * source of the bounds — never re-implemented here). Returns a NEW event object
 * (no mutation of the input); the `view` key is omitted entirely when the
 * sanitizer returns `undefined`, so a wholly-hostile or absent `view` yields an
 * event that processes exactly as if it never carried one. Symmetric with the
 * ag-ui normalizer's conditional-spread of a clamped `view`.
 */
export function sanitizeEventView(event: ClientEvent): ClientEvent {
  const view = sanitizeView((event as { view?: unknown }).view);
  const { view: _dropped, ...rest } = event as ClientEvent & { view?: unknown };
  return view === undefined ? (rest as ClientEvent) : ({ ...rest, view } as ClientEvent);
}

function isFinitePrimitiveRecord(value: unknown): boolean {
  return (
    isPrimitiveRecord(value) &&
    Object.values(value as Record<string, unknown>).every(
      (entry) => typeof entry !== "number" || Number.isFinite(entry),
    )
  );
}

/** Shape-check a renderer-resolved `TapEffect` on a collected /record tap: an object
 * carrying EITHER a string `navigate` (a screen name) or a string `toggle` (a node
 * id). Anything else is rejected so a malformed effect can't reach the Sink. */
function isTapEffect(value: unknown): value is TapEffect {
  if (typeof value !== "object" || value === null) return false;
  const { navigate, toggle } = value as { navigate?: unknown; toggle?: unknown };
  // Bound the effect string with the same cap as `fields` values so a ~5 MiB
  // navigate/toggle can't be persisted into the (unbounded) Sink and later
  // replayed into the LLM prompt.
  if (navigate !== undefined)
    return (
      typeof navigate === "string" &&
      navigate.length <= MAX_FIELD_VALUE_CHARS &&
      toggle === undefined
    );
  if (toggle !== undefined)
    return (
      typeof toggle === "string" && toggle.length <= MAX_FIELD_VALUE_CHARS && navigate === undefined
    );
  return false;
}

/** Shape-check an untrusted /record body: a collected LOCAL tap (a navigate/toggle
 * the renderer already resolved) that the runtime persists to the Sink WITHOUT
 * invoking the agent. Mirrors `isEventBody`'s per-kind rigor but for the local tap
 * shape — `target`/`effect`/`fields`/`seq` are all optional and, when present,
 * strictly typed (reusing the shared field caps via `isFieldsRecord`). Unlike
 * `isEventBody` there is no `action` to guard: a local tap never reaches the agent.
 * A malformed or empty body is rejected so nothing ill-shaped reaches the Sink. */
export function isRecordBody(
  body: unknown,
): body is { visitor: VisitorContext; event: CollectedEvent } {
  if (!isEventEnvelope(body)) return false;
  const { event } = body;
  // /record carries only locally-resolved taps — visit/message are forward events
  // that ride /event, never the record-only channel.
  if ((event as { kind?: unknown }).kind !== "tap") return false;
  // A local navigate/toggle tap only ever carries `effect` — never `action`. Reject
  // ANY action (incl. null) so a `{kind:"tap", action:…}` can't be shape-accepted
  // and persisted verbatim to the Sink (poisoning the durable log / bypassing the
  // field cap). Symmetric with isEventBody's rejection of effect/target on an agent tap.
  const action = (event as { action?: unknown }).action;
  if (action !== undefined) return false;
  const target = (event as { target?: unknown }).target;
  // Cap `target` with the same bound as `fields`/effect strings so an over-long
  // node id can't be persisted into the (unbounded) Sink.
  if (target !== undefined && (typeof target !== "string" || target.length > MAX_FIELD_VALUE_CHARS))
    return false;
  const effect = (event as { effect?: unknown }).effect;
  if (effect !== undefined && !isTapEffect(effect)) return false;
  const fields = (event as { fields?: unknown }).fields;
  if (fields !== undefined && !isFieldsRecord(fields)) return false;
  // A local tap must carry a RENDERABLE payload. `describeEvent` renders a tap
  // from its `effect` (or `action`), never from `target` — so `target` alone is
  // not renderable. The renderer always attaches a navigate/toggle `effect` to a
  // local tap, and `action` is already rejected above, so a valid /record tap
  // ALWAYS carries `effect`. A body lacking BOTH `effect` and `action` is
  // semantically empty (`{kind:"tap"}`, a fields-only tap, or a hand-crafted
  // target-only tap) — drop it here so no inert no-content StoredEvent is
  // persisted (which would later replay as an `(unknown event)` prompt line).
  if (effect === undefined && action === undefined) return false;
  return isValidSeq(event);
}

/** The REJECTING form of the action `fields` rule: a plain (non-array) object
 * whose every value is either a boolean (checkbox/switch) or a string of length
 * ≤ `MAX_FIELD_VALUE_CHARS`. Keys and their count are bounded too, so a
 * non-renderer client can't slip megabytes of untrusted fields through the
 * per-value cap in aggregate (the renderer's output is bounded by tree size).
 * The renderer caps values at collection time with the same core constant, so
 * the two sides cannot drift. */
function isFieldsRecord(value: unknown): value is FieldValues {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  if (entries.length > MAX_FIELDS_KEYS) return false;
  return entries.every(
    ([k, v]) =>
      k.length <= MAX_FIELD_VALUE_CHARS &&
      (typeof v === "boolean" || (typeof v === "string" && v.length <= MAX_FIELD_VALUE_CHARS)),
  );
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
