import { MAX_PATTERNS, type FacetPattern } from "@facet/core";

/**
 * Select one exact Pattern from the already validated, deeply frozen turn
 * snapshot. An impossible over-cap snapshot fails closed instead of exposing a
 * truncated prefix.
 */
export function selectPatternReference(
  patterns: readonly FacetPattern[],
  name: string,
): FacetPattern | undefined {
  if (patterns.length > MAX_PATTERNS) return undefined;
  return patterns.find((pattern) => pattern.name === name);
}
