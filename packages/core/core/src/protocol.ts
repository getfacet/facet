/**
 * The wire vocabulary: what the server sends a browser, what a dialled-in agent
 * receives, and what it sends back.
 *
 * Every frame is declared **here and nowhere else**. `@facet/server` and
 * `@facet/agent-client` are two independent implementations of one protocol, and
 * a shape restated in both is a shape that drifts — silently, because each side
 * keeps passing its own tests while the pair stops agreeing. So this module owns
 * the envelopes and *imports* the payloads: `ConversationMessage` stays
 * `conversation.ts`'s, the fold vocabulary stays `patch.ts`'s, the visitor's
 * interaction stays `event.ts`'s, and the ordering token stays `revision.ts`'s.
 *
 * **Two things a frame always carries, and one it carries at most once.** Every
 * change to the stage travels with the server-authoritative `stageRevision` it
 * commits at, so a browser can tell a frame it has already folded from one it
 * has not. And a turn delivers **at most one** conversation message: the
 * `messageId` is derived from the turn and the direction, so a second message in
 * the same turn would derive the same id and idempotent collapse — the thing
 * that lets the wire redeliver a frame safely — would break.
 *
 * **What is deleted, and stays deleted.** The retired authoring model had a
 * plain-text frame of its own and a whole-session restart frame (D-02); both are
 * gone, and no member of any frame here carries a browser-side snapshot of what
 * the visitor was looking at (D-07). Those are not deprecated members with a
 * compatibility shim behind them — they are absent, and `protocol.test.ts`
 * asserts their absence mechanically over this source *and* over the declaration
 * `tsc` emits, because a type-only member is erased before any test runs.
 *
 * **D4 — a patch frame's ops address the stage, never the document alone.**
 * `/document/...` for an authored change, `/data/...` for a published one, and
 * the root for a resync, which replaces the whole stage in one operation. That
 * is what makes a reconnecting browser restore *data as well as document*
 * instead of adopting a fresh document that still reads a model it replaced.
 *
 * `validateTurnOutcome` is **total**: it never throws, for any input of any type
 * — a non-object, a value with a throwing getter, a proxy that refuses its own
 * keys, a cyclic operation list. It answers the first failure in a fixed order,
 * so the same input always yields the same rejection, and the projection
 * functions are deterministic: the same outcome always yields the same frames in
 * the same order.
 */

import { deriveMessageId, truncateConversationText } from "./conversation.js";
import type { ConversationMessage } from "./conversation.js";
import type { AgentEvent } from "./event.js";
import { MAX_PATCH_OPS } from "./patch.js";
import type { JsonPatchOperation } from "./patch.js";
import type { StageRevision } from "./revision.js";

/**
 * One ordered batch of authorized operations, stamped with the revision it
 * commits at.
 *
 * The operations are RFC 6902 and **stage-rooted** (D4): `/document/...`,
 * `/data/...`, or the root for a resync that replaces both halves at once. The
 * frame states the vocabulary and the revision; deciding which operations are
 * authorized is `applyPatch`'s job, and it is the same fold on both sides of the
 * wire — so a frame that arrives with something the fold refuses is rejected
 * whole, by the one implementation that owns that answer.
 */
export interface PatchFrame {
  readonly kind: "patch";
  /** The server-authoritative revision this batch commits at. */
  readonly stageRevision: StageRevision;
  /** The ordered batch, applied all-or-nothing by `applyPatch`. */
  readonly ops: readonly JsonPatchOperation[];
}

/**
 * Everything the server sends a browser.
 *
 * Two kinds, discriminated by `kind`, and the conversation half is
 * `conversation.ts`'s declaration unchanged rather than a copy of it — one
 * declaration is what leaves a single owner of the derived `messageId`.
 */
export type ServerFrame = PatchFrame | ConversationMessage;

/**
 * The browser's end of the link: a stream of server frames.
 *
 * Subscription is the whole contract, because it is the whole thing both
 * transports have in common. What a browser *sends* is a request shape each
 * adapter owns — an SSE transport posts, an in-process one calls — and putting a
 * send method here would make core the author of a shape it cannot check.
 *
 * `subscribe` answers with the unsubscribe, so a caller never has to hold the
 * callback it passed in order to stop listening.
 */
export interface FacetTransport {
  subscribe(onFrame: (frame: ServerFrame) => void): () => void;
}

/**
 * What the server delivers to a dialled-in agent: the visitor's interaction,
 * whole.
 *
 * The frame is an envelope and nothing more. The id that keys single-flight
 * dedupe and the revision the browser had folded when the visitor acted are
 * `frame.event.eventId` and `frame.event.stageRevision` — they are **not**
 * hoisted onto the envelope, because a hoisted copy is a second answer to "which
 * turn is this?", and the two answers only have to disagree once.
 */
export interface AgentEventFrame {
  readonly kind: "agent_event";
  /** The validated interaction, as `event.ts` declares it. */
  readonly event: AgentEvent;
}

/**
 * What the agent sends back: one turn's complete result, addressed to the event
 * that caused it.
 *
 * `eventId` is correlation, not a copy of the payload — the outcome carries no
 * event, so naming the turn here is the only way the link can attribute a result
 * and drop a redelivery of one it already applied.
 */
export interface AgentControlFrame {
  readonly kind: "agent_control";
  /** The `eventId` of the `AgentEventFrame` this answers. */
  readonly eventId: string;
  /** Everything the turn produced. */
  readonly outcome: TurnOutcome;
}

/**
 * Everything one turn produced: the stage change, and at most one thing said.
 *
 * `patches` is a single ordered batch rather than a list of batches, because the
 * outcome commits at **one** revision — a second batch would need a second
 * revision, and a turn that half-commits is exactly the state the compare-and-
 * swap contract exists to prevent. An empty batch is legal and means the turn
 * changed nothing.
 *
 * `conversation` is optional and singular. Zero means the turn said nothing; one
 * is the assistant's reply. There is no way to express two, and
 * `validateTurnOutcome` rejects the attempt.
 */
export interface TurnOutcome {
  /** The revision `patches` commits at. */
  readonly stageRevision: StageRevision;
  /** The turn's one ordered batch of stage-rooted operations. */
  readonly patches: readonly JsonPatchOperation[];
  /** The turn's one message, when it said anything. */
  readonly conversation?: ConversationMessage;
}

/**
 * The agent brain's end of the link: one event in, one outcome out.
 *
 * The host implements this; Facet never supplies it. Deciding *what* to render
 * is the agent's whole job, and it is deliberately outside the framework.
 */
export interface FacetAgent {
  handleEvent(frame: AgentEventFrame): Promise<TurnOutcome>;
}

/**
 * What `validateTurnOutcome` answers: the accepted outcome, or the first failure
 * — its code, the location it names, and one line of detail.
 *
 * Both branches are spelled out here rather than assembled from named halves,
 * because a consumer that stores a result, threads it through a helper or writes
 * a fixture rejection has to be able to **name** its type, and a signature naming
 * a type the consumer cannot import is not a contract.
 */
export type TurnOutcomeValidationResult =
  | { readonly ok: true; readonly outcome: TurnOutcome }
  | {
      readonly ok: false;
      readonly code: string;
      readonly at: string;
      readonly detail: string;
    };

/**
 * The rejection branch on its own, for the helpers below that can only fail. It
 * is **derived from** the public result rather than being its source, so the two
 * cannot drift and the private name never reaches an emitted signature.
 */
type TurnOutcomeRejection = Extract<TurnOutcomeValidationResult, { readonly ok: false }>;

/**
 * The outcome's complete member set, as a value.
 *
 * Annotated as an exhaustive `Record` over the interface's own keys, so a member
 * added there and forgotten here is a compile error, and a key here that the
 * interface does not declare is one too.
 */
const OUTCOME_KEYS: Readonly<Record<keyof TurnOutcome, true>> = Object.freeze({
  stageRevision: true,
  patches: true,
  conversation: true,
});

/** The conversation frame's complete member set, pinned to its own declaration. */
const CONVERSATION_KEYS: Readonly<Record<keyof ConversationMessage, true>> = Object.freeze({
  kind: true,
  messageId: true,
  turnId: true,
  text: true,
  at: true,
  role: true,
});

/** The one direction an agent may author. The other half is the visitor's. */
const AGENT_ROLE = "assistant";

function reject(code: string, at: string, detail: string): TurnOutcomeRejection {
  return { ok: false, code, at, detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keys are sorted so the first unknown key is the same one on every run. */
function firstUnknownKey(
  record: Record<string, unknown>,
  allowed: Readonly<Record<string, true>>,
): string | undefined {
  return Object.keys(record)
    .sort()
    .find((key) => !Object.prototype.hasOwnProperty.call(allowed, key));
}

/** A revision as it appears on the wire: a non-negative safe integer. */
function isRevision(value: unknown): value is StageRevision {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Validates one turn outcome arriving from an agent.
 *
 * Returns the outcome frozen and normalized to exactly the members that were
 * present, so an absent `conversation` stays absent rather than becoming an
 * explicit `undefined`, and nothing can widen the payload after the boundary
 * accepted it.
 */
export function validateTurnOutcome(value: unknown): TurnOutcomeValidationResult {
  try {
    return validateOutcome(value);
  } catch {
    return reject(
      "turn_outcome_read_failed",
      "",
      "Reading the outcome threw; a turn outcome must be plain data.",
    );
  }
}

function validateOutcome(value: unknown): TurnOutcomeValidationResult {
  if (!isRecord(value)) {
    return reject("turn_outcome_not_an_object", "", "A turn outcome must be a plain object.");
  }
  const unknownKey = firstUnknownKey(value, OUTCOME_KEYS);
  if (unknownKey !== undefined) {
    return reject("unknown_turn_outcome_key", unknownKey, "The turn outcome form is closed.");
  }

  const stageRevision = value["stageRevision"];
  if (!isRevision(stageRevision)) {
    return reject(
      "invalid_stage_revision",
      "stageRevision",
      "stageRevision must be a non-negative safe integer.",
    );
  }

  const batch = readPatches(value["patches"]);
  if (!batch.ok) {
    return batch;
  }

  const said = readConversation(value);
  if (!said.ok) {
    return said;
  }

  return {
    ok: true,
    outcome: Object.freeze({
      stageRevision,
      patches: batch.patches,
      ...(said.conversation === undefined ? {} : { conversation: said.conversation }),
    }),
  };
}

/**
 * Reads the turn's one batch.
 *
 * The **count** is checked here and the **content** is almost entirely left to
 * the fold, deliberately. `applyPatch` is the single site that decides which
 * operations are authorized, it is total, and it rejects a batch whole —
 * re-deciding that here would be a second answer to one question, and a
 * drifting one, since the vocabulary lives in `patch.ts`. The one exception is
 * the public authoring boundary: a root `/document` add/replace whose value is
 * a string is raw agent markup, not an already-validated `ComponentDocument`,
 * and therefore cannot be admitted as a patch value.
 */
function readPatches(
  value: unknown,
): { readonly ok: true; readonly patches: readonly JsonPatchOperation[] } | TurnOutcomeRejection {
  if (!Array.isArray(value)) {
    return reject("invalid_patches", "patches", "A turn states its batch, even when empty.");
  }
  if (value.length > MAX_PATCH_OPS) {
    return reject(
      "too_many_patch_operations",
      "patches",
      "The batch exceeds the authorized fold's operation cap.",
    );
  }
  for (let index = 0; index < value.length; index += 1) {
    const operation = value[index];
    if (!isRecord(operation)) {
      return reject(
        "invalid_patch_operation",
        `patches.${index}`,
        "An operation is a plain object; the fold decides which ones it authorizes.",
      );
    }
    if (isRawDocumentMarkupPatch(operation)) {
      return reject(
        "invalid_patch_operation",
        `patches.${index}`,
        "Raw markup is not a document patch value; authoring must go through the runtime session.",
      );
    }
  }
  // Every entry is a plain object and the batch is within the fold's cap. The
  // fold re-reads each operation's exact member set before applying any of them,
  // so this narrowing hands on a shape the one owner of that vocabulary checks.
  return { ok: true, patches: Object.freeze([...value] as JsonPatchOperation[]) };
}

function isRawDocumentMarkupPatch(operation: Readonly<Record<string, unknown>>): boolean {
  return (
    (operation["op"] === "add" || operation["op"] === "replace") &&
    operation["path"] === "/document" &&
    typeof operation["value"] === "string"
  );
}

/**
 * Reads the turn's at-most-one message.
 *
 * A list is refused whatever its length, because the singular member is the
 * whole contract: two messages in one turn derive one id, and a caller reaching
 * for a list has already stopped believing that.
 */
function readConversation(
  value: Record<string, unknown>,
):
  | { readonly ok: true; readonly conversation: ConversationMessage | undefined }
  | TurnOutcomeRejection {
  if (!("conversation" in value)) {
    return { ok: true, conversation: undefined };
  }
  const said = value["conversation"];
  if (Array.isArray(said)) {
    return reject(
      "conversation_not_singular",
      "conversation",
      "A turn carries at most one message, stated directly and never as a list.",
    );
  }
  if (!isRecord(said)) {
    return reject("invalid_conversation", "conversation", "A message is a plain object.");
  }
  const unknownKey = firstUnknownKey(said, CONVERSATION_KEYS);
  if (unknownKey !== undefined) {
    return reject(
      "unknown_conversation_key",
      `conversation.${unknownKey}`,
      "The conversation frame form is closed.",
    );
  }
  if (said["kind"] !== "conversation") {
    return reject(
      "invalid_conversation_kind",
      "conversation.kind",
      "A message names the conversation frame.",
    );
  }
  if (said["role"] !== AGENT_ROLE) {
    return reject(
      "invalid_conversation_role",
      "conversation.role",
      "An agent authors its own half of the conversation, never the visitor's.",
    );
  }
  const turnId = said["turnId"];
  if (typeof turnId !== "string" || turnId.length === 0) {
    return reject(
      "invalid_turn_id",
      "conversation.turnId",
      "A message names the turn it belongs to.",
    );
  }
  if (said["messageId"] !== deriveMessageId(turnId, AGENT_ROLE)) {
    return reject(
      "conversation_id_not_derived",
      "conversation.messageId",
      "A message id is derived from the turn and the direction, never asserted.",
    );
  }
  const at = said["at"];
  if (typeof at !== "number" || !Number.isFinite(at) || at < 0) {
    return reject(
      "invalid_conversation_at",
      "conversation.at",
      "A message carries the emitting side's wall clock, in milliseconds.",
    );
  }
  const text = said["text"];
  if (typeof text !== "string") {
    return reject("invalid_conversation_text", "conversation.text", "Message text is a string.");
  }
  return {
    ok: true,
    // B-25's answer in this direction is conversation.ts's, and it is to clamp:
    // refusing an over-long reply would throw away a completed turn's work. This
    // boundary applies that answer rather than inventing a second one.
    conversation: Object.freeze({
      kind: "conversation",
      messageId: deriveMessageId(turnId, AGENT_ROLE),
      turnId,
      role: AGENT_ROLE,
      text: truncateConversationText(text),
      at,
    }),
  };
}

/**
 * Projects one turn outcome onto the frames the server sends, in order.
 *
 * The stage change goes first: the message is *about* the page, and a client
 * that showed the words first would be describing something it has not rendered.
 * A turn that changed nothing emits no patch frame at all — an empty batch would
 * make the browser fold, rebuild and re-render for a stage that did not move.
 *
 * Deterministic: the same outcome always yields the same frames in the same
 * order, and each frame is frozen over its own copy of the batch so a later edit
 * of the outcome cannot reach a frame already on the wire.
 */
export function* iterateTurnOutcome(outcome: TurnOutcome): IterableIterator<ServerFrame> {
  const patches = Array.isArray(outcome.patches) ? outcome.patches : [];
  if (patches.length > 0) {
    yield Object.freeze({
      kind: "patch",
      stageRevision: outcome.stageRevision,
      ops: Object.freeze([...patches]),
    });
  }
  const said = outcome.conversation;
  if (said !== undefined) {
    yield said;
  }
}

/** The same projection, collected. Order and contents are `iterateTurnOutcome`'s. */
export function collectTurnOutcome(outcome: TurnOutcome): readonly ServerFrame[] {
  return [...iterateTurnOutcome(outcome)];
}
