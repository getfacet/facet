/**
 * The field store — where a collected value lives, and the only path from a
 * field to an event.
 *
 * Facet owns the value (D-08). A collectable component is mounted inside
 * `FieldHost`, which injects the current value under the **catalog-declared**
 * value prop and hands back an `onValueChange` the component reports through.
 * The component keeps no state and is never read from the page: the payload is
 * assembled from this store, so a value written into an element behind React's
 * back changes nothing that is sent.
 *
 * A component cannot stamp the collection address into the DOM because it is
 * never given it. `FieldHost` reads the exact lowercase `name` prop, registers
 * it here, and **removes it from the props the component receives** — so the
 * ordinary way to write a trusted component, spreading what it is handed onto
 * its element, produces no `name` attribute. The injection carries declared
 * component props and the declared value prop; no `data-*` key, no hidden
 * mirror, and no generated collect id exist to forward.
 *
 * Collectable identity is the catalog's, not the component's. A component
 * cannot opt itself in, opt itself out, or quietly yield nothing — `isCollectable`
 * reads the validated spec, and a collectable node that never registered is
 * reported to the payload as `unavailable`, which becomes the structured
 * `collect_source_unavailable` rather than a silent blank.
 *
 * **Sensitive is a property of the source, not of the payload builder.** A
 * sensitive field's collect-facing source carries no `value` key at all, so
 * there is nothing for a consumer to leak; `collect.ts` independently maps that
 * kind to `omitted_sensitive`. Two locks, neither depending on the other, for
 * the one exclusion whose failure is unrecoverable. What is deliberately *not*
 * withheld is the value the control itself renders: a controlled password input
 * has to show what the visitor typed, and the prohibition is the collection
 * channel, not the control.
 *
 * The store is **local view-state**. It holds values keyed by node id, it has no
 * access to the Data Model — asserted by parsing this module's import surface —
 * and it emits no patch: a keystroke changes what this store returns and
 * nothing else, which is what keeps the server the only writer of the document
 * and the data.
 *
 * Values are clamped to `B-23` on write, so the store cannot come to hold a
 * value that could not be collected. Every function is **total**: a write to an
 * unregistered node, a disposer that fires twice, and a component reporting a
 * value after unmounting are all no-ops rather than errors.
 *
 * The module is **private**: it is not barrel-exported and is not a package
 * entry point.
 */

import type { CollectSpec, ComponentSpec } from "@facet/core";
import { BOUNDS } from "@facet/core";
import type { ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from "react";

import type { CollectSource } from "./collect.js";

/**
 * The prop that carries a collectable node's collect name.
 *
 * `CollectSpec` stays closed and gains no `nameProp`: the exact lowercase `name`
 * is the **framework** collection address (D-08), and every collectable spec must
 * declare it as a required scalar string with no `default`, `enum` or `bindable`
 * (WU-11). So this is a convention the catalog enforces, not one the renderer
 * infers from a component.
 *
 * Author validation additionally guarantees the authored value is a scalar
 * literal satisfying `isFacetIdentifier` on **every** collectable node, whether
 * or not a `collect` list names it (WU-13) — an accepted collectable may never
 * carry an unusable address. Against a validated document, therefore, `readName`
 * always finds a non-empty string, and its string/non-empty test is **not**
 * author-fault handling. It is a totality guard for the other input this
 * renderer must survive: corrupt persisted state, which degrades to a bounded
 * safe subset rather than throwing (core invariant 3). A node the guard answers
 * `undefined` for still holds and shows its value; it is simply not addressable,
 * so nothing can collect it.
 */
const COLLECT_NAME_PROP = "name";

/**
 * The address is normalised in one place, so the store cannot hold `""` as a
 * name through one entry point and `undefined` through another. An empty name
 * addresses nothing, and a field that answers to `""` would answer to a `collect`
 * list that named nothing.
 */
function normalizeName(name: string | undefined): string | undefined {
  return name === undefined || name === "" ? undefined : name;
}

/** A resolved prop value: an authored scalar, or what a `data:path` selected. */
type PropValue =
  string | number | boolean | readonly unknown[] | { readonly [key: string]: unknown };

/** A node's resolved props, keyed by declared prop name. */
type ResolvedProps = Readonly<Record<string, PropValue>>;

/** A spec the catalog declared collectable. Derived, so the two cannot drift. */
export interface CollectableSpec extends ComponentSpec {
  readonly collect: CollectSpec;
}

/** What Facet injects into a collectable mount: the value, and the way back. */
export interface FieldInjection {
  /**
   * What the trusted component is handed: the node's declared props with the
   * declared value prop set to Facet's value, and **without the collection
   * address**.
   *
   * The exact lowercase `name` is the framework's address (D-08). `FieldHost`
   * consumes it to register the field and it stops there, so a component written
   * the ordinary way — spreading what it is given onto its element — cannot put
   * a `name` attribute in the DOM. There is no `data-*` key, no hidden mirror,
   * and no generated collect id here either: the store is the only channel.
   */
  readonly props: ResolvedProps;
  /** How the visitor's new value reaches the store. */
  readonly onValueChange: (value: string) => void;
}

/** One live collectable node, as the store records it. */
export interface FieldRegistration {
  readonly nodeId: string;
  /** The name a `collect` list addresses it by; absent when the node declares none. */
  readonly name?: string;
  readonly sensitive: boolean;
  /** The value Facet shows until the visitor changes it. */
  readonly seed: string;
}

/** The per-session store of local field values. There is no process-global one. */
export interface FieldStore {
  /** Records a live node and answers with the disposer that removes it. */
  register(registration: FieldRegistration): () => void;
  /**
   * Re-points a live node's collect address, keeping its value.
   *
   * Values are keyed by node id, so the address is a property of the field
   * rather than the field's identity: re-authoring only the name moves what a
   * `collect` list has to say to reach this node and changes nothing about what
   * the visitor typed.
   */
  setName(nodeId: string, name: string | undefined): void;
  /** Records the visitor's new value for a registered node. */
  write(nodeId: string, value: string): void;
  /** The node's current value, or `undefined` when nothing is registered under it. */
  readValue(nodeId: string): string | undefined;
  /** Subscribes to every change, for `useSyncExternalStore`. */
  subscribe(listener: () => void): () => void;
  /** What the payload builder sees for one collect name. */
  collectSource(name: string): CollectSource;
}

/** What `FieldHost` is handed. `mount` renders the trusted component. */
export interface FieldHostProps {
  readonly nodeId: string;
  readonly spec: CollectableSpec;
  readonly props: ResolvedProps;
  readonly store: FieldStore;
  readonly mount: (injection: FieldInjection) => ReactNode;
}

/** One stored field. Records are replaced rather than mutated, so a read is a snapshot. */
interface FieldRecord {
  readonly name: string | undefined;
  readonly sensitive: boolean;
  readonly value: string;
  /** Identifies this registration, so a stale disposer removes nothing. */
  readonly token: symbol;
}

/**
 * Whether the active catalog declared this component collectable.
 *
 * The answer comes from the validated spec and nowhere else: not the tag, not
 * the presence of a prop that looks the part, and not anything the component
 * renders.
 */
export function isCollectable(spec: ComponentSpec): spec is CollectableSpec {
  return spec.collect?.collectable === true;
}

/** A value the store may hold: never longer than a value that could be collected. */
function clamp(value: string): string {
  return value.length > BOUNDS.collectedValueChars
    ? value.slice(0, BOUNDS.collectedValueChars)
    : value;
}

/** Creates one session's field store. Nothing here is shared between sessions. */
export function createFieldStore(): FieldStore {
  const records = new Map<string, FieldRecord>();
  const listeners = new Set<() => void>();

  /** Iterates a copy, so a listener that unsubscribes while notified is safe. */
  function notify(): void {
    for (const listener of [...listeners]) {
      listener();
    }
  }

  function register(registration: FieldRegistration): () => void {
    const token = Symbol("field");
    records.set(registration.nodeId, {
      name: normalizeName(registration.name),
      sensitive: registration.sensitive,
      value: clamp(registration.seed),
      token,
    });
    notify();
    return () => {
      // Only the registration this disposer belongs to. A remount registers the
      // same node id again before the old effect's cleanup can run in some
      // orders, and a disposer that fired twice would otherwise delete a live
      // field.
      if (records.get(registration.nodeId)?.token !== token) {
        return;
      }
      records.delete(registration.nodeId);
      notify();
    };
  }

  function setName(nodeId: string, name: string | undefined): void {
    const record = records.get(nodeId);
    if (record === undefined) {
      return;
    }
    const next = normalizeName(name);
    if (next === record.name) {
      return;
    }
    records.set(nodeId, { ...record, name: next });
    notify();
  }

  function write(nodeId: string, value: string): void {
    const record = records.get(nodeId);
    if (record === undefined) {
      return;
    }
    const next = clamp(value);
    if (next === record.value) {
      return;
    }
    records.set(nodeId, { ...record, value: next });
    notify();
  }

  function readValue(nodeId: string): string | undefined {
    return records.get(nodeId)?.value;
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  /**
   * Resolves one collect name to a source.
   *
   * Two live fields answering to one name is **ambiguous**, and the closed entry
   * union has no kind for that — so the answer is that there is no source. It is
   * order-independent and states the absence, where picking one would be a
   * silent guess that changes with mount order.
   *
   * The scan is linear over the live fields rather than an index, because an
   * index that disagreed with the records would be a second source of truth for
   * exactly the question this function exists to answer.
   */
  function collectSource(name: string): CollectSource {
    let found: FieldRecord | undefined;
    for (const record of records.values()) {
      if (record.name !== name) {
        continue;
      }
      if (found !== undefined) {
        return Object.freeze({ kind: "unavailable" });
      }
      found = record;
    }
    if (found === undefined) {
      return Object.freeze({ kind: "unavailable" });
    }
    return found.sensitive
      ? Object.freeze({ kind: "sensitive" })
      : Object.freeze({ kind: "value", value: found.value });
  }

  return Object.freeze({ register, setName, write, readValue, subscribe, collectSource });
}

/**
 * The value a node shows before the visitor changes it: what the author wrote,
 * or — when the author wrote nothing usable — the **declared default**, which is
 * what makes an untouched collectable node yield a stated value rather than an
 * inferred blank.
 */
function readSeed(spec: CollectableSpec, props: ResolvedProps): string {
  const authored = props[spec.collect.valueProp];
  if (typeof authored === "string") {
    return authored;
  }
  const declared = spec.props[spec.collect.valueProp];
  if (declared !== undefined && "default" in declared && typeof declared.default === "string") {
    return declared.default;
  }
  return "";
}

/**
 * Whether this node's value is withheld.
 *
 * The catalog requires `sensitiveProp` to name a declared boolean prop, so any
 * other value is already off-contract; folding every truthy one to "sensitive"
 * errs toward withholding, which is the only safe direction.
 */
function readSensitive(collect: CollectSpec, props: ResolvedProps): boolean {
  const { sensitiveProp } = collect;
  return sensitiveProp === undefined ? false : Boolean(props[sensitiveProp]);
}

/** The name a `collect` list addresses this node by, when it declares one. */
function readName(props: ResolvedProps): string | undefined {
  const value = props[COLLECT_NAME_PROP];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Registration has to be committed before the visitor can act, so it runs in a
 * layout effect. Rendering to a string has no visitor and no store to keep, so
 * the server path takes the passive effect and simply never registers, rather
 * than warning about an effect that cannot run there.
 */
const useRegistrationEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Mounts one collectable component with its value injected.
 *
 * The seed and the sensitivity are the registration's identity; the **address is
 * not**. When the server authors a new value for the node, the registration is
 * replaced and the field shows the authored value again, and when the field's
 * sensitivity changes it is replaced too — a value typed under one answer to
 * "may this be collected?" does not carry over to the other. An ordinary
 * re-render that leaves both alone keeps what the visitor typed, and an unmount
 * drops the value entirely, so a field that comes back comes back seeded rather
 * than carrying a stale one.
 *
 * Re-authoring only the name moves the address and keeps the value, because
 * values are keyed by the stable node id. The agent renaming a field is not the
 * visitor changing their answer, and it is not something the visitor can see, so
 * it must not silently empty the control in front of them.
 */
export function FieldHost(host: FieldHostProps): ReactNode {
  const { nodeId, spec, props, store, mount } = host;
  const seed = readSeed(spec, props);
  const sensitive = readSensitive(spec.collect, props);
  const name = readName(props);
  const valueProp = spec.collect.valueProp;

  const stored = useSyncExternalStore(
    store.subscribe,
    () => store.readValue(nodeId),
    () => store.readValue(nodeId),
  );
  const value = stored ?? seed;

  // The registration's identity is the node, its seed and its sensitivity — not
  // its address. A new seed means the server authored a new value, and a changed
  // sensitivity means the field is a different kind of thing to collect from, so
  // both replace the registration and drop what the visitor typed. That second
  // one is deliberate: it is what makes re-authoring a secret field as an
  // ordinary one yield nothing rather than the secret.
  useRegistrationEffect(
    () => store.register({ nodeId, sensitive, seed, ...(name === undefined ? {} : { name }) }),
    // `name` is read here but is intentionally not a dependency: it is carried
    // so a fresh registration is complete in one step, and the effect below owns
    // every later change to it.
    [store, nodeId, sensitive, seed],
  );

  // The address moves on its own, because values are keyed by the stable node
  // id. Re-authoring only `name` re-points what a `collect` list must say to
  // reach this field and keeps what the visitor typed; folding it back into the
  // registration above would discard their input for a change they cannot see.
  useRegistrationEffect(() => {
    store.setName(nodeId, name);
  }, [store, nodeId, name]);

  const onValueChange = useCallback(
    (next: string) => {
      store.write(nodeId, next);
    },
    [store, nodeId],
  );

  const injected = useMemo<ResolvedProps>(() => {
    const forwarded: Record<string, PropValue> = { ...props, [valueProp]: value };
    // The collection address is the renderer's. `FieldHost` has already read it
    // and registered it in the store, and it stops here — so a trusted component
    // written the ordinary way, spreading what it is given onto its element,
    // cannot put a `name` attribute in the DOM. Stripping it last states the
    // property unconditionally: WU-11 already forbids a `valueProp` that names
    // the address, and this does not lean on that holding.
    delete forwarded[COLLECT_NAME_PROP];
    return Object.freeze(forwarded);
  }, [props, valueProp, value]);

  return mount({ props: injected, onValueChange });
}
