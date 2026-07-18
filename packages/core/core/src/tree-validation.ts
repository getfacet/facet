import { isContainer, type FacetNode } from "./nodes.js";
import { EMPTY_TREE, type FacetTree } from "./tree.js";
import {
  BoundedIssues,
  isForbiddenKey,
  isPlainObject as isObject,
  nullMap,
  printableKey,
  printableValue,
  type IssueSink,
} from "./issues.js";
import { sanitizeNode } from "./brick-node-validation.js";
import { sanitizeDataWarehouse } from "./data-binding.js";
import type { DataWarehouse } from "./data-types.js";

export interface TreeValidationResult {
  readonly tree: FacetTree;
  readonly issues: readonly string[];
}

export const MAX_DEPTH = 100;
export const MAX_RENDER_NODES = 5000;
export const MAX_SCREENS = 100;

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Sanitizes screens: keep only entries whose value is a string naming an
 * existing container node (a screen root must be renderable as a root). Zero
 * survivors ⇒ both fields come back undefined and the tree stays the plain
 * single-screen form. entry must name a kept screen, else fall back to the
 * first kept key so a kept screens map always ships a valid entry.
 */
function sanitizeScreens(
  rawScreens: unknown,
  rawEntry: unknown,
  nodes: Readonly<Record<string, FacetNode>>,
  issues: IssueSink,
): { screens?: Record<string, string>; entry?: string } {
  if (rawScreens === undefined) return {};
  if (!isObject(rawScreens)) {
    issues.push("screens is not an object map; dropped");
    return {};
  }
  // Null-prototype accumulator, matching sanitizeNodeMap: with a plain literal a
  // screen keyed "__proto__" would hit the inherited setter (silent no-op) and
  // an `entry` naming an Object.prototype member ("constructor"/"toString") would
  // resolve through the chain and ship an entry that names no kept screen.
  const kept: Record<string, string> = nullMap<string>();
  let keptCount = 0;
  let capped = false;
  for (const [name, target] of Object.entries(rawScreens)) {
    const screen = printableKey(name);
    // Forbidden screen names dropped WITH an issue (mirrors sanitizeNodeMap's
    // forbidden-id policy) rather than silently mutating the accumulator.
    if (isForbiddenKey(name)) {
      issues.push(`screen "${screen}": forbidden screen name dropped`);
      continue;
    }
    if (keptCount >= MAX_SCREENS) {
      capped = true;
      break;
    }
    if (typeof target !== "string") {
      issues.push(`screen "${screen}": target is not a node id string; dropped`);
      continue;
    }
    const node = nodes[target];
    if (node === undefined) {
      issues.push(`screen "${screen}": target "${printableKey(target)}" does not exist; dropped`);
      continue;
    }
    if (!isContainer(node)) {
      issues.push(
        `screen "${screen}": target "${printableKey(target)}" is not a container; dropped`,
      );
      continue;
    }
    kept[name] = target;
    keptCount += 1;
  }
  if (capped) {
    issues.push(`screens exceeded the ${MAX_SCREENS}-screen cap; extra screens dropped`);
  }
  const firstKey = Object.keys(kept)[0];
  if (firstKey === undefined) return {};
  const entry = asString(rawEntry);
  if (entry !== undefined && kept[entry] !== undefined) {
    return { screens: kept, entry };
  }
  // Only report the fallback when an entry was actually SUPPLIED. `entry?` is a
  // legal optional on FacetTree, so an omitted entry is a valid shape, not a
  // mistake — silently default it to the first kept screen. Guard on the RAW
  // input (not `entry`) so a present-but-non-string entry still gets the
  // diagnostic while the legal omitted-entry case stays quiet.
  if (rawEntry !== undefined) {
    issues.push(`entry does not name a kept screen; falling back to "${printableKey(firstKey)}"`);
  }
  return { screens: kept, entry: firstKey };
}

/**
 * Sanitizes a raw `nodes` map into a null-prototype accumulator of kept nodes.
 *
 * Null-prototype: with a plain object literal, a node keyed "__proto__" would
 * ASSIGN the map's [[Prototype]] instead of storing a node (silently losing it
 * and making dangling-child lookups resolve through the prototype chain). Such
 * ids are also dropped outright — patch pointers to them are forbidden anyway,
 * so they'd be unreachable. This is the single node-map sanitation path for
 * `validateTree`, keeping brick-shape + token-membership sanitation centralized.
 */
export function sanitizeNodeMap(
  rawNodes: Record<string, unknown>,
  issues: IssueSink,
): Record<string, FacetNode> {
  const nodes = nullMap<FacetNode>();
  for (const [id, raw] of Object.entries(rawNodes)) {
    if (id === "") {
      issues.push('node "": empty node id dropped');
      continue;
    }
    if (isForbiddenKey(id)) {
      issues.push(`node "${printableKey(id)}": forbidden node id dropped`);
      continue;
    }
    const node = sanitizeNode(id, raw, issues);
    if (node !== undefined) {
      nodes[id] = node;
    }
  }
  return nodes;
}

/**
 * Drops child references that point at nodes we couldn't keep, and dedupes
 * duplicate siblings (a child id may appear at most once under one parent —
 * keep the first occurrence). A dup would otherwise render the same subtree
 * twice and make patch pointers to it ambiguous. Mutates `nodes` in place.
 */
export function pruneDanglingChildren(nodes: Record<string, FacetNode>, issues: IssueSink): void {
  for (const node of Object.values(nodes)) {
    if (isContainer(node)) {
      const seen = new Set<string>();
      const kept: string[] = [];
      let dangling = false;
      for (const child of node.children) {
        if (nodes[child] === undefined) {
          dangling = true;
          continue;
        }
        if (seen.has(child)) {
          issues.push(
            `node "${printableKey(node.id)}": removed duplicate sibling child "${printableKey(child)}"`,
          );
          continue;
        }
        seen.add(child);
        kept.push(child);
      }
      if (dangling) {
        issues.push(`node "${printableKey(node.id)}": removed dangling child references`);
      }
      if (kept.length !== node.children.length) {
        nodes[node.id] = { ...node, children: kept };
      }
    }
  }
}

/**
 * Breaks cycles AND collapses shared children so the sanitized graph is a true
 * tree (invariant #2): a child ref pointing back to an ancestor is dropped (it
 * would recurse forever), depth is capped at MAX_DEPTH (a pathologically deep
 * input can't blow the stack), and — critically — a child already kept under
 * another parent in the SAME walk is dropped. Without that last rule a
 * shared-child DAG stays acyclic and validates clean, but has an exponential
 * number of root-to-node PATHS, so the renderer (which caps depth only)
 * instantiates 2^depth elements and hangs the tab.
 *
 * Single-parent is enforced PER WALK ROOT: `claimed` resets at the start of each
 * root's DFS (the roots are the tree root plus each kept screen root; each
 * validation walk passes one root). This is deliberate — two screens legitimately
 * SHARE a node (a common header/footer), so a global claim would strip the ref
 * from the second screen and break the pre-drawn-screens feature. Path explosion
 * only matters within one render pass (one root); across roots a node may still
 * be kept under multiple different walk roots. Mutates `nodes` in place.
 */
export function breakCycles(
  nodes: Record<string, FacetNode>,
  roots: readonly string[],
  issues: IssueSink,
): { worstRoot: string; maxReachable: number } {
  const inPath = new Set<string>();
  // Nodes kept under some parent during the CURRENT root's walk. Reset per root
  // so cross-screen sharing survives; within one walk, `claimed` also prevents
  // re-visiting a subtree, keeping validation linear with no separate settled set.
  let claimed = new Set<string>();
  const visit = (nodeId: string, depth: number): void => {
    const node = nodes[nodeId];
    if (node === undefined || !isContainer(node)) {
      return;
    }
    inPath.add(nodeId);
    const kept: string[] = [];
    for (const child of node.children) {
      if (inPath.has(child)) {
        issues.push(
          `node "${printableKey(nodeId)}": removed cyclic child "${printableKey(child)}"`,
        );
        continue;
      }
      if (depth >= MAX_DEPTH) {
        issues.push(
          `node "${printableKey(nodeId)}": dropped child "${printableKey(child)}" beyond max depth`,
        );
        continue;
      }
      if (claimed.has(child)) {
        issues.push(
          `node "${printableKey(nodeId)}": removed shared child "${printableKey(child)}" (already kept under another parent)`,
        );
        continue;
      }
      claimed.add(child);
      kept.push(child);
      visit(child, depth + 1);
    }
    if (kept.length !== node.children.length) {
      nodes[nodeId] = { ...node, children: kept };
    }
    inPath.delete(nodeId);
  };
  // Track the heaviest render root: the renderer spends a fresh budget per pass on
  // the CURRENT screen's subtree, so what matters for truncation is the MOST nodes
  // any single root reaches, not the whole map. Reachable = the root itself plus
  // every child claimed during its walk (shared nodes counted per root, matching
  // the renderer, which re-instantiates a shared node in each screen it appears in).
  let worstRoot = roots[0] ?? "";
  let maxReachable = 0;
  for (const root of roots) {
    claimed = new Set<string>();
    visit(root, 0);
    const reachable = claimed.size + (nodes[root] !== undefined ? 1 : 0);
    if (reachable > maxReachable) {
      maxReachable = reachable;
      worstRoot = root;
    }
  }
  return { worstRoot, maxReachable };
}

export function validateTree(input: unknown): TreeValidationResult {
  const issues = new BoundedIssues();
  try {
    return validateTreeUnsafe(input, issues);
  } catch {
    issues.push("input could not be read safely; empty tree used");
    return { tree: EMPTY_TREE, issues: issues.list };
  }
}

function validateTreeUnsafe(input: unknown, issues: BoundedIssues): TreeValidationResult {
  if (!isObject(input) || !isObject(input.nodes)) {
    issues.push("input is not a tree object with a nodes map");
    return { tree: EMPTY_TREE, issues: issues.list };
  }

  const nodes = sanitizeNodeMap(input.nodes, issues);
  pruneDanglingChildren(nodes, issues);

  const explicitRoot = typeof input.root === "string" && nodes[input.root] !== undefined;
  const rootId = explicitRoot
    ? (input.root as string)
    : nodes["root"] !== undefined
      ? "root"
      : undefined;
  // A dangling/absent `input.root` that we salvaged by falling back to the node
  // keyed "root" is a stored-vs-live divergence the fail-safe renderer does NOT
  // reproduce (its isRenderableTree goes blank on the dangling id), so surface
  // it as an issue instead of falling back silently — the runtime logs it and
  // converges live tabs on this recovered root.
  if (!explicitRoot && rootId === "root" && input.root !== undefined) {
    // `input.root` is untrusted: a bounded, never-throwing echo — a cyclic object
    // or BigInt handed in via the public API would make JSON.stringify throw
    // (breaching the never-throws boundary), and a huge value would flood the
    // runtime's save-time console.error. printableValue quotes a capped string
    // and collapses anything else to a constant placeholder.
    issues.push(`root ${printableValue(input.root)} not found; fell back to "root"`);
  }

  const rootNode = rootId === undefined ? undefined : nodes[rootId];
  if (rootId === undefined || rootNode === undefined) {
    issues.push("no valid root node");
    return { tree: EMPTY_TREE, issues: issues.list };
  }
  if (!isContainer(rootNode)) {
    issues.push("root node must be a container");
    return { tree: EMPTY_TREE, issues: issues.list };
  }

  const { screens, entry } = sanitizeScreens(input.screens, input.entry, nodes, issues);

  // Dedupe the walk roots: several screens may target the SAME box, and a screen
  // may target the tree root — breakCycles resets its claim set per root, so
  // rewalking a repeated root is redundant work (its subtree is already pruned).
  const walkRoots = Array.from(
    new Set([rootId, ...(screens !== undefined ? Object.values(screens) : [])]),
  );
  const { worstRoot, maxReachable } = breakCycles(nodes, walkRoots, issues);

  // The renderer truncates a PASS at MAX_RENDER_NODES nodes, and a pass renders one
  // render root's subtree — so warn when the heaviest single root crosses the cap,
  // not when the whole node map does. A multi-screen tree whose total exceeds the
  // cap but whose every screen fits renders fully; warning on the map total would
  // be a false diagnostic. This keeps the guarantee bidirectional: a clean verdict
  // means no screen can render truncated, a warning means one actually will.
  if (maxReachable > MAX_RENDER_NODES) {
    issues.push(
      `render root "${printableKey(worstRoot)}" reaches ${maxReachable} nodes; a render pass will truncate past ${MAX_RENDER_NODES}`,
    );
  }

  const tree: {
    root: string;
    nodes: Record<string, FacetNode>;
    screens?: Record<string, string>;
    entry?: string;
    data?: DataWarehouse;
  } = { root: rootId, nodes };
  // Sanitize the per-tree data warehouse HERE (not in the renderer) and copy the
  // survivor onto the returned tree, so the ONE `foldPatchIntoStage` that runs
  // this validateTree on BOTH server and client keeps `data` identically
  // (RISK-INV-1). Absent/all-invalid input leaves `data` off entirely — an
  // additive optional, so inline-only trees serialize unchanged (DC-007).
  const data = sanitizeDataWarehouse(input.data, issues);
  if (data !== undefined) {
    tree.data = data;
  }
  if (screens !== undefined && entry !== undefined) {
    tree.screens = screens;
    tree.entry = entry;
  }
  return { tree, issues: issues.list };
}
