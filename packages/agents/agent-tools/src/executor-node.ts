import { isContainer, type FacetTheme, type FacetTree, type JsonPatchOperation } from "@facet/core";
import { authorErrorResult } from "./author-errors.js";
import { parseNodeInput } from "./executor-input.js";
import { childrenPath, nodeChildrenPath, nodePath, screenPath } from "./executor-paths.js";
import { errorResult, okMessageResult, okPatchResult } from "./executor-result.js";

export function executeAppendNode(
  input: Readonly<Record<string, unknown>>,
  shadow: FacetTree,
  theme: FacetTheme,
) {
  const parentId = input["parentId"];
  if (typeof parentId !== "string" || parentId.length === 0) {
    return errorResult(
      "append_node",
      "invalid_input",
      'error: append_node needs a non-empty string "parentId" (the container to append into)',
      shadow,
      [],
      "Pass parentId as an existing box node id. Use inspect_stage if you need to find one.",
    );
  }

  const parent = shadow.nodes[parentId];
  if (parent === undefined) {
    return errorResult(
      "append_node",
      "invalid_parent",
      `error: append_node — parent "${parentId}" does not exist yet. Create it first with render_page or set_node, or append into an existing node.`,
      shadow,
      [],
      "Inspect the stage and append under an existing visible box, or create the parent first.",
    );
  }
  if (!isContainer(parent)) {
    return errorResult(
      "append_node",
      "invalid_parent",
      `error: append_node — parent "${parentId}" is not a container`,
      shadow,
      [],
      "Choose an existing box node as parentId.",
    );
  }

  const node = parseNodeInput(input["node"], "append_node", shadow, theme);
  if ("authorValidation" in node) {
    return authorErrorResult("append_node", node.authorValidation, shadow);
  }
  if ("error" in node)
    return errorResult("append_node", "invalid_input", node.error, shadow, [], node.nextAction);
  if (node.facetNode.id === shadow.root) {
    return errorResult(
      "append_node",
      "invalid_input",
      `error: append_node — cannot replace the stage root "${shadow.root}". Use render_page for root-level restructures.`,
      shadow,
      [],
      "Use render_page for root-level restructures.",
    );
  }
  if (Object.hasOwn(shadow.nodes, node.facetNode.id)) {
    return errorResult(
      "append_node",
      "invalid_input",
      `error: append_node — node "${node.facetNode.id}" already exists. Use set_node to replace it or choose a new id.`,
      shadow,
      [],
      "Use set_node to replace the existing node, or choose a new id.",
    );
  }
  return okPatchResult(
    "append_node",
    `Appended "${node.facetNode.id}" under "${parentId}".`,
    shadow,
    [
      { op: "add", path: nodePath(node.facetNode.id), value: node.facetNode },
      { op: "add", path: childrenPath(parentId), value: node.facetNode.id },
    ],
    node.issues,
  );
}

export function executeSetNode(
  input: Readonly<Record<string, unknown>>,
  shadow: FacetTree,
  theme: FacetTheme,
) {
  const node = parseNodeInput(input["node"], "set_node", shadow, theme);
  if ("authorValidation" in node) {
    return authorErrorResult("set_node", node.authorValidation, shadow);
  }
  if ("error" in node)
    return errorResult("set_node", "invalid_input", node.error, shadow, [], node.nextAction);
  if (node.facetNode.id === shadow.root) {
    return errorResult(
      "set_node",
      "invalid_input",
      `error: set_node — cannot replace the stage root "${shadow.root}". Use render_page for root-level restructures.`,
      shadow,
      [],
      "Use render_page for root-level restructures.",
    );
  }
  // The entry screen's root must stay a container: a non-container replacement
  // would make the fold drop the screen, leaving no renderable entry.
  const entryTarget =
    shadow.screens !== undefined && shadow.entry !== undefined
      ? shadow.screens[shadow.entry]
      : undefined;
  if (node.facetNode.id === entryTarget && !isContainer(node.facetNode)) {
    return errorResult(
      "set_node",
      "invalid_input",
      `error: set_node — node "${node.facetNode.id}" is the entry screen root and must stay a container; render a replacement screen first`,
      shadow,
      [],
      "Replace the entry screen root only with a container node, or use render_page to restructure.",
    );
  }
  return okPatchResult(
    "set_node",
    `Set "${node.facetNode.id}".`,
    shadow,
    [{ op: "add", path: nodePath(node.facetNode.id), value: node.facetNode }],
    node.issues,
    { visibilityNodeIds: [node.facetNode.id] },
  );
}

export function executeRemoveNode(input: Readonly<Record<string, unknown>>, shadow: FacetTree) {
  const nodeId = input["nodeId"];
  if (typeof nodeId !== "string" || nodeId.length === 0) {
    return errorResult(
      "remove_node",
      "invalid_input",
      'error: remove_node needs a non-empty string "nodeId"',
      shadow,
      [],
      "Pass nodeId as a non-empty string. Use inspect_stage if you need to find one.",
    );
  }
  if (nodeId === shadow.root) {
    return errorResult(
      "remove_node",
      "invalid_input",
      `error: remove_node — cannot remove the stage root "${shadow.root}". Use render_page for root-level restructures.`,
      shadow,
      [],
      "Use render_page for root-level restructures.",
    );
  }
  if (!Object.hasOwn(shadow.nodes, nodeId)) {
    return errorResult(
      "remove_node",
      "invalid_input",
      `error: remove_node — node "${nodeId}" does not exist`,
      shadow,
      [],
      "Inspect the stage and remove an existing non-root node.",
    );
  }
  // Refuse to remove the entry screen's root: dropping it would leave the page
  // with no renderable entry, and there is no in-band repair path. The author must
  // render a replacement screen first.
  const entryTarget =
    shadow.screens !== undefined && shadow.entry !== undefined
      ? shadow.screens[shadow.entry]
      : undefined;
  if (entryTarget === nodeId) {
    return errorResult(
      "remove_node",
      "invalid_input",
      `error: remove_node — node "${nodeId}" is the entry screen root; render a replacement screen first`,
      shadow,
      [],
      "Render a replacement entry screen (render_page or set the entry screen's target) before removing this node.",
    );
  }
  // Detach the node from every parent that references it BEFORE removing it, so
  // the validated fold never sees a dangling child ref (which it would strip
  // with a warning, misreporting a fully successful removal). Non-entry screens
  // whose target is this node get their /screens entry removed for the same
  // reason — a dangling screen target folds away with a warning otherwise.
  const patches: JsonPatchOperation[] = [];
  for (const parent of Object.values(shadow.nodes)) {
    if (isContainer(parent) && parent.children.includes(nodeId)) {
      patches.push({
        op: "replace",
        path: nodeChildrenPath(parent.id),
        value: parent.children.filter((childId) => childId !== nodeId),
      });
    }
  }
  if (shadow.screens !== undefined) {
    for (const [name, target] of Object.entries(shadow.screens)) {
      if (target === nodeId) {
        patches.push({ op: "remove", path: screenPath(name) });
      }
    }
  }
  patches.push({ op: "remove", path: nodePath(nodeId) });
  return okPatchResult("remove_node", `Removed "${nodeId}".`, shadow, patches, [], {
    visibilityNodeIds: [nodeId],
  });
}

export function executeSay(input: Readonly<Record<string, unknown>>, shadow: FacetTree) {
  const text = input["text"];
  if (typeof text !== "string" || text.length === 0) {
    return errorResult(
      "say",
      "invalid_input",
      'error: say needs a non-empty string "text"',
      shadow,
      [],
      'Pass a non-empty string "text".',
    );
  }
  return okMessageResult("say", "Sent chat message.", shadow, [{ kind: "say", text }]);
}
