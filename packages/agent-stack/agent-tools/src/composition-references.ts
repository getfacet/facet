import { validateCatalog, validateComposition, type FacetComposition } from "@facet/core";

// A 128-entry worst-case name + description index stays comfortably inside the
// reference agent's smallest context profile together with STAGE_SPEC and tool
// schemas. The cap belongs at the shared exposure boundary so prompt and lookup
// can never disagree about a truncated tail.
const MAX_EXPOSED_COMPOSITION_REFERENCES = 128;

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;

  const children = Object.values(value as Readonly<Record<string, unknown>>);
  for (const child of children) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * Builds the immutable composition-reference snapshot shared by prompt indexing
 * and asset lookup. This is the sole composition exposure-policy boundary:
 * omitted catalog means all valid references up to the deterministic exposure
 * cap, while a malformed supplied catalog fails closed to none.
 */
export function selectCompositionReferences(
  compositions: readonly unknown[],
  catalog?: unknown,
): readonly FacetComposition[] {
  let allowedNames: ReadonlySet<string> | undefined;
  if (catalog !== undefined) {
    const validated = validateCatalog(catalog);
    if (validated.issues.length > 0) return Object.freeze([]);
    if (validated.catalog.compositions.mode === "allow") {
      allowedNames = new Set(validated.catalog.compositions.names);
    }
  }

  const selected: FacetComposition[] = [];
  const seen = new Set<string>();
  for (const input of compositions) {
    const { composition } = validateComposition(input);
    if (composition === undefined || seen.has(composition.name)) continue;
    seen.add(composition.name);
    if (allowedNames !== undefined && !allowedNames.has(composition.name)) continue;
    selected.push(deepFreeze(composition));
    if (selected.length === MAX_EXPOSED_COMPOSITION_REFERENCES) break;
  }

  return Object.freeze(selected);
}
