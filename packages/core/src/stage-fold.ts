import { applyOpInPlace, applyPatch, MAX_PATCH_OPS, type JsonPatchOperation } from "./patch.js";
import type { FacetTree } from "./tree.js";
import { validateTree } from "./validate.js";
import { BoundedIssues, printableValue } from "./issues.js";

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
 * Fail-safe steps, in order:
 *  0. BOUND the batch: a batch over `MAX_PATCH_OPS` is rejected WHOLE (the stage
 *     is left unchanged, validated) — salvaging hundreds of thousands of ops
 *     op-by-op would block the synchronous per-visitor path for seconds.
 *  1. Apply the batch ATOMICALLY (`applyPatch` — all ops or none), matching what
 *     a client receives on the wire.
 *  2. On throw, SALVAGE op-by-op on ONE private clone (no per-op re-clone) so a
 *     single bad op doesn't discard the whole batch; each dropped op is surfaced
 *     with a BOUNDED description (never the raw op echoed) and the dropped list
 *     itself is capped (`BoundedIssues`) so a batch of throwing ops can't balloon
 *     the issue array. A failed RFC 6902 `test` GUARD drops itself and every
 *     remaining op it guarded (§5: "if a test fails, the entire patch document
 *     SHALL NOT be applied") — ops applied before the guard stay.
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

  // Reject an oversize batch WHOLE before any apply: the salvage clones once and
  // applies in place, but building a per-op dropped list for hundreds of
  // thousands of ops is itself an O(ops) synchronous stall. Both callers
  // (runtime store + client `useFacet`) fold with this one function, so this
  // bounds the server lane and every browser tab at once.
  if (patches.length > MAX_PATCH_OPS) {
    const { tree, issues } = validateTree(stage);
    return {
      tree,
      issues: [
        `patch batch dropped: ${String(patches.length)} ops exceeds the ${String(MAX_PATCH_OPS)}-op cap`,
        ...issues,
      ],
    };
  }

  const dropped = new BoundedIssues();
  let raw: FacetTree = stage;
  try {
    raw = applyPatch(stage, patches);
  } catch {
    // The client applies this SAME batch atomically and would drop it whole on
    // the throw; salvage the good ops op-by-op so the stored + rendered trees
    // both keep exactly the ops that apply, in order. Clone ONCE and apply each
    // op in place (`applyOpInPlace` is atomic per op — a throw leaves the clone
    // unchanged), instead of `applyPatch(raw, [op])` which would re-clone the
    // WHOLE tree per op (the O(ops × tree_size) blowup).
    raw = structuredClone(stage);
    for (const [index, op] of patches.entries()) {
      try {
        raw = applyOpInPlace(raw, op) as FacetTree;
      } catch {
        // A failed `test` is a guard, not an independently-bad op: RFC 6902 §5
        // forbids applying the ops it protects, so drop this and everything after
        // it. (An independently-bad op is dropped alone and salvage continues.)
        if (isTestOp(op)) {
          const remaining = patches.length - index - 1;
          dropped.push(
            `failed \`test\` guard at ${describeOpPath(op)}; dropped it and the ${String(remaining)} following op(s) it guarded`,
          );
          break;
        }
        dropped.push(describeDroppedOp(op));
      }
    }
  }
  const { tree, issues } = validateTree(raw);
  const droppedList = dropped.list;
  return {
    tree,
    issues: droppedList.length === 0 ? issues : [...droppedList, ...issues],
  };
}

/** True for a `test` op (RFC 6902 guard) — a plain object whose `op` is "test". */
function isTestOp(op: unknown): boolean {
  return typeof op === "object" && op !== null && (op as Record<string, unknown>)["op"] === "test";
}

/** The bounded, never-throwing `path` echo for a dropped op's issue string. */
function describeOpPath(op: unknown): string {
  const rec = typeof op === "object" && op !== null ? (op as Record<string, unknown>) : undefined;
  return printableValue(rec?.["path"]);
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
