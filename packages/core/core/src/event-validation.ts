import type { FacetAction } from "./nodes.js";
import {
  MAX_FIELDS_KEYS,
  MAX_FIELD_VALUE_CHARS,
  type ClientEvent,
  type CollectedEvent,
  type FieldValues,
  type TapEffect,
  type VisitorContext,
} from "./protocol.js";
import { sanitizeView } from "./view.js";

/** A collected tap resolved locally by the renderer and never routed to an agent. */
export type LocalCollectedEvent = Extract<CollectedEvent, { readonly kind: "tap" }> & {
  readonly effect: TapEffect;
  readonly action?: never;
};

/** Normalize an untrusted visitor value to the closed public visitor contract. */
export function normalizeVisitorContext(value: unknown): VisitorContext | undefined {
  try {
    if (!isObjectRecord(value)) return undefined;
    const visitorId = value["visitorId"];
    if (typeof visitorId !== "string") return undefined;

    const referrer = optionalString(value, "referrer");
    const locale = optionalString(value, "locale");
    const relationship = optionalString(value, "relationship");
    if (referrer === null || locale === null || relationship === null) return undefined;

    return {
      visitorId,
      ...(referrer === undefined ? {} : { referrer }),
      ...(locale === undefined ? {} : { locale }),
      ...(relationship === undefined ? {} : { relationship }),
    };
  } catch {
    return undefined;
  }
}

/**
 * Normalize the browser-to-agent event subset. Unknown keys are dropped so all
 * transports persist and deliver the same canonical JSON-compatible shape.
 */
export function normalizeClientEvent(value: unknown): ClientEvent | undefined {
  try {
    if (!isObjectRecord(value)) return undefined;
    const seq = optionalSeq(value);
    if (seq === null) return undefined;
    const view = sanitizeView(value["view"]);

    if (value["kind"] === "visit") {
      const visitor = normalizeVisitorContext(value["visitor"]);
      return visitor === undefined
        ? undefined
        : {
            kind: "visit",
            visitor,
            ...(view === undefined ? {} : { view }),
            ...(seq === undefined ? {} : { seq }),
          };
    }

    if (value["kind"] === "message") {
      const text = value["text"];
      return typeof text !== "string"
        ? undefined
        : {
            kind: "message",
            text,
            ...(view === undefined ? {} : { view }),
            ...(seq === undefined ? {} : { seq }),
          };
    }

    if (value["kind"] !== "tap") return undefined;
    if (value["effect"] !== undefined || value["target"] !== undefined) return undefined;
    const action = normalizeAgentAction(value["action"]);
    const fields = optionalFields(value);
    if (action === undefined || fields === null) return undefined;
    return {
      kind: "tap",
      action,
      ...(fields === undefined ? {} : { fields }),
      ...(view === undefined ? {} : { view }),
      ...(seq === undefined ? {} : { seq }),
    };
  } catch {
    return undefined;
  }
}

/**
 * Normalize a renderer-resolved local tap for a record-only channel. Agent
 * actions and semantically empty taps are rejected rather than reclassified.
 */
export function normalizeLocalCollectedEvent(value: unknown): LocalCollectedEvent | undefined {
  try {
    if (!isObjectRecord(value) || value["kind"] !== "tap") return undefined;
    if (value["action"] !== undefined) return undefined;
    const seq = optionalSeq(value);
    const effect = optionalTapEffect(value);
    const fields = optionalFields(value);
    const target = optionalBoundedString(value, "target");
    if (
      seq === null ||
      effect === undefined ||
      effect === null ||
      fields === null ||
      target === null
    ) {
      return undefined;
    }
    const view = sanitizeView(value["view"]);
    return {
      kind: "tap",
      effect,
      ...(target === undefined ? {} : { target }),
      ...(fields === undefined ? {} : { fields }),
      ...(view === undefined ? {} : { view }),
      ...(seq === undefined ? {} : { seq }),
    };
  } catch {
    return undefined;
  }
}

function normalizeAgentAction(value: unknown): FacetAction | undefined {
  if (!isObjectRecord(value)) return undefined;
  const kind = value["kind"];
  if (kind !== undefined && kind !== "agent") return undefined;
  const name = value["name"];
  if (typeof name !== "string") return undefined;
  const payload = optionalPayload(value);
  const collect = optionalString(value, "collect");
  if (payload === null || collect === null) return undefined;
  return {
    ...(kind === "agent" ? { kind } : {}),
    name,
    ...(payload === undefined ? {} : { payload }),
    ...(collect === undefined ? {} : { collect }),
  };
}

function optionalTapEffect(value: Record<string, unknown>): TapEffect | undefined | null {
  const effect = value["effect"];
  if (effect === undefined) return undefined;
  if (!isObjectRecord(effect)) return null;
  const navigate = effect["navigate"];
  const toggle = effect["toggle"];
  if (
    typeof navigate === "string" &&
    navigate.length <= MAX_FIELD_VALUE_CHARS &&
    toggle === undefined
  )
    return { navigate };
  if (
    typeof toggle === "string" &&
    toggle.length <= MAX_FIELD_VALUE_CHARS &&
    navigate === undefined
  )
    return { toggle };
  return null;
}

function optionalFields(value: Record<string, unknown>): FieldValues | undefined | null {
  const fields = value["fields"];
  if (fields === undefined) return undefined;
  if (!isObjectRecord(fields)) return null;
  const entries = Object.entries(fields);
  if (entries.length > MAX_FIELDS_KEYS) return null;
  const normalized: Record<string, string | boolean> = {};
  for (const [name, fieldValue] of entries) {
    if (name.length > MAX_FIELD_VALUE_CHARS) return null;
    if (typeof fieldValue === "boolean") normalized[name] = fieldValue;
    else if (typeof fieldValue === "string" && fieldValue.length <= MAX_FIELD_VALUE_CHARS)
      normalized[name] = fieldValue;
    else return null;
  }
  return normalized;
}

function optionalPayload(
  value: Record<string, unknown>,
): Readonly<Record<string, string | number | boolean>> | undefined | null {
  const payload = value["payload"];
  if (payload === undefined) return undefined;
  if (!isObjectRecord(payload)) return null;
  const normalized: Record<string, string | number | boolean> = {};
  for (const [name, payloadValue] of Object.entries(payload)) {
    if (
      typeof payloadValue !== "string" &&
      typeof payloadValue !== "number" &&
      typeof payloadValue !== "boolean"
    )
      return null;
    if (typeof payloadValue === "number" && !Number.isFinite(payloadValue)) return null;
    normalized[name] = payloadValue;
  }
  return normalized;
}

function optionalSeq(value: Record<string, unknown>): number | undefined | null {
  const seq = value["seq"];
  if (seq === undefined) return undefined;
  return typeof seq === "number" && Number.isFinite(seq) ? seq : null;
}

function optionalString(value: Record<string, unknown>, key: string): string | undefined | null {
  const entry = value[key];
  if (entry === undefined) return undefined;
  return typeof entry === "string" ? entry : null;
}

function optionalBoundedString(
  value: Record<string, unknown>,
  key: string,
): string | undefined | null {
  const entry = optionalString(value, key);
  if (entry === undefined || entry === null) return entry;
  return entry.length <= MAX_FIELD_VALUE_CHARS ? entry : null;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
