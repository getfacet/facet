/**
 * Screen navigation: which of the document's screens the visitor is looking at.
 *
 * `nav:` is the one authored interaction the agent is not involved in, and that
 * is exactly why it lives here rather than in the component that carries it.
 * `Button` reports that it was activated; the **renderer** holds the document,
 * resolves the reference, and decides what happens — so a component has no idea
 * what a screen is and cannot navigate on its own.
 *
 * **Navigation is browser view-state, and writes nothing.** The current screen
 * is React state in this process. The document is read to answer one question —
 * "does this document declare that screen?" — and is never written, so
 * navigation produces no patch (DC-018) and the browser never becomes a second
 * writer. `nav.test.ts` observes the document for writes rather than taking the
 * claim on trust.
 *
 * **There are exactly two schemes.** `parseAction` in `@facet/core` is the sole
 * authority on that, and this module defers to it rather than re-deriving the
 * grammar: browser-local action routing is refused by name, an unscheme'd string is not an action,
 * and an `agent:` reference is explicitly *not* navigation — it is handed back
 * for the caller to forward, never acted on here (DC-024). There is no local
 * action router, and adding one would mean adding a scheme `parseAction` does
 * not admit.
 *
 * **A corrupt target keeps the current valid screen.** A document arriving from
 * a store may name an entry that does not exist, and a re-authored document may
 * drop the screen the visitor is standing on. Neither blanks the stage while the
 * document still declares *any* screen: the effective screen is *derived* on
 * every render from the document in force, so it falls back — to the entry, then
 * to the first screen the document does declare — rather than being remembered
 * as a stale answer.
 *
 * A document from which no screen can be derived **at all** is a different
 * outcome and a deliberate one: `current` is `null` — the safe-empty stage —
 * rather than a screen whose root cannot be mounted. That case includes the
 * documents `parseAction` reads and this module does not, such as an inherited
 * `screens` or an array in place of the node map: the renderer needs a node to
 * *mount*, so it holds the narrower own-property, plain-record rule on purpose,
 * since widening it would mean reading through a prototype. Where the two
 * readers disagree the outcome stays **coherent** — nothing mounts and nothing
 * navigates, never one without the other.
 *
 * Every function here is **total**: it never throws, for any reference and any
 * document, including one whose property getter throws.
 *
 * The module is **private**: it is not barrel-exported and is not a package
 * entry point.
 */

import type { ComponentDocument } from "@facet/core";
import { BOUNDS, parseAction } from "@facet/core";
import { useCallback, useState } from "react";

import { isArrayValue, readArrayItem, readArrayLength, readOwn } from "./safe-read.js";

/**
 * One screen the document declares: the name `nav:` targets, and the node id
 * its root is stored under.
 *
 * Both halves are needed and neither is derivable from the other at the point
 * of use — the reference names the screen, the renderer mounts the node — so
 * resolving them together is what keeps a caller from re-walking the document.
 */
export interface ScreenView {
  readonly name: string;
  readonly nodeId: string;
}

/**
 * The outcome of resolving one authored reference as navigation.
 *
 * `not_a_navigation` is the branch that keeps this module's scope honest: an
 * `agent:` reference is a perfectly valid action that simply is not this
 * module's to perform, and reporting it as a failure to navigate — rather than
 * silently ignoring it — is what lets the caller forward it. The other reasons
 * are `parseAction`'s own, passed through unchanged so one vocabulary describes
 * one grammar.
 *
 * **The outcome is a report; `current` is the authority.** A caller holding a
 * `navigate` closure captured under a superseded document can be handed a
 * `ScreenView` whose node id that document no longer uses. Mount `current`,
 * which is re-derived from the document in force on every render, and read the
 * outcome for whether the navigation was accepted — never as the thing to
 * render.
 */
export type NavigationOutcome =
  | { readonly ok: true; readonly screen: ScreenView }
  | {
      readonly ok: false;
      readonly reason:
        | "not_a_navigation"
        | "not_an_action"
        | "unknown_scheme"
        | "invalid_target"
        | "unknown_screen";
    };

/** The prop a `Screen` root carries its name in. */
const NAME_PROP = "name";

/**
 * Every screen the document declares, in document order.
 *
 * The rule is deliberately the same one `parseAction` applies: an id listed in
 * `screens`, present in `nodes`, whose `name` prop is a literal scalar string.
 * It is **not** widened with a `Screen` tag check — if this module accepted a
 * narrower set than `parseAction` does, a reference could parse as a legal
 * navigation and then resolve to no node, which is a disagreement rather than a
 * rejection. Whether a root's tag is mountable is the mounting boundary's
 * question, and it answers it by degrading that subtree.
 *
 * Read defensively throughout: the document may have arrived from a store, so a
 * missing node, a renamed prop or a throwing getter reads as "no such screen"
 * rather than as an exception.
 */
export function listScreens(document: ComponentDocument): readonly ScreenView[] {
  const screens = readOwn(document, "screens");
  if (!isArrayValue(screens)) {
    return [];
  }
  const nodes = readOwn(document, "nodes");
  const views: ScreenView[] = [];
  const length = Math.min(readArrayLength(screens), BOUNDS.screensPerDocument);
  for (let index = 0; index < length; index += 1) {
    const nodeId = readArrayItem(screens, index);
    if (typeof nodeId !== "string") {
      continue;
    }
    const props = readOwn(readOwn(nodes, nodeId), "props");
    const value = readOwn(props, NAME_PROP);
    if (readOwn(value, "kind") !== "scalar") {
      continue;
    }
    const name = readOwn(value, "value");
    if (typeof name === "string") {
      views.push(Object.freeze({ name, nodeId }));
    }
  }
  return Object.freeze(views);
}

/** The screen the document declares under `name`, or `null` for no such screen. */
export function resolveScreen(document: ComponentDocument, name: unknown): ScreenView | null {
  if (typeof name !== "string") {
    return null;
  }
  return listScreens(document).find((screen) => screen.name === name) ?? null;
}

/**
 * The screen a visitor lands on: the declared `entry`, or — when a persisted
 * document names an entry it does not declare — the first screen it does.
 *
 * The fallback is what keeps a corrupt document from rendering nothing at all.
 * `null` is reserved for a document that declares no usable screen, which is
 * the one case with nothing to fall back to.
 */
export function entryScreen(document: ComponentDocument): ScreenView | null {
  const screens = listScreens(document);
  const entry = readOwn(document, "entry");
  if (typeof entry === "string") {
    const named = screens.find((screen) => screen.name === entry);
    if (named !== undefined) {
      return named;
    }
  }
  return screens[0] ?? null;
}

/**
 * Resolves one authored reference as navigation within `document`.
 *
 * `parseAction` decides whether the reference is an action and, for `nav:`,
 * whether the document declares that screen; this function only turns the
 * accepted screen name into the node id the renderer mounts. The two read the
 * same rule, so an accepted navigation always resolves — and if it somehow did
 * not, the answer is still a rejection rather than a broken screen.
 */
export function resolveNavigation(
  reference: unknown,
  document: ComponentDocument,
): NavigationOutcome {
  const parsed = parseAction(reference, document);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason };
  }
  if (parsed.action.kind !== "nav") {
    return { ok: false, reason: "not_a_navigation" };
  }
  const screen = resolveScreen(document, parsed.action.screen);
  return screen === null ? { ok: false, reason: "unknown_screen" } : { ok: true, screen };
}

/** Whether two screens name the same target, compared by value rather than identity. */
function sameScreen(one: ScreenView, other: ScreenView | null): boolean {
  return other !== null && one.name === other.name && one.nodeId === other.nodeId;
}

/** What a mounted renderer holds: the screen in view, and the way to change it. */
export interface ScreenNavigation {
  /** The screen being shown, or `null` when the document declares none. */
  readonly current: ScreenView | null;
  /**
   * Moves the visitor to the screen a `nav:` reference names, reporting the
   * outcome. A reference that is not a navigation leaves the current screen
   * exactly as it was — refusing is inert, never a blank stage.
   */
  readonly navigate: (reference: unknown) => NavigationOutcome;
}

/**
 * Holds which screen the visitor is on, as browser state over one document.
 *
 * Only the screen **name** is remembered, and the effective screen is derived
 * from the document in force on every render. That is what makes a re-authored
 * document safe in both directions: a document that still declares the name
 * keeps the visitor where they are (its new node id included), and one that
 * dropped it falls back to the entry instead of pointing at a node that no
 * longer exists. A remembered `ScreenView` would carry the stale id with it.
 *
 * A request the document has dropped is **discarded**, not held dormant. Left in
 * place it would outlive the document that gave it meaning, and a later document
 * that happened to re-declare the same name would move the visitor with no
 * interaction at all — a stale intent resurrecting minutes later, in the middle
 * of something else. Clearing it during render is React's own way to adjust
 * state from props; it settles in one extra render and cannot loop, because
 * after the clear the condition that triggers it is false.
 *
 * **A shown screen is never replaced by a blank stage.** A document the mountable
 * index can derive nothing from is not the same claim as "this page has no
 * screens": core's reader still reports screens for it in five executed
 * disagreement classes, so an empty index there is a *disagreement*, not a fact
 * about the page. Blanking on it would take a working page away from the visitor
 * because a host handed in an exotic object, so the last genuinely derivable
 * screen stays on show until a document arrives that can be indexed again.
 *
 * That preserved screen is a **floor, not a latch**: any document with a usable
 * index takes over immediately, including one that dropped the visitor's screen
 * (which falls back to its entry, as above). It is consulted only when the index
 * yields nothing at all — and there the alternative is not a better screen, it is
 * no screen. Should its node id be absent from the document in force,
 * `mount-node.tsx` degrades that subtree deterministically, which is a bounded,
 * visible neutral state rather than an empty page.
 */
export function useScreenView(document: ComponentDocument): ScreenNavigation {
  const [requested, setRequested] = useState<string | null>(null);
  const [preserved, setPreserved] = useState<ScreenView | null>(null);
  const live = requested === null ? null : resolveScreen(document, requested);
  if (requested !== null && live === null) {
    setRequested(null);
  }
  const derived = live ?? entryScreen(document);
  if (derived !== null && !sameScreen(derived, preserved)) {
    // Compared by value, never by identity: the index answers with a fresh
    // frozen object on every render, so an identity test would never settle.
    setPreserved(derived);
  }
  const current = derived ?? preserved;
  const navigate = useCallback(
    (reference: unknown): NavigationOutcome => {
      const outcome = resolveNavigation(reference, document);
      if (outcome.ok) {
        setRequested(outcome.screen.name);
      }
      return outcome;
    },
    [document],
  );
  return { current, navigate };
}
