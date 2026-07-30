/**
 * The conversation frame.
 *
 * A turn's plain-text message — the visitor's question or the assistant's reply
 * — travels as one typed frame declared **here and nowhere else**. The browser
 * transport, the runtime outbox and the `Sink` all name this type rather than
 * restating its shape, which is what keeps `@facet/client` free of a
 * `@facet/runtime` dependency and leaves exactly one owner of the `messageId`.
 * A second declaration would be a second answer to "are these the same
 * message?", and idempotent collapse is precisely that question.
 *
 * Conversation text is **content, never instruction**: it is not parsed as
 * markup, never executed, and changes no document, Data Model or revision. The
 * renderer escapes it.
 *
 * `B-25` bounds both directions and the two fail **differently on purpose**. An
 * over-bound visitor message is rejected before the agent is invoked —
 * truncating it would silently change what was asked. An over-bound assistant
 * message is truncated — rejecting it would throw away a completed turn's work.
 * The visible truncation marker is counted **inside** the bound, so a delivered
 * message is never longer than the bound it was clamped to; adding the marker on
 * top would push a message that was exactly at the bound past it.
 *
 * Every function here is **total**: it never throws, for any input of any type.
 * This is a wire boundary, so an unexpected value is an inert answer, never an
 * exception. And nothing here reads a clock, a counter or a random source — the
 * same turn and direction always derive the same id, and the same over-bound
 * text always delivers the same bytes.
 */

import { BOUNDS } from "./bounds.js";

/**
 * One plain-text message in a turn, in either direction.
 *
 * `turnId` is the turn's identity — the client-stable `eventId` for an `agent:`
 * event, or the server-minted `v-<ulid>` for a visitor message — and
 * `messageId` is derived from it, so the id is stable and unique per
 * turn/direction without a counter to keep in sync. `at` is the emitting side's
 * wall clock in milliseconds; it orders nothing and is display metadata only,
 * because ordering is the transport's job.
 */
export interface ConversationMessage {
  readonly kind: "conversation";
  readonly messageId: string;
  readonly turnId: string;
  readonly role: "visitor" | "assistant";
  readonly text: string;
  readonly at: number;
}

/** Joins the turn identity to the direction. Absent from every legal role. */
const SEPARATOR = ":";

/**
 * The visible marker a truncated message ends with. Counted inside `B-25`, so a
 * clamped message is never longer than the bound.
 */
const TRUNCATION_MARKER = "…";

const HIGH_SURROGATE_FIRST = 0xd800;
const HIGH_SURROGATE_LAST = 0xdbff;

/**
 * Derives the stable identity of a turn's message in one direction.
 *
 * The turn and the direction are the whole input: the same pair always derives
 * the same id, and no two distinct pairs derive the same one. That is what lets
 * the wire redeliver a frame while the client and the `Sink` collapse it to one
 * visible item and one record — the sender keeps no counter and the receiver
 * needs no negotiation. The role half is a closed two-member union, so a turn id
 * that itself contains the separator cannot shift the split and impersonate
 * another turn's message.
 *
 * Off-contract input yields the empty string rather than an exception. An empty
 * id is never derivable from a legal pair — every derived id contains the
 * separator and a role — so a rejection cannot collide with a real message.
 */
export function deriveMessageId(turnId: string, role: "visitor" | "assistant"): string {
  if (typeof turnId !== "string") {
    return "";
  }
  if (role !== "visitor" && role !== "assistant") {
    return "";
  }
  return `${turnId}${SEPARATOR}${role}`;
}

/**
 * Whether `text` is a visitor message the session will accept — a string within
 * `B-25`.
 *
 * The bound is the **only** thing decided here, because it is the only thing
 * with framework-controlled copy behind it (`Your message is too long…`).
 * Emptiness and trimming are not bound questions and are deliberately not
 * answered: an empty string is a legal, in-bound value, and a surface that does
 * not want to send one refuses it in its own terms rather than borrowing this
 * rejection and mislabelling it as too long.
 *
 * Rejection is the entire vocabulary — the caller in each layer decides what an
 * unacceptable message means there.
 */
export function validateVisitorText(text: unknown): text is string {
  return typeof text === "string" && text.length <= BOUNDS.conversationMessageChars;
}

/**
 * Clamps an assistant message to `B-25`, deterministically.
 *
 * A message within the bound is returned byte-identical, marker and all
 * absent — including one of exactly `B-25` characters, which is the off-by-one
 * this contract is written to avoid. Past the bound, the text is cut to leave
 * room for the marker, so the delivered length is exactly the bound. A cut that
 * would split a surrogate pair backs off one code unit, delivering one
 * character less rather than a lone surrogate.
 *
 * The result depends on the input alone, so the same over-bound response always
 * delivers the same bytes — and clamping an already-clamped message changes
 * nothing.
 */
export function truncateConversationText(text: string): string {
  if (typeof text !== "string") {
    return "";
  }
  const limit = BOUNDS.conversationMessageChars;
  if (text.length <= limit) {
    return text;
  }
  let cut = limit - TRUNCATION_MARKER.length;
  const last = cut > 0 ? text.charCodeAt(cut - 1) : 0;
  if (last >= HIGH_SURROGATE_FIRST && last <= HIGH_SURROGATE_LAST) {
    cut -= 1;
  }
  return `${text.slice(0, cut)}${TRUNCATION_MARKER}`;
}
