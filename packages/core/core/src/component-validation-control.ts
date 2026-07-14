import { normalizeFacetAction } from "./action-validation.js";
import { isPlainObject, printableKey, type IssueSink } from "./issues.js";
import {
  INPUT_KINDS,
  type ComponentNode,
  type FacetAction,
  type InputKind,
  type FilterBarFilter,
  type NavItem,
  type Tone,
} from "./nodes.js";
import {
  MAX_COMPONENT_ARRAY_ITEMS,
  MAX_NODE_BODY_CHARS,
  MAX_NODE_LABEL_CHARS,
  MAX_TABS_ITEMS,
  boundedArray,
  boundedString,
  capArray,
  childRefs,
  isScalar,
  setText,
  setTone,
  setVariant,
  tokenValue,
} from "./component-validation-shared.js";

export type ControlComponentType = "button" | "tabs" | "nav" | "form" | "filterBar";

export function sanitizeControlComponentNode(
  id: string,
  raw: Record<string, unknown>,
  type: ControlComponentType,
  issues: IssueSink,
): ComponentNode | undefined {
  switch (type) {
    case "button": {
      const label = boundedString(raw.label, id, "label", MAX_NODE_LABEL_CHARS, issues);
      if (label === undefined) {
        issues.push(`node "${printableKey(id)}": button has no string label`);
        return undefined;
      }
      const node: {
        id: string;
        type: "button";
        label: string;
        variant?: string;
        tone?: Tone;
        disabled?: boolean;
        onPress?: FacetAction;
        onHold?: FacetAction;
      } = { id, type, label };
      setVariant(raw.variant, id, node, issues);
      setTone(raw.tone, id, node, issues, true);
      const onPress = normalizeFacetAction(raw.onPress, id, "onPress", issues);
      if (onPress !== undefined) node.onPress = onPress;
      const onHold = normalizeFacetAction(raw.onHold, id, "onHold", issues);
      if (onHold !== undefined) node.onHold = onHold;
      if (typeof raw.disabled === "boolean") node.disabled = raw.disabled;
      return node;
    }
    case "tabs": {
      const items: { label: string; to: string }[] = [];
      if (Array.isArray(raw.items)) {
        for (const item of capArray(raw.items, MAX_TABS_ITEMS, id, "items", issues)) {
          if (!isPlainObject(item)) continue;
          const label = boundedString(item.label, id, "tab label", MAX_NODE_LABEL_CHARS, issues);
          if (label !== undefined && typeof item.to === "string")
            items.push({ label, to: item.to });
        }
      }
      const node: { id: string; type: "tabs"; items: typeof items; variant?: string } = {
        id,
        type,
        items,
      };
      setVariant(raw.variant, id, node, issues);
      return node;
    }
    case "nav": {
      const items: NavItem[] = [];
      for (const item of boundedArray(raw.items, id, "items", issues)) {
        if (!isPlainObject(item)) continue;
        const label = boundedString(item.label, id, "nav label", MAX_NODE_LABEL_CHARS, issues);
        if (label !== undefined && typeof item.to === "string") items.push({ label, to: item.to });
      }
      const node: { id: string; type: "nav"; items: readonly NavItem[]; variant?: string } = {
        id,
        type,
        items,
      };
      setVariant(raw.variant, id, node, issues);
      return node;
    }
    case "form": {
      const node: {
        id: string;
        type: "form";
        title?: string;
        body?: string;
        submitLabel?: string;
        variant?: string;
        onSubmit?: FacetAction;
        children: readonly string[];
      } = { id, type, children: childRefs(raw.children) };
      setText(raw.title, id, "title", node, "title", MAX_NODE_LABEL_CHARS, issues);
      setText(raw.body, id, "body", node, "body", MAX_NODE_BODY_CHARS, issues);
      setText(
        raw.submitLabel,
        id,
        "submitLabel",
        node,
        "submitLabel",
        MAX_NODE_LABEL_CHARS,
        issues,
      );
      setVariant(raw.variant, id, node, issues);
      const onSubmit = normalizeFacetAction(raw.onSubmit, id, "onSubmit", issues);
      if (onSubmit !== undefined) node.onSubmit = onSubmit;
      return node;
    }
    case "filterBar": {
      const filters: FilterBarFilter[] = [];
      for (const item of boundedArray(raw.filters, id, "filters", issues)) {
        if (!isPlainObject(item)) continue;
        const name = boundedString(item.name, id, "filter name", MAX_NODE_LABEL_CHARS, issues);
        const label = boundedString(item.label, id, "filter label", MAX_NODE_LABEL_CHARS, issues);
        if (name === undefined || label === undefined) continue;
        const filter: {
          name: string;
          label: string;
          input?: InputKind;
          options?: readonly string[];
          value?: string | number | boolean;
        } = { name, label };
        const input = tokenValue<InputKind>(item.input, INPUT_KINDS);
        if (input !== undefined) filter.input = input;
        const options = stringList(item.options, id, "filter options", issues);
        if (options !== undefined) filter.options = options;
        if (isScalar(item.value)) filter.value = item.value;
        filters.push(filter);
      }
      const node: {
        id: string;
        type: "filterBar";
        filters: readonly FilterBarFilter[];
        variant?: string;
        onChange?: FacetAction;
      } = { id, type, filters };
      setVariant(raw.variant, id, node, issues);
      const onChange = normalizeFacetAction(raw.onChange, id, "onChange", issues);
      if (onChange !== undefined) node.onChange = onChange;
      return node;
    }
  }
}

function stringList(
  value: unknown,
  id: string,
  field: string,
  issues: IssueSink,
): readonly string[] | undefined {
  const out: string[] = [];
  for (const item of boundedArray(value, id, field, issues, MAX_COMPONENT_ARRAY_ITEMS)) {
    const text = boundedString(item, id, field, MAX_NODE_LABEL_CHARS, issues);
    if (text !== undefined) out.push(text);
  }
  return out.length > 0 ? out : undefined;
}
