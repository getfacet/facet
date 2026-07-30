/**
 * The stage — the one thing an RFC 6902 patch changes.
 *
 * A session holds exactly one `FacetStage`, and it has two halves. `document` is
 * what the visitor sees; `data` is the bounded hierarchical model the document
 * reads through its `data:` references. They are one value rather than two
 * because they change together and must stay coherent: an authored mutation
 * produces operations under `/document`, an accepted publish produces operations
 * under `/data`, and a resync root-`replace`s the **whole** stage — so a
 * reconnecting browser restores *data as well as document* instead of adopting a
 * fresh document that still reads a stale model. Two independently patched roots
 * would have made that coherence a convention; one root makes it the shape.
 *
 * `document` is `null` while the session is **preparing** — a session exists,
 * holds its immutable catalog and theme, and can accept a publish, but nothing
 * has authored a page yet. `null` is the whole vocabulary for that state: there
 * is no "empty document" sentinel to tell apart from a real one, and no
 * `phase` field here to disagree with the document's presence.
 *
 * This module declares `FacetStage` and nothing else. The fold that changes a
 * stage is `applyPatch` (`patch.ts`); the counter that orders the changes is
 * `StageRevision` (`revision.ts`).
 */

import type { DataModel } from "./data-model.js";
import type { ComponentDocument } from "./document.js";

/**
 * The single RFC 6902 fold target: the whole of what a patch may change.
 *
 * Both members are spelled with types that are themselves public, so a consumer
 * that holds a stage can name every part of it without reaching into this
 * package's private modules.
 */
export interface FacetStage {
  /** The visible document, or `null` while the session is preparing. */
  readonly document: ComponentDocument | null;
  /** The bounded hierarchical model the document's `data:` references read. */
  readonly data: DataModel;
}
