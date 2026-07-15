import { treeHasContent, validateTree, type FacetCatalog, type FacetTree } from "@facet/core";
import { preserveCatalogTheme, treeCatalogViolation } from "./executor-policy.js";
import { errorResult, okPatchResult } from "./executor-result.js";

export function executeRenderPage(
  input: Readonly<Record<string, unknown>>,
  shadow: FacetTree,
  catalog: FacetCatalog | undefined,
) {
  const validated = validateTree(input["tree"]);
  const issues = validated.issues;
  const tree = preserveCatalogTheme(validated.tree, catalog, shadow);
  if (!isRenderable(tree)) {
    const hint = issueHint(issues);
    return errorResult(
      "render_page",
      "invalid_tree",
      `error: render_page needs a full tree { root, nodes } whose entry screen (or root) has renderable content. ${
        hint.length > 0
          ? `Fix these and retry: ${hint}`
          : "Provide a root or entry screen with visible text, fields, media, controls, or data-backed bricks and retry."
      }`,
      shadow,
      issues,
      "Provide a root or entry screen with renderable content, then retry render_page.",
    );
  }
  const catalogViolation = treeCatalogViolation(tree, catalog, shadow);
  if (catalogViolation !== undefined) {
    return errorResult(
      "render_page",
      "invalid_input",
      catalogViolation.message,
      shadow,
      [],
      catalogViolation.nextAction,
    );
  }

  const note = issues.length > 0 ? ` note: dropped invalid node(s): ${issueHint(issues)}` : "";
  return okPatchResult(
    "render_page",
    `Page replaced.${note}`,
    shadow,
    [{ op: "replace", path: "", value: tree }],
    issues,
  );
}

function isRenderable(tree: FacetTree): boolean {
  return treeHasContent(tree);
}

function issueHint(issues: readonly string[]): string {
  if (issues.length === 0) return "";
  const shown = issues.slice(0, 5).join("; ");
  return issues.length > 5 ? `${shown}; ...(+${String(issues.length - 5)} more)` : shown;
}
