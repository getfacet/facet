/**
 * Renderer bootstrap — the single place Facet's trust boundary is closed.
 *
 * A host registers trusted React code **once**, before a session exists, and
 * this function is that moment. It takes the catalog an agent may author
 * against, the registry that actually mounts, the theme every component styles
 * itself from, and optionally the host's neutral copy; it either hands back one
 * validated, frozen session boundary or it rejects. There is no third outcome
 * and no mid-session registration: a rejected bootstrap returns **no** catalog,
 * registry, theme or copy, so a host has nothing to render a partially matched
 * document with.
 *
 * **One object form.** `bootstrapRenderer({ catalog, registry, theme,
 * themeExtensions?, copy? })` is the only spelling. The form is closed — an
 * option it does not declare is a rejection, not an ignored extra — because a
 * silently dropped option is how a host ends up believing it configured
 * something it did not. Closed against the **own property names**, and every option read is an own read: an option
 * defined non-enumerably still counts, and one reachable only through a
 * prototype is not an option at all, so the check and the read agree on what an
 * option is. An unknown key inherited from a prototype is deliberately *not* a
 * rejection — nothing can read it, so refusing it would turn unrelated
 * `Object.prototype` pollution into an outage while closing nothing.
 *
 * **The catalog rules are mirrored, never re-invented.** `validateCatalog` in
 * `@facet/core` already reserves `Facet`, requires exactly one `Screen`, and
 * refines that `Screen` (takes children, collects nothing, declares a required
 * scalar-string `name` with no default, domain or binding). Those rejections are
 * relayed here **with their code and location unchanged**, so a host reads one
 * vocabulary and the two halves cannot drift into two answers for the same
 * fault. The same holds for `validateModalConformance`, `validateTheme` and
 * `resolveNeutralCopy`.
 *
 * **`Modal` is optional; only `Screen` is mandatory.** A registered `Modal` must
 * conform to the frame contract, and a nonconforming one rejects with its code
 * and location unchanged. A catalog that registers none is a host that never
 * needs the overlap contract: it bootstraps, and the session offers no authored
 * modal tag and no frame. So the conformance rule is unconditional and the
 * *call* is conditional — `validateModalConformance` still refuses an omitted
 * spec whenever it is asked.
 *
 * **Exactly one rule is bootstrap's own: `Facet` may not be registered.** It is
 * a grammar position, and the catalog cannot speak for the registry — a host may
 * hand over a hand-built frozen record that never passed through
 * `createRegistry`. `Screen`, by contrast, is a registered member like any
 * other, so nothing here reserves it. What makes a registry lacking a trusted
 * `Screen` fail is **exact tag-set equality**: every catalogued component needs
 * an implementation and every implementation needs a spec. That is why the
 * failure lands at bootstrap, where a host can read it, instead of at the first
 * render of a screen root.
 *
 * **The registry is snapshotted, not borrowed.** The host's object is copied
 * into a fresh null-prototype record and frozen, so a caller that keeps a
 * mutable reference cannot add, remove or swap a component after the tag sets
 * were compared. Borrowing it would make the equality check a statement about
 * one instant rather than about the session.
 *
 * **Neutral copy has exactly one input path.** `copy` is the only way to change
 * what Facet says when it has nothing to show, and with it omitted — read as an
 * **own** property, so a prototype cannot supply one — the resolved copy *is*
 * `NEUTRAL_COPY_DEFAULTS`, the same frozen object, not a reconstruction of it. Nothing is looked up by a key an author, the Data Model
 * or a component prop could supply, so a catalog full of props named after copy
 * slots changes the rendered neutral text by not one byte (DC-015). Only the
 * exact lowercase `id` is a reserved prop name; there is no `facet*`
 * reservation, which is precisely why this guarantee is structural rather than
 * name-based.
 *
 * **No process global.** Everything a session needs is in the returned value.
 * This module's entire runtime surface is one function, so two sessions in one
 * process cannot see each other.
 *
 * `bootstrapRenderer` is **total**: it never throws, for any input of any type,
 * including a catalog with a throwing getter or a registry that traps its own
 * keys. Bootstrap is host configuration, so a fault is a result a host can read.
 */

import type {
  ComponentSpec,
  FacetCatalog,
  FacetTheme,
  FacetThemeExtensionDeclaration,
  NeutralCopy,
} from "@facet/core";
import {
  buildCatalogIndex,
  resolveNeutralCopy,
  validateCatalog,
  validateModalConformance,
  validateTheme,
  validateThemeExtensionDeclarations,
} from "@facet/core";

import type { ComponentRegistry } from "./registry.js";
import { snapshotRegistryForTags } from "./registry.js";

/**
 * What `bootstrapRenderer` answers: the validated session boundary, or the
 * first failure.
 *
 * Both branches are spelled out in full. The rejection is part of the public
 * contract — a host has to be able to name and store what it caught — and the
 * acceptance carries everything a renderer needs and nothing it does not. Note
 * what the rejection branch does **not** carry: no catalog, no registry, no
 * theme, no copy. Half a trust boundary is not a trust boundary.
 */
export type RendererBootstrap =
  | {
      readonly ok: true;
      /** The validated, frozen catalog: what an agent may author. */
      readonly catalog: FacetCatalog;
      /** The tag lookup for that catalog, built once per session. */
      readonly index: ReadonlyMap<string, ComponentSpec>;
      /** The session's own frozen snapshot of the registry: what actually mounts. */
      readonly registry: ComponentRegistry;
      /** The validated theme every registered component styles itself from. */
      readonly theme: FacetTheme;
      /** Host-declared theme extension namespaces active for this session. */
      readonly themeExtensions: readonly FacetThemeExtensionDeclaration[];
      /** The framework copy this session shows when it has nothing else to show. */
      readonly copy: NeutralCopy;
    }
  | {
      readonly ok: false;
      readonly code: string;
      readonly at: string;
      readonly detail: string;
    };

/**
 * The rejection branch, derived from the public result. Deriving it keeps this
 * private name out of every emitted signature.
 */
type BootstrapRejection = Extract<RendererBootstrap, { readonly ok: false }>;

/** The closed option form. An option outside this set is a rejection. */
const OPTION_KEYS: readonly string[] = ["catalog", "registry", "theme", "themeExtensions", "copy"];

/** The tag whose registered spec the framework overlap frame projects. */
const MODAL_TAG = "Modal";

function reject(code: string, at: string, detail: string): BootstrapRejection {
  return { ok: false, code, at, detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads one option, **own properties only**.
 *
 * A plain `options[name]` walks the prototype chain, which would give every
 * option a second input path nobody declared: with `Object.prototype.copy`
 * planted, a host that omits `copy` — the normal case, and the whole point of
 * the option being optional — silently gets the planted value instead of the
 * framework defaults. Core's `neutral-copy.ts` uses `Object.hasOwn` at every
 * level for exactly this reason; reading inherited here would defeat that
 * discipline one frame above it.
 *
 * The same rule holds for `catalog`, `theme` and `registry`, so that the read
 * and the closed-form check above agree on what an option *is*. An option that
 * exists only on a prototype is therefore absent, and a required one then
 * rejects by its own validator — loudly, with the code that names it.
 */
function read(options: Record<string, unknown>, name: string): unknown {
  return Object.hasOwn(options, name) ? options[name] : undefined;
}

/**
 * Closes the trust boundary for one session.
 *
 * The order of the checks below is fixed, so the same input always yields the
 * same first failure: the option form, then the catalog and any Modal it
 * carries, then the theme and the copy, then the registry and its equality with
 * the catalog. Catalog before registry because the catalog is what the registry
 * is compared *against* — reporting a tag mismatch against a catalog that was
 * never valid would name the wrong fault.
 */
export function bootstrapRenderer(options: {
  /** The component set an agent may author. Validated, never trusted. */
  readonly catalog: FacetCatalog;
  /** The trusted implementations. Snapshotted and frozen for this session. */
  readonly registry: ComponentRegistry;
  /** The complete token contract this session renders with. */
  readonly theme: FacetTheme;
  /** Optional host extension token declarations for `theme.extensions`. */
  readonly themeExtensions?: unknown;
  /** The host's neutral copy override. Omit it for the framework defaults. */
  readonly copy?: unknown;
}): RendererBootstrap {
  try {
    return bootstrap(options);
  } catch {
    return reject(
      "bootstrap_read_failed",
      "",
      "Reading the bootstrap options threw; they must be plain data.",
    );
  }
}

function bootstrap(options: unknown): RendererBootstrap {
  if (!isRecord(options)) {
    return reject(
      "bootstrap_not_an_object",
      "",
      "Bootstrap takes one object: { catalog, registry, theme, themeExtensions?, copy? }.",
    );
  }
  // `getOwnPropertyNames`, not `Object.keys`: an option defined non-enumerably
  // is still an option the host wrote, and a closed form that only inspects the
  // enumerable half is decorative. Sorted, so which option a host wrote first
  // never decides what it is told.
  const unknownKey = Object.getOwnPropertyNames(options)
    .sort()
    .find((key) => !OPTION_KEYS.includes(key));
  if (unknownKey !== undefined) {
    return reject("unknown_bootstrap_key", unknownKey, "The bootstrap form is closed.");
  }

  const catalog = validateCatalog(read(options, "catalog"));
  if (!catalog.ok) {
    // Relayed verbatim: `reserved_structural_tag`, `duplicate_tag`,
    // `missing_screen_spec` and `nonconforming_screen_spec` are the catalog's
    // codes and locations, and restating them here would give one fault two
    // answers.
    return catalog;
  }
  // Only when the host registered one. `Modal` is optional (owner ruling): a
  // catalog without it is a host that never needs the overlap contract, and the
  // session simply offers no authored modal tag and no frame. A `Modal` that
  // *is* present is held to the frame contract exactly as before —
  // `validateModalConformance` still rejects an omitted spec when called; what
  // is conditional is the call, not the rule.
  const modalSpec = catalog.catalog.components.find((spec) => spec.tag === MODAL_TAG);
  if (modalSpec !== undefined) {
    const modal = validateModalConformance(modalSpec);
    if (!modal.ok) {
      return modal;
    }
  }
  const themeExtensions = validateThemeExtensionDeclarations(read(options, "themeExtensions"));
  if (!themeExtensions.ok) {
    return themeExtensions;
  }

  const theme = validateTheme(read(options, "theme"), {
    catalog: catalog.catalog,
    extensions: themeExtensions.extensions,
  });
  if (!theme.ok) {
    return theme;
  }
  const copy = resolveNeutralCopy(read(options, "copy"));
  if (!copy.ok) {
    return copy;
  }
  const registry = snapshotRegistryForTags(
    read(options, "registry"),
    catalog.catalog.components.map((spec) => spec.tag),
  );
  if (!registry.ok) {
    return registry;
  }
  return {
    ok: true,
    catalog: catalog.catalog,
    index: buildCatalogIndex(catalog.catalog),
    registry: registry.registry,
    theme: theme.theme,
    themeExtensions: themeExtensions.extensions,
    copy: copy.copy,
  };
}
