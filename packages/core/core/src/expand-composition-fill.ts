import type { IssueSink } from "./issues.js";
import type { FacetAction, FacetNode, NodeId } from "./nodes.js";
import { MAX_FIELD_VALUE_CHARS } from "./protocol.js";
import { SLOT_MARKER_RE, type FacetComposition } from "./validate.js";

const EMPTY_SLOTS: Readonly<Record<string, string>> = Object.freeze(
  Object.create(null),
) as Readonly<Record<string, string>>;

export function fillComposition(
  composition: FacetComposition,
  params: Readonly<Record<string, unknown>>,
  issues: IssueSink,
) {
  const nodes: Record<string, FacetNode> = {};
  for (const [id, node] of Object.entries(composition.nodes)) {
    const defaults = composition.slots ?? EMPTY_SLOTS;
    nodes[id] = fillNodeActions(fillNode(node, defaults, params, issues), defaults, params, issues);
  }
  const filled: {
    name: string;
    description?: string;
    metadata?: typeof composition.metadata;
    slots?: Readonly<Record<string, string>>;
    root: NodeId;
    nodes: Record<string, FacetNode>;
  } = { name: composition.name, root: composition.root, nodes };
  if (composition.description !== undefined) filled.description = composition.description;
  if (composition.metadata !== undefined) filled.metadata = composition.metadata;
  if (composition.slots !== undefined) filled.slots = composition.slots;
  return filled;
}

function fillNode(
  node: FacetNode,
  defaults: Readonly<Record<string, string>>,
  params: Readonly<Record<string, unknown>>,
  issues: IssueSink,
): FacetNode {
  switch (node.type) {
    case "box":
      return node;
    case "text":
      return { ...node, value: fillString(node.value, defaults, params, issues) };
    case "media": {
      const next = { ...node, src: fillString(node.src, defaults, params, issues) };
      if (node.alt !== undefined) next.alt = fillString(node.alt, defaults, params, issues);
      if (node.poster !== undefined) {
        next.poster = fillString(node.poster, defaults, params, issues);
      }
      return next;
    }
    case "field": {
      const next = { ...node, name: fillString(node.name, defaults, params, issues) };
      if (node.label !== undefined) next.label = fillString(node.label, defaults, params, issues);
      if (node.placeholder !== undefined) {
        next.placeholder = fillString(node.placeholder, defaults, params, issues);
      }
      if (node.options !== undefined) {
        next.options = node.options.map((option) => fillString(option, defaults, params, issues));
      }
      return next;
    }
    case "button": {
      return { ...node, label: fillString(node.label, defaults, params, issues) };
    }
    case "section": {
      const next = { ...node };
      if (node.title !== undefined) next.title = fillString(node.title, defaults, params, issues);
      if (node.eyebrow !== undefined) {
        next.eyebrow = fillString(node.eyebrow, defaults, params, issues);
      }
      if (node.body !== undefined) next.body = fillString(node.body, defaults, params, issues);
      return next;
    }
    case "card": {
      const next = { ...node };
      if (node.title !== undefined) next.title = fillString(node.title, defaults, params, issues);
      if (node.body !== undefined) next.body = fillString(node.body, defaults, params, issues);
      return next;
    }
    case "tabs": {
      return {
        ...node,
        items: node.items.map((item) => ({
          label: fillString(item.label, defaults, params, issues),
          to: fillString(item.to, defaults, params, issues),
        })),
      };
    }
    case "nav": {
      return {
        ...node,
        items: node.items.map((item) => ({
          label: fillString(item.label, defaults, params, issues),
          to: fillString(item.to, defaults, params, issues),
        })),
      };
    }
    case "table": {
      const next = {
        ...node,
        columns: node.columns.map((column) => ({
          ...column,
          label: fillString(column.label, defaults, params, issues),
        })),
        rows: node.rows.map((row) => {
          const next: Record<string, string | number | boolean> = {};
          for (const [key, value] of Object.entries(row)) {
            next[key] =
              typeof value === "string" ? fillString(value, defaults, params, issues) : value;
          }
          return next;
        }),
      };
      if (node.caption !== undefined) {
        next.caption = fillString(node.caption, defaults, params, issues);
      }
      return next;
    }
    case "chart": {
      const next = { ...node };
      if (node.title !== undefined) next.title = fillString(node.title, defaults, params, issues);
      if (node.labels !== undefined) {
        next.labels = node.labels.map((label) => fillString(label, defaults, params, issues));
      }
      next.series = node.series.map((series) => ({
        ...series,
        label: fillString(series.label, defaults, params, issues),
      }));
      return next;
    }
    case "metric":
    case "stat": {
      const next = {
        ...node,
        label: fillString(node.label, defaults, params, issues),
        value: fillString(node.value, defaults, params, issues),
      };
      if (node.delta !== undefined) next.delta = fillString(node.delta, defaults, params, issues);
      return next;
    }
    case "keyValue": {
      return {
        ...node,
        items: node.items.map((item) => {
          const next = {
            ...item,
            label: fillString(item.label, defaults, params, issues),
            value: fillString(item.value, defaults, params, issues),
          };
          if (item.key !== undefined) next.key = fillString(item.key, defaults, params, issues);
          return next;
        }),
      };
    }
    case "badge":
      return { ...node, label: fillString(node.label, defaults, params, issues) };
    case "progress": {
      const next = { ...node };
      if (node.label !== undefined) next.label = fillString(node.label, defaults, params, issues);
      return next;
    }
    case "alert": {
      const next = { ...node, body: fillString(node.body, defaults, params, issues) };
      if (node.title !== undefined) next.title = fillString(node.title, defaults, params, issues);
      return next;
    }
    case "list": {
      return {
        ...node,
        items: node.items.map((item) => {
          const next = { ...item, title: fillString(item.title, defaults, params, issues) };
          if (item.body !== undefined) next.body = fillString(item.body, defaults, params, issues);
          return next;
        }),
      };
    }
    case "divider": {
      const next = { ...node };
      if (node.label !== undefined) next.label = fillString(node.label, defaults, params, issues);
      return next;
    }
    case "form": {
      const next = { ...node };
      if (node.title !== undefined) next.title = fillString(node.title, defaults, params, issues);
      if (node.body !== undefined) next.body = fillString(node.body, defaults, params, issues);
      if (node.submitLabel !== undefined) {
        next.submitLabel = fillString(node.submitLabel, defaults, params, issues);
      }
      return next;
    }
    case "search": {
      const next = { ...node, name: fillString(node.name, defaults, params, issues) };
      if (node.label !== undefined) next.label = fillString(node.label, defaults, params, issues);
      if (node.placeholder !== undefined) {
        next.placeholder = fillString(node.placeholder, defaults, params, issues);
      }
      if (node.value !== undefined) next.value = fillString(node.value, defaults, params, issues);
      if (node.submitLabel !== undefined) {
        next.submitLabel = fillString(node.submitLabel, defaults, params, issues);
      }
      return next;
    }
    case "filterBar": {
      return {
        ...node,
        filters: node.filters.map((filter) => ({
          ...filter,
          name: fillString(filter.name, defaults, params, issues),
          label: fillString(filter.label, defaults, params, issues),
          ...(filter.options === undefined
            ? {}
            : {
                options: filter.options.map((option) =>
                  fillString(option, defaults, params, issues),
                ),
              }),
          ...(typeof filter.value === "string"
            ? { value: fillString(filter.value, defaults, params, issues) }
            : {}),
        })),
      };
    }
    case "emptyState": {
      const next = { ...node };
      if (node.title !== undefined) next.title = fillString(node.title, defaults, params, issues);
      if (node.body !== undefined) next.body = fillString(node.body, defaults, params, issues);
      if (node.actionLabel !== undefined) {
        next.actionLabel = fillString(node.actionLabel, defaults, params, issues);
      }
      return next;
    }
    case "loading": {
      const next = { ...node };
      if (node.label !== undefined) next.label = fillString(node.label, defaults, params, issues);
      return next;
    }
  }
}

function fillString(
  value: string,
  defaults: Readonly<Record<string, string>>,
  params: Readonly<Record<string, unknown>>,
  issues: IssueSink,
): string {
  const match = SLOT_MARKER_RE.exec(value);
  const name = match?.[1];
  if (name === undefined) return value;

  if (Object.prototype.hasOwnProperty.call(params, name)) {
    const raw = params[name];
    if (typeof raw !== "string") {
      issues.push(`composition param "${name}" is not a string; using default`);
    } else if (SLOT_MARKER_RE.test(raw)) {
      // A model echoing the template literal back as the value is a missing
      // param, not a fill — fall through to the slot's declared default.
      issues.push(`composition param "${name}" echoed the slot marker; using default`);
    } else if (raw.length > MAX_FIELD_VALUE_CHARS) {
      issues.push(`composition param "${name}" truncated to ${MAX_FIELD_VALUE_CHARS} characters`);
      return raw.slice(0, MAX_FIELD_VALUE_CHARS);
    } else {
      return raw;
    }
  }
  return Object.prototype.hasOwnProperty.call(defaults, name) ? (defaults[name] ?? "") : "";
}

export function collectSlotSources(composition: FacetComposition): ReadonlyMap<string, NodeId> {
  const sources = new Map<string, NodeId>();
  for (const [id, node] of Object.entries(composition.nodes)) {
    for (const value of [...nodeStringLeaves(node), ...nodeActionStrings(node)]) {
      const name = SLOT_MARKER_RE.exec(value)?.[1];
      if (name !== undefined && !sources.has(name)) sources.set(name, id);
    }
  }
  return sources;
}

const ACTION_KEYS = ["onPress", "onHold", "onSubmit", "onChange"] as const;

type ActionBearing = Partial<Record<(typeof ACTION_KEYS)[number], FacetAction>>;

function nodeActions(node: FacetNode): readonly FacetAction[] {
  const source = node as ActionBearing;
  const actions: FacetAction[] = [];
  for (const key of ACTION_KEYS) {
    const action = source[key];
    if (action !== undefined) actions.push(action);
  }
  return actions;
}

/**
 * Every string an action carries — fillable strings (navigate `to`, agent
 * `name`, string payload values) plus non-fillable node-id references
 * (toggle `target`, agent `collect`), so the unfilled-marker refusal gate
 * sees markers in ref fields too.
 */
export function nodeActionStrings(node: FacetNode): readonly string[] {
  const out: string[] = [];
  for (const action of nodeActions(node)) {
    if (action.kind === "navigate") {
      out.push(action.to);
      continue;
    }
    if (action.kind === "toggle") {
      out.push(action.target);
      continue;
    }
    out.push(action.name);
    if (action.payload !== undefined) {
      for (const value of Object.values(action.payload)) {
        if (typeof value === "string") out.push(value);
      }
    }
    if (action.collect !== undefined) out.push(action.collect);
  }
  return out;
}

function fillAction(
  action: FacetAction,
  defaults: Readonly<Record<string, string>>,
  params: Readonly<Record<string, unknown>>,
  issues: IssueSink,
): FacetAction {
  if (action.kind === "navigate") {
    const to = fillString(action.to, defaults, params, issues);
    return to === action.to ? action : { ...action, to };
  }
  // toggle.target and agent.collect are node-id references consumed by
  // remapAction — never param-filled.
  if (action.kind === "toggle") return action;
  let next: FacetAction = action;
  const name = fillString(action.name, defaults, params, issues);
  if (name !== action.name) next = { ...next, name };
  if (action.payload !== undefined) {
    let changed = false;
    const payload: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(action.payload)) {
      if (typeof value === "string") {
        const filled = fillString(value, defaults, params, issues);
        payload[key] = filled;
        if (filled !== value) changed = true;
      } else {
        payload[key] = value;
      }
    }
    if (changed) next = { ...next, payload };
  }
  return next;
}

function fillNodeActions(
  node: FacetNode,
  defaults: Readonly<Record<string, string>>,
  params: Readonly<Record<string, unknown>>,
  issues: IssueSink,
): FacetNode {
  const source = node as ActionBearing;
  let next: FacetNode | undefined;
  for (const key of ACTION_KEYS) {
    const action = source[key];
    if (action === undefined) continue;
    const filled = fillAction(action, defaults, params, issues);
    if (filled === action) continue;
    next = next ?? { ...node };
    (next as ActionBearing)[key] = filled;
  }
  return next ?? node;
}

export function nodeStringLeaves(node: FacetNode): readonly string[] {
  switch (node.type) {
    case "box":
      return [];
    case "text":
      return [node.value];
    case "media":
      return [node.src, node.alt, node.poster].filter(
        (value): value is string => value !== undefined,
      );
    case "field":
      return [node.name, node.label, node.placeholder, ...(node.options ?? [])].filter(
        (value): value is string => value !== undefined,
      );
    case "button":
      return [node.label];
    case "section":
      return [node.title, node.eyebrow, node.body].filter(
        (value): value is string => value !== undefined,
      );
    case "card":
      return [node.title, node.body].filter((value): value is string => value !== undefined);
    case "tabs":
    case "nav":
      return node.items.flatMap((item) => [item.label, item.to]);
    case "table":
      return [
        node.caption,
        ...node.columns.map((column) => column.label),
        ...node.rows.flatMap((row) =>
          Object.values(row).filter((value): value is string => typeof value === "string"),
        ),
      ].filter((value): value is string => value !== undefined);
    case "chart":
      return [
        node.title,
        ...(node.labels ?? []),
        ...node.series.map((series) => series.label),
      ].filter((value): value is string => value !== undefined);
    case "metric":
    case "stat":
      return [node.label, node.value, node.delta].filter(
        (value): value is string => value !== undefined,
      );
    case "keyValue":
      return node.items.flatMap((item) =>
        [item.key, item.label, item.value].filter((value): value is string => value !== undefined),
      );
    case "badge":
      return [node.label];
    case "progress":
      return [node.label].filter((value): value is string => value !== undefined);
    case "alert":
      return [node.title, node.body].filter((value): value is string => value !== undefined);
    case "list":
      return node.items.flatMap((item) =>
        [item.title, item.body].filter((value): value is string => value !== undefined),
      );
    case "divider":
      return [node.label].filter((value): value is string => value !== undefined);
    case "form":
      return [node.title, node.body, node.submitLabel].filter(
        (value): value is string => value !== undefined,
      );
    case "search":
      return [node.name, node.label, node.placeholder, node.value, node.submitLabel].filter(
        (value): value is string => value !== undefined,
      );
    case "filterBar":
      return node.filters.flatMap((filter) => [
        filter.name,
        filter.label,
        ...(filter.options ?? []),
        ...(typeof filter.value === "string" ? [filter.value] : []),
      ]);
    case "emptyState":
      return [node.title, node.body, node.actionLabel].filter(
        (value): value is string => value !== undefined,
      );
    case "loading":
      return [node.label].filter((value): value is string => value !== undefined);
  }
}
