/**
 * Prop resolution: turning one stored node into the props a trusted component
 * is handed, and refreshing them when data lands.
 *
 * A document is authored once. Data arrives many times. The whole point of a
 * `data:path` reference is that the second does not require the first: an
 * accepted publish changes what a bound component shows without a single node,
 * prop or child id changing (DC-019). That is why the model reaches a mount
 * through React context rather than being baked into the props at author time —
 * a new model is a new context value, so every component that reads one
 * re-resolves on the next render and none of them holds a value from before.
 *
 * **Resolution is a read.** Nothing here writes to the node, the document or
 * the model, and nothing here can produce a patch: the binding half of the
 * two-writers invariant is that the browser never becomes a second writer.
 * `binding.test.ts` observes both inputs for writes rather than taking the
 * claim on trust.
 *
 * **A missing path is not an empty value.** `resolveBinding` draws that line in
 * core, and this module keeps it: a path the model does not select leaves the
 * prop **absent** with a structured issue. It never becomes `""`, and it never
 * falls back to the schema's default — the author asked for published data, and
 * quietly substituting something else would present a typo, a renamed key or a
 * publish that never landed as real data. Defaults fill props the author
 * **omitted**, which is the only thing a default means.
 *
 * **The mount contract is the boundary.** A trusted component is handed
 * declared props only, already agreed with the declared schema, in the value
 * types that contract names. So an undeclared prop a corrupt persisted document
 * carries is refused rather than forwarded, an out-of-domain scalar is refused
 * rather than coerced, and `"3"` arrives as `3` — the document stores every
 * authored scalar as text, and a stringly-typed number is not something
 * `ComponentMountProps` admits.
 *
 * `resolveProps` is **total**: it never throws, for any node, spec or model,
 * including a model whose property getter throws. Unwinding here would blank a
 * subtree over data the host published.
 *
 * The module is **private**: it is not barrel-exported and is not a package
 * entry point.
 */

import type {
  ComponentMountProps,
  ComponentNode,
  ComponentSpec,
  DataModel,
  FacetAssetRegistry,
} from "@facet/core";
import { BOUNDS, parseAuthoredNumber, resolveBinding, resolveFacetAsset } from "@facet/core";
import { createContext, createElement, useContext, useMemo } from "react";
import type { ReactNode } from "react";

import { isRecord as isSafeRecord, readOwn } from "./safe-read.js";

/**
 * The props a mounted component receives, named from the mount contract rather
 * than restated. Deriving it is what stops this module and `@facet/core` from
 * drifting into two vocabularies for the same value.
 */
type ResolvedProps = ComponentMountProps["props"];

/** One resolved value: exactly what the mount contract's record holds. */
type ResolvedValue = ResolvedProps[string];

/**
 * Why something did not resolve — **discriminated by what it is about**.
 *
 * The prop-scoped vocabulary mirrors the author-error codes
 * `document-validation.ts` produces for the same faults, because these are the
 * same faults arriving a second time — from a persisted document, or from a
 * model that changed after the markup was accepted. One vocabulary means a
 * renderer and an author read the same failure by the same name.
 *
 * The node scope exists because a catastrophic failure must stay
 * **distinguishable from clean success**. A node whose own shape cannot be read
 * yields no props and, without this, no issues either — and "no props, no
 * issues" is exactly what a healthy component with nothing to show looks like,
 * so the corrupt-subtree policy downstream would mount it as if nothing were
 * wrong. Discriminating on `scope` is what makes that impossible to miss: a
 * consumer narrows rather than recognising a sentinel prop name.
 */
export type BindingIssue =
  | {
      /** About one declared prop, named by `prop`. */
      readonly scope: "prop";
      /** The prop that did not resolve. Always a real, non-empty prop name. */
      readonly prop: string;
      /** Why. Closed, structured, and stable. */
      readonly reason:
        | "unknown_prop"
        | "missing_required"
        | "invalid_value"
        | "unresolved_binding"
        | "binding_not_allowed"
        /**
         * Reading this one prop threw. Only a host can cause it — a revoked
         * proxy in the model, a schema getter that throws — and it costs
         * exactly this prop: its siblings, and their issues, survive.
         */
        | "resolution_failed";
    }
  | {
      /**
       * About the **node**: the node or its spec could not be read at all, so
       * there was nothing to walk and no prop to attribute the fault to.
       * `mount-node.tsx` treats any node-scoped issue as a corrupt subtree.
       */
      readonly scope: "node";
      readonly reason: "node_unreadable" | "spec_unreadable" | "event_arg_too_long";
    };

/**
 * One node's resolution: the props to mount with, and every prop that did not
 * make it.
 *
 * The two halves are deliberate. A resolution is never all-or-nothing — a node
 * with one dangling binding still has every other prop — so the caller decides
 * what an issue means for the subtree. `mount-node.tsx` is that caller: it
 * owns the corrupt-subtree policy, and this module owns the facts it decides on.
 */
export interface PropResolution {
  readonly props: ResolvedProps;
  readonly issues: readonly BindingIssue[];
}

/** The prop schemas a spec declares, named from the spec for the same reason. */
type PropSchemas = ComponentSpec["props"];

type PropSchema = PropSchemas[string];

const TRUE_LITERAL = "true";

const FALSE_LITERAL = "false";

/** The exact lowercase framework event-argument convention (D-07). */
const ARG_PROP = "arg";

const EMPTY_ASSET_REGISTRY: FacetAssetRegistry = Object.freeze(Object.create(null));

/** The spec's declared prop schemas, read defensively from an unvalidated spec. */
function declaredProps(spec: ComponentSpec): Readonly<Record<string, unknown>> {
  if (!isReadableRecord(spec)) {
    return {};
  }
  const props = readOwn(spec, "props");
  return isSafeRecord(props) ? props : {};
}

/** The node's stored props, read defensively from an unvalidated document. */
function storedProps(node: ComponentNode): Readonly<Record<string, unknown>> {
  if (!isReadableRecord(node)) {
    return {};
  }
  const props = readOwn(node, "props");
  return isSafeRecord(props) ? props : {};
}

function isReadableRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Own enumerable string keys, without ever throwing. */
function ownKeys(container: object): readonly string[] {
  try {
    return Object.keys(container);
  } catch {
    return [];
  }
}

/**
 * Narrows an unvalidated schema to the shape a resolution consults. The catalog
 * is the trust boundary that admits a spec; an unrecognized shape rejects here
 * rather than being assumed well-formed.
 */
function readSchema(schema: unknown): PropSchema | null {
  if (!isSafeRecord(schema)) {
    return null;
  }
  const type = readOwn(schema, "type");
  if (
    type !== "string" &&
    type !== "number" &&
    type !== "boolean" &&
    type !== "array" &&
    type !== "object"
  ) {
    return null;
  }
  return schema as unknown as PropSchema;
}

function declaredAssetKind(schema: PropSchema): "image" | null {
  return readOwn(schema as unknown as Record<string, unknown>, "assetKind") === "image"
    ? "image"
    : null;
}

/** Whether the schema declares this prop required. */
function isRequired(schema: PropSchema): boolean {
  return readOwn(schema as unknown as Record<string, unknown>, "required") === true;
}

/** The declared default, or `undefined` when the schema carries none. */
function declaredDefault(schema: PropSchema): unknown {
  return readOwn(schema as unknown as Record<string, unknown>, "default");
}

/** The declared domain, or `null` when the schema declares none. */
function declaredEnum(schema: PropSchema): readonly unknown[] | null {
  const domain = readOwn(schema as unknown as Record<string, unknown>, "enum");
  return Array.isArray(domain) ? domain : null;
}

/** One declared numeric bound, or `null` when the schema declares none. */
function numericBound(schema: PropSchema, key: "minimum" | "maximum"): number | null {
  const bound = readOwn(schema as unknown as Record<string, unknown>, key);
  return typeof bound === "number" && Number.isFinite(bound) ? bound : null;
}

/** Whether a finite number satisfies the schema's declared domain and range. */
function agreesWithNumericDomain(amount: number, schema: PropSchema): boolean {
  const domain = declaredEnum(schema);
  if (domain !== null && !domain.includes(amount)) {
    return false;
  }
  const minimum = numericBound(schema, "minimum");
  if (minimum !== null && amount < minimum) {
    return false;
  }
  const maximum = numericBound(schema, "maximum");
  return maximum === null || amount <= maximum;
}

/**
 * Agrees an authored scalar with its declared schema, in the value type the
 * mount contract names, or returns `null` when the text does not satisfy it.
 *
 * **This is the one path where the renderer does enforce a declared domain, and
 * the reason is positive rather than special: nothing else validates it.** Core
 * never sees these stored scalar bytes at mount time — they arrive from a store
 * as part of a persisted document, which invariant 3 requires be treated as
 * untrusted input, and `resolveBinding` is not in this path at all. Author
 * validation did check them, once, when the markup was accepted; that is a
 * different moment and a different copy of the value.
 *
 * The contrast is with the two paths that were removed. A **bound** value is
 * agreed by `resolveBinding` immediately before it gets here, and a **declared
 * default** is agreed by `validateComponentSpec` at bootstrap — both had a live
 * enforcing owner, so a second reader here was duplication. This path has none,
 * so the rules are enforced here: a value the author grammar refused must not
 * become mountable by surviving a round trip through a store.
 */
function agreeScalar(text: string, schema: PropSchema): ResolvedValue | null {
  switch (schema.type) {
    case "array":
    case "object":
      // Only a `data:` reference fills a structured prop; inline structure is
      // refused by the grammar and must stay refused here.
      return null;
    case "boolean":
      if (text === TRUE_LITERAL) {
        return true;
      }
      return text === FALSE_LITERAL ? false : null;
    case "number": {
      const amount = parseAuthoredNumber(text);
      if (amount === null || !agreesWithNumericDomain(amount, schema)) {
        return null;
      }
      return amount;
    }
    case "string": {
      const domain = declaredEnum(schema);
      return domain === null || domain.includes(text) ? text : null;
    }
  }
}

/**
 * Narrows a declared default to the runtime type its branch admits.
 *
 * **A type guard, not a domain check — the distinction is the whole point.** A
 * default comes from the immutable catalog, which `validateComponentSpec` has
 * already accepted at bootstrap: `enum`, `minimum` and `maximum` are enforced
 * there, and `default_outside_domain` is core's own rejection. Re-reading that
 * domain here would be the same duplicate validation just removed from the
 * bound path, so it is gone.
 *
 * What remains is only what stops a value from violating `ComponentMountProps`
 * if this private helper is ever reached outside a normal bootstrap: the value
 * must actually be a string, a boolean, or a **finite** number, because a `NaN`
 * is not JSON data and the mount contract's value union has no room for one.
 * Nothing here consults a declared domain.
 *
 * A default that fails even that is filtered rather than reported: a malformed
 * spec is a catalog fault the bootstrap boundary owns, not a fault of this node.
 */
function agreeDefault(value: unknown, schema: PropSchema): ResolvedValue | null {
  switch (schema.type) {
    case "array":
    case "object":
      // The structured branches declare no default; there is nothing to fill.
      return null;
    case "boolean":
      return typeof value === "boolean" ? value : null;
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    case "string":
      return typeof value === "string" ? value : null;
  }
}

/** Maps a binding rejection onto this module's vocabulary, mirroring core. */
function bindingIssue(reason: string): PropIssueReason {
  if (reason === "prop_not_bindable" || reason === "invalid_prop_schema") {
    return "binding_not_allowed";
  }
  return reason === "invalid_reference" ? "invalid_value" : "unresolved_binding";
}

/** The outcome of resolving one stored value: a value, or the reason it is not. */
type ValueOutcome =
  | { readonly ok: true; readonly value: ResolvedValue }
  | { readonly ok: false; readonly reason: PropIssueReason };

/**
 * Resolves one stored prop value against the schema that authorizes it.
 *
 * An action reference resolves to its authored text — `nav:details` — because
 * the component reports the interaction and the **renderer** decides what the
 * reference means. Requiring the prop be declared `string` with `action: true`
 * mirrors author validation exactly; the declared domain is deliberately *not*
 * consulted for one, for the same reason it is not at author time: the domain
 * of an action is the closed scheme vocabulary, whose targets are open.
 */
function resolveValue(
  name: string,
  stored: unknown,
  schema: PropSchema,
  model: DataModel,
  assetRegistry: FacetAssetRegistry,
): ValueOutcome {
  if (!isSafeRecord(stored)) {
    return { ok: false, reason: "invalid_value" };
  }
  const kind = readOwn(stored, "kind");
  const assetKind = declaredAssetKind(schema);
  if (kind === "reference") {
    const scheme = readOwn(stored, "scheme");
    const target = readOwn(stored, "target");
    if (
      typeof target !== "string" ||
      target.length === 0 ||
      `${String(scheme)}:${target}`.length > BOUNDS.attributeValueChars
    ) {
      return { ok: false, reason: "invalid_value" };
    }
    if (scheme === "asset") {
      const asset = assetKind === null ? null : resolveFacetAsset(assetRegistry, target, assetKind);
      return asset === null
        ? { ok: false, reason: "invalid_value" }
        : {
            ok: true,
            value: Object.freeze({
              kind: asset.kind,
              src: asset.src,
              ...(asset.width === undefined ? {} : { width: asset.width }),
              ...(asset.height === undefined ? {} : { height: asset.height }),
            }),
          };
    }
    if (assetKind !== null) {
      return { ok: false, reason: "invalid_value" };
    }
    if (scheme === "data") {
      // `resolveBinding` is the single authority for a bound value: it agrees
      // the value with the declared type, `enum`, `minimum` and `maximum`
      // before answering `ok`. The renderer maps its rejection into this
      // module's vocabulary and otherwise passes the value straight through —
      // re-checking the same schema here would be a second reader of one
      // source of truth, and its reject branch could never be reached.
      const resolved = resolveBinding(target, model, schema);
      return resolved.ok
        ? { ok: true, value: resolved.value }
        : { ok: false, reason: bindingIssue(resolved.reason) };
    }
    if (scheme !== "nav" && scheme !== "agent") {
      return { ok: false, reason: "invalid_value" };
    }
    return schema.type === "string" && schema.action === true
      ? { ok: true, value: `${scheme}:${target}` }
      : { ok: false, reason: "invalid_value" };
  }
  if (kind !== "scalar") {
    return { ok: false, reason: "invalid_value" };
  }
  if (assetKind !== null) {
    return { ok: false, reason: "invalid_value" };
  }
  if (schema.type === "string" && schema.action === true) {
    return { ok: false, reason: "invalid_value" };
  }
  const text = readOwn(stored, "value");
  if (typeof text !== "string" || (name !== ARG_PROP && text.length > BOUNDS.attributeValueChars)) {
    return { ok: false, reason: "invalid_value" };
  }
  const agreed = agreeScalar(text, schema);
  return agreed === null ? { ok: false, reason: "invalid_value" } : { ok: true, value: agreed };
}

/**
 * Resolves one node's props against its declared spec and the current model.
 *
 * Props are walked in the spec's declaration order and then the node's, both
 * sorted, so the same node always yields the same record and the same issue
 * list — which is what lets a caller derive a stable identity from a resolution
 * (`mount-node.tsx`'s `resetToken`, WU-33).
 *
 * Total: never throws, for any input of any type.
 */
export function resolveProps(
  node: ComponentNode,
  spec: ComponentSpec,
  model: DataModel,
  assetRegistry: FacetAssetRegistry = EMPTY_ASSET_REGISTRY,
): PropResolution {
  // A null prototype, not an object literal. `props[name] = value` with the name
  // `__proto__` on an ordinary literal invokes the prototype setter: the value
  // is silently not stored and the record's prototype is re-pointed instead. The
  // catalog refuses such a prop name, so this is defense in depth against a spec
  // that never went through it.
  const props = Object.create(null) as Record<string, ResolvedValue>;
  const issues: BindingIssue[] = [];

  // The two reads that must succeed before there is anything to walk at all,
  // each attributed on its own. A revoked proxy in place of either one throws
  // from `isRecord`, before a single prop has been looked at, so neither fault
  // belongs to a prop — and reporting it as one would be a sentinel by another
  // name.
  const schemas = readOrNull(() => declaredProps(spec));
  if (schemas === null) {
    issues.push({ scope: "node", reason: "spec_unreadable" });
  }
  const stored = readOrNull(() => storedProps(node));
  if (stored === null) {
    issues.push({ scope: "node", reason: "node_unreadable" });
  }
  if (schemas === null || stored === null) {
    return { props: Object.freeze(props), issues: Object.freeze(issues) };
  }

  try {
    collect(schemas, stored, model, assetRegistry, props, issues);
    const argument = props[ARG_PROP];
    if (typeof argument === "string" && argument.length > BOUNDS.collectedValueChars) {
      issues.push({ scope: "node", reason: "event_arg_too_long" });
    }
  } catch {
    // Nothing below is expected to reach here — every per-prop fault is already
    // isolated — but a fault that did would otherwise leave a resolution that
    // looks clean. Whatever resolved is kept, and the node is marked.
    issues.push({ scope: "node", reason: "node_unreadable" });
  }
  return { props: Object.freeze(props), issues: Object.freeze(issues) };
}

/** Runs one read that may throw on a hostile input, answering `null` if it does. */
function readOrNull(
  read: () => Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | null {
  try {
    return read();
  } catch {
    return null;
  }
}

/** A prop-scoped issue's reason, named from the discriminated union it lives in. */
type PropIssueReason = Extract<BindingIssue, { readonly scope: "prop" }>["reason"];

/** What one declared prop resolved to: a value, nothing at all, or a fault. */
type PropOutcome =
  | { readonly kind: "value"; readonly value: ResolvedValue }
  | { readonly kind: "absent" }
  | { readonly kind: "issue"; readonly reason: PropIssueReason };

/**
 * Resolves one declared prop, converting a throw into that prop's own issue.
 *
 * The guard is per-prop rather than around the whole walk, and that placement is
 * the point. Three inputs a host controls can throw from inside a single prop —
 * a revoked proxy in the model (core's `isPlainObject` calls `Array.isArray`
 * before any guard), a schema whose `bindable` getter throws, and an `enum`
 * whose `includes` throws — and a guard around the walk would let any one of
 * them erase every sibling prop that had already resolved, including the
 * `missing_required` the walk would otherwise have reported. One hostile prop
 * costs exactly one prop.
 */
function resolveDeclared(
  name: string,
  schemas: Readonly<Record<string, unknown>>,
  stored: Readonly<Record<string, unknown>>,
  model: DataModel,
  assetRegistry: FacetAssetRegistry,
): PropOutcome {
  try {
    return declared(name, schemas, stored, model, assetRegistry);
  } catch {
    return { kind: "issue", reason: "resolution_failed" };
  }
}

function declared(
  name: string,
  schemas: Readonly<Record<string, unknown>>,
  stored: Readonly<Record<string, unknown>>,
  model: DataModel,
  assetRegistry: FacetAssetRegistry,
): PropOutcome {
  const schema = readSchema(readOwn(schemas, name));
  if (schema === null) {
    return { kind: "absent" };
  }
  if (!Object.prototype.hasOwnProperty.call(stored, name)) {
    if (isRequired(schema)) {
      return { kind: "issue", reason: "missing_required" };
    }
    const fallback = agreeDefault(declaredDefault(schema), schema);
    return fallback === null ? { kind: "absent" } : { kind: "value", value: fallback };
  }
  const storedValue = readOwn(stored, name);
  if (
    name === ARG_PROP &&
    isSafeRecord(storedValue) &&
    readOwn(storedValue, "kind") === "reference"
  ) {
    return { kind: "issue", reason: "invalid_value" };
  }
  const outcome = resolveValue(name, storedValue, schema, model, assetRegistry);
  return outcome.ok
    ? { kind: "value", value: outcome.value }
    : { kind: "issue", reason: outcome.reason };
}

function collect(
  schemas: Readonly<Record<string, unknown>>,
  stored: Readonly<Record<string, unknown>>,
  model: DataModel,
  assetRegistry: FacetAssetRegistry,
  props: Record<string, ResolvedValue>,
  issues: BindingIssue[],
): void {
  const data = isSafeRecord(model) ? model : {};

  for (const name of [...ownKeys(schemas)].sort()) {
    const outcome = resolveDeclared(name, schemas, stored, data, assetRegistry);
    if (outcome.kind === "value") {
      props[name] = outcome.value;
    } else if (outcome.kind === "issue") {
      issues.push({ scope: "prop", prop: name, reason: outcome.reason });
    }
  }

  for (const name of [...ownKeys(stored)].sort()) {
    if (!Object.prototype.hasOwnProperty.call(schemas, name)) {
      issues.push({ scope: "prop", prop: name, reason: "unknown_prop" });
    }
  }
}

/**
 * The absent-provider sentinel.
 *
 * A missing `DataProvider` is a renderer composition fault, not corrupt data,
 * and the two must not be confused: defaulting to an empty model would make
 * every binding on the page dangle and report an authoring problem the author
 * does not have. The sentinel makes the fault determinate at the first read.
 */
const NO_MODEL = Symbol("facet.noDataModel");

const DataModelContext = createContext<DataModel | typeof NO_MODEL>(NO_MODEL);

/**
 * Publishes the current Data Model to every mounted component beneath it.
 *
 * The model is the context value itself, so an accepted publish — a new model —
 * is one context change and every reader re-resolves. Components that bind
 * nothing re-render too and resolve to exactly what they resolved before, which
 * is why "refresh" needs no dependency tracking to stay correct.
 */
export function DataProvider(props: {
  readonly model: DataModel;
  readonly children?: ReactNode;
}): ReactNode {
  return createElement(DataModelContext.Provider, { value: props.model }, props.children);
}

/** The Data Model in force. A determinate error when no provider is above. */
export function useDataModel(): DataModel {
  const model = useContext(DataModelContext);
  if (model === NO_MODEL) {
    throw new Error("Facet renderer: no Data Model provider is mounted above this component.");
  }
  return model;
}

/**
 * Resolves one node's props against the model in force, re-resolving whenever
 * the node, its spec, or the model changes.
 *
 * The model is a memo dependency, not an afterthought: leaving it out is
 * exactly how a value that no longer exists survives the publish that removed
 * it, which is the one failure this hook exists to make impossible.
 *
 * **The caller's obligation, stated because it is not checkable here.** Refresh
 * is keyed on the model's *identity*, so a publish must hand `DataProvider` a
 * **new** model object. A caller that mutates the committed model in place and
 * re-renders leaves every bound component showing its pre-publish value, with
 * no error and no issue — DC-019's failure arriving silently, which is worse
 * than it arriving loudly. Core meets this by construction: `writePath` derives
 * a new model and never mutates the prior one, which is also what lets a
 * rejected publish leave prior data byte-identical. `binding.test.ts` pins the
 * obligation so a future caller that mutates instead fails there rather than in
 * a browser.
 */
export function useResolvedProps(
  node: ComponentNode,
  spec: ComponentSpec,
  assetRegistry: FacetAssetRegistry = EMPTY_ASSET_REGISTRY,
): PropResolution {
  const model = useDataModel();
  return useMemo(
    () => resolveProps(node, spec, model, assetRegistry),
    [node, spec, model, assetRegistry],
  );
}
