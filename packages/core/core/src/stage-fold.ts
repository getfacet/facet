import { applyOpInPlace, applyPatch, MAX_PATCH_OPS, type JsonPatchOperation } from "./patch.js";
import { isJsonPatchTestOperation } from "./protocol.js";
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
  /**
   * Whether this fold actually MUTATED the stage: at least one non-`test` op
   * applied. False for a whole-batch reject (over-cap or non-array), an
   * all-ops-failed salvage, and a `test`-only batch (a passing guard changes
   * nothing). The runtime threads this to `TurnResult.agentMutated` so the
   * transport advances "last applied" ONLY when the agent's own turn changed the
   * page — a turn whose patch was dropped whole must never stale a parked late
   * result. This reflects what APPLIED, not what `validateTree` then kept.
   */
  readonly mutated: boolean;
  /**
   * Whether an applied non-`test` op wrote the root document (`path: ""`). This
   * is effect-based like `mutated`: a guarded or otherwise dropped root write
   * remains false, so renderers do not animate a replacement that never landed.
   */
  readonly rootReplaced?: boolean;
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
 *  1. Try the fast path: apply the batch ATOMICALLY (`applyPatch` — all ops or
 *     none).
 *  2. On throw, SALVAGE op-by-op on ONE private clone (no per-op re-clone) so a
 *     single bad op doesn't discard the whole batch; each dropped op is surfaced
 *     with a BOUNDED description (never the raw op echoed) and the dropped list
 *     itself is capped (`BoundedIssues`) so a batch of throwing ops can't balloon
 *     the issue array. A failed RFC 6902 `test` GUARD drops itself and every
 *     remaining op in this salvage stream; ops already salvaged before the guard
 *     stay applied by deliberate partial-salvage policy.
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
  if (!safeIsArray(patches)) {
    const { tree, issues } = validateTree(stage);
    return {
      tree,
      mutated: false,
      rootReplaced: false,
      issues: ["patch message dropped: patches is not an array", ...issues],
    };
  }

  // Reject an oversize batch WHOLE before any apply: the salvage clones once and
  // applies in place, but building a per-op dropped list for hundreds of
  // thousands of ops is itself an O(ops) synchronous stall. Both callers
  // (runtime store + client `useFacet`) fold with this one function, so this
  // bounds the server lane and every browser tab at once.
  const patchCount = safeArrayLength(patches);
  if (patchCount === undefined) {
    const { tree, issues } = validateTree(stage);
    return {
      tree,
      mutated: false,
      rootReplaced: false,
      issues: ["patch batch dropped: patches length is unreadable", ...issues],
    };
  }
  if (patchCount > MAX_PATCH_OPS) {
    const { tree, issues } = validateTree(stage);
    return {
      tree,
      mutated: false,
      rootReplaced: false,
      issues: [
        `patch batch dropped: ${String(patchCount)} ops exceeds the ${String(MAX_PATCH_OPS)}-op cap`,
        ...issues,
      ],
    };
  }

  const dropped = new BoundedIssues();
  let raw: FacetTree = stage;
  // True once a non-`test` op actually applies — the effect-based edit signal.
  let mutated = false;
  let rootReplaced = false;
  try {
    raw = applyPatch(stage, patches);
    // The atomic apply succeeded, so EVERY op applied: the batch mutated the
    // stage iff it carried at least one non-`test` op (a `test`-only batch is a
    // guard check that changes nothing).
    const classification = classifyAppliedBatch(patches, patchCount);
    mutated = classification.mutated;
    rootReplaced = classification.rootReplaced;
  } catch {
    // Salvage the good ops op-by-op so every caller keeps exactly the ops that
    // apply, in order. Clone ONCE and apply each op in place (`applyOpInPlace` is
    // atomic per op — a throw leaves the clone unchanged), instead of
    // `applyPatch(raw, [op])` which would re-clone the WHOLE tree per op (the
    // O(ops × tree_size) blowup).
    raw = structuredClone(stage);
    for (let index = 0; index < patchCount; index += 1) {
      const opRead = safeArrayItem(patches, index);
      if (!opRead.ok) {
        dropped.push(`dropped an unreadable patch op at index ${String(index)}`);
        continue;
      }
      const op = opRead.value as JsonPatchOperation;
      try {
        raw = applyOpInPlace(raw, op) as FacetTree;
        // A non-`test` op that applied in place is a real mutation; a passing
        // `test` guard applies without throwing but changes nothing.
        if (!isJsonPatchTestOperation(op)) mutated = true;
        if (isRootDocumentWrite(op)) rootReplaced = true;
      } catch {
        // A failed `test` is a guard, not an independently-bad op: drop this and
        // everything after it in the salvaged stream. Ops already salvaged before
        // the guard stay applied; an independently-bad non-test op is dropped
        // alone and salvage continues.
        if (isJsonPatchTestOperation(op)) {
          const remaining = patchCount - index - 1;
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
    mutated,
    rootReplaced,
    issues: droppedList.length === 0 ? issues : [...droppedList, ...issues],
  };
}

function safeIsArray(value: unknown): value is readonly unknown[] {
  try {
    return Array.isArray(value);
  } catch {
    return false;
  }
}

function safeArrayLength(value: readonly unknown[]): number | undefined {
  try {
    const length = value.length;
    return Number.isSafeInteger(length) && length >= 0 ? length : undefined;
  } catch {
    return undefined;
  }
}

type PropertyRead = { readonly ok: true; readonly value: unknown } | { readonly ok: false };

function safeArrayItem(value: readonly unknown[], index: number): PropertyRead {
  try {
    return { ok: true, value: value[index] };
  } catch {
    return { ok: false };
  }
}

function safeProperty(value: unknown, key: string): PropertyRead {
  if (typeof value !== "object" || value === null) return { ok: false };
  try {
    return { ok: true, value: (value as Record<string, unknown>)[key] };
  } catch {
    return { ok: false };
  }
}

function classifyAppliedBatch(
  patches: readonly JsonPatchOperation[],
  patchCount: number,
): { readonly mutated: boolean; readonly rootReplaced: boolean } {
  let mutated = false;
  let rootReplaced = false;
  for (let index = 0; index < patchCount; index += 1) {
    const opRead = safeArrayItem(patches, index);
    if (!opRead.ok) {
      // The batch already applied atomically; if we can no longer read a member,
      // fail closed for late-result ordering and report that something changed.
      mutated = true;
      continue;
    }
    if (!isJsonPatchTestOperation(opRead.value)) mutated = true;
    if (isRootDocumentWrite(opRead.value)) rootReplaced = true;
  }
  return { mutated, rootReplaced };
}

function isRootDocumentWrite(operation: unknown): boolean {
  const path = safeProperty(operation, "path");
  const op = safeProperty(operation, "op");
  return (
    path.ok &&
    path.value === "" &&
    op.ok &&
    (op.value === "add" || op.value === "replace" || op.value === "copy" || op.value === "move")
  );
}

/** The bounded, never-throwing `path` echo for a dropped op's issue string. */
function describeOpPath(op: unknown): string {
  const path = safeProperty(op, "path");
  return printableValue(path.ok ? path.value : undefined);
}

/** A bounded, never-throwing note for an op that failed to apply (no raw echo). */
function describeDroppedOp(op: unknown): string {
  const opKind = safeProperty(op, "op");
  const path = safeProperty(op, "path");
  const from = safeProperty(op, "from");
  const kind = printableValue(opKind.ok ? opKind.value : undefined);
  const where = path.ok && path.value !== undefined ? path.value : from.ok ? from.value : undefined;
  return where === undefined
    ? `dropped an unapplicable patch op (${kind})`
    : `dropped an unapplicable patch op (${kind} at ${printableValue(where)})`;
}
