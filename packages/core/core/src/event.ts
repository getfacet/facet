/**
 * The visitor event — the complete payload an authored `agent:` interaction sends.
 *
 * The payload is **exactly its declared fields** (D-07): the client-stable
 * `eventId` that keys single-flight dedupe, the `eventName` the author wrote,
 * the `sourceNodeId` that emitted it, the `screen` it was emitted from, the
 * server-authoritative `stageRevision` the browser last folded, an optional
 * `arg`, and the `collect` map. There is no view snapshot: `toggled`, `sort`,
 * `viewport` and `colorMode` are deleted, because device-responsive divergence
 * lives inside trusted components as CSS and Modal open state stays
 * browser-local and unobserved. The form is **closed** — an unknown key is a
 * rejection, never an ignored extra — so a caller cannot reintroduce a snapshot
 * field by sending one.
 *
 * `collect` is **always stated**, never inferred. An event that names no field
 * sends an empty map; a named field whose collectable component never
 * registered sends a structured `collect_source_unavailable` entry, and a field
 * the catalog marked sensitive sends `omitted_sensitive` with **no value key at
 * all** (D-08). That is the whole point of the closed entry union: a missing
 * value is reported as a missing value rather than dropped, so the agent can
 * never read an absent key as "the visitor left it blank".
 *
 * This module is the **single enforcement site** for `B-22` and `B-23`. The
 * renderer builds a payload and the server validates one through this same
 * exported function reading the same frozen `BOUNDS`, which is what removes the
 * drift the retired pair of per-side constants allowed. No limit is restated
 * here as a literal.
 *
 * `validateVisitorEvent` is **total**: it never throws, for any input of any type
 * — a non-object, a value with a throwing getter, a proxy that refuses its own
 * keys, a cyclic `collect`. It returns the first failure in a fixed order, so
 * the same input always yields the same rejection.
 */

import { BOUNDS } from "./bounds.js";
import { isFacetIdentifier } from "./identifiers.js";

/**
 * One `agent:` event.
 *
 * The `collect` entry union is spelled out structurally rather than named,
 * because this declaration is the whole public contract: a consumer reads the
 * complete shape here without following an alias into a type it cannot import.
 *
 * `stageRevision` is the server-authoritative revision the browser echoes back,
 * declared as the plain non-negative integer it is on the wire. `sourceNodeId`
 * is checked as a bounded identifier only — which generated ids are live is the
 * document's question, answered where the document is in hand, not here.
 *
 * `eventId` is the one member that is **not** an authored name, so it does not
 * take the identifier grammar. It is an opaque ASCII token — it may start with
 * a digit, so a bare ULID or UUID is legal — bounded by B-06, and free of `:`.
 * No minting layer owes it a prefix.
 */
export interface VisitorEvent {
  /**
   * Client-stable and client-minted; the same id is deduplicated, never re-run.
   * An opaque token, not an authored name: a bare ULID or UUID is legal, a `:`
   * is not.
   */
  readonly eventId: string;
  /** The event the author named in `agent:<event>`. */
  readonly eventName: string;
  /** The generated id of the node the visitor acted on. */
  readonly sourceNodeId: string;
  /** The screen the visitor was on. */
  readonly screen: string;
  /** The server-authoritative revision the browser last folded. */
  readonly stageRevision: number;
  /** The one explicit authored argument, when the interaction declares one. */
  readonly arg?: string;
  /** Exactly the fields the interaction named, each with its own outcome. */
  readonly collect: Readonly<
    Record<
      string,
      | { readonly kind: "value"; readonly value: string }
      | { readonly kind: "omitted_sensitive" }
      | { readonly kind: "collect_source_unavailable" }
    >
  >;
}

/**
 * What `validateVisitorEvent` answers: the accepted event, or the first failure —
 * its code, the location it names, and one line of detail.
 *
 * Both branches are spelled out here rather than assembled from named halves,
 * because a consumer that stores a result, threads it through a helper, or
 * writes a fixture rejection has to be able to **name** its type, and a
 * signature naming a type the consumer cannot import is not a contract.
 */
export type VisitorEventValidationResult =
  | { readonly ok: true; readonly event: VisitorEvent }
  | {
      readonly ok: false;
      readonly code: string;
      readonly at: string;
      readonly detail: string;
    };

/**
 * The rejection branch on its own, for the helpers below that can only fail.
 * It is **derived from** the public result rather than being its source, so the
 * two cannot drift and the private name never reaches an emitted signature.
 */
type EventRejection = Extract<VisitorEventValidationResult, { readonly ok: false }>;

/** One entry of the collect map, derived from the public contract for the same reason. */
type CollectedEntry = VisitorEvent["collect"][string];

const EVENT_KEYS: readonly string[] = [
  "eventId",
  "eventName",
  "sourceNodeId",
  "screen",
  "stageRevision",
  "arg",
  "collect",
];

/**
 * The closed entry vocabulary: a collected value, or a stated reason there is
 * none. Derived from the public contract, so a kind cannot be admitted here
 * without appearing in `VisitorEvent` too.
 */
const ENTRY_KINDS: readonly CollectedEntry["kind"][] = [
  "value",
  "omitted_sensitive",
  "collect_source_unavailable",
];

/** The closed key set per entry kind. A stated absence carries no value key at all. */
const VALUE_ENTRY_KEYS: readonly string[] = ["kind", "value"];

const ABSENT_ENTRY_KEYS: readonly string[] = ["kind"];

/**
 * The `eventId` grammar — deliberately **not** the Facet identifier grammar.
 *
 * An `eventId` is an opaque client idempotency token, not a name the author
 * wrote, so it may begin with a digit: a bare ULID and a bare UUID are the two
 * things a client is overwhelmingly likely to mint, and rejecting them would be
 * integration friction buying nothing. What the token must not carry is the `:`
 * that would make the derived `messageId` (`${eventId}:${role}`) ambiguous, and
 * this pattern forbids it on its own — that property never depended on the
 * first character. Everything else the identifier grammar excludes stays
 * excluded: whitespace, `.`, non-ASCII, and a leading `_` or `-` (so
 * `__proto__` is rejected by construction). Anchored, non-global, and
 * backtracking-free.
 */
const EVENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** Whether `value` is a legal `eventId`: the token grammar, bounded by B-06. Private on purpose. */
function isEventId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= BOUNDS.identifierChars &&
    EVENT_ID_PATTERN.test(value)
  );
}

function reject(code: string, at: string, detail: string): EventRejection {
  return { ok: false, code, at, detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keys are sorted so the first unknown key is the same one on every run. */
function firstUnknownKey(
  record: Record<string, unknown>,
  allowed: readonly string[],
): string | undefined {
  return Object.keys(record)
    .sort()
    .find((key) => !allowed.includes(key));
}

/**
 * Validates one `agent:` event payload.
 *
 * Returns the accepted event frozen and normalized to exactly the keys that were
 * present, so a consumer cannot widen a payload after the boundary accepted it,
 * and an absent `arg` stays absent rather than becoming an explicit `undefined`.
 */
export function validateVisitorEvent(value: unknown): VisitorEventValidationResult {
  try {
    return validateEvent(value);
  } catch {
    return reject("event_read_failed", "", "Reading the event threw; an event must be plain data.");
  }
}

function validateEvent(value: unknown): VisitorEventValidationResult {
  if (!isRecord(value)) {
    return reject("event_not_an_object", "", "A visitor event must be a plain object.");
  }
  const unknownKey = firstUnknownKey(value, EVENT_KEYS);
  if (unknownKey !== undefined) {
    return reject("unknown_event_key", unknownKey, "The visitor event form is closed.");
  }

  const eventId = readEventId(value);
  if (!eventId.ok) {
    return eventId;
  }
  const eventName = readIdentifier(value, "eventName", "invalid_event_name");
  if (!eventName.ok) {
    return eventName;
  }
  const sourceNodeId = readIdentifier(value, "sourceNodeId", "invalid_source_node_id");
  if (!sourceNodeId.ok) {
    return sourceNodeId;
  }
  const screen = readIdentifier(value, "screen", "invalid_screen");
  if (!screen.ok) {
    return screen;
  }

  const stageRevision = value["stageRevision"];
  if (typeof stageRevision !== "number" || !Number.isSafeInteger(stageRevision)) {
    return reject(
      "invalid_stage_revision",
      "stageRevision",
      "stageRevision must be a non-negative safe integer.",
    );
  }
  if (stageRevision < 0) {
    return reject("invalid_stage_revision", "stageRevision", "A revision never runs backwards.");
  }

  const argument = validateArg(value);
  if (!argument.ok) {
    return argument;
  }

  const collected = validateCollect(value["collect"]);
  if (!collected.ok) {
    return collected;
  }

  return {
    ok: true,
    event: Object.freeze({
      eventId: eventId.value,
      eventName: eventName.value,
      sourceNodeId: sourceNodeId.value,
      screen: screen.value,
      stageRevision,
      ...(argument.arg === undefined ? {} : { arg: argument.arg }),
      collect: collected.collect,
    }),
  };
}

/**
 * Reads the client's idempotency token under the token grammar above. Separate
 * from `readIdentifier` because the two grammars differ, and the difference is
 * the point: an id may start with a digit, an authored name may not.
 */
function readEventId(
  record: Record<string, unknown>,
): { readonly ok: true; readonly value: string } | EventRejection {
  const value = record["eventId"];
  if (!isEventId(value)) {
    return reject(
      "invalid_event_id",
      "eventId",
      "eventId must be an opaque ASCII token of at most B-06 chars, with no `:`.",
    );
  }
  return { ok: true, value };
}

/**
 * Reads one identifier-grammared member. Every **authored** name an event
 * carries — the event name, the source node id and the screen — takes the one
 * identifier grammar, so it is ASCII, starts with a letter, is bounded by B-06,
 * and is free of the `:` that would make the derived `messageId`
 * (`${turnId}:${role}`) ambiguous. The `eventId` is not one of them; it is a
 * client token and takes `readEventId` above.
 */
function readIdentifier(
  record: Record<string, unknown>,
  key: string,
  code: string,
): { readonly ok: true; readonly value: string } | EventRejection {
  const value = record[key];
  if (!isFacetIdentifier(value)) {
    return reject(code, key, `${key} must be a Facet identifier of at most B-06 chars.`);
  }
  return { ok: true, value };
}

/**
 * Reads the one optional member. An explicit `undefined` is a rejection rather
 * than an absence: the key being there is the caller saying an argument was
 * sent, and `""` is a legitimate argument that must stay distinguishable from
 * no argument at all.
 */
function validateArg(
  value: Record<string, unknown>,
): { readonly ok: true; readonly arg: string | undefined } | EventRejection {
  if (!("arg" in value)) {
    return { ok: true, arg: undefined };
  }
  const argument = value["arg"];
  if (typeof argument !== "string") {
    return reject("invalid_arg", "arg", "An argument is a single authored string.");
  }
  if (argument.length > BOUNDS.collectedValueChars) {
    return reject("arg_too_long", "arg", "The argument exceeds B-23.");
  }
  return { ok: true, arg: argument };
}

function validateCollect(
  value: unknown,
): { readonly ok: true; readonly collect: VisitorEvent["collect"] } | EventRejection {
  if (!isRecord(value)) {
    return reject(
      "invalid_collect",
      "collect",
      "An event states its collect map, even when empty.",
    );
  }
  const names = Object.keys(value).sort();
  if (names.length > BOUNDS.collectFieldsPerEvent) {
    return reject("too_many_collect_fields", "collect", "Collected field count exceeds B-22.");
  }
  const collect: Record<string, CollectedEntry> = {};
  for (const name of names) {
    const at = `collect.${name}`;
    if (!isFacetIdentifier(name)) {
      return reject("invalid_collect_name", at, "A collected field name is a Facet identifier.");
    }
    const entry = validateEntry(value[name], at);
    if (!entry.ok) {
      return entry;
    }
    collect[name] = entry.entry;
  }
  return { ok: true, collect: Object.freeze(collect) };
}

/**
 * Validates one collected field's outcome.
 *
 * The two stated-absence kinds carry a closed key set of `kind` alone, so a
 * sensitive value can never ride along inside the marker that says it was
 * withheld.
 */
function validateEntry(
  value: unknown,
  at: string,
): { readonly ok: true; readonly entry: CollectedEntry } | EventRejection {
  if (!isRecord(value)) {
    return reject("invalid_collect_entry", at, "A collected field is a plain object.");
  }
  const kind = readEntryKind(value["kind"]);
  if (kind === null) {
    return reject(
      "invalid_collect_entry_kind",
      `${at}.kind`,
      "A collected field is a value, omitted_sensitive, or collect_source_unavailable.",
    );
  }
  const allowed = kind === "value" ? VALUE_ENTRY_KEYS : ABSENT_ENTRY_KEYS;
  const unknownKey = firstUnknownKey(value, allowed);
  if (unknownKey !== undefined) {
    return reject(
      "unknown_collect_entry_key",
      `${at}.${unknownKey}`,
      "The collected-field form is closed.",
    );
  }
  if (kind === "omitted_sensitive") {
    return { ok: true, entry: Object.freeze({ kind: "omitted_sensitive" }) };
  }
  if (kind === "collect_source_unavailable") {
    return { ok: true, entry: Object.freeze({ kind: "collect_source_unavailable" }) };
  }
  const collected = value["value"];
  if (typeof collected !== "string") {
    return reject("invalid_collected_value", `${at}.value`, "A collected value is a string.");
  }
  if (collected.length > BOUNDS.collectedValueChars) {
    return reject("collected_value_too_long", `${at}.value`, "The collected value exceeds B-23.");
  }
  return { ok: true, entry: Object.freeze({ kind: "value", value: collected }) };
}

/** Narrows an authored `kind` to the closed vocabulary, or `null` if it is none of them. */
function readEntryKind(value: unknown): CollectedEntry["kind"] | null {
  return ENTRY_KINDS.find((kind) => kind === value) ?? null;
}
