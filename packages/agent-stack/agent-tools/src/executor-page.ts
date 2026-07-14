import {
  MAX_PATCH_OPS,
  expandComposition,
  isContainer,
  treeHasContent,
  validateTree,
  type FacetCatalog,
  type FacetComposition,
  type FacetTree,
  type JsonPatchOperation,
  type NodeId,
} from "@facet/core";
import { isRecord } from "./executor-input.js";
import { childrenPath, nodePath } from "./executor-paths.js";
import {
  compositionCatalogViolation,
  nodesCatalogViolation,
  preserveCatalogTheme,
  treeCatalogViolation,
} from "./executor-policy.js";
import { errorResult, okPatchResult } from "./executor-result.js";

const MAX_COMPOSITION_METADATA_CHARS = 2000;

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

export function executeUseComposition(
  input: Readonly<Record<string, unknown>>,
  shadow: FacetTree,
  compositions: readonly FacetComposition[],
  catalog: FacetCatalog | undefined,
) {
  const name = input["name"];
  if (typeof name !== "string" || name.length === 0) {
    return errorResult(
      "use_composition",
      "invalid_input",
      'error: use_composition needs a non-empty string "name" from the COMPOSITIONS list',
      shadow,
      [],
      "Pick a composition name from the COMPOSITIONS list and pass it as name.",
    );
  }

  const at = input["at"];
  if (!isRecord(at) || typeof at["parent"] !== "string" || at["parent"].length === 0) {
    return errorResult(
      "use_composition",
      "invalid_input",
      'error: use_composition needs at={ "parent": "<container node id>" }',
      shadow,
      [],
      'Pass at={ "parent": "<existing box, section, card, or form node id>" }.',
    );
  }

  const parent = at["parent"];
  const parentNode = shadow.nodes[parent];
  if (parentNode === undefined) {
    return errorResult(
      "use_composition",
      "invalid_parent",
      `error: use_composition — parent "${parent}" does not exist yet`,
      shadow,
      [],
      "Inspect the stage and choose an existing container parent before using a composition.",
    );
  }
  if (!isContainer(parentNode)) {
    return errorResult(
      "use_composition",
      "invalid_parent",
      `error: use_composition — parent "${parent}" is not a container`,
      shadow,
      [],
      "Choose an existing box, section, card, or form node as at.parent.",
    );
  }

  const policyViolation = compositionCatalogViolation(name, catalog);
  if (policyViolation !== undefined) {
    return errorResult(
      "use_composition",
      "invalid_composition",
      policyViolation.message,
      shadow,
      [],
      policyViolation.nextAction,
    );
  }

  const composition = compositions.find((candidate) => candidate.name === name);
  if (composition === undefined) {
    return errorResult(
      "use_composition",
      "invalid_composition",
      `error: use_composition — unknown composition "${name}". Pick a name from COMPOSITIONS.`,
      shadow,
      [],
      "Pick one of the advertised COMPOSITIONS names.",
    );
  }

  const expanded = expandComposition(
    composition,
    input["params"] ?? {},
    { parent },
    {
      existingIds: Object.keys(shadow.nodes),
      // Thread the loaded registry so a nested `{ use }` reference resolves to
      // primitives; the `nodesCatalogViolation` re-check below stays the
      // defensive backstop for any RESIDUAL unresolved reference.
      compositions,
    },
  );
  if (expanded.root === undefined) {
    const hint = issueHint(expanded.issues);
    return errorResult(
      "use_composition",
      "invalid_composition",
      `error: use_composition — could not expand "${name}"${hint.length > 0 ? `: ${hint}` : ""}`,
      shadow,
      expanded.issues,
      "Fix the composition params or choose another composition, then retry use_composition.",
    );
  }

  // Catalog-INDEPENDENT residual-reference backstop (RISK-INV-1), symmetric with
  // the Stage path's `isResidualReference`: core resolves every `{ use }` to
  // primitives at expand, so this never fires — but `nodesCatalogViolation` below
  // is inert when `catalog === undefined`, so a residual reference must be caught
  // here regardless of catalog presence, never emitted into the patch.
  const residualRef = Object.values(expanded.nodes).find((node) => {
    const raw = node as { readonly type?: unknown; readonly use?: unknown };
    return raw.type === undefined && typeof raw.use === "string";
  });
  if (residualRef !== undefined) {
    return errorResult(
      "use_composition",
      "invalid_composition",
      `error: use_composition — expansion of "${name}" left an unresolved composition reference; refused`,
      shadow,
      expanded.issues,
      "Ensure every referenced composition is in the catalog, then retry use_composition.",
    );
  }

  const catalogViolation = nodesCatalogViolation(Object.values(expanded.nodes), catalog);
  if (catalogViolation !== undefined) {
    return errorResult(
      "use_composition",
      "invalid_composition",
      catalogViolation.message,
      shadow,
      expanded.issues,
      catalogViolation.nextAction,
    );
  }

  const expansionPatchOps = Object.keys(expanded.nodes).length + 1;
  if (expansionPatchOps > MAX_PATCH_OPS) {
    return errorResult(
      "use_composition",
      "patch_limit",
      `error: use_composition — expanded "${name}" would exceed the patch op cap (${String(MAX_PATCH_OPS)}) for this streamed batch`,
      shadow,
      expanded.issues,
      "Split the page change into smaller edits or use a smaller composition.",
    );
  }

  const patches: JsonPatchOperation[] = Object.values(expanded.nodes).map((node) => ({
    op: "add",
    path: nodePath(node.id),
    value: node,
  }));
  patches.push({ op: "add", path: childrenPath(parent), value: expanded.root });

  const note = expanded.issues.length > 0 ? ` note: ${issueHint(expanded.issues)}` : "";
  const metadata = compositionMetadata(expanded.root, expanded.slots, expanded.ids);
  return okPatchResult(
    "use_composition",
    `Used composition "${name}".${note}`,
    shadow,
    patches,
    expanded.issues,
    { data: metadata },
  );
}

/**
 * Serialize the minted composition ids and slots as always-valid JSON bounded to
 * {@link MAX_COMPOSITION_METADATA_CHARS}. EVERY part of the envelope participates
 * in the budget — not just `ids` — so a slots-heavy payload can never serialize
 * past the cap and collapse to `{"truncated":true}` downstream in
 * `boundedData`. `root` is always kept (a bounded node id); `slots` entries are
 * added first, then `ids` entries, each one at a time and dropped when it would
 * push the envelope over the cap. Dropped counts surface as `slotsOmitted` /
 * `idsOmitted`, INCLUDED ONLY WHEN GREATER THAN ZERO so a payload that fully fits
 * carries neither counter. Even the first entry of either map can be dropped when
 * the preceding content already fills the budget. The cap ({@link
 * MAX_COMPOSITION_METADATA_CHARS} = 2000) sits below the observation layer's 2048
 * `MAX_DATA_CHARS`, so `boundedData` never fires on this well-formed output and
 * `observation.data` stays valid JSON ≤ 2048.
 */
function compositionMetadata(
  root: NodeId,
  slots: Readonly<Record<string, NodeId>>,
  ids: Readonly<Record<string, NodeId>>,
): string {
  const slotEntries = Object.entries(slots);
  const idEntries = Object.entries(ids);
  const keptSlots: Record<string, NodeId> = {};
  const keptIds: Record<string, NodeId> = {};
  const pack = (): string => {
    const envelope: {
      root: NodeId;
      slots: Record<string, NodeId>;
      ids: Record<string, NodeId>;
      slotsOmitted?: number;
      idsOmitted?: number;
    } = { root, slots: keptSlots, ids: keptIds };
    const slotsOmitted = slotEntries.length - Object.keys(keptSlots).length;
    const idsOmitted = idEntries.length - Object.keys(keptIds).length;
    if (slotsOmitted > 0) envelope.slotsOmitted = slotsOmitted;
    if (idsOmitted > 0) envelope.idsOmitted = idsOmitted;
    return JSON.stringify(envelope);
  };
  // Root is always kept. Only theoretical: if even the root-only envelope (with
  // every slot and id counted as omitted) overflows — root is a bounded node id —
  // fall back to a minimal valid object instead of an over-cap payload.
  if (pack().length > MAX_COMPOSITION_METADATA_CHARS) {
    return JSON.stringify({ root, truncated: true });
  }
  for (const [key, value] of slotEntries) {
    keptSlots[key] = value;
    if (pack().length > MAX_COMPOSITION_METADATA_CHARS) {
      delete keptSlots[key];
      break;
    }
  }
  for (const [key, value] of idEntries) {
    keptIds[key] = value;
    if (pack().length > MAX_COMPOSITION_METADATA_CHARS) {
      delete keptIds[key];
      break;
    }
  }
  return pack();
}

function isRenderable(tree: FacetTree): boolean {
  return treeHasContent(tree);
}

function issueHint(issues: readonly string[]): string {
  if (issues.length === 0) return "";
  const shown = issues.slice(0, 5).join("; ");
  return issues.length > 5 ? `${shown}; ...(+${String(issues.length - 5)} more)` : shown;
}
