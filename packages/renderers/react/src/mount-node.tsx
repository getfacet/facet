/**
 * Mounting — the one place a stored node becomes a trusted React component, and
 * the one place a subtree that cannot be trusted stops.
 *
 * A document arriving from a store is untrusted input. It may name a node that
 * is not there, carry a tag no catalog declares, hold a node whose shape is not
 * a node at all, point back at one of its own ancestors, nest deeper than the
 * grammar ever allowed, or carry an exact lowercase resolved `arg` past `B-23`.
 * Invariant 3's browser half is that **all six of those take one path**:
 * `mountOrFallback` replaces the **root of that subtree** with the
 * corrupt-subtree neutral state, and every valid sibling keeps rendering. One
 * outcome for six causes is deliberate — which fault occurred is not recoverable
 * from the page, so a corrupt persisted document cannot be read back out of what
 * a visitor sees (DC-013).
 *
 * **Termination is a property of the walk, not of the input.** Two things are
 * threaded down: the set of node ids already open on the current mount path,
 * and a depth counter cut off at `B-03`. A node already on its own path is a
 * cycle, a subtree past the bound is a cut, and both are the same degrade as the
 * other three. `@facet/core`'s `serializeDocument` is the server-side mirror of
 * exactly this walk — same two guards, same ordering, same one-placeholder
 * outcome — because the runtime is the *first* consumer of the same untrusted
 * bytes and cannot rely on the browser to have degraded them.
 *
 * **What is corruption and what is merely absent.** A prop whose `data:` path
 * the model does not select is **not** corruption: the prop is left absent with
 * a structured issue and the subtree renders, because the alternative is
 * blanking a region every time a publish is late or a key was renamed (DC-019).
 * Everything else a resolution reports — an undeclared prop, a missing required
 * prop, a value that disagrees with its declared type, a binding on a prop the
 * schema does not make bindable — describes the **document** rather than the
 * data, and a document that says those things did not come from an accepted
 * mutation. Those degrade, which is the browser mirror of the same rule
 * `validatePersistedSession` applies on the server.
 *
 * **Node-scoped resolution issues are the form that hides.** `resolveProps`
 * reports them when the node or spec could not be read at all and when the
 * exact lowercase resolved `arg` is longer than `B-23`. The unreadable form
 * comes back with an empty prop record — exactly the shape of a healthy
 * component that has nothing to show — and the over-bound arg form would look
 * like an ordinary resolved string to a caller that ignored issues. Mounting on
 * "no issues I recognise" or on "no props, so nothing to check" would therefore
 * mount corrupt input and report success from the code that exists to fail safe.
 * So the discriminant is read, never the length: any node-scoped issue takes the
 * same single path as the other corrupt causes and replaces that subtree's root.
 * `binding.ts` owns the facts; this module owns what they mean for a subtree.
 *
 * **This module is the sole `resetToken` seam.** The token a `SubtreeBoundary`
 * resets on is derived here, after binding resolution, from that node's **own**
 * `{tag, resolvedProps, contentRouting}` — and from nothing else. In particular
 * not from the authoritative `stageRevision`, which is not a parameter of
 * anything in this file. A revision-keyed reset would look correct and be
 * quietly destructive: every accepted mutation and every data publish advances
 * the revision for the whole stage, so every boundary on the page would clear at
 * once, remounting subtrees that never failed and taking unrelated `Field`
 * state, focus and open `Modal` state with them. Node-local means a crashed
 * subtree revives exactly when its own input moved, and no other subtree moves.
 * The boundary's *identity* is the separate, stable `${nodeId}:${tag}`, which is
 * the React key — so a node that stays put keeps its boundary, and with it its
 * subtree's React state.
 *
 * **One tag is inserted rather than emitted.** `Modal` is a catalog tag like any
 * other — stored as a node, resolved as a node, implemented by trusted React
 * that renders flow content and knows nothing about dialogs. What cannot be like
 * any other is where that content goes. Emitted in place it would sit in the
 * document beside its own trigger, inside the containment element whose
 * `isolation` is precisely what stops it painting over anything: a box in the
 * page rather than a surface over it. So the exact registered `Modal` tag is
 * routed to `MountContext`'s frame seam and its content handed over, while
 * everything else about that node — its binding, its boundary, its identity, its
 * reset token, its containment — is unchanged. The seam is `Modal`-specific and
 * deliberately not an extension point: no generic wrapper, no frame registry, no
 * router. It is required on the context rather than optional, because an absent
 * one would silently mean "emit it in the flow", which is the failure.
 *
 * **Containment is applied here and specified elsewhere.** Every mounted
 * implementation is wrapped in `containment.ts`'s element, which is the only
 * stacking guarantee that survives arbitrary host React. This module emits no
 * geometry of its own: no positioning, no z-index, no dimensions. Those belong
 * to the framework overlay frame and to nothing else, and the suite states that
 * as a property of this file's source rather than of one rendered tree.
 *
 * The module is **private**: it is not barrel-exported and is not a package
 * entry point.
 */

import { BOUNDS, isFacetIdentifier } from "@facet/core";
import type {
  ComponentDocument,
  ComponentMountProps,
  ComponentNode,
  ComponentSpec,
  DataModel,
  FacetAssetRegistry,
  MountedComponent,
  NeutralCopy,
} from "@facet/core";
import type { ReactNode } from "react";
import { useMemo } from "react";

import { resolveProps, useDataModel } from "./binding.js";
import type { BindingIssue } from "./binding.js";
import { Containment } from "./containment.js";
import { boundaryIdentity, safeInvoke, SubtreeBoundary } from "./error-boundary.js";
import { CorruptSubtreeState } from "./fallback.js";
import { FieldHost, isCollectable } from "./field-store.js";
import type { FieldInjection, FieldStore } from "./field-store.js";
import type { ComponentRegistry } from "./registry.js";
import { isArrayValue, isRecord, readArrayItem, readArrayLength, readOwn } from "./safe-read.js";

/** A node's resolved props, named from the mount contract rather than restated. */
type ResolvedProps = ComponentMountProps["props"];

/**
 * One `Modal` node's flow content, on its way to the framework frame.
 *
 * The shape is closed and small on purpose. `content` is the element the
 * registered implementation would have rendered in place, already carrying its
 * resolved props, its theme and its contained handler, so the frame renders it
 * untouched and injects nothing. `props` is the **same resolved record** the
 * implementation was handed, so the frame can read the props it projects —
 * `triggerLabel`, a title — without resolving anything a second time. `nodeId`
 * is the node's identity, which is what an ordered list of open modals is keyed
 * by. Nothing else belongs here: the theme the frame's own chrome paints with is
 * the renderer's to close over when it builds the callback, not mounting's to
 * pass down, and an action reference is the node's, not the frame's.
 */
export interface ModalMountRequest {
  readonly nodeId: string;
  readonly props: ResolvedProps;
  readonly content: ReactNode;
}

/**
 * Everything mounting needs for one session, gathered so the walk threads one
 * value rather than eight.
 *
 * It is the caller's to keep stable: a new object on every render re-renders
 * every mounted node. `StageRenderer` holds one per session.
 */
export interface MountContext {
  /** The document in force. Read-only here; mounting never writes it. */
  readonly document: ComponentDocument;
  /** Tag to spec, built once at bootstrap from the validated catalog. */
  readonly index: ReadonlyMap<string, ComponentSpec>;
  /** The session's frozen registry: what actually mounts. */
  readonly registry: ComponentRegistry;
  /** The session's frozen host-pinned image assets. */
  readonly assetRegistry: FacetAssetRegistry;
  /** The active theme's custom properties, handed to every mount. */
  readonly themeVars: Readonly<Record<string, string>>;
  /** The session's resolved neutral copy. */
  readonly copy: NeutralCopy;
  /** Where a collected value lives. */
  readonly store: FieldStore;
  /**
   * Reports that a visitor activated the interaction declared on one node's
   * prop. Mounting resolves nothing about it: the renderer holds the document
   * and decides what the reference means.
   */
  readonly onAction: (nodeId: string, prop: string) => void;
  /**
   * Puts one `Modal` node's flow content into the framework frame.
   *
   * Required, not optional: a context without it would mean "render the modal
   * where it stands", and that is exactly the outcome the seam exists to
   * prevent. The renderer supplies one memo-stable callback per session; no
   * public prop replaces it, and nothing but the registered `Modal` tag reaches
   * it.
   */
  readonly renderModal: (request: ModalMountRequest) => ReactNode;
}

/**
 * One stored node, read defensively.
 *
 * The three fields are the ones mounting needs and they are checked here; the
 * prop **values** are deliberately left `unknown`, because checking them is
 * `resolveProps`'s job and it is total over any value of any type. Writing the
 * document's own prop union here would be a claim about untrusted bytes that
 * nothing in this file has verified.
 */
interface ReadNode {
  readonly tag: string;
  readonly slot?: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly children: readonly string[];
}

/** What one mounted node is handed after its own subtree decision was made. */
interface MountedProps {
  readonly context: MountContext;
  readonly nodeId: string;
  readonly spec: ComponentSpec;
  readonly implementation: MountedComponent<ReactNode, ReactNode>;
  readonly props: ResolvedProps;
  readonly content: ContentPlan;
  /** The node ids open on the mount path above this node. */
  readonly path: ReadonlySet<string>;
  readonly depth: number;
}

interface ContentPlan {
  readonly children: readonly string[];
  readonly slots: Readonly<Record<string, readonly string[]>>;
  readonly resetInput: readonly unknown[];
}

/**
 * The `Facet` envelope occupies the first level of `B-03` — `serializeDocument`
 * counts it that way — so a screen root stands at the second. Counting the two
 * mirrors alike is what makes "deeper than `B-03`" name the same subtree in the
 * browser and on the server.
 */
const SCREEN_ROOT_DEPTH = 2;

/** The empty mount path. Never mutated; every level derives a fresh set. */
const NO_ANCESTORS: ReadonlySet<string> = Object.freeze(new Set<string>());

const NO_CHILD_IDS: readonly string[] = Object.freeze([]);

const NO_SLOT_IDS: Readonly<Record<string, readonly string[]>> = Object.freeze(Object.create(null));

const NO_RENDERED_CHILDREN: readonly ReactNode[] = Object.freeze([]);

const NO_RENDERED_SLOTS: Readonly<Record<string, ReactNode>> = Object.freeze(Object.create(null));

/**
 * The one **prop-scoped** resolution issue that is about the Data Model rather
 * than about the document, and therefore the one that does not degrade a
 * subtree. Nothing node-scoped is ever excused this way.
 */
const DATA_ONLY_ISSUE = "unresolved_binding";

/**
 * The stand-in for a resolved value that cannot be reduced to a stable string.
 *
 * A resolved value that happened to *be* this string would derive the same token
 * as an unserializable one, and that is the harmless direction: the two would
 * share a token, so a boundary would decline to reset where it might have reset.
 * Nothing leaks and nothing crashes; the subtree waits for its next real change.
 */
const UNSERIALIZABLE = "facet:unserializable-resolved-value";

/**
 * Reads one stored node, or answers `null` when what is stored under that id is
 * not a node.
 *
 * Both "there is nothing here" and "what is here is not a node" answer the same
 * way, because both are the same degrade and telling them apart would only
 * create a second path. The child list is required to be ids and required to
 * name each child once: every node in an accepted document has exactly one
 * parent, so a repeated child id is corruption — and it is the one shape that
 * would put two subtrees under a single boundary identity.
 */
function readNode(document: ComponentDocument, nodeId: string): ReadNode | null {
  const stored = readOwn(readOwn(document, "nodes"), nodeId);
  if (!isRecord(stored)) {
    return null;
  }
  const tag = readOwn(stored, "tag");
  let slot: string | undefined;
  try {
    if (Object.hasOwn(stored, "slot")) {
      const candidate = stored["slot"];
      if (!isFacetIdentifier(candidate)) {
        return null;
      }
      slot = candidate;
    }
  } catch {
    return null;
  }
  const props = readOwn(stored, "props");
  const children = readOwn(stored, "children");
  if (typeof tag !== "string" || tag.length === 0 || !isRecord(props) || !isArrayValue(children)) {
    return null;
  }
  const childNodeIds: string[] = [];
  const childCount = readArrayLength(children);
  if (childCount > BOUNDS.nodesPerDocument) {
    return null;
  }
  for (let index = 0; index < childCount; index += 1) {
    const child = readArrayItem(children, index);
    if (typeof child !== "string" || childNodeIds.includes(child)) {
      return null;
    }
    childNodeIds.push(child);
  }
  return { tag, props, children: childNodeIds, ...(slot === undefined ? {} : { slot }) };
}

/** The trusted implementation registered under a tag, or `undefined`. */
function readImplementation(
  registry: ComponentRegistry,
  tag: string,
): MountedComponent<ReactNode, ReactNode> | undefined {
  const implementation = readOwn(registry, tag);
  return typeof implementation === "function"
    ? (implementation as MountedComponent<ReactNode, ReactNode>)
    : undefined;
}

/**
 * Whether a resolution is a reason to refuse the mount.
 *
 * The two scopes are read separately, because they fail for different reasons
 * and only one of them has an exception.
 *
 * A **node-scoped** issue always refuses. It says the node or its spec could not
 * be read *at all*, so there was nothing to walk — and the resolution that comes
 * back is an empty prop record, which is indistinguishable by shape from a
 * healthy component that simply has nothing to show. That is exactly why the
 * scope exists and why it is read here: inferring health from `issues.length` or
 * from an empty `props` would mount a catastrophically failed node as if
 * nothing had happened, and the fail-safe boundary would be reporting success.
 *
 * A **prop-scoped** issue refuses too, with one exception: `unresolved_binding`
 * is about the Data Model rather than about the document. A path the model does
 * not select yet is a publish that is late or a key that was renamed, and
 * blanking a region for it would make every slow publish look like corruption
 * (DC-019). Every other prop-scoped reason — an undeclared prop, a missing
 * required one, a value that disagrees with its declared type, a binding on a
 * prop the schema does not make bindable, a prop whose read threw — describes
 * the **document**, and a document that says those things did not come from an
 * accepted mutation. The exception never applies to a collectable component's
 * sensitivity prop: an unresolved confidentiality decision must remove the
 * field rather than register it as non-sensitive.
 *
 * Written as "everything except the one exception" on purpose: a reason added to
 * either arm of the union later refuses by default, which is the safe direction
 * for a consumer of a vocabulary it does not own.
 */
function refusesTheMount(issues: readonly BindingIssue[], spec: ComponentSpec): boolean {
  const sensitiveProp = spec.collect?.sensitiveProp;
  return issues.some(
    (issue) =>
      issue.scope === "node" ||
      issue.reason !== DATA_ONLY_ISSUE ||
      (sensitiveProp !== undefined && issue.prop === sensitiveProp),
  );
}

/**
 * Derive and validate the component's content-routing plan.
 *
 * Read totally, because it is read *before* `resolveProps` has had the chance to
 * report an unreadable spec as a node-scoped issue: a spec that throws from this
 * read would otherwise unwind out of the walk instead of degrading through it.
 * A spec that cannot answer is invalid, which lands on the centralized degrade
 * path without unwinding the walk.
 */
function planContent(
  context: MountContext,
  node: ReadNode,
  spec: ComponentSpec,
): ContentPlan | null {
  const content = readOwn(spec, "content");
  if (!isRecord(content)) {
    return null;
  }
  const mode = readOwn(content, "mode");
  if (mode === "none") {
    return node.children.length === 0
      ? { children: NO_CHILD_IDS, slots: NO_SLOT_IDS, resetInput: NO_CHILD_IDS }
      : null;
  }
  if (mode === "children") {
    for (const childId of node.children) {
      const child = readNode(context.document, childId);
      if (child !== null && child.slot !== undefined) {
        return null;
      }
    }
    return { children: node.children, slots: NO_SLOT_IDS, resetInput: node.children };
  }
  if (mode !== "slots") {
    return null;
  }
  const declared = readOwn(content, "slots");
  if (!isRecord(declared)) {
    return null;
  }
  let names: readonly string[];
  try {
    names = Object.keys(declared).sort();
  } catch {
    return null;
  }
  if (names.length === 0) {
    return null;
  }
  const grouped: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
  for (const name of names) {
    if (!isFacetIdentifier(name)) {
      return null;
    }
    grouped[name] = [];
  }
  for (const childId of node.children) {
    const child = readNode(context.document, childId);
    if (child === null || child.slot === undefined) {
      return null;
    }
    const slotSpec = readOwn(declared, child.slot);
    const bucket = grouped[child.slot];
    if (!isRecord(slotSpec) || bucket === undefined) {
      return null;
    }
    const minChildren = readOwn(slotSpec, "minChildren");
    const maxChildren = readOwn(slotSpec, "maxChildren");
    if (
      typeof minChildren !== "number" ||
      !Number.isSafeInteger(minChildren) ||
      typeof maxChildren !== "number" ||
      !Number.isSafeInteger(maxChildren) ||
      minChildren < 0 ||
      maxChildren < minChildren
    ) {
      return null;
    }
    const allowedTags = readOwn(slotSpec, "allowedTags");
    if (allowedTags !== undefined) {
      if (!isArrayValue(allowedTags)) {
        return null;
      }
      let allowed = false;
      const length = readArrayLength(allowedTags);
      for (let index = 0; index < length; index += 1) {
        if (readArrayItem(allowedTags, index) === child.tag) {
          allowed = true;
          break;
        }
      }
      if (!allowed) {
        return null;
      }
    }
    bucket.push(childId);
    if (bucket.length > maxChildren) {
      return null;
    }
  }
  const slots: Record<string, readonly string[]> = Object.create(null) as Record<
    string,
    readonly string[]
  >;
  for (const name of names) {
    const slotSpec = readOwn(declared, name);
    const bucket = grouped[name];
    const minChildren = isRecord(slotSpec) ? readOwn(slotSpec, "minChildren") : undefined;
    if (bucket === undefined || typeof minChildren !== "number" || bucket.length < minChildren) {
      return null;
    }
    if (bucket.length > 0) {
      slots[name] = Object.freeze([...bucket]);
    }
  }
  return {
    children: NO_CHILD_IDS,
    slots: Object.freeze(slots),
    resetInput: Object.freeze(
      node.children.map((childId) => [childId, readNode(context.document, childId)?.slot]),
    ),
  };
}

/**
 * The one tag whose content the framework inserts instead of emitting.
 *
 * Core reserves the same name for the conformance check it runs at bootstrap,
 * and keeps it private to that module; this is the renderer's own copy of a
 * closed catalog constant rather than a second policy about it.
 */
const MODAL_TAG = "Modal";

/**
 * Whether this spec is the catalog's `Modal`.
 *
 * The tag is read from the **spec** rather than from the stored node. Both are
 * the same value under the real bootstrap — the catalog index is keyed by each
 * spec's own tag — but the spec is the validated side of the pair, and reading
 * the validated side is what keeps a persisted tag from being the thing that
 * decides where content goes.
 *
 * Read totally, for the same reason the content contract is: a hostile spec that
 * throws from this read must degrade through the walk, not unwind out of it.
 * A spec that cannot answer is not the `Modal`, which lands on the ordinary
 * mount — and an ordinary mount of an unreadable spec is already refused
 * upstream by its node-scoped resolution issue.
 */
function readsAsModal(spec: ComponentSpec): boolean {
  return readOwn(spec, "tag") === MODAL_TAG;
}

/**
 * The boundary reset input for one node: a pure function of that node's own
 * post-binding `{tag, resolvedProps, contentRouting}`, and of nothing else.
 *
 * `resolveProps` walks a spec's declared props in sorted order. Scalar text and
 * structured values are reduced to fixed-size digests, and structured object
 * digests are cached by immutable model identity. A large value shared by many
 * nodes is therefore serialized once and no boundary retains its full text.
 *
 * A resolved value that cannot be reduced — a structured prop the Data Model
 * handed over with a cycle in it — yields a **stable** stand-in rather than a
 * fresh one. A token that changed on every render would remount the subtree on
 * every render, which is the failure this whole derivation exists to avoid.
 */
const RESET_VALUE_DIGESTS = new WeakMap<object, string>();

function digestText(value: string): string {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ code, 0x85ebca6b);
  }
  return `${(left >>> 0).toString(16).padStart(8, "0")}${(right >>> 0)
    .toString(16)
    .padStart(8, "0")}:${value.length}`;
}

function digestResetValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return `s:${digestText(value)}`;
  if (typeof value === "number") return `n:${String(value)}`;
  if (typeof value === "boolean") return value ? "b:1" : "b:0";
  if (typeof value !== "object") return `${typeof value}:${UNSERIALIZABLE}`;

  const cached = RESET_VALUE_DIGESTS.get(value);
  if (cached !== undefined) return cached;
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string") return `j:${UNSERIALIZABLE}`;
    const digest = `j:${digestText(serialized)}`;
    RESET_VALUE_DIGESTS.set(value, digest);
    return digest;
  } catch {
    return `j:${UNSERIALIZABLE}`;
  }
}

export function deriveResetToken(
  tag: string,
  props: ResolvedProps,
  contentRouting: readonly unknown[],
): string {
  const parts = [`tag:${digestText(tag)}`];
  for (const name of Object.keys(props).sort()) {
    parts.push(`prop:${digestText(name)}=${digestResetValue(props[name])}`);
  }
  parts.push(`content:${digestResetValue(contentRouting)}`);
  return parts.join("|");
}

/**
 * Mounts one node, or replaces its subtree with the corrupt-subtree state.
 *
 * The checks are ordered and total. The order decides nothing a visitor can
 * observe — every cause renders the same element — but it is fixed so that the
 * same document always takes the same branch, and it mirrors the order the
 * server-side walk uses: already on the path, past the depth bound, not a
 * readable node, not a catalogued and registered tag, and finally a resolution
 * that refuses the mount, node-scoped or prop-scoped.
 */
export function mountOrFallback(
  context: MountContext,
  model: DataModel,
  nodeId: string,
  path: ReadonlySet<string>,
  depth: number,
): ReactNode {
  const node =
    path.has(nodeId) || depth > BOUNDS.elementDepth ? null : readNode(context.document, nodeId);
  const identity = boundaryIdentity(nodeId, node?.tag ?? "");
  // One construction site for the degrade, so "five causes, one outcome" is a
  // property of the code's shape and not of five branches that happen to agree.
  const degrade = (): ReactNode => <CorruptSubtreeState key={identity} copy={context.copy} />;

  if (node === null) {
    return degrade();
  }
  const spec = context.index.get(node.tag);
  const implementation = readImplementation(context.registry, node.tag);
  if (spec === undefined || implementation === undefined) {
    return degrade();
  }
  const content = planContent(context, node, spec);
  if (content === null) {
    return degrade();
  }
  // The cast hands untrusted values to the one function written to narrow them:
  // `resolveProps` checks every stored value against its declared schema and is
  // total for any input of any type, so it is the right place for the check and
  // this is the boundary the value crosses to reach it.
  const resolution = resolveProps(
    node as unknown as ComponentNode,
    spec,
    model,
    context.assetRegistry,
  );
  if (refusesTheMount(resolution.issues, spec)) {
    return degrade();
  }
  return (
    <SubtreeBoundary
      key={identity}
      copy={context.copy}
      resetToken={deriveResetToken(node.tag, resolution.props, content.resetInput)}
    >
      <Containment>
        <Mounted
          context={context}
          nodeId={nodeId}
          spec={spec}
          implementation={implementation}
          props={resolution.props}
          content={content}
          path={path}
          depth={depth}
        />
      </Containment>
    </SubtreeBoundary>
  );
}

/**
 * Renders one node whose subtree decision has already been made, and mounts its
 * children.
 *
 * The recursion runs through React rather than through the call stack: each
 * child is an *element*, so this function returns before any descendant renders
 * and no document, however deep or however self-referential, can put a frame per
 * node on the stack.
 */
function Mounted(mounted: MountedProps): ReactNode {
  const { context, nodeId, spec, implementation, props, content, path, depth } = mounted;
  const model = useDataModel();
  const childPath = useMemo(() => new Set([...path, nodeId]), [path, nodeId]);
  const onAction = useMemo(
    () =>
      safeInvoke((prop: string) => {
        context.onAction(nodeId, prop);
      }),
    [context, nodeId],
  );

  const children = content.children.map((childId) =>
    mountOrFallback(context, model, childId, childPath, depth + 1),
  );
  const slots: Record<string, ReactNode> = Object.create(null) as Record<string, ReactNode>;
  for (const [name, childIds] of Object.entries(content.slots)) {
    slots[name] = Object.freeze(
      childIds.map((childId) => mountOrFallback(context, model, childId, childPath, depth + 1)),
    );
  }
  const renderedChildren = children.length === 0 ? NO_RENDERED_CHILDREN : Object.freeze(children);
  const renderedSlots = Object.keys(slots).length === 0 ? NO_RENDERED_SLOTS : Object.freeze(slots);
  const Implementation = implementation;

  if (readsAsModal(spec)) {
    // The registered implementation is built exactly as it would be anywhere
    // else — same resolved props, same theme, same contained handler, same
    // children — and then handed over rather than returned. It is built here
    // and nowhere else, so there is no arrangement of this branch in which the
    // content is both framed and left standing in the flow.
    return context.renderModal({
      nodeId,
      props,
      content: (
        <Implementation
          props={props}
          children={renderedChildren}
          slots={renderedSlots}
          themeVars={context.themeVars}
          onAction={onAction}
        />
      ),
    });
  }

  if (isCollectable(spec)) {
    // Facet owns the value: the store seeds it, injects it under the declared
    // value prop, and is the only path from this control to an event payload.
    return (
      <FieldHost
        nodeId={nodeId}
        spec={spec}
        props={props}
        store={context.store}
        mount={(injection: FieldInjection) => (
          <Implementation
            props={injection.props}
            children={renderedChildren}
            slots={renderedSlots}
            themeVars={context.themeVars}
            onAction={onAction}
            onValueChange={safeInvoke(injection.onValueChange)}
          />
        )}
      />
    );
  }
  return (
    <Implementation
      props={props}
      children={renderedChildren}
      slots={renderedSlots}
      themeVars={context.themeVars}
      onAction={onAction}
    />
  );
}

/**
 * Mounts one node of the document in force — the renderer's entry into the
 * walk, and the only caller that starts it.
 *
 * The screen root's level is fixed rather than passed, so no caller can start a
 * walk part-way down the depth bound and buy a subtree more nesting than the
 * grammar allows.
 */
export function MountNode(props: {
  readonly context: MountContext;
  readonly nodeId: string;
}): ReactNode {
  const model = useDataModel();
  return mountOrFallback(props.context, model, props.nodeId, NO_ANCESTORS, SCREEN_ROOT_DEPTH);
}
