import { applyPatch, type JsonPatchOperation } from "./patch.js";
import type { FacetTree } from "./tree.js";
import { validateTree } from "./validate.js";
import { printableValue } from "./issues.js";

/**
 * The result of folding one patch batch into a stage: the guaranteed-valid,
 * normalized tree plus every issue raised (dropped-op salvage notes first, then
 * validateTree's own findings).
 */
export interface StageFoldResult {
  readonly tree: FacetTree;
  readonly issues: readonly string[];
}

/**
 * The ONE way a patch batch becomes stage state — run identically on the server
 * (the stored stage, `@facet/runtime`) and the client (the rendered tree,
 * `@facet/react`'s `useFacet`). Because both sides fold with THIS pure function
 * on the same inputs, the client tree is the same normalized fold as the stored
 * stage by construction — they cannot drift (invariant #2), so no divergence
 * detector / corrective frame is needed.
 *
 * Three fail-safe steps, in order:
 *  1. Apply the batch ATOMICALLY (`applyPatch` — all ops or none), matching what
 *     a client receives on the wire.
 *  2. On throw, SALVAGE op-by-op so a single bad op doesn't discard the whole
 *     batch; each dropped op is surfaced with a BOUNDED description (never the
 *     raw op echoed — a hostile path/value can't flood the log).
 *  3. `validateTree` the result — the untrusted-tree boundary that returns a
 *     guaranteed-valid tree, so both callers always hold a sanitized tree.
 *
 * Never throws.
 */
export function foldPatchIntoStage(
  stage: FacetTree,
  patches: readonly JsonPatchOperation[],
): StageFoldResult {
  // A wire patch message can carry a non-array `patches` field. Treat it as a
  // no-op batch, but still run the stage through validateTree so the contract
  // "returns a validated tree" holds for every caller and both sides agree.
  if (!Array.isArray(patches)) {
    const { tree, issues } = validateTree(stage);
    return {
      tree,
      issues: ["patch message dropped: patches is not an array", ...issues],
    };
  }

  const dropped: string[] = [];
  let raw: FacetTree = stage;
  try {
    raw = applyPatch(stage, patches);
  } catch {
    // The client applies this SAME batch atomically and would drop it whole on
    // the throw; salvage the good ops op-by-op so the stored + rendered trees
    // both keep exactly the ops that apply, in order.
    raw = stage;
    for (const op of patches) {
      try {
        raw = applyPatch(raw, [op]);
      } catch {
        dropped.push(describeDroppedOp(op));
      }
    }
  }
  const { tree, issues } = validateTree(raw);
  return { tree, issues: dropped.length === 0 ? issues : [...dropped, ...issues] };
}

/** A bounded, never-throwing note for an op that failed to apply (no raw echo). */
function describeDroppedOp(op: unknown): string {
  const rec = typeof op === "object" && op !== null ? (op as Record<string, unknown>) : undefined;
  const kind = printableValue(rec?.["op"]);
  const where = rec === undefined ? undefined : (rec["path"] ?? rec["from"]);
  return where === undefined
    ? `dropped an unapplicable patch op (${kind})`
    : `dropped an unapplicable patch op (${kind} at ${printableValue(where)})`;
}
