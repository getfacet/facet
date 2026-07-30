/**
 * The React registry — the trusted half of Facet's one immutable trust
 * boundary.
 *
 * The catalog says what an agent may author; this says what actually mounts. A
 * `ComponentRegistry` is a **plain frozen record** from an exact tag to a
 * callable implementation — no brand, no class, no wrapper, and above all no
 * module-level singleton. That shape is deliberate on every count:
 *
 * - **Structural, so the shipped defaults drop in unchanged.**
 *   `@facet/assets/react` declares `DEFAULT_REGISTRY` as exactly
 *   `Readonly<Record<string, MountedComponent<ReactNode, ReactNode>>>`. A branded
 *   or class-wrapped registry would force that package to import this one to
 *   construct its value, and the assets → core edge would become a cycle (D-09).
 *   A structural type keeps the edge one-way and costs nothing: a host that
 *   builds its own frozen record is as valid as one that calls `createRegistry`,
 *   because bootstrap re-checks either.
 * - **No global.** Registration is a bootstrap act, not a runtime one, and two
 *   sessions in one process must not be able to see each other's components.
 *   This module's entire runtime surface is one function, so there is nowhere a
 *   registry could be kept.
 *
 * `createRegistry` takes **ordered entries rather than an object**, and that is
 * the only interesting decision here. An object literal resolves a duplicate key
 * by overwriting: `{...defaults, ...custom}` silently replaces a trusted
 * implementation with a later one, leaving no trace and no way for Facet to
 * notice. Pairs preserve both registrations long enough to reject the second —
 * **before the record is materialized**, which is the only point at which the
 * collision still exists. So composing defaults with custom components is
 * `createRegistry([...Object.entries(DEFAULT_REGISTRY), ...customEntries])`, and
 * spreading them into one object beforehand is out of contract: it resolves the
 * collision before Facet ever sees it.
 *
 * The record is built with a **null prototype**, so no tag can resolve to an
 * inherited member — `registry["constructor"]` answers nothing rather than
 * `Object`'s constructor — and a `__proto__` tag lands as an ordinary own entry
 * instead of being swallowed by a setter.
 *
 * `createRegistry` is **total**: it never throws, for any input of any type,
 * including an entry with a throwing accessor. Registration is host
 * configuration, so a malformed one is a rejection the host can read, never an
 * exception thrown out of bootstrap.
 */

import type { MountedComponent } from "@facet/core";
import type { ReactNode } from "react";

/**
 * The registered components for one session: an exact tag mapped to the trusted
 * React implementation that renders it.
 *
 * Spelled structurally, and identical to the type `@facet/assets/react` already
 * declares for `DEFAULT_REGISTRY`, so the shipped defaults satisfy it with no
 * cast and no adaptation.
 */
export type ComponentRegistry = Readonly<Record<string, MountedComponent<ReactNode, ReactNode>>>;

/** The one grammar position no component may occupy. Compared exactly. */
const FACET_TAG = "Facet";

/**
 * The rejection branch, derived from `createRegistry`'s declared return type.
 * Deriving it rather than declaring it keeps this private name out of every
 * emitted public signature while still giving the helpers below one thing to
 * return.
 */
type RegistryRejection = Extract<ReturnType<typeof createRegistry>, { readonly ok: false }>;

function reject(code: string, at: string, detail: string): RegistryRejection {
  return { ok: false, code, at, detail };
}

/**
 * Builds the registry for one session from ordered `[tag, implementation]`
 * pairs.
 *
 * The result type is written inline rather than through a named alias: the
 * Barrel Export Contract lists no name for it, and a public signature may not
 * refer to an off-barrel one.
 */
export function createRegistry(
  entries: readonly (readonly [
    tag: string,
    implementation: MountedComponent<ReactNode, ReactNode>,
  ])[],
):
  | { readonly ok: true; readonly registry: ComponentRegistry }
  | {
      readonly ok: false;
      readonly code: string;
      readonly at: string;
      readonly detail: string;
    } {
  try {
    return buildRegistry(entries);
  } catch {
    return reject(
      "registry_read_failed",
      "",
      "Reading the registry entries threw; they must be plain pairs.",
    );
  }
}

function buildRegistry(
  entries: readonly (readonly [string, MountedComponent<ReactNode, ReactNode>])[],
): ReturnType<typeof createRegistry> {
  if (!Array.isArray(entries as unknown)) {
    return reject("invalid_registry_entries", "", "A registry is built from ordered tag pairs.");
  }
  // Collected before anything is materialized. A duplicate is only observable
  // while both registrations still exist, so the check has to happen here rather
  // than against a half-built record.
  const seen = new Set<string>();
  const accepted: [string, MountedComponent<ReactNode, ReactNode>][] = [];
  for (const [index, entry] of entries.entries()) {
    const at = `entries[${index}]`;
    if (!Array.isArray(entry as unknown) || entry.length !== 2) {
      return reject("invalid_registry_entry", at, "Each entry is a [tag, implementation] pair.");
    }
    const [tag, implementation] = entry;
    if (typeof tag !== "string" || tag.length === 0) {
      return reject("invalid_registry_entry", `${at}.tag`, "A registered tag is a non-empty name.");
    }
    if (tag === FACET_TAG) {
      return reject(
        "reserved_structural_tag",
        `${at}.tag`,
        "Facet is a grammar position, not a component.",
      );
    }
    if (seen.has(tag)) {
      return reject(
        "duplicate_tag",
        `${at}.tag`,
        "One tag resolves to exactly one implementation; a later entry may not replace an earlier one.",
      );
    }
    if (typeof implementation !== "function") {
      return reject(
        "implementation_not_callable",
        `${at}.implementation`,
        "A registered implementation is a component function.",
      );
    }
    seen.add(tag);
    accepted.push([tag, implementation]);
  }
  return { ok: true, registry: freezeRegistry(accepted) };
}

/**
 * Materializes the record. Shared with the bootstrap snapshot, which owes the
 * session the same guarantees: null prototype, own entries only, frozen.
 *
 * @internal — not barrel-exported.
 */
export function freezeRegistry(
  entries: readonly (readonly [string, MountedComponent<ReactNode, ReactNode>])[],
): ComponentRegistry {
  const registry = Object.create(null) as Record<string, MountedComponent<ReactNode, ReactNode>>;
  for (const [tag, implementation] of entries) {
    // `defineProperty` rather than assignment, so a tag named after an accessor
    // cannot be intercepted on the way in.
    Object.defineProperty(registry, tag, {
      value: implementation,
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }
  return Object.freeze(registry);
}
