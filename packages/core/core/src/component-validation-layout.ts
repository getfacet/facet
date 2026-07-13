import { normalizeFacetAction } from "./action-validation.js";
import type { IssueSink } from "./issues.js";
import type { ComponentNode, FacetAction, Tone } from "./nodes.js";
import {
  MAX_NODE_BODY_CHARS,
  MAX_NODE_LABEL_CHARS,
  childRefs,
  setText,
  setTone,
  setVariant,
} from "./component-validation-shared.js";

export type LayoutComponentType = "section" | "card" | "divider";

export function sanitizeLayoutComponentNode(
  id: string,
  raw: Record<string, unknown>,
  type: LayoutComponentType,
  issues: IssueSink,
): ComponentNode {
  switch (type) {
    case "section": {
      const node: {
        id: string;
        type: "section";
        title?: string;
        eyebrow?: string;
        body?: string;
        variant?: string;
        children: readonly string[];
      } = { id, type, children: childRefs(raw.children) };
      setText(raw.title, id, "title", node, "title", MAX_NODE_LABEL_CHARS, issues);
      setText(raw.eyebrow, id, "eyebrow", node, "eyebrow", MAX_NODE_LABEL_CHARS, issues);
      setText(raw.body, id, "body", node, "body", MAX_NODE_BODY_CHARS, issues);
      setVariant(raw.variant, id, node, issues);
      return node;
    }
    case "card": {
      const node: {
        id: string;
        type: "card";
        title?: string;
        body?: string;
        variant?: string;
        tone?: Tone;
        onPress?: FacetAction;
        onHold?: FacetAction;
        children: readonly string[];
      } = { id, type, children: childRefs(raw.children) };
      setText(raw.title, id, "title", node, "title", MAX_NODE_LABEL_CHARS, issues);
      setText(raw.body, id, "body", node, "body", MAX_NODE_BODY_CHARS, issues);
      setVariant(raw.variant, id, node, issues);
      setTone(raw.tone, id, node, issues, true);
      const onPress = normalizeFacetAction(raw.onPress, id, "onPress", issues);
      if (onPress !== undefined) node.onPress = onPress;
      const onHold = normalizeFacetAction(raw.onHold, id, "onHold", issues);
      if (onHold !== undefined) node.onHold = onHold;
      return node;
    }
    case "divider": {
      const node: { id: string; type: "divider"; label?: string; variant?: string } = {
        id,
        type,
      };
      setText(raw.label, id, "label", node, "label", MAX_NODE_LABEL_CHARS, issues);
      setVariant(raw.variant, id, node, issues);
      return node;
    }
  }
}
