import { normalizeFacetAction } from "./action-validation.js";
import { printableKey, type IssueSink } from "./issues.js";
import type { ComponentNode, FacetAction, Tone } from "./nodes.js";
import {
  MAX_NODE_BODY_CHARS,
  MAX_NODE_LABEL_CHARS,
  boundedString,
  setText,
  setTone,
  setVariant,
} from "./component-validation-shared.js";

export type FeedbackComponentType = "badge" | "progress" | "alert" | "emptyState" | "loading";

export function sanitizeFeedbackComponentNode(
  id: string,
  raw: Record<string, unknown>,
  type: FeedbackComponentType,
  issues: IssueSink,
): ComponentNode | undefined {
  switch (type) {
    case "badge": {
      const label = boundedString(raw.label, id, "label", MAX_NODE_LABEL_CHARS, issues);
      if (label === undefined) {
        issues.push(`node "${printableKey(id)}": badge has no string label`);
        return undefined;
      }
      const node: { id: string; type: "badge"; label: string; tone?: Tone; variant?: string } = {
        id,
        type,
        label,
      };
      setTone(raw.tone, id, node, issues, true);
      setVariant(raw.variant, id, node, issues);
      return node;
    }
    case "progress": {
      const node: {
        id: string;
        type: "progress";
        value: number;
        label?: string;
        tone?: Tone;
        variant?: string;
      } = { id, type, value: progressValue(raw.value, id, issues) };
      setText(raw.label, id, "label", node, "label", MAX_NODE_LABEL_CHARS, issues);
      setTone(raw.tone, id, node, issues, true);
      setVariant(raw.variant, id, node, issues);
      return node;
    }
    case "alert": {
      const body = boundedString(raw.body, id, "body", MAX_NODE_BODY_CHARS, issues);
      if (body === undefined) {
        issues.push(`node "${printableKey(id)}": alert has no string body`);
        return undefined;
      }
      const node: {
        id: string;
        type: "alert";
        body: string;
        title?: string;
        tone?: Tone;
        variant?: string;
      } = { id, type, body };
      setText(raw.title, id, "title", node, "title", MAX_NODE_LABEL_CHARS, issues);
      setTone(raw.tone, id, node, issues, true);
      setVariant(raw.variant, id, node, issues);
      return node;
    }
    case "emptyState": {
      const node: {
        id: string;
        type: "emptyState";
        title?: string;
        body?: string;
        actionLabel?: string;
        variant?: string;
        onPress?: FacetAction;
      } = { id, type };
      setText(raw.title, id, "title", node, "title", MAX_NODE_LABEL_CHARS, issues);
      setText(raw.body, id, "body", node, "body", MAX_NODE_BODY_CHARS, issues);
      setText(
        raw.actionLabel,
        id,
        "actionLabel",
        node,
        "actionLabel",
        MAX_NODE_LABEL_CHARS,
        issues,
      );
      setVariant(raw.variant, id, node, issues);
      const onPress = normalizeFacetAction(raw.onPress, id, "onPress", issues);
      if (onPress !== undefined) node.onPress = onPress;
      return node;
    }
    case "loading": {
      const node: { id: string; type: "loading"; label?: string; variant?: string } = {
        id,
        type,
      };
      setText(raw.label, id, "label", node, "label", MAX_NODE_LABEL_CHARS, issues);
      setVariant(raw.variant, id, node, issues);
      return node;
    }
  }
}

function progressValue(value: unknown, id: string, issues: IssueSink): number {
  const raw = typeof value === "number" && Number.isFinite(value) ? value : 0;
  const clamped = Math.min(100, Math.max(0, raw));
  if (clamped !== raw) {
    issues.push(`node "${printableKey(id)}": progress value clamped to ${String(clamped)}`);
  }
  return clamped;
}
