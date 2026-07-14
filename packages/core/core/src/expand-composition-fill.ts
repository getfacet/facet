import type { IssueSink } from "./issues.js";
import type {
  AlertNode,
  BadgeNode,
  BoxNode,
  ButtonNode,
  CardNode,
  ChartNode,
  DividerNode,
  EmptyStateNode,
  FacetAction,
  FacetNode,
  InputNode,
  FilterBarNode,
  FormNode,
  KeyValueNode,
  ListNode,
  LoadingNode,
  MediaNode,
  MetricNode,
  NavNode,
  NodeId,
  ProgressNode,
  SectionNode,
  StatNode,
  TableNode,
  TabsNode,
  TextNode,
} from "./nodes.js";
import { MAX_FIELD_VALUE_CHARS } from "./protocol.js";
import { SLOT_MARKER_RE, type FacetComposition } from "./validate.js";
import type { CompositionRef } from "./composition-validation.js";
import { BRICK_REGISTRY } from "./brick-registry.js";

/** A composition-reference node has a `use` and no brick `type`. */
function isRef(node: FacetNode | CompositionRef): node is CompositionRef {
  return !("type" in node);
}

const EMPTY_SLOTS: Readonly<Record<string, string>> = Object.freeze(
  Object.create(null),
) as Readonly<Record<string, string>>;

export function fillComposition(
  composition: FacetComposition,
  params: Readonly<Record<string, unknown>>,
  issues: IssueSink,
) {
  const nodes: Record<string, FacetNode | CompositionRef> = {};
  for (const [id, node] of Object.entries(composition.nodes)) {
    const defaults = composition.slots ?? EMPTY_SLOTS;
    if (isRef(node)) {
      // A reference's `slots` are the child's params — fill them against the
      // OUTER composition's params/defaults first so an outer marker like
      // `{{status}}` resolves before the referenced child expands.
      nodes[id] = fillCompositionRef(node, defaults, params, issues);
      continue;
    }
    nodes[id] = fillNodeActions(fillNode(node, defaults, params, issues), defaults, params, issues);
  }
  const filled: {
    name: string;
    description?: string;
    metadata?: typeof composition.metadata;
    slots?: Readonly<Record<string, string>>;
    root: NodeId;
    nodes: Record<string, FacetNode | CompositionRef>;
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
  // Registry lookup replaces the former per-type switch; each brick declares its
  // `fill` handler in `brick-registry.ts`.
  return BRICK_REGISTRY[node.type].fill(node, defaults, params, issues);
}

/**
 * Fill a composition reference's slot ARGUMENTS against the outer
 * params/defaults (the same `fillString` path a brick string uses), so an outer
 * marker carried into a reference slot resolves before the child expands. Only
 * `use` and (filled) `slots` survive — the shape stays a closed `CompositionRef`.
 */
function fillCompositionRef(
  ref: CompositionRef,
  defaults: Readonly<Record<string, string>>,
  params: Readonly<Record<string, unknown>>,
  issues: IssueSink,
): CompositionRef {
  if (ref.slots === undefined) return ref;
  const slots: Record<string, string> = {};
  for (const [name, value] of Object.entries(ref.slots)) {
    slots[name] = fillString(value, defaults, params, issues);
  }
  return { use: ref.use, slots };
}

// Per-brick `fill` handlers — the former `fillNode` switch cases, verbatim. The
// uniform `raw: FacetNode` signature (with a one-line narrowing alias) lets the
// registry store them directly; hoisted so they are safe across the import
// cycle.
export function fillBox(raw: FacetNode): FacetNode {
  const node = raw as BoxNode;
  return node;
}
export function fillText(
  raw: FacetNode,
  defaults: Readonly<Record<string, string>>,
  params: Readonly<Record<string, unknown>>,
  issues: IssueSink,
): FacetNode {
  const node = raw as TextNode;
  return { ...node, value: fillString(node.value, defaults, params, issues) };
}
export function fillMedia(
  raw: FacetNode,
  defaults: Readonly<Record<string, string>>,
  params: Readonly<Record<string, unknown>>,
  issues: IssueSink,
): FacetNode {
  const node = raw as MediaNode;
  const next = { ...node, src: fillString(node.src, defaults, params, issues) };
  if (node.alt !== undefined) next.alt = fillString(node.alt, defaults, params, issues);
  if (node.poster !== undefined) {
    next.poster = fillString(node.poster, defaults, params, issues);
  }
  return next;
}
export function fillField(
  raw: FacetNode,
  defaults: Readonly<Record<string, string>>,
  params: Readonly<Record<string, unknown>>,
  issues: IssueSink,
): FacetNode {
  const node = raw as InputNode;
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
export function fillButton(
  raw: FacetNode,
  defaults: Readonly<Record<string, string>>,
  params: Readonly<Record<string, unknown>>,
  issues: IssueSink,
): FacetNode {
  const node = raw as ButtonNode;
  return { ...node, label: fillString(node.label, defaults, params, issues) };
}
export function fillSection(
  raw: FacetNode,
  defaults: Readonly<Record<string, string>>,
  params: Readonly<Record<string, unknown>>,
  issues: IssueSink,
): FacetNode {
  const node = raw as SectionNode;
  const next = { ...node };
  if (node.title !== undefined) next.title = fillString(node.title, defaults, params, issues);
  if (node.eyebrow !== undefined) {
    next.eyebrow = fillString(node.eyebrow, defaults, params, issues);
  }
  if (node.body !== undefined) next.body = fillString(node.body, defaults, params, issues);
  return next;
}
export function fillCard(
  raw: FacetNode,
  defaults: Readonly<Record<string, string>>,
  params: Readonly<Record<string, unknown>>,
  issues: IssueSink,
): FacetNode {
  const node = raw as CardNode;
  const next = { ...node };
  if (node.title !== undefined) next.title = fillString(node.title, defaults, params, issues);
  if (node.body !== undefined) next.body = fillString(node.body, defaults, params, issues);
  return next;
}
export function fillTabsNav(
  raw: FacetNode,
  defaults: Readonly<Record<string, string>>,
  params: Readonly<Record<string, unknown>>,
  issues: IssueSink,
): FacetNode {
  const node = raw as TabsNode | NavNode;
  return {
    ...node,
    items: node.items.map((item) => ({
      label: fillString(item.label, defaults, params, issues),
      to: fillString(item.to, defaults, params, issues),
    })),
  };
}
export function fillTable(
  raw: FacetNode,
  defaults: Readonly<Record<string, string>>,
  params: Readonly<Record<string, unknown>>,
  issues: IssueSink,
): FacetNode {
  const node = raw as TableNode;
  const next = {
    ...node,
    columns: node.columns.map((column) => ({
      ...column,
      label: fillString(column.label, defaults, params, issues),
    })),
    rows: node.rows.map((row) => {
      const next: Record<string, string | number | boolean> = {};
      for (const [key, value] of Object.entries(row)) {
        next[key] = typeof value === "string" ? fillString(value, defaults, params, issues) : value;
      }
      return next;
    }),
  };
  if (node.caption !== undefined) {
    next.caption = fillString(node.caption, defaults, params, issues);
  }
  return next;
}
export function fillChart(
  raw: FacetNode,
  defaults: Readonly<Record<string, string>>,
  params: Readonly<Record<string, unknown>>,
  issues: IssueSink,
): FacetNode {
  const node = raw as ChartNode;
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
export function fillMetricStat(
  raw: FacetNode,
  defaults: Readonly<Record<string, string>>,
  params: Readonly<Record<string, unknown>>,
  issues: IssueSink,
): FacetNode {
  const node = raw as MetricNode | StatNode;
  const next = {
    ...node,
    label: fillString(node.label, defaults, params, issues),
    value: fillString(node.value, defaults, params, issues),
  };
  if (node.delta !== undefined) next.delta = fillString(node.delta, defaults, params, issues);
  return next;
}
export function fillKeyValue(
  raw: FacetNode,
  defaults: Readonly<Record<string, string>>,
  params: Readonly<Record<string, unknown>>,
  issues: IssueSink,
): FacetNode {
  const node = raw as KeyValueNode;
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
export function fillBadge(
  raw: FacetNode,
  defaults: Readonly<Record<string, string>>,
  params: Readonly<Record<string, unknown>>,
  issues: IssueSink,
): FacetNode {
  const node = raw as BadgeNode;
  return { ...node, label: fillString(node.label, defaults, params, issues) };
}
export function fillProgress(
  raw: FacetNode,
  defaults: Readonly<Record<string, string>>,
  params: Readonly<Record<string, unknown>>,
  issues: IssueSink,
): FacetNode {
  const node = raw as ProgressNode;
  const next = { ...node };
  if (node.label !== undefined) next.label = fillString(node.label, defaults, params, issues);
  return next;
}
export function fillAlert(
  raw: FacetNode,
  defaults: Readonly<Record<string, string>>,
  params: Readonly<Record<string, unknown>>,
  issues: IssueSink,
): FacetNode {
  const node = raw as AlertNode;
  const next = { ...node, body: fillString(node.body, defaults, params, issues) };
  if (node.title !== undefined) next.title = fillString(node.title, defaults, params, issues);
  return next;
}
export function fillList(
  raw: FacetNode,
  defaults: Readonly<Record<string, string>>,
  params: Readonly<Record<string, unknown>>,
  issues: IssueSink,
): FacetNode {
  const node = raw as ListNode;
  return {
    ...node,
    items: node.items.map((item) => {
      const next = { ...item, title: fillString(item.title, defaults, params, issues) };
      if (item.body !== undefined) next.body = fillString(item.body, defaults, params, issues);
      return next;
    }),
  };
}
export function fillDivider(
  raw: FacetNode,
  defaults: Readonly<Record<string, string>>,
  params: Readonly<Record<string, unknown>>,
  issues: IssueSink,
): FacetNode {
  const node = raw as DividerNode;
  const next = { ...node };
  if (node.label !== undefined) next.label = fillString(node.label, defaults, params, issues);
  return next;
}
export function fillForm(
  raw: FacetNode,
  defaults: Readonly<Record<string, string>>,
  params: Readonly<Record<string, unknown>>,
  issues: IssueSink,
): FacetNode {
  const node = raw as FormNode;
  const next = { ...node };
  if (node.title !== undefined) next.title = fillString(node.title, defaults, params, issues);
  if (node.body !== undefined) next.body = fillString(node.body, defaults, params, issues);
  if (node.submitLabel !== undefined) {
    next.submitLabel = fillString(node.submitLabel, defaults, params, issues);
  }
  return next;
}
export function fillFilterBar(
  raw: FacetNode,
  defaults: Readonly<Record<string, string>>,
  params: Readonly<Record<string, unknown>>,
  issues: IssueSink,
): FacetNode {
  const node = raw as FilterBarNode;
  return {
    ...node,
    filters: node.filters.map((filter) => ({
      ...filter,
      name: fillString(filter.name, defaults, params, issues),
      label: fillString(filter.label, defaults, params, issues),
      ...(filter.options === undefined
        ? {}
        : {
            options: filter.options.map((option) => fillString(option, defaults, params, issues)),
          }),
      ...(typeof filter.value === "string"
        ? { value: fillString(filter.value, defaults, params, issues) }
        : {}),
    })),
  };
}
export function fillEmptyState(
  raw: FacetNode,
  defaults: Readonly<Record<string, string>>,
  params: Readonly<Record<string, unknown>>,
  issues: IssueSink,
): FacetNode {
  const node = raw as EmptyStateNode;
  const next = { ...node };
  if (node.title !== undefined) next.title = fillString(node.title, defaults, params, issues);
  if (node.body !== undefined) next.body = fillString(node.body, defaults, params, issues);
  if (node.actionLabel !== undefined) {
    next.actionLabel = fillString(node.actionLabel, defaults, params, issues);
  }
  return next;
}
export function fillLoading(
  raw: FacetNode,
  defaults: Readonly<Record<string, string>>,
  params: Readonly<Record<string, unknown>>,
  issues: IssueSink,
): FacetNode {
  const node = raw as LoadingNode;
  const next = { ...node };
  if (node.label !== undefined) next.label = fillString(node.label, defaults, params, issues);
  return next;
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
    // A reference contributes its (as-authored) slot values via `nodeStringLeaves`
    // so an outer marker carried into a reference slot maps to the reference id —
    // which becomes the child subtree root after resolution (RISK-INV-2).
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
export function nodeActionStrings(node: FacetNode | CompositionRef): readonly string[] {
  // A reference carries no actions (only `use`/`slots`) — no marker to surface.
  if (isRef(node)) return [];
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

export function nodeStringLeaves(node: FacetNode | CompositionRef): readonly string[] {
  // A reference's fillable strings are its slot values — return them (never a
  // `BRICK_REGISTRY[undefined]` lookup) so the unfilled-marker gate and
  // `collectSlotSources` see markers carried into reference slots too.
  if (isRef(node)) return Object.values(node.slots ?? {});
  // Registry lookup replaces the former per-type switch; each brick declares its
  // `stringLeaves` handler in `brick-registry.ts`.
  return BRICK_REGISTRY[node.type].stringLeaves(node);
}

// Per-brick `stringLeaves` handlers — the former `nodeStringLeaves` switch
// cases, verbatim (uniform `raw: FacetNode` signature + narrowing alias).
export function leavesBox(): readonly string[] {
  return [];
}
export function leavesText(raw: FacetNode): readonly string[] {
  const node = raw as TextNode;
  return [node.value];
}
export function leavesMedia(raw: FacetNode): readonly string[] {
  const node = raw as MediaNode;
  return [node.src, node.alt, node.poster].filter((value): value is string => value !== undefined);
}
export function leavesField(raw: FacetNode): readonly string[] {
  const node = raw as InputNode;
  return [node.name, node.label, node.placeholder, ...(node.options ?? [])].filter(
    (value): value is string => value !== undefined,
  );
}
export function leavesButton(raw: FacetNode): readonly string[] {
  const node = raw as ButtonNode;
  return [node.label];
}
export function leavesSection(raw: FacetNode): readonly string[] {
  const node = raw as SectionNode;
  return [node.title, node.eyebrow, node.body].filter(
    (value): value is string => value !== undefined,
  );
}
export function leavesCard(raw: FacetNode): readonly string[] {
  const node = raw as CardNode;
  return [node.title, node.body].filter((value): value is string => value !== undefined);
}
export function leavesTabsNav(raw: FacetNode): readonly string[] {
  const node = raw as TabsNode | NavNode;
  return node.items.flatMap((item) => [item.label, item.to]);
}
export function leavesTable(raw: FacetNode): readonly string[] {
  const node = raw as TableNode;
  return [
    node.caption,
    ...node.columns.map((column) => column.label),
    ...node.rows.flatMap((row) =>
      Object.values(row).filter((value): value is string => typeof value === "string"),
    ),
  ].filter((value): value is string => value !== undefined);
}
export function leavesChart(raw: FacetNode): readonly string[] {
  const node = raw as ChartNode;
  return [node.title, ...(node.labels ?? []), ...node.series.map((series) => series.label)].filter(
    (value): value is string => value !== undefined,
  );
}
export function leavesMetricStat(raw: FacetNode): readonly string[] {
  const node = raw as MetricNode | StatNode;
  return [node.label, node.value, node.delta].filter(
    (value): value is string => value !== undefined,
  );
}
export function leavesKeyValue(raw: FacetNode): readonly string[] {
  const node = raw as KeyValueNode;
  return node.items.flatMap((item) =>
    [item.key, item.label, item.value].filter((value): value is string => value !== undefined),
  );
}
export function leavesBadge(raw: FacetNode): readonly string[] {
  const node = raw as BadgeNode;
  return [node.label];
}
export function leavesProgress(raw: FacetNode): readonly string[] {
  const node = raw as ProgressNode;
  return [node.label].filter((value): value is string => value !== undefined);
}
export function leavesAlert(raw: FacetNode): readonly string[] {
  const node = raw as AlertNode;
  return [node.title, node.body].filter((value): value is string => value !== undefined);
}
export function leavesList(raw: FacetNode): readonly string[] {
  const node = raw as ListNode;
  return node.items.flatMap((item) =>
    [item.title, item.body].filter((value): value is string => value !== undefined),
  );
}
export function leavesDivider(raw: FacetNode): readonly string[] {
  const node = raw as DividerNode;
  return [node.label].filter((value): value is string => value !== undefined);
}
export function leavesForm(raw: FacetNode): readonly string[] {
  const node = raw as FormNode;
  return [node.title, node.body, node.submitLabel].filter(
    (value): value is string => value !== undefined,
  );
}
export function leavesFilterBar(raw: FacetNode): readonly string[] {
  const node = raw as FilterBarNode;
  return node.filters.flatMap((filter) => [
    filter.name,
    filter.label,
    ...(filter.options ?? []),
    ...(typeof filter.value === "string" ? [filter.value] : []),
  ]);
}
export function leavesEmptyState(raw: FacetNode): readonly string[] {
  const node = raw as EmptyStateNode;
  return [node.title, node.body, node.actionLabel].filter(
    (value): value is string => value !== undefined,
  );
}
export function leavesLoading(raw: FacetNode): readonly string[] {
  const node = raw as LoadingNode;
  return [node.label].filter((value): value is string => value !== undefined);
}
