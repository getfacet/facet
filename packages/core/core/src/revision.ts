/**
 * The server-authoritative stage revision and the compare-and-swap outcome.
 *
 * One counter orders every change to one session's `FacetStage`. It is
 * **server-authoritative**: the server assigns it, stamps it on every patch
 * frame it emits, and the browser echoes the last one it adopted back on every
 * event. The browser never invents a revision — the counter it keeps for its own
 * fold progress is a different number with a different name, and conflating the
 * two is exactly the drift this split exists to prevent.
 *
 * A write presents the revision it believes is current, and the store commits
 * only if that is still true. **A stale write is rejected, never merged**: two
 * writers that disagree about the prior state cannot both be right about the
 * next one, and silently folding the loser's operations over a stage it never
 * saw is how a page ends up in a state neither writer intended.
 *
 * This module declares the vocabulary — `StageRevision`, `CasOutcome` and the
 * one function that advances a revision. It does not implement a store; the
 * store lives in the runtime and answers in exactly these terms.
 */

/**
 * A stage revision: a non-negative integer that only ever increases.
 *
 * A fresh session starts at `0`, and the first committed change is `1`. The
 * value is opaque to everyone but the store — it is an ordering token, not a
 * count of anything a consumer should interpret.
 */
export type StageRevision = number;

/**
 * The outcome of one compare-and-swap against a session's stage.
 *
 * Written out inline as a closed two-branch union so the emitted declaration is
 * standalone: a consumer reads the whole contract here and names no alias it
 * cannot import. A rejection carries **one** structured reason, never a list —
 * there is exactly one way to lose a compare-and-swap, and `currentRevision`
 * tells the loser what to re-read before it retries.
 */
export type CasOutcome =
  | {
      readonly ok: true;
      /** The revision the change committed at. */
      readonly revision: StageRevision;
    }
  | {
      readonly ok: false;
      /** Why the change did not commit. Closed, structured, and stable. */
      readonly reason: "conflict";
      /** The revision the stage is actually at, for the loser to re-read. */
      readonly currentRevision: StageRevision;
    };

/**
 * The revision a change commits at, given the revision it is committing over.
 *
 * **Total**: it never throws, for any input of any type. A value that is not a
 * revision at all — a fraction, a negative count, `NaN`, or something that is
 * not a number because a corrupt store handed it back — restarts the sequence at
 * the first revision rather than inventing a plausible-looking successor for a
 * number nobody can order. That is the fail-safe answer: a writer holding any
 * other expectation then loses its compare-and-swap and re-reads, instead of
 * committing over a stage whose position was never known.
 *
 * At the safe-integer ceiling the sequence **saturates** instead of stepping to
 * a value floating-point arithmetic can no longer tell apart from its
 * neighbour. That point is unreachable in practice — it is more revisions than a
 * session could produce in any lifetime — and saturating keeps the function
 * non-decreasing, which a wrap to zero would not.
 */
export function nextRevision(current: StageRevision): StageRevision {
  if (typeof current !== "number" || !Number.isSafeInteger(current) || current < 0) {
    return 1;
  }
  if (current >= Number.MAX_SAFE_INTEGER) {
    return Number.MAX_SAFE_INTEGER;
  }
  return current + 1;
}
