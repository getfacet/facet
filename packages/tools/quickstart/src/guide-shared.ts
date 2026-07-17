import type { FacetNode, FacetTree, NodeId } from "@facet/core";

export const QUICKSTART_NAV_ITEMS = [
  { label: "What is Facet?", to: "what" },
  { label: "Core Structure", to: "structure" },
  { label: "Design System", to: "system" },
  { label: "Use Cases", to: "usecases" },
] as const;

const NAV_ITEM_STYLE = {
  preset: "secondaryAction",
  active: { preset: "primaryAction" },
} as const;
const NAV_LABEL_STYLE = {
  preset: "actionLabel",
  active: { color: "accentForeground" },
} as const;

/** Builds one screen-local copy of the shared quickstart navigation subtree. */
export function buildQuickstartNavigation(namespace: string): FacetTree["nodes"] {
  const rootId = `qs.nav.${namespace}`;
  const nodes: Record<NodeId, FacetNode> = {
    [rootId]: {
      id: rootId,
      type: "box",
      style: { direction: "row", gap: "xs", wrap: true, width: "full" },
      children: QUICKSTART_NAV_ITEMS.map(({ to }) => `${rootId}.${to}`),
    },
  };
  for (const item of QUICKSTART_NAV_ITEMS) {
    const itemId = `${rootId}.${item.to}`;
    const labelId = `${itemId}.label`;
    nodes[itemId] = {
      id: itemId,
      type: "box",
      activeWhen: { screen: item.to },
      style: NAV_ITEM_STYLE,
      children: [labelId],
      onPress: { kind: "navigate", to: item.to },
    };
    nodes[labelId] = {
      id: labelId,
      type: "text",
      value: item.label,
      activeWhen: { screen: item.to },
      style: NAV_LABEL_STYLE,
    };
  }
  return nodes;
}
