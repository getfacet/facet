/**
 * The session's theme — resolved from what the host booted with, and from
 * nothing else.
 *
 * **There is no default here, and its absence is the whole module.** The retired
 * renderer answered an omitted theme with `@facet/assets`'s shipped palette,
 * which quietly made a page whose theme never arrived render anyway, in someone
 * else's colours, with nothing naming the omission. That fallback is gone
 * (RISK-API-7): the host owns the theme, so a session that was handed none is a
 * **bootstrap error a host can read**, not a silent substitution. It is also
 * what keeps the assets edge one-way — this package imports nothing from
 * `@facet/assets` (D-09), and could not reach a shipped default even if the
 * policy allowed one.
 *
 * **Absence and invalidity are different faults, so they carry different
 * codes.** "You booted without a theme" is fixed by supplying one; "your theme
 * is missing a token" is fixed by editing it. Folding them into one code would
 * make a host read the second message for the first problem.
 *
 * **The token contract is relayed, never restated.** `validateTheme` in
 * `@facet/core` owns the closed group and token vocabulary, the value grammar
 * and the rebuild, and its rejection is passed through here with its `code`,
 * `at` and `detail` **unchanged**. This module names no token, declares no
 * group, and checks no value: a second reader of that contract is how a theme
 * comes to be accepted by one half of the framework and refused by the other.
 *
 * `resolveTheme` is **total** — it never throws, for any input of any type,
 * including a revoked proxy or an object whose group getter throws — because
 * booting is host configuration and a fault there is a result rather than an
 * exception.
 *
 * **Visibility: barrel-exported** — `resolveTheme` only. No other symbol in this
 * module is public.
 */

import { validateTheme } from "@facet/core";
import type { FacetTheme, FacetThemeValidationOptions } from "@facet/core";

/**
 * The two spellings of "the host supplied nothing".
 *
 * Both are absence rather than a malformed value: a host that read a boot
 * variable which was never set holds `undefined`, and one that parsed a JSON
 * `null` holds `null`. Neither is a theme, and neither should be reported as a
 * badly-shaped one.
 */
function isAbsent(value: unknown): boolean {
  return value === undefined || value === null;
}

/**
 * Resolves the theme a session renders with.
 *
 * The parameter carries **no default value**, deliberately: a default here would
 * swallow the very absence this function exists to report, and would do it in
 * the one place nothing else is watching.
 *
 * The result type is written inline rather than through a named alias, because
 * the Barrel Export Contract lists no name for it and a public signature may not
 * refer to an off-barrel one.
 */
export function resolveTheme(
  bootstrapTheme: unknown,
  options: FacetThemeValidationOptions = {},
):
  | { readonly ok: true; readonly theme: FacetTheme }
  | {
      readonly ok: false;
      readonly code: string;
      readonly at: string;
      readonly detail: string;
    } {
  if (isAbsent(bootstrapTheme)) {
    return {
      ok: false,
      code: "missing_bootstrap_theme",
      at: "",
      detail: "A session renders with the theme its host booted with; there is no default.",
    };
  }
  // Relayed verbatim on both branches. The accepted value is the contract's own
  // frozen rebuild, so the session holds the tokens the contract admits and
  // nothing the host happened to attach to the object it passed in.
  return validateTheme(bootstrapTheme, options);
}
