/**
 * The three neutral states — everything Facet shows when it has nothing else to
 * show, and nothing beyond them.
 *
 * `PreparingState` is the page before the agent has authored it. `CrashState`
 * stands in for one registered component whose React code threw. And
 * `CorruptSubtreeState` stands at the root of a subtree that could not be
 * trusted to render at all. There is no fourth: `NeutralCopy.render` declares
 * exactly three slots, and `fallback.test.tsx` holds the two sets to a bijection
 * so a fourth state cannot appear here without a fourth slot in `@facet/core`.
 *
 * **Copy is read, never composed.** Each component names its own slot as a
 * literal — `copy.render.preparing`, and so on — and renders that string as the
 * element's only child. Nothing here is looked up by a key that could come from
 * authored markup, the Data Model or a component's resolved props, and no string
 * is concatenated onto what the host wrote. That is what makes DC-015 a property
 * of the code's shape rather than of a reserved prop name: there is no key to
 * supply and no slot to supply it to. The host's one bootstrap override
 * (`resolveNeutralCopy`) and the framework defaults are the only two sources.
 *
 * **These components run after something already failed, so they are total.** A
 * neutral state that threw on a malformed copy object would unwind into its
 * parent boundary and blank a region larger than the one that actually broke —
 * the crash state would become the crash. So the copy is read through a guard
 * that survives a missing group, a non-string value and a throwing getter alike,
 * and answers the framework default in every one of those cases. Validation
 * belongs to `resolveNeutralCopy`, which is where a host learns it wrote
 * something wrong; by the time a value reaches this file the only useful
 * behaviour left is to render something neutral.
 *
 * **The DOM marker is the renderer's own.** `data-facet-neutral-state` names
 * which of the three is showing, so mounting (WU-33) and the stage renderer
 * (WU-37) can assert *which* neutral state appeared rather than matching on
 * copy that a host may have replaced. It carries no node id, tag or cause.
 *
 * The one-field props type is spelled out at each of the three exported
 * signatures rather than named once. A barrel-exported signature may not
 * reference a name a consumer cannot import, and a shared local alias would be
 * exactly that (D-12); three short literals are the cost of that rule.
 *
 * **The signatures are held to that shape, not merely written in it.** Each
 * exported state destructures exactly `{ copy }`, and `fallback.test.tsx` scans
 * all three parameter lists for precisely that form. The scan exists because
 * the weaker checks it sits beside — no rest-spread, every slot read named by a
 * literal — constrain only what a state does with what it was handed, and a
 * state rewritten to take the whole props object satisfies both while reading
 * any prop name it likes. Widening a signature here is therefore a test failure,
 * which is the only reason the DC-015 claim above holds.
 */

import { NEUTRAL_COPY_DEFAULTS } from "@facet/core";
import type { NeutralCopy } from "@facet/core";
import type { ReactElement } from "react";

/**
 * Reads one render slot off a copy set that arrived typed but is not trusted to
 * be well-formed, answering the framework default for anything unusable.
 *
 * `slot` is always a literal written in this file. The parameter exists so the
 * three components share one total read, not so a caller can choose a slot.
 */
function readRenderCopy(copy: NeutralCopy, slot: keyof NeutralCopy["render"]): string {
  try {
    const value: unknown = copy.render[slot];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  } catch {
    // A hostile or exotic copy object — a throwing getter, a revoked proxy —
    // is a malformed configuration, not a reason to blank more of the page.
  }
  return NEUTRAL_COPY_DEFAULTS.render[slot];
}

/**
 * The one element every neutral state renders.
 *
 * `role="status"` with a polite live region is the honest description: something
 * changed that the visitor should hear about, and none of the three is urgent
 * enough to interrupt. Sharing the element keeps the three states identical in
 * everything except the words and the marker.
 */
function NeutralState({
  marker,
  text,
}: {
  readonly marker: string;
  readonly text: string;
}): ReactElement {
  return (
    <div role="status" aria-live="polite" data-facet-neutral-state={marker}>
      {text}
    </div>
  );
}

/** Shown where the page will be, while the agent is still authoring it. */
export function PreparingState({ copy }: { readonly copy: NeutralCopy }): ReactElement {
  return <NeutralState marker="preparing" text={readRenderCopy(copy, "preparing")} />;
}

/**
 * Shown in place of a single registered component whose React code threw.
 *
 * It is handed no error, by construction: `SubtreeBoundary` keeps nothing about
 * the failure, so there is no message, stack or component name for this element
 * to leak even by accident (DC-014).
 */
export function CrashState({ copy }: { readonly copy: NeutralCopy }): ReactElement {
  return (
    <NeutralState
      marker="component-unavailable"
      text={readRenderCopy(copy, "componentUnavailable")}
    />
  );
}

/**
 * Shown at the root of a subtree that could not be trusted to render — a corrupt
 * node, a dangling reference, an unknown runtime tag, a reference cycle, or a
 * subtree past the depth bound. All five causes take this one path and produce
 * this one element, so the outcome is the same whichever of them occurred and
 * the persisted input cannot be inferred from the page (DC-013).
 */
export function CorruptSubtreeState({ copy }: { readonly copy: NeutralCopy }): ReactElement {
  return <NeutralState marker="corrupt-subtree" text={readRenderCopy(copy, "corruptSubtree")} />;
}
