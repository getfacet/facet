import type { AuthorValidationResult, FacetTargetedMutationResult } from "@facet/core";

import { renderAuthorError, type AuthorErrorResult } from "./author-errors.js";
import type {
  FacetToolSession,
  InsertSubtreeInput,
  RemoveSubtreeInput,
  RenderPageInput,
  ReplaceSubtreeInput,
  UpdateNodeInput,
} from "./types.js";

export type MutationToolResult =
  | {
      readonly ok: true;
      readonly stageRevision: number;
    }
  | AuthorErrorResult
  | {
      readonly ok: false;
      readonly code:
        | "page_not_rendered"
        | "unknown_target_id"
        | "entry_screen_root_removal"
        | "invalid_document"
        | "invalid_fragment"
        | "invalid_markup_input"
        | "reserved-attribute"
        | "invalid_target_id"
        | "screen_boundary_violation"
        | "screen_name_changed"
        | "mutation_authority_rejected"
        | "stale_revision"
        | "unknown_mutation_kind"
        | "invalid_mutation_input"
        | "mutation_rejected";
      readonly detail: string;
    };

const MUTATION_REJECT_CODES: ReadonlySet<string> = new Set([
  "page_not_rendered",
  "unknown_target_id",
  "entry_screen_root_removal",
  "invalid_document",
  "invalid_fragment",
  "invalid_markup_input",
  "reserved-attribute",
  "invalid_target_id",
  "screen_boundary_violation",
  "screen_name_changed",
  "mutation_authority_rejected",
  "stale_revision",
  "unknown_mutation_kind",
  "invalid_mutation_input",
]);

type MutationRejectCode = Exclude<
  Extract<MutationToolResult, { readonly ok: false }>["code"],
  "author_error"
>;

function toolReject(
  code: MutationRejectCode,
  detail: string,
): Extract<MutationToolResult, { readonly ok: false; readonly detail: string }> {
  return Object.freeze({ ok: false as const, code, detail });
}

function mutationRejectCode(code: string): MutationRejectCode {
  return MUTATION_REJECT_CODES.has(code) ? (code as MutationRejectCode) : "mutation_rejected";
}

function mutationResult(
  result: AuthorValidationResult | FacetTargetedMutationResult,
  session: FacetToolSession,
): MutationToolResult {
  if (!result.ok) {
    if ("error" in result) {
      return renderAuthorError(result.error);
    }
    return toolReject(mutationRejectCode(result.code), result.detail);
  }
  return Object.freeze({ ok: true as const, stageRevision: session.stageRevision });
}

async function applyMarkup(markup: string, session: FacetToolSession): Promise<MutationToolResult> {
  return mutationResult(await session.applyAuthorMutation(markup), session);
}

export async function executeRenderPage(
  input: RenderPageInput,
  session: FacetToolSession,
): Promise<MutationToolResult> {
  return applyMarkup(input.markup, session);
}

async function executeTargetedMarkup(
  kind: "insert_subtree" | "replace_subtree" | "update_node",
  input: InsertSubtreeInput | ReplaceSubtreeInput | UpdateNodeInput,
  session: FacetToolSession,
): Promise<MutationToolResult> {
  return mutationResult(await session.applyTargetedMutation({ kind, ...input }), session);
}

export async function executeInsertSubtree(
  input: InsertSubtreeInput,
  session: FacetToolSession,
): Promise<MutationToolResult> {
  return executeTargetedMarkup("insert_subtree", input, session);
}

export async function executeReplaceSubtree(
  input: ReplaceSubtreeInput,
  session: FacetToolSession,
): Promise<MutationToolResult> {
  return executeTargetedMarkup("replace_subtree", input, session);
}

export async function executeUpdateNode(
  input: UpdateNodeInput,
  session: FacetToolSession,
): Promise<MutationToolResult> {
  return executeTargetedMarkup("update_node", input, session);
}

export async function executeRemoveSubtree(
  input: RemoveSubtreeInput,
  session: FacetToolSession,
): Promise<MutationToolResult> {
  return mutationResult(
    await session.applyTargetedMutation({ kind: "remove_subtree", ...input }),
    session,
  );
}
