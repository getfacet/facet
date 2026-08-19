/**
 * The default component catalog: the components an agent may author
 * when the host registers nothing of its own.
 *
 * The catalog is one half of Facet's trust boundary — the React registry is the
 * other — and the two must carry the **same tag set exactly**, so this module
 * is the single place the default set is counted. It composes the five private
 * spec groups and adds nothing: every prop, domain and default already lives in
 * the group that owns its components, and duplicating one here would give the
 * same tag two descriptions.
 *
 * The default count is a **product decision**, not a bound. `validateCatalog` stays
 * generic — it accepts any catalog inside `B-09`, because a host that registers
 * five trusted components of its own has a perfectly valid catalog — so
 * the exact default roster is an obligation of this module and is pinned by
 * `catalog.test.ts`, never by core.
 *
 * `Screen` is a member here like any other. It is simultaneously a structural
 * position in the grammar and a registered component, and both are needed: a
 * document stores its screen roots as ordinary component nodes that the
 * renderer mounts, and bootstrap demands exact catalog/registry equality, so a
 * `Screen` no host could register would leave the root unmountable. The single
 * reservation is `Facet`, which appears nowhere below. Registering `Screen`
 * reopens no nesting hole: a nested `<Screen>` is refused by document
 * validation, before the catalog is consulted at all.
 *
 * Validation is deliberately **not** performed at import time. The catalog is
 * plain, frozen data that travels to the agent as discovery text, to the
 * renderer as a validation table, and to disk with a session; the trust
 * boundary validates it once at bootstrap, which is where a rejection can be
 * reported to the host instead of thrown out of a module load. That is also
 * what keeps this module free of side effects.
 *
 * **Visibility: private module, public symbols.** `DEFAULT_COMPONENT_SPECS` and
 * `DEFAULT_CATALOG` are barrel-exported through `index.ts`; the module itself is
 * not a package entry point and nothing outside `@facet/assets` may import it
 * by path.
 */

import type { ComponentSpec, FacetCatalog } from "@facet/core";

import { CONTENT_SPECS } from "./specs-content.js";
import { EXPRESSION_SPECS } from "./specs-expression.js";
import { INTERACTIVE_SPECS } from "./specs-interactive.js";
import { LAYOUT_SPECS } from "./specs-layout.js";
import { SURFACE_SPECS } from "./specs-surface.js";

/**
 * The default specs, grouped in registration order: structure, navigation and
 * actions, content and data display, task surfaces, then input and disclosure.
 * The modules own their members; this assembler deliberately carries no second
 * copy of the 47-tag roster.
 *
 * Frozen, because a host reads this array to build its registry: an array a
 * consumer could push onto would let the two halves of the trust boundary drift
 * apart after the tag-set check that compares them.
 */
export const DEFAULT_COMPONENT_SPECS: readonly ComponentSpec[] = Object.freeze([
  ...LAYOUT_SPECS,
  ...SURFACE_SPECS,
  ...CONTENT_SPECS,
  ...EXPRESSION_SPECS,
  ...INTERACTIVE_SPECS,
]);

/**
 * The default catalog, ready to hand to bootstrap.
 *
 * It is the same specs in a `FacetCatalog` envelope — the shape
 * `validateCatalog` accepts and `bootstrapSession` freezes for the session's
 * lifetime.
 */
export const DEFAULT_CATALOG: FacetCatalog = Object.freeze({
  components: DEFAULT_COMPONENT_SPECS,
});
