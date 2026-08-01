/**
 * The conversation surface — where a turn's prose reaches the visitor, and the
 * one place a validation message the visitor can act on is shown.
 *
 * **Prose is content, never instruction.** An assistant message is plain text
 * that the brain wrote; it is not markup, it is not parsed, and it changes no
 * document, Data Model or revision. So it is rendered as a **React text child**
 * and nothing else. That is not a sanitizing step — there is no sanitizer here,
 * and there is deliberately no place to add one. Executable markup is rejected
 * at the author boundary rather than cleaned up at the render boundary
 * (invariant 3), and prose that merely *looks* like markup is shown as the
 * characters it is. A brain that writes `<Metric value="x" />` mid-sentence puts
 * those exact characters on the page; no tag is resolved, no component is
 * looked up in the registry, and nothing mounts. `dangerouslySetInnerHTML`,
 * `innerHTML` and every other HTML-injection route are absent from this module,
 * and `ConversationSurface.test.tsx` scans the compiled-away-comment source to
 * keep them absent rather than trusting this paragraph.
 *
 * **Every message carries its identity.** `messageId` is Core's, derived once
 * per turn and direction by `deriveMessageId`, and it travels onto the rendered
 * element as `data-facet-message-id`. Collapsing a redelivery is *not* done
 * here — that is `useFacet`'s job on the frame stream, upstream of this
 * component — but a surface that dropped the id would leave the collapse
 * unobservable at the seam a visitor actually sees, which is why the marker is
 * part of the contract rather than a debugging aid.
 *
 * **The validation message is not a fourth neutral state, and the difference is
 * structural.** `NeutralCopy.render` holds the three states the renderer may
 * show when it has nothing to show, and `fallback.tsx` holds them to a
 * bijection. `messageTooLong` lives under `NeutralCopy.validation` instead,
 * because it is copy for input the visitor can fix — nothing degraded, nothing
 * hidden, and something to do about it. So it renders here, inside the
 * conversation, with the conversation's own marker and an assertive live region;
 * it carries **no** `data-facet-neutral-state` attribute, and this module
 * imports no neutral copy at all. The string arrives already resolved through
 * the host's one bootstrap override, so the framework default and a host
 * replacement take the identical path and this component chooses between
 * neither.
 *
 * **This is a wire boundary, so it is total.** Items arrive from the transport,
 * which is to say from a persisted, replayed, possibly corrupt source. A message
 * whose text is not a string is not renderable and is **not rendered** — there
 * is no stand-in copy for it, because inventing one is exactly the fourth
 * neutral state the paragraph above rules out. Every sibling keeps rendering,
 * and a non-array `items` or a hostile getter is inert rather than an exception
 * that would unwind into whatever boundary the host mounted this under.
 *
 * **Visibility: barrel-exported** — `ConversationSurface` and `ConversationItem`
 * only. No other symbol in this module is public.
 */

import type { ConversationMessage } from "@facet/core";
import type { ReactElement } from "react";

import { readOwn } from "./safe-read.js";

/**
 * One rendered conversation message.
 *
 * Narrowed from Core's `ConversationMessage` rather than restated, so the three
 * fields and their types have one owner: a `ConversationMessage` off the wire is
 * assignable here with no mapping step, and a change to the frame's field names
 * is a type error at this seam instead of a silent divergence. The frame's
 * `kind`, `turnId` and `at` are deliberately not narrowed away by accident —
 * they are simply not read: the surface shows text and identity, and ordering is
 * the transport's job, not a timestamp's.
 */
export type ConversationItem = Pick<ConversationMessage, "messageId" | "role" | "text">;

/** What one item reduces to once it has been read safely. `null` fields carry no marker. */
interface ReadableItem {
  readonly messageId: string | null;
  readonly role: ConversationMessage["role"] | null;
  readonly text: string;
}

/** The reading of an unusable `items` value: nothing to show, and no exception. */
const NO_ITEMS: readonly ReadableItem[] = Object.freeze([]);

/**
 * Reads one item, answering `null` for anything with no text to show.
 *
 * Text is the whole of what makes a message renderable. An unusable `messageId`
 * or `role` costs the message its marker, not its place on the page: the
 * visitor's words are worth more than the metadata that described them, and the
 * collapse those markers serve happens upstream in any case.
 */
function readItem(candidate: unknown): ReadableItem | null {
  const text = readOwn(candidate, "text");
  if (typeof text !== "string") {
    return null;
  }
  const messageId = readOwn(candidate, "messageId");
  const role = readOwn(candidate, "role");
  return {
    messageId: typeof messageId === "string" && messageId.length > 0 ? messageId : null,
    role: role === "visitor" || role === "assistant" ? role : null,
    text,
  };
}

/** Reads the whole list, keeping order and dropping only what cannot be shown. */
function readItems(candidate: unknown): readonly ReadableItem[] {
  try {
    if (!Array.isArray(candidate)) {
      return NO_ITEMS;
    }
    const read: ReadableItem[] = [];
    for (const entry of candidate as readonly unknown[]) {
      const item = readItem(entry);
      if (item !== null) {
        read.push(item);
      }
    }
    return read;
  } catch {
    return NO_ITEMS;
  }
}

/**
 * Reads the validation message, answering `null` for anything that would put an
 * empty box on the page.
 *
 * A usable string is returned **unchanged** — not trimmed, not decorated — so
 * what the host wrote is what the visitor reads, byte for byte. Emptiness is the
 * one rejection, on the same ground `resolveNeutralCopy` rejects it at
 * bootstrap: a message the visitor is asked to act on has to say something.
 */
function readValidationError(candidate: unknown): string | null {
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : null;
}

/**
 * Renders one session's conversation.
 *
 * `validationError` is an **already-resolved** string, not a slot key: the
 * caller runs `validateVisitorText` against the draft and, on rejection, hands
 * over `copy.validation.messageTooLong` from the session's resolved copy set.
 * Keeping the resolution outside means this component has no copy table to be
 * asked for by name, and therefore nothing for authored markup, the Data Model
 * or a component prop to select. Absent, no validation message is shown at all.
 *
 * The explicit `| undefined` is not noise under `exactOptionalPropertyTypes`: a
 * caller holds "the error, or nothing" as a single `string | undefined`
 * expression — `validateVisitorText(draft) ? undefined : copy.validation.messageTooLong`
 * — and without it every caller would have to spread the prop conditionally to
 * say the thing the optional already means.
 */
export function ConversationSurface({
  items,
  validationError,
}: {
  readonly items: readonly ConversationItem[];
  readonly validationError?: string | undefined;
}): ReactElement {
  const shown = readItems(items);
  const error = readValidationError(validationError);
  return (
    <div data-facet-conversation="" role="log" aria-live="polite">
      {shown.map((item, index) => (
        <div
          key={item.messageId ?? `#${index}`}
          data-facet-message-id={item.messageId}
          data-facet-message-role={item.role}
        >
          {item.text}
        </div>
      ))}
      {error === null ? null : (
        <div role="alert" data-facet-conversation-error="">
          {error}
        </div>
      )}
    </div>
  );
}
