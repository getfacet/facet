import type { CompositionRef, FacetComposition } from "./composition-validation.js";
import { BoundedIssues, isPlainObject, printableKey } from "./issues.js";
import { isCompositionRefShape } from "./primitive-node-validation.js";

/**
 * Maximum reference-nesting depth of a composition graph, counted as the number
 * of compositions on the longest reference chain rooted at a composition (a
 * leaf with no `{ use }` reference is depth 1). A chain longer than this is
 * refused at load. This is deliberately the CONSERVATIVE counterpart of the
 * expand-time recursion backstop (`MAX_COMPOSITION_NEST_DEPTH` in
 * `expand-composition-core.ts`): counting compositions rather than hops refuses
 * one level earlier than a hop counter would, so a load-accepted graph can never
 * out-nest the expander. Load-time is the primary gate; expand carries a
 * redundant depth-cap + visited-set so a hand-built registry still cannot loop.
 */
export const MAX_COMPOSITION_GRAPH_NEST_DEPTH = 8;

/**
 * Cap on a composition's MEMOIZED transitive expansion size (its own node count
 * plus the transitive node count of every composition it references). Mirrors
 * the per-composition `MAX_COMPOSITION_NODES` raw cap in `composition-validation.ts`;
 * here it bounds the whole reference DAG so a fan-out of individually-legal
 * compositions cannot expand into an unbounded tree. A composition whose
 * transitive count exceeds this is refused at load.
 */
export const MAX_COMPOSITION_GRAPH_NODES = 1023;

/**
 * The result of validating a whole catalog's composition-reference GRAPH: the
 * ACCEPTED subset (fixpoint-consistent — every kept composition resolves fully
 * within the cycle/dangling/depth/size bounds) plus the bounded list of refusal
 * issues. `accepted` preserves the input order of the surviving compositions.
 */
export interface ValidateCompositionGraphResult {
  readonly accepted: readonly FacetComposition[];
  readonly issues: readonly string[];
}

interface NodeMetrics {
  readonly ok: boolean;
  /** Longest reference chain rooted here (leaf = 1). Meaningful only when ok. */
  readonly depth: number;
  /** Transitive expansion node count. Meaningful only when ok. */
  readonly nodes: number;
}

const CYCLE_SENTINEL: NodeMetrics = { ok: false, depth: Number.MAX_SAFE_INTEGER, nodes: 0 };

/**
 * Catalog-level, load-time reference-graph validator — the PRIMARY safety gate
 * for composition nesting (`validateComposition` sees ONE document and cannot
 * see the graph). Given the whole set of already-individually-validated
 * compositions it builds the `{ use }` reference graph and REFUSES (prunes to a
 * fixpoint) every composition that:
 *
 *  - sits on a cycle (`a→b→a`, self `a→a`),
 *  - has a dangling reference (`use` names a composition not in the set),
 *  - roots a chain deeper than `MAX_COMPOSITION_GRAPH_NEST_DEPTH`,
 *  - has a transitive expansion larger than `MAX_COMPOSITION_GRAPH_NODES`, or
 *  - (transitively) references any composition refused for one of the above.
 *
 * It is a PURE function (the catalog is passed in — no I/O, keeps `@facet/core`
 * dependency-free) and is FAIL-SAFE: it NEVER throws on hostile input (a
 * non-array, junk entries, throwing getters); each refusal pushes a single
 * BOUNDED issue (`BoundedIssues`). Returns the surviving compositions + issues.
 */
export function validateCompositionGraph(
  compositions: readonly FacetComposition[],
): ValidateCompositionGraphResult {
  const issues = new BoundedIssues();
  try {
    return validateGraphUnsafe(compositions, issues);
  } catch {
    issues.push("composition graph could not be validated safely; refused all references");
    return { accepted: [], issues: issues.list };
  }
}

function validateGraphUnsafe(
  compositions: readonly FacetComposition[],
  issues: BoundedIssues,
): ValidateCompositionGraphResult {
  if (!Array.isArray(compositions)) {
    issues.push("composition graph input is not an array; refused");
    return { accepted: [], issues: issues.list };
  }

  // Keep only well-formed entries (a plain object with a string name); index the
  // FIRST occurrence of each name so a reference resolves deterministically.
  const ordered: FacetComposition[] = [];
  const byName = new Map<string, FacetComposition>();
  for (const entry of compositions) {
    if (!isPlainObject(entry) || typeof entry.name !== "string" || entry.name === "") {
      issues.push("composition graph entry is not a valid composition; skipped");
      continue;
    }
    if (byName.has(entry.name)) {
      issues.push(`composition "${printableKey(entry.name)}" is a duplicate name; skipped`);
      continue;
    }
    // `entry` is a pre-validated FacetComposition (validateComposition ran per
    // document before this graph pass); the isPlainObject guard above narrows it
    // to Record<string,unknown> for the fail-safe property reads, so re-assert the
    // element type when storing.
    byName.set(entry.name, entry as unknown as FacetComposition);
    ordered.push(entry as unknown as FacetComposition);
  }

  const memo = new Map<string, NodeMetrics>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cyclic = new Set<string>();
  const reasonOf = new Map<string, string>();

  const recordReason = (name: string, reason: string): void => {
    if (!reasonOf.has(name)) reasonOf.set(name, reason);
  };

  const evaluate = (name: string): NodeMetrics => {
    const cached = memo.get(name);
    if (cached !== undefined) return cached;

    if (onStack.has(name)) {
      // A back-edge to a composition still on the DFS stack: every member from
      // that composition up to the current top is on a reference cycle.
      const start = stack.indexOf(name);
      if (start >= 0) {
        for (let i = start; i < stack.length; i++) cyclic.add(stack[i]!);
      }
      cyclic.add(name);
      return CYCLE_SENTINEL;
    }

    const comp = byName.get(name);
    if (comp === undefined) {
      // Absent target — the CALLER records the dangling reason against itself.
      return { ok: false, depth: Number.MAX_SAFE_INTEGER, nodes: 0 };
    }

    onStack.add(name);
    stack.push(name);

    let ok = true;
    let maxChildDepth = 0;
    let total = ownNodeCount(comp);

    for (const target of edgesOf(comp)) {
      if (!byName.has(target)) {
        ok = false;
        recordReason(name, `references unknown composition "${printableKey(target)}"`);
        continue;
      }
      const child = evaluate(target);
      if (!child.ok) {
        ok = false;
        recordReason(name, `references refused composition "${printableKey(target)}"`);
      } else {
        if (child.depth > maxChildDepth) maxChildDepth = child.depth;
        total += child.nodes;
      }
    }

    stack.pop();
    onStack.delete(name);

    const depth = maxChildDepth + 1;
    if (depth > MAX_COMPOSITION_GRAPH_NEST_DEPTH) {
      ok = false;
      recordReason(name, `exceeds the max nesting depth of ${MAX_COMPOSITION_GRAPH_NEST_DEPTH}`);
    }
    if (total > MAX_COMPOSITION_GRAPH_NODES) {
      ok = false;
      recordReason(
        name,
        `transitive expansion exceeds the ${MAX_COMPOSITION_GRAPH_NODES}-node cap`,
      );
    }

    const result: NodeMetrics = { ok, depth, nodes: total };
    memo.set(name, result);
    return result;
  };

  for (const comp of ordered) evaluate(comp.name);

  const accepted: FacetComposition[] = [];
  for (const comp of ordered) {
    const name = comp.name;
    const refusedForCycle = cyclic.has(name);
    const metrics = memo.get(name);
    const refused = refusedForCycle || metrics === undefined || !metrics.ok;
    if (!refused) {
      accepted.push(comp);
      continue;
    }
    const reason = refusedForCycle
      ? "is on a reference cycle"
      : (reasonOf.get(name) ?? "references a refused composition");
    issues.push(`composition "${printableKey(name)}" ${reason}; refused`);
  }

  return { accepted, issues: issues.list };
}

/** Referenced composition names from a composition's node map. Never throws. */
function edgesOf(comp: FacetComposition): string[] {
  const out: string[] = [];
  try {
    const nodes = (comp as { nodes?: unknown }).nodes;
    if (!isPlainObject(nodes)) return out;
    for (const key of Object.keys(nodes)) {
      let value: unknown;
      try {
        value = nodes[key];
      } catch {
        continue;
      }
      if (isCompositionRefShape(value)) out.push((value as CompositionRef).use);
    }
  } catch {
    // A hostile nodes container (throwing getter/proxy) contributes no edges.
  }
  return out;
}

/** Own node count of a composition (entries in its node map). Never throws. */
function ownNodeCount(comp: FacetComposition): number {
  try {
    const nodes = (comp as { nodes?: unknown }).nodes;
    return isPlainObject(nodes) ? Object.keys(nodes).length : 0;
  } catch {
    return 0;
  }
}
