import { type FacetCatalog, type FacetNode, type FacetTree } from "@facet/core";
import { COMPONENT_NODE_TYPE_SET, PRIMITIVE_NODE_TYPES, nodeVariant } from "./executor-registry.js";

interface CatalogPolicyViolation {
  readonly message: string;
  readonly nextAction: string;
}

export function treeCatalogViolation(
  tree: FacetTree,
  catalog: FacetCatalog | undefined,
  shadow: FacetTree,
): CatalogPolicyViolation | undefined {
  const nodeViolation = nodesCatalogViolation(Object.values(tree.nodes), catalog);
  if (nodeViolation !== undefined) return nodeViolation;
  return tree.theme === undefined
    ? undefined
    : themeCatalogViolation(tree.theme, catalog, shadow.theme);
}

export function preserveCatalogTheme(
  tree: FacetTree,
  catalog: FacetCatalog | undefined,
  shadow: FacetTree,
): FacetTree {
  if (tree.theme !== undefined) return tree;
  if (catalog?.theme.switchPolicy !== "locked") return tree;
  const theme = catalog.theme.active ?? shadow.theme;
  if (theme === undefined) return tree;
  if (themeCatalogViolation(theme, catalog, shadow.theme) !== undefined) return tree;
  return { ...tree, theme };
}

export function nodesCatalogViolation(
  nodes: readonly FacetNode[],
  catalog: FacetCatalog | undefined,
): CatalogPolicyViolation | undefined {
  for (const node of nodes) {
    const violation = nodeCatalogViolation(node, catalog);
    if (violation !== undefined) return violation;
  }
  return undefined;
}

export function nodeCatalogViolation(
  node: FacetNode,
  catalog: FacetCatalog | undefined,
): CatalogPolicyViolation | undefined {
  if (catalog === undefined) return undefined;
  const policy = catalogPolicyEntryForNode(node, catalog);
  if (policy === undefined) {
    if (PRIMITIVE_NODE_TYPES.has(node.type) && catalog.primitiveFallback === "allowed") {
      return undefined;
    }
    return {
      message: `error: catalog policy rejected node type "${node.type}". Allowed node types: ${catalogAllowedNodeTypes(catalog)}.`,
      nextAction: "Use an allowed catalog component or permitted primitive fallback.",
    };
  }

  const variant = nodeVariant(node);
  if (
    variant !== undefined &&
    policy.variants !== undefined &&
    !policy.variants.includes(variant)
  ) {
    return {
      message: `error: catalog policy rejected variant "${variant}" for node type "${node.type}". Allowed variants: ${policy.variants.join(", ")}.`,
      nextAction: `Use an allowed "${node.type}" variant or omit variant for the default recipe.`,
    };
  }
  const tone = nodeTone(node);
  if (
    variant === undefined &&
    tone !== undefined &&
    policy.variants !== undefined &&
    !policy.variants.includes(tone)
  ) {
    return {
      message: `error: catalog policy rejected tone "${tone}" as a recipe selector for node type "${node.type}". Allowed variants: ${policy.variants.join(", ")}.`,
      nextAction: `Use an allowed "${node.type}" variant, or omit tone when the catalog does not advertise that recipe.`,
    };
  }
  return undefined;
}

function catalogPolicyEntryForNode(
  node: FacetNode,
  catalog: FacetCatalog,
): FacetCatalog["bricks"][number] | NonNullable<FacetCatalog["components"]>[number] | undefined {
  if (COMPONENT_NODE_TYPE_SET.has(node.type)) {
    const component = catalog.components?.find((candidate) => candidate.type === node.type);
    if (component !== undefined) return component;
    if (catalog.components !== undefined && node.type !== "stat") return undefined;
  }
  return catalog.bricks.find((candidate) => candidate.type === node.type);
}

export function themeCatalogViolation(
  name: string,
  catalog: FacetCatalog | undefined,
  currentTheme: string | undefined,
): CatalogPolicyViolation | undefined {
  if (catalog === undefined) return undefined;
  const activeTheme = catalog.theme.active;
  if (catalog.theme.switchPolicy === "locked") {
    if (name === activeTheme || (activeTheme === undefined && name === currentTheme)) {
      return undefined;
    }
    return {
      message: `error: catalog policy locked theme${activeTheme === undefined ? "" : ` to "${activeTheme}"`}; rejected theme "${name}".`,
      nextAction:
        "Keep the active catalog theme; do not call set_theme unless the catalog allows theme switching.",
    };
  }
  if (catalog.theme.allowed !== undefined && !catalog.theme.allowed.includes(name)) {
    return {
      message: `error: catalog policy rejected theme "${name}". Allowed themes: ${catalog.theme.allowed.join(", ")}.`,
      nextAction: "Pick a theme allowed by the active catalog.",
    };
  }
  return undefined;
}

function nodeTone(node: FacetNode): string | undefined {
  return "tone" in node && typeof node.tone === "string" ? node.tone : undefined;
}

function catalogAllowedNodeTypes(catalog: FacetCatalog): string {
  const allowed = new Set<string>();
  if (catalog.components === undefined) {
    for (const brick of catalog.bricks) allowed.add(brick.type);
  } else {
    for (const component of catalog.components) allowed.add(component.type);
    for (const brick of catalog.bricks) {
      if (PRIMITIVE_NODE_TYPES.has(brick.type) || brick.type === "stat") allowed.add(brick.type);
    }
  }
  if (catalog.primitiveFallback === "allowed") {
    for (const type of PRIMITIVE_NODE_TYPES) allowed.add(type);
  }
  return Array.from(allowed).join(", ");
}
