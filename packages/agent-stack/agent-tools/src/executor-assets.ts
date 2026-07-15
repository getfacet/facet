import { isValidThemeName, type FacetTree } from "@facet/core";
import { selectCompositionReferences } from "./composition-references.js";
import { errorResult, okMessageResult } from "./executor-result.js";

/** Execute a read-only lookup against the validated, catalog-exposed reference snapshot. */
export function executeGetComposition(
  input: Readonly<Record<string, unknown>>,
  shadow: FacetTree,
  compositions: readonly unknown[],
  catalog?: unknown,
) {
  const name = exactCompositionName(input);
  if (name === undefined) {
    return errorResult(
      "get_composition",
      "invalid_input",
      'error: get_composition needs exactly one field, a valid non-empty string "name"',
      shadow,
      [],
      "Pass exactly { name: <a name from the offered COMPOSITIONS list> }.",
    );
  }

  const composition = selectCompositionReferences(compositions, catalog).find(
    (candidate) => candidate.name === name,
  );
  if (composition === undefined) {
    return errorResult(
      "get_composition",
      "invalid_composition",
      `error: get_composition — composition "${name}" is not available in the exposed reference datasets`,
      shadow,
      [],
      "Pick a name from the offered COMPOSITIONS list, then retry get_composition.",
    );
  }

  return okMessageResult(
    "get_composition",
    `Read composition reference "${name}".`,
    shadow,
    [],
    [],
    {
      data: JSON.stringify(composition),
      nextAction: "Author the stage separately with native Facet stage tools.",
    },
  );
}

function exactCompositionName(input: Readonly<Record<string, unknown>>): string | undefined {
  try {
    const keys = Object.keys(input);
    if (keys.length !== 1 || keys[0] !== "name") return undefined;
    const name = input["name"];
    return typeof name === "string" && isValidThemeName(name) ? name : undefined;
  } catch {
    return undefined;
  }
}
