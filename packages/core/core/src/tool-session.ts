/**
 * The tool session port — the one handle every agent tool executor is given.
 *
 * A tool reads the session's catalog, optional host-pinned asset index, current
 * document and data model, applies one whole-document authored render, applies
 * one targeted authored subtree mutation, or publishes one bounded value. That
 * is the whole surface, and this module is where its shape is written down.
 *
 * **Why the port lives here, in a dependency-free package (D5, D-16).** Two
 * packages meet at this boundary: `@facet/agent-tools` writes the executors that
 * *take* a session, and `@facet/runtime` owns the concrete adapter that *is*
 * one, bound to a session key and the live turn's authority. Declaring the shape
 * on either side would have made the other side depend on it — a
 * `runtime → agent-tools` edge, or a duplicated shape free to drift. `@facet/core`
 * is the one package both already depend on and it depends on nothing, so the
 * port has exactly **one** declaration site: `@facet/agent-tools` re-exports this
 * declaration with `export type` and never restates it, and `@facet/runtime`
 * satisfies it without importing agent-tools at all.
 *
 * **It is a port, not a base class.** Nothing here is implemented, extended or
 * instantiated: satisfaction is *structural*, so a session object carrying the
 * members below is a `FacetToolSession` whether or not it ever names the type,
 * and a runtime session that also carries a theme, neutral copy and a phase
 * satisfies it just as well. Nothing in Facet asserts nominal identity against
 * this declaration.
 *
 * **Every member answers in a type `@facet/core` already exports.** The port
 * introduces no named result shape of its own — an authored validation failure
 * answers in `AuthorValidationResult`, a targeted lane rejection is spelled
 * structurally on the method that can produce it, a publish answers in
 * `PayloadEvaluation`, and the reads hand back the same `FacetCatalog`,
 * `ComponentDocument` and `DataModel` the rest of the contract is written in.
 *
 * **The reads are the session's own state, not derivations of it.** There is no
 * `readScreen` here and no catalog index: `serializeScreen`, `serializeDocument`
 * and `buildCatalogIndex` are total functions this same package exports, so a
 * tool composes them over `document` and `catalog` itself. A port method that
 * merely re-offered one of them would be a second way to read one thing, and two
 * read paths are two things to keep in step.
 *
 * `document` is `null` while the session is **preparing** — a session exists and
 * can already accept a publish, but nothing has authored a page yet — exactly as
 * `FacetStage` spells that state. `stageRevision` is the server-authoritative
 * counter the reads above are pinned to, so a tool that discloses a snapshot can
 * say which revision it read.
 */

import type { FacetCatalog } from "./catalog.js";
import type { FacetAssetRegistry } from "./asset-registry.js";
import type { DataModel, PayloadEvaluation } from "./data-model.js";
import type { AuthorValidationResult } from "./document-validation.js";
import type { ComponentDocument } from "./document.js";
import type { DataPath } from "./identifiers.js";
import type { StageRevision } from "./revision.js";

/** The four targeted authoring operations that require an already-rendered page. */
export type FacetTargetedMutationInput =
  | {
      readonly kind: "insert_subtree";
      readonly targetId: string;
      readonly markup: string;
    }
  | {
      readonly kind: "replace_subtree";
      readonly targetId: string;
      readonly markup: string;
    }
  | {
      readonly kind: "update_node";
      readonly targetId: string;
      readonly markup: string;
    }
  | {
      readonly kind: "remove_subtree";
      readonly targetId: string;
    };

/** Runtime-lane rejections that are not catalog author errors. */
export type FacetTargetedMutationResult =
  | AuthorValidationResult
  | {
      readonly ok: false;
      readonly code: string;
      readonly at: string;
      readonly detail: string;
      readonly currentRevision?: StageRevision;
    };

/**
 * The structural port a tool executor takes as its session handle.
 *
 * Both writes are asynchronous because a real session commits through a
 * serialized write lane over a store that may be a database; an in-process
 * adapter simply resolves immediately. `readonly` describes what a *tool* may do
 * with a member — it never assigns one — not a promise that the value stands
 * still: an accepted mutation moves `document` and `stageRevision`, and the next
 * read sees the new stage.
 */
export interface FacetToolSession {
  /** The immutable catalog resolved for this session at bootstrap. */
  readonly catalog: FacetCatalog;
  /** Host-pinned assets available to authored asset references, when the adapter exposes them. */
  readonly assetRegistry?: FacetAssetRegistry;
  /** The current document, or `null` while the session is preparing. */
  readonly document: ComponentDocument | null;
  /** The bounded hierarchical model the document's `data:` references read. */
  readonly data: DataModel;
  /** The server-authoritative revision the reads above are pinned to. */
  readonly stageRevision: StageRevision;
  /**
   * Applies one authored mutation, atomically.
   *
   * The markup is the whole document the mutation intends; a rejection produces
   * exactly one `AuthorError` and changes nothing, so a refused call leaves the
   * prior revision untouched by construction.
   */
  applyAuthorMutation(markup: string): Promise<AuthorValidationResult>;
  /**
   * Applies one targeted authored subtree mutation, atomically.
   *
   * `applyAuthorMutation(markup)` stays the whole-document render path used by
   * `Stage.render`. Targeted tools use this explicit second method so the
   * runtime, not `@facet/agent-tools`, owns the document candidate construction,
   * revision/CAS check, authority fencing and commit. The fragment itself is
   * still parsed and validated through `@facet/core`; the complete candidate is
   * accepted only if the active catalog, data bindings, screen boundaries and
   * stable-id rules all hold.
   */
  applyTargetedMutation(input: FacetTargetedMutationInput): Promise<FacetTargetedMutationResult>;
  /**
   * Publishes one value at one validated data path, atomically.
   *
   * The path is already parsed, so the port never re-decides the path grammar.
   * A rejection carries the one closed structured reason — the incoming
   * payload's bound or the resulting model's — and leaves prior data unchanged.
   */
  publishData(path: DataPath, value: unknown): Promise<PayloadEvaluation>;
}
