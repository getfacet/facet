/**
 * The active catalog — one immutable trust boundary per session.
 *
 * A `FacetCatalog` is the complete set of components an agent may author. It is
 * validated once, frozen, and never changed again: registration is a bootstrap
 * act, not a runtime one. `validateCatalog` therefore rejects the whole catalog
 * rather than dropping a member — a partially accepted trust boundary is not a
 * trust boundary — and rejects duplicate tags outright, because one tag must
 * resolve to exactly one spec for the renderer's registry match to mean
 * anything. A component that declares a theme recipe also reserves the CSS
 * recipe namespace derived from its tag; two recipe-owning tags that project to
 * the same namespace are rejected for the same reason duplicate tags are.
 *
 * `Facet` is a **grammar position, not a component**, so a registration under
 * that tag is rejected. It is the single registry-side reservation; the
 * renderer's bootstrap relies on the validated catalog rather than repeating it.
 *
 * `Screen` is **not** reserved. A document stores its screen roots as component
 * nodes the renderer mounts, and bootstrap demands exact catalog/registry
 * equality, so a `Screen` that could not be registered would make the default
 * catalog unsatisfiable. Every valid catalog therefore carries **exactly one**
 * `Screen` spec: zero leaves the renderer with no root to mount, and the
 * duplicate-tag rule above already forbids a second. Registering `Screen` does
 * not reopen the nesting hole — a nested `<Screen/>` is rejected as a misplaced
 * structural tag by document validation, which runs before any catalog lookup.
 *
 * Presence is not conformance. A merely-present `Screen` would let a host
 * bootstrap a screen root the grammar and renderer cannot safely mount, so the
 * registered spec is also **refined**: it takes children, collects no value, and
 * declares a `name` the author can write literally — a scalar `string`,
 * required, with no `default`, `enum` or `bindable`. Those three are rejected as
 * **keys**, not as false values, because a screen name that could be defaulted,
 * drawn from a domain or bound would not resolve to a stable navigation target
 * before mount. Guidance bounds stay with ordinary prop validation rather than
 * being restated here, and extra presentation props stay ordinary. The
 * refinement runs **after** member validation and the duplicate rule, so the
 * deterministic first error is unchanged.
 *
 * Both tag comparisons are exact and case-sensitive: `FacetThing`, `Screens`,
 * `facet` and `screen` are ordinary tags a host may register, and none of them
 * satisfies the `Screen` requirement.
 *
 * A **collectable** member carries a similar-looking obligation — the exact
 * `name` prop a collect list addresses it by — but that one is not a catalog
 * rule and is not checked here. It is a coherence rule of the spec itself: a
 * spec that declares `collect` must declare its address, whatever tag it is
 * registered under and whether or not it ever reaches a catalog. It therefore
 * lives in `component-spec.ts` with its own code, and a catalog inherits it
 * through ordinary member validation — which is exactly why it is reported
 * ahead of the duplicate rule, the `Screen` requirement and the refinement below.
 *
 * The reserved `collect` **request list** is the same kind of rule and lives in
 * the same place, under its own code. A member that declares the list wrongly is
 * therefore rejected as that member's own fault, ahead of every catalog-level
 * rule — including, for a `Screen`, the refinement below.
 *
 * The reserved `arg` **event argument** is the third of these, under a third
 * code, and reaches a catalog the same way: through ordinary member validation,
 * ahead of every rule in this file. Its shape is deliberately not the request
 * list's — `required` and a closed `enum` domain stay the member's own business
 * — but that difference belongs to `component-spec.ts`, not here.
 *
 * `validateModalConformance` guards Facet's one dedicated overlap contract.
 * Every other component stays flow-contained; there is no z-index, positioning,
 * or layering escape hatch anywhere in the author grammar. Overlap exists only
 * because the framework owns a Modal frame — scrim, placement, focus trap,
 * escape, containment — into which a registered `Modal` supplies flow content.
 * That projection is only deterministic if the registered schema is exactly the
 * one the frame consumes, so a `Modal` that **omits** a projected prop or
 * **contradicts** its type, optionality, or default is rejected at
 * registration, not at render. Coordinates never appear in the contract: the
 * frame owns placement and the spec describes content.
 *
 * Every function here is **total** — it never throws, for any input of any
 * type — and deterministic: the same input always yields the same first
 * failure.
 */

import { BOUNDS } from "./bounds.js";
import { validateComponentSpec } from "./component-spec.js";
import type { ComponentSpec, PropSchema } from "./component-spec.js";
import { facetThemeToKebabCase } from "./theme-contract.js";

/** The immutable component set for one session. */
export interface FacetCatalog {
  readonly components: readonly ComponentSpec[];
}

/**
 * What `validateCatalog` answers: the frozen catalog, or the first failure.
 * Spelled out in full for the same reason as `ComponentSpecValidationResult` —
 * the rejection is part of the public contract, so it must be nameable.
 */
export type CatalogValidationResult =
  | { readonly ok: true; readonly catalog: FacetCatalog }
  | {
      readonly ok: false;
      readonly code: string;
      readonly at: string;
      readonly detail: string;
    };

/**
 * What `validateModalConformance` answers. Its success branch carries no
 * payload: conformance is a yes, not a value — the frame already owns what it
 * projects.
 */
export type ModalConformanceResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: string;
      readonly at: string;
      readonly detail: string;
    };

/**
 * The shared rejection branch, derived from the public catalog result. Both
 * entry points fail identically, so one derived alias serves both; deriving it
 * keeps the private name out of every emitted signature.
 */
type CatalogRejection = Extract<CatalogValidationResult, { readonly ok: false }>;

const CATALOG_KEY = "components";

const MODAL_TAG = "Modal";

/** The one grammar position no component may occupy. Compared exactly. */
const FACET_TAG = "Facet";

/** The screen root every catalog registers exactly once. Compared exactly. */
const SCREEN_TAG = "Screen";

/** The prop naming the screen the grammar navigates to. */
const SCREEN_NAME_PROP = "name";

/**
 * The keywords a screen `name` may not carry. Each is checked as a **key**: a
 * `bindable: false` is as much a declaration about binding as a `bindable: true`,
 * and the conforming schema simply does not mention any of the three.
 */
const SCREEN_NAME_FORBIDDEN_KEYS: readonly string[] = ["default", "enum", "bindable"];

/**
 * The exact schema the framework Modal frame projects. `default` is part of the
 * contract, not only `type` and `required`: a registered `Modal` that
 * substitutes its own default would make the frame's projection depend on the
 * registration instead of the contract.
 */
const MODAL_FRAME_PROPS: readonly {
  readonly name: string;
  readonly type: PropSchema["type"];
  readonly required: boolean;
  readonly default?: string | number | boolean;
}[] = [
  { name: "triggerLabel", type: "string", required: true },
  { name: "title", type: "string", required: true },
];

function reject(code: string, at: string, detail: string): CatalogRejection {
  return { ok: false, code, at, detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Prefixes a member's own location with the catalog position it came from. */
function locate(prefix: string, at: string): string {
  return at.length === 0 ? prefix : `${prefix}.${at}`;
}

/**
 * Reads a declared default. The structured `PropSchema` branches carry no
 * `default` keyword at all, so the key test — not a direct read — is what makes
 * "this prop declares no default" answerable for every branch of the union.
 */
function declaredDefault(schema: PropSchema): string | number | boolean | undefined {
  return "default" in schema ? schema.default : undefined;
}

/**
 * Validates a catalog and returns it frozen.
 *
 * Member specs are validated by `validateComponentSpec`, whose rejection is
 * relayed with the failing component's index prefixed onto its location. Modal
 * conformance is deliberately **not** checked here: the catalog is one half of
 * the bootstrap trust boundary and the React registry is the other, so the
 * bootstrap composes `validateCatalog`, tag-set equality, and
 * `validateModalConformance` rather than this function guessing which halves
 * are present.
 */
export function validateCatalog(value: unknown): CatalogValidationResult {
  try {
    return validateCatalogShape(value);
  } catch {
    return reject("catalog_read_failed", "", "Reading the catalog threw; it must be plain data.");
  }
}

function validateCatalogShape(value: unknown): CatalogValidationResult {
  if (!isRecord(value)) {
    return reject("catalog_not_an_object", "", "A catalog must be a plain object.");
  }
  const unknownKey = Object.keys(value)
    .sort()
    .find((key) => key !== CATALOG_KEY);
  if (unknownKey !== undefined) {
    return reject("unknown_catalog_key", unknownKey, "The catalog form is closed.");
  }
  const raw = value[CATALOG_KEY];
  if (!Array.isArray(raw)) {
    return reject("invalid_components", CATALOG_KEY, "A catalog declares a component array.");
  }
  const entries: readonly unknown[] = raw;
  if (entries.length > BOUNDS.componentsPerCatalog) {
    return reject("too_many_components", CATALOG_KEY, "Component count exceeds B-09.");
  }

  const components: ComponentSpec[] = [];
  const tags = new Set<string>();
  const recipeNamespaces = new Set<string>();
  // Captured with its position so the refinement below can name the offending
  // member and key, the way every other member-level rejection here does.
  let screen: { readonly spec: ComponentSpec; readonly position: string } | undefined;
  for (const [index, entry] of entries.entries()) {
    const position = `${CATALOG_KEY}[${index}]`;
    const result = validateComponentSpec(entry);
    if (!result.ok) {
      return reject(result.code, locate(position, result.at), result.detail);
    }
    if (result.spec.tag === FACET_TAG) {
      return reject(
        "reserved_structural_tag",
        `${position}.tag`,
        "Facet is a grammar position, not a component.",
      );
    }
    if (tags.has(result.spec.tag)) {
      return reject("duplicate_tag", `${position}.tag`, "One tag resolves to exactly one spec.");
    }
    tags.add(result.spec.tag);
    if (result.spec.themeRecipe !== undefined) {
      const namespace = facetThemeToKebabCase(result.spec.tag);
      if (recipeNamespaces.has(namespace)) {
        return reject(
          "duplicate_theme_recipe_namespace",
          `${position}.tag`,
          "Component recipe namespaces must not collide after CSS variable projection.",
        );
      }
      recipeNamespaces.add(namespace);
    }
    if (result.spec.tag === SCREEN_TAG) {
      screen = { spec: result.spec, position };
    }
    components.push(result.spec);
  }
  // Both screen rules run after the members, so a member's own rejection and
  // `duplicate_tag` still come first. Presence only needs the "at least one"
  // half: a second Screen is two components under one tag, which the duplicate
  // rule has already rejected above.
  if (screen === undefined) {
    return reject(
      "missing_screen_spec",
      CATALOG_KEY,
      "A catalog registers exactly one Screen; the renderer mounts a stored Screen root.",
    );
  }
  const nonconforming = validateScreenConformance(screen.spec, screen.position);
  if (nonconforming !== undefined) {
    return nonconforming;
  }
  for (const [componentIndex, spec] of components.entries()) {
    if (spec.content.mode !== "slots") continue;
    for (const slotName of Object.keys(spec.content.slots).sort()) {
      const allowedTags = spec.content.slots[slotName]?.allowedTags;
      if (allowedTags === undefined) continue;
      for (const [allowedTagIndex, allowedTag] of allowedTags.entries()) {
        if (!tags.has(allowedTag)) {
          return reject(
            "unknown_allowed_tag",
            `${CATALOG_KEY}[${componentIndex}].content.slots.${slotName}.allowedTags.${allowedTagIndex}`,
            "Every allowed slot tag must be registered in the same catalog.",
          );
        }
      }
    }
  }
  return { ok: true, catalog: Object.freeze({ components: Object.freeze(components) }) };
}

/**
 * Checks the registered `Screen` against the shape the grammar and renderer
 * mount. One code covers every nonconformity, because a host reading it has one
 * thing to fix — the location names which part — and because the bootstrap
 * mirrors this rule rather than restating it.
 *
 * Returns `undefined` when the spec conforms, so the caller reads as a guard.
 */
function validateScreenConformance(
  spec: ComponentSpec,
  position: string,
): CatalogRejection | undefined {
  if (spec.content.mode !== "children") {
    return rejectScreen(`${position}.content`, "A screen root holds ordinary screen content.");
  }
  if (spec.collect !== undefined) {
    return rejectScreen(`${position}.collect`, "A screen root is not a value Facet collects.");
  }
  const at = `${position}.props.${SCREEN_NAME_PROP}`;
  const name = spec.props[SCREEN_NAME_PROP];
  if (name === undefined) {
    return rejectScreen(at, "A screen root declares the name the grammar navigates to.");
  }
  if (name.type !== "string") {
    return rejectScreen(`${at}.type`, "A screen name is a scalar string the author writes.");
  }
  const forbidden = SCREEN_NAME_FORBIDDEN_KEYS.find((key) => key in name);
  if (forbidden !== undefined) {
    return rejectScreen(
      `${at}.${forbidden}`,
      "A screen name is authored literally, so it carries no default, domain or binding.",
    );
  }
  if (name.required !== true) {
    return rejectScreen(`${at}.required`, "Every screen is named, so the name is required.");
  }
  return undefined;
}

function rejectScreen(at: string, detail: string): CatalogRejection {
  return reject("nonconforming_screen_spec", at, detail);
}

/**
 * Builds the tag lookup for a validated catalog. A `Map` is used rather than an
 * object so that no tag can collide with a prototype member.
 */
export function buildCatalogIndex(catalog: FacetCatalog): ReadonlyMap<string, ComponentSpec> {
  const index = new Map<string, ComponentSpec>();
  for (const spec of catalog.components) {
    index.set(spec.tag, spec);
  }
  return index;
}

/**
 * Checks a registered `Modal` against the framework frame contract.
 *
 * An absent registration is itself a rejection: a host that reaches this check
 * without a `Modal` has no overlap contract to project. Extra content props are
 * allowed — the frame ignores what it does not consume — but every projected
 * prop must match the contract exactly.
 */
export function validateModalConformance(value: unknown): ModalConformanceResult {
  try {
    return validateModalSpec(value);
  } catch {
    return reject("modal_read_failed", "", "Reading the Modal spec threw; it must be plain data.");
  }
}

function validateModalSpec(value: unknown): ModalConformanceResult {
  if (value === undefined || value === null) {
    return reject("modal_spec_omitted", MODAL_TAG, "No Modal is registered, so none can conform.");
  }
  const result = validateComponentSpec(value);
  if (!result.ok) {
    return reject(result.code, result.at, result.detail);
  }
  const spec = result.spec;
  if (spec.tag !== MODAL_TAG) {
    return reject("modal_tag_mismatch", "tag", `The frame projects the ${MODAL_TAG} tag only.`);
  }
  if (spec.content.mode !== "slots") {
    return reject(
      "modal_must_use_slots",
      "content",
      "The frame projects named body and actions regions.",
    );
  }
  const slotNames = Object.keys(spec.content.slots).sort();
  if (slotNames.join(",") !== "actions,body") {
    return reject(
      "modal_slots_mismatch",
      "content.slots",
      "Modal declares exactly body and actions slots.",
    );
  }
  const body = spec.content.slots["body"];
  const actions = spec.content.slots["actions"];
  if (
    body === undefined ||
    body.minChildren !== 1 ||
    body.maxChildren !== 16 ||
    actions === undefined ||
    actions.minChildren !== 0 ||
    actions.maxChildren !== 4
  ) {
    return reject(
      "modal_slot_cardinality_mismatch",
      "content.slots",
      "Modal body accepts 1..16 children and actions accepts 0..4.",
    );
  }
  if (spec.collect !== undefined) {
    return reject("modal_must_not_collect", "collect", "The frame owns the overlap, not a value.");
  }
  return validateModalProps(spec);
}

function validateModalProps(spec: ComponentSpec): ModalConformanceResult {
  for (const contract of MODAL_FRAME_PROPS) {
    const at = `props.${contract.name}`;
    const schema = spec.props[contract.name];
    if (schema === undefined) {
      return reject("modal_prop_omitted", at, "The frame projection consumes this prop.");
    }
    if (schema.type !== contract.type) {
      return reject(
        "modal_prop_type_mismatch",
        `${at}.type`,
        `The frame reads a ${contract.type}.`,
      );
    }
    if (declaredDefault(schema) !== contract.default) {
      return reject(
        "modal_prop_default_conflict",
        `${at}.default`,
        "The frame contract owns this prop's default.",
      );
    }
    if ((schema.required === true) !== contract.required) {
      return reject(
        "modal_prop_optionality_mismatch",
        `${at}.required`,
        "The frame contract owns this prop's optionality.",
      );
    }
  }
  return { ok: true };
}
