import { BoundedIssues, caughtErrorDetail } from "./issues.js";
import type { FacetNode, NodeId } from "./nodes.js";
import { expandCompositionInner, noOp } from "./expand-composition-core.js";

export type CompositionParams = Readonly<Record<string, unknown>>;

export interface ExpandAt {
  readonly parent: NodeId;
}

export interface UseCompositionResult {
  readonly root?: NodeId;
  readonly slots: Readonly<Record<string, NodeId>>;
  readonly ids: Readonly<Record<NodeId, NodeId>>;
}

export interface ExpandCompositionResult extends UseCompositionResult {
  readonly nodes: Readonly<Record<NodeId, FacetNode>>;
  readonly issues: readonly string[];
}

export interface ExpandCompositionOptions {
  readonly existingIds?: Iterable<NodeId>;
  readonly mintId?: () => string;
}

export function expandComposition(
  composition: unknown,
  params: unknown,
  at: ExpandAt,
  options: ExpandCompositionOptions = {},
): ExpandCompositionResult {
  const issues = new BoundedIssues();
  try {
    return expandCompositionInner(composition, params, at, options, issues);
  } catch (error) {
    issues.push(`composition expansion failed: ${caughtErrorDetail(error)}`);
    return noOp(issues);
  }
}
