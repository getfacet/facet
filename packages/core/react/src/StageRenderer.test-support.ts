import type { FacetNode, FacetTree, NodeId } from "@facet/core";

export const interactionTree = (
  nodes: Record<NodeId, FacetNode>,
  root: NodeId = "root",
): FacetTree => ({ root, nodes });

/** A two-screen tree: entry "home" (with a navigate button) and "about". */
export const interactionScreensTree = (): FacetTree => ({
  root: "root",
  nodes: {
    root: { id: "root", type: "box", children: ["rootText"] },
    rootText: { id: "rootText", type: "text", value: "plain root content" },
    home: { id: "home", type: "box", children: ["homeText", "goAbout"] },
    homeText: { id: "homeText", type: "text", value: "home content" },
    goAbout: {
      id: "goAbout",
      type: "box",
      onPress: { kind: "navigate", to: "about" },
      children: [],
    },
    about: { id: "about", type: "box", children: ["aboutText"] },
    aboutText: { id: "aboutText", type: "text", value: "about content" },
  },
  screens: { home: "home", about: "about" },
  entry: "home",
});

export function interactionPointerEvent(
  type: string,
  coords: { x?: number; y?: number } = {},
  options: { button?: number; isPrimary?: boolean; pointerId?: number } = {},
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    clientX: coords.x ?? 0,
    clientY: coords.y ?? 0,
    pointerId: options.pointerId ?? 1,
    button: options.button ?? 0,
    isPrimary: options.isPrimary ?? true,
  });
  return event;
}
