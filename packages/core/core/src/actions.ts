/**
 * The action grammar — the complete vocabulary of what an authored interaction
 * may do.
 *
 * There are exactly two actions. `nav:<screen>` moves the visitor to another
 * screen already declared in the same document, and `agent:<event>` forwards a
 * named event to the agent. Nothing else is an action: browser-local routing in particular is
 * rejected by name, because a local-action router would be a second, invisible
 * behavior surface that no catalog declares and no validation can bound. There
 * is no third scheme to add one through either — an unrecognized prefix is an
 * unknown scheme, never an extension point.
 *
 * `nav:` is resolved against the **same document**, which is what makes it a
 * pure read: the answer is "this declared screen", the document is not consulted
 * for anything else, and nothing is written. Navigation therefore never produces
 * a patch (DC-018) — the renderer changes which screen it shows, not what the
 * document says.
 *
 * `parseAction` is **total**: it never throws, for any reference and any
 * document, including a document whose property getter throws. An unusable
 * document yields a rejection, exactly as an unusable reference does.
 */

import type { ComponentDocument } from "./document.js";
import { isFacetIdentifier } from "./identifiers.js";

/** The two things an authored interaction may do, and nothing else. */
export type Action =
  | { readonly kind: "nav"; readonly screen: string }
  | { readonly kind: "agent"; readonly event: string };

/**
 * What `parseAction` answers: the action, or why the reference is not one.
 *
 * Exported because `parseAction` is: a caller that stores a result, threads it
 * through a helper, or narrows it in a second function has to be able to **name**
 * it, and an unexported return type turns that into
 * `TS2459: declares 'ActionResult' locally, but it is not exported`.
 *
 * The reject reasons are written out inline rather than behind a shared private
 * alias. A `.d.ts` may carry an unexported alias, but a consumer cannot name it,
 * so folding the vocabulary into this one declaration keeps every part of the
 * emitted signature reachable while the module's export list stays exactly
 * `parseAction`, `Action` and this type.
 */
export type ActionResult =
  | { readonly ok: true; readonly action: Action }
  | {
      readonly ok: false;
      /** Why a reference is not an action. Closed, structured, and stable. */
      readonly reason: "not_an_action" | "unknown_scheme" | "invalid_target" | "unknown_screen";
    };

/**
 * The rejection branch on its own, for the builder below that can only fail.
 * It is **derived from** the public result rather than being its source, so the
 * two cannot drift and the private name never reaches an emitted signature.
 */
type ActionRejection = Extract<ActionResult, { readonly ok: false }>;

const SCHEME_SEPARATOR = ":";

const NAV_SCHEME = "nav";

const AGENT_SCHEME = "agent";

/** The prop a `Screen` root carries its name in. */
const NAME_PROP = "name";

function reject(reason: ActionRejection["reason"]): ActionResult {
  return { ok: false, reason };
}

/**
 * The names of every screen the document declares.
 *
 * Read defensively: the document may have arrived from a store, so a missing
 * node, a renamed prop, or a getter that throws must read as "no such screen"
 * rather than as an exception.
 */
function screenNames(document: ComponentDocument): ReadonlySet<string> {
  const names = new Set<string>();
  const screens: unknown = document.screens;
  if (!Array.isArray(screens)) {
    return names;
  }
  const nodes: unknown = document.nodes;
  if (typeof nodes !== "object" || nodes === null) {
    return names;
  }
  for (const id of screens) {
    if (typeof id !== "string" || !Object.prototype.hasOwnProperty.call(nodes, id)) {
      continue;
    }
    const node: unknown = (nodes as Record<string, unknown>)[id];
    if (typeof node !== "object" || node === null) {
      continue;
    }
    const props: unknown = (node as Record<string, unknown>)["props"];
    if (typeof props !== "object" || props === null) {
      continue;
    }
    const value: unknown = (props as Record<string, unknown>)[NAME_PROP];
    if (typeof value !== "object" || value === null) {
      continue;
    }
    const record = value as Record<string, unknown>;
    if (record["kind"] !== "scalar" || typeof record["value"] !== "string") {
      continue;
    }
    names.add(record["value"]);
  }
  return names;
}

/**
 * Parses one authored reference into an action, or reports why it is not one.
 *
 * The reference is the authored text — `nav:details`, `agent:refresh` — so a
 * scheme the parser never turned into a reference, such as a browser-local toggle,
 * still arrives here and is still refused by name.
 */
export function parseAction(reference: unknown, document: ComponentDocument): ActionResult {
  try {
    return parse(reference, document);
  } catch {
    return reject("not_an_action");
  }
}

function parse(reference: unknown, document: ComponentDocument): ActionResult {
  if (typeof reference !== "string") {
    return reject("not_an_action");
  }
  const separator = reference.indexOf(SCHEME_SEPARATOR);
  if (separator <= 0) {
    return reject("not_an_action");
  }
  const scheme = reference.slice(0, separator);
  if (scheme !== NAV_SCHEME && scheme !== AGENT_SCHEME) {
    return reject("unknown_scheme");
  }
  const target = reference.slice(separator + SCHEME_SEPARATOR.length);
  if (!isFacetIdentifier(target)) {
    return reject("invalid_target");
  }
  if (scheme === AGENT_SCHEME) {
    return { ok: true, action: Object.freeze({ kind: "agent", event: target }) };
  }
  if (document === null || document === undefined || !screenNames(document).has(target)) {
    return reject("unknown_screen");
  }
  return { ok: true, action: Object.freeze({ kind: "nav", screen: target }) };
}
