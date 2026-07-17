import { treeHasContent, validateAuthorTree, type FacetTheme, type FacetTree } from "@facet/core";
import { authorErrorResult } from "./author-errors.js";
import { errorResult, okPatchResult } from "./executor-result.js";

export function executeRenderPage(
  input: Readonly<Record<string, unknown>>,
  shadow: FacetTree,
  theme: FacetTheme,
) {
  const strict = validateAuthorTree(input["tree"], theme);
  if (strict.value === undefined) {
    return authorErrorResult("render_page", strict, shadow);
  }
  const tree = strict.value;
  if (!isRenderable(tree)) {
    return errorResult(
      "render_page",
      "invalid_tree",
      "error: render_page needs a full tree { root, nodes } whose entry screen (or root) has renderable content. Provide a root or entry screen with visible text, fields, media, controls, or data-backed bricks and retry.",
      shadow,
      [],
      "Provide a root or entry screen with renderable content, then retry render_page.",
    );
  }
  return okPatchResult(
    "render_page",
    "Page replaced.",
    shadow,
    [{ op: "replace", path: "", value: tree }],
    [],
  );
}

function isRenderable(tree: FacetTree): boolean {
  return treeHasContent(tree);
}
