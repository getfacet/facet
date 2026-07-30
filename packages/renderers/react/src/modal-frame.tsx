/**
 * The framework's Modal frame — the whole of the one sanctioned overlap, and the
 * only place in Facet where anything paints over anything else.
 *
 * Authored markup has no coordinates: no positioning, no z-index, no layering
 * escape hatch, and no local action router. Overlap exists at all because the
 * framework owns a frame — the trigger, the open/close lifecycle, the scrim, the
 * dialog surface, the placement, the stacking band, the dismiss control, the
 * focus trap, Escape, and the scroll lock — into which a registered `Modal`
 * supplies flow content and nothing else. The registered component describes
 * **content**; this file describes **the dialog**. `validateModalConformance` is
 * the registration-time half of the same contract: a `Modal` whose schema omits
 * or contradicts a projected prop is refused at bootstrap, so the two strings
 * below always mean what the frame reads them as.
 *
 * **The frame renders through a portal, and that is not a detail.** `Modal` is
 * one of the catalog's tags, so a modal node mounts *inside* the containment
 * elements mounting wraps around every subtree, and each of those carries
 * `isolation: isolate`. A frame that placed itself where the node sits would be
 * confined to that ancestor's stacking context and paint **below** any later
 * sibling subtree, however large a z-index it wrote — containment would defeat
 * the only overlap mechanism there is. So the scrim and the dialog are rendered
 * with `createPortal` into `useOverlayRoot()`'s target: a renderer-owned element
 * that the renderer mounts as a sibling of, never inside, any containment
 * element (D-13). The node's own mount point, props, bindings and subtree
 * boundary are untouched; only the painted output moves.
 *
 * **While the target is not there, nothing renders.** `useOverlayRoot` answers
 * `null` for exactly one commit, while the provider's ref attaches. The frame
 * renders no scrim and no dialog for that commit rather than falling back into
 * the flow — "in place" is precisely the position the portal exists to leave, and
 * a modal that flashed in flow for one commit would be the containment failure
 * this design is built to prevent, arriving one frame at a time. Outside a
 * provider entirely, the hook throws; that is a renderer composition fault and is
 * deliberately not survivable here. `useModalHost` answers the same way for the
 * same reason.
 *
 * **Everything two open modals share inside one session is derived from one
 * ordered list, and the list belongs to that session.** `ModalHost` holds the
 * open node ids in the order they opened, and topmost-only Escape, topmost-only
 * scrim close, and the paint order of the dialogs are all read off it. None of
 * that is a module-level stack: two `StageRenderer`s on one page are two
 * sessions, and a shared open stack would let one session's modal decide what
 * the other session's Escape closes and how high it paints. The one shared page
 * side effect is the body scroll lock, so it is reference-counted per body: the
 * page's own `overflow` is saved on the first lock and restored only after the
 * last session unlocks.
 *
 * **The frame owns the dialog surface, not the registered `Modal`.** A host may
 * register its own conforming `Modal`, and it must receive the same complete
 * frame the default one gets, so the background, the padding, the radius, the
 * shadow and the type are drawn here rather than pushed into `@facet/assets`
 * (DC-017) — which this package could not import in any case (D-09). Every one
 * of those declarations names a **Core-owned** custom property and nothing else:
 * the whole projection is declared on the dialog, and the chrome references it.
 * There is no raw CSS, no fallback value behind a reference, no invented
 * property name, and no second projection.
 *
 * **The dismiss control is the framework's own chrome.** Escape and the scrim
 * are unreachable by touch, undiscoverable, and not what a screen reader
 * announces, so an overlay with neither a visible nor a named way out is not one
 * a visitor can always leave. The button's accessible name and its glyph are
 * fixed here; neither is authorable and neither is read off the props record.
 * That adds no fourth neutral state — `NeutralCopy` stays the exact three-state
 * bijection it is — and host localisation of framework chrome is outside this
 * cut.
 *
 * **The two projected strings are the frame's own chrome too.** `triggerLabel`
 * names the control that opens the modal and `title` names the dialog; the
 * registered `Modal` prints neither, because printing them there would duplicate
 * what the frame already draws. Nothing else is read off the props record — no
 * width, no height, no coordinate. A label that is not usable text yields **no
 * trigger at all**, which is the safe direction: an overlay that cannot be
 * opened, rather than a control with no name.
 *
 * **Open state is this component's, and it can race nothing.** The flag lives in
 * `useState` here, so there is no writer for anything else to contend with: the
 * frame holds no document, no stage revision, no patch builder and no action
 * seam — `onAction` is not a parameter of anything in this file. Opening and
 * closing therefore emit no patch by construction rather than by discipline, and
 * `modal-frame.test.tsx` states that as a property of this file's source. There
 * has no browser-local action reference behind the trigger and no way to author one.
 *
 * **Visibility: barrel-exported** — `ModalFrame` only. It is exported so a host
 * can see the contract its `Modal` has to satisfy. `ModalHost` and
 * `MODAL_PART_ATTRIBUTE` are module exports for the renderer that composes the
 * session and for the sibling suite; both are `@internal`, because a host that
 * could mount its own host — or find the frame's parts by a published name —
 * would own a piece of the overlap contract the framework has to keep.
 */

import type { ComponentMountProps } from "@facet/core";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { OVERLAY_Z_BAND, useOverlayRoot } from "./containment.js";

/**
 * The marker every element of the frame carries, naming which part it is.
 *
 * One attribute with five values rather than five attributes: the parts are one
 * closed set owned by one file, and a test — or a person reading a DOM — should
 * be able to find all of them with a single selector. It carries no node id, no
 * tag, and nothing the author wrote.
 *
 * @internal Not barrel-exported; `@facet/react`-private.
 */
export const MODAL_PART_ATTRIBUTE = "data-facet-modal";

/** The prop naming the control that opens the modal. Projected into the trigger. */
const TRIGGER_LABEL_PROP = "triggerLabel";

/** The prop naming the decision the modal asks for. Projected into the heading. */
const TITLE_PROP = "title";

/**
 * The dismiss control's accessible name and its glyph.
 *
 * Framework-fixed, and deliberately not sourced from anything: not from a prop,
 * not from the Data Model, not from `NeutralCopy` — which is the closed
 * three-state render bijection and gains no fourth member for a button. The
 * glyph is U+00D7 MULTIPLICATION SIGN rather than the letter `x`, so the visible
 * mark is the one every dialog on the platform draws while the *name* screen
 * readers announce is a word.
 */
const DISMISS_NAME = "Close";
const DISMISS_GLYPH = "×";

/** The key that closes the topmost modal. Compared exactly. */
const ESCAPE_KEY = "Escape";

/** The key the focus trap answers itself rather than deferring to the browser. */
const TAB_KEY = "Tab";

/** What the body's `overflow` becomes while any modal in the session is open. */
const LOCKED_OVERFLOW = "hidden";

/**
 * The distance between one open modal's stacking level and the next, derived
 * from the band rather than chosen.
 *
 * Two open modals need four ordered slots, not two: the upper dialog's scrim has
 * to cover the lower dialog, and the upper dialog has to sit above its own
 * scrim. Deriving the stride from the band's own two members is what keeps that
 * arithmetic true if the band ever changes — and keeps this file from writing a
 * stacking number of its own.
 */
const OVERLAY_STACK_STRIDE = OVERLAY_Z_BAND.frame - OVERLAY_Z_BAND.scrim + 1;

/**
 * The scrim: the page, held back.
 *
 * `position: fixed` against the viewport rather than against an ancestor,
 * because the overlay root is the frame's context and the scrim covers what the
 * visitor can see rather than what the document happens to be tall enough to
 * hold. The colour is deliberately not a theme token: the token contract is
 * closed and semantic — a surface, a border, an accent — and none of its members
 * means "the page, dimmed". A scrim is the framework holding the page back, not
 * a surface the design system paints, so it is the one paint in this file that a
 * theme does not reach.
 */
const SCRIM_STYLE: Readonly<CSSProperties> = Object.freeze({
  position: "fixed",
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  background: "rgba(0, 0, 0, 0.5)",
});

/**
 * The dialog: its placement, and the whole of its surface.
 *
 * Centred on the viewport, bounded so a long modal scrolls itself instead of
 * running off the screen — and painted, because the registered `Modal` inside it
 * supplies flow content and may be a host's own. Every colour, space, corner,
 * edge, elevation and type declaration names a Core-owned custom property, whose
 * values arrive on this same element as the theme projection.
 */
const FRAME_STYLE: Readonly<CSSProperties> = Object.freeze({
  position: "fixed",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  boxSizing: "border-box",
  width: "calc(100vw - 2rem)",
  maxWidth: "32rem",
  maxHeight: "calc(100vh - 2rem)",
  overflowY: "auto",
  background: "var(--facet-color-surface)",
  color: "var(--facet-color-text)",
  borderStyle: "solid",
  borderWidth: "var(--facet-border-width-thin)",
  borderColor: "var(--facet-color-border)",
  borderRadius: "var(--facet-radius-lg)",
  boxShadow: "var(--facet-shadow-lg)",
  padding: "var(--facet-space-lg)",
  fontFamily: "var(--facet-font-family-sans)",
  fontSize: "var(--facet-font-size-md)",
  lineHeight: "var(--facet-line-height-normal)",
});

/** The heading and the dismiss control, on one line. Structure only. */
const HEADER_STYLE: Readonly<CSSProperties> = Object.freeze({
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: "var(--facet-space-md)",
  marginBottom: "var(--facet-space-md)",
});

const TITLE_STYLE: Readonly<CSSProperties> = Object.freeze({
  margin: 0,
  color: "var(--facet-color-text)",
  fontFamily: "var(--facet-font-family-sans)",
  fontSize: "var(--facet-font-size-lg)",
  fontWeight: "var(--facet-font-weight-bold)",
  lineHeight: "var(--facet-line-height-tight)",
});

/**
 * The dismiss control.
 *
 * `transparent` and `none` are the absence of paint rather than a colour of the
 * frame's own choosing: what shows through is the dialog's themed surface, one
 * element up.
 */
const DISMISS_STYLE: Readonly<CSSProperties> = Object.freeze({
  flex: "none",
  background: "transparent",
  borderStyle: "none",
  borderRadius: "var(--facet-radius-sm)",
  padding: "var(--facet-space-xs)",
  color: "var(--facet-color-text-muted)",
  fontFamily: "var(--facet-font-family-sans)",
  fontSize: "var(--facet-font-size-lg)",
  lineHeight: "var(--facet-line-height-tight)",
  cursor: "pointer",
});

/** What counts as a stop inside the trap. The dialog's own `tabindex="-1"` is excluded. */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * One open modal, as the session's list holds it: the node it belongs to and the
 * one way to shut it. The entry's **identity** is what the release closure
 * removes, so two modals of the same node id — which an accepted document cannot
 * produce — would still release exactly the registration they made.
 */
interface OpenModal {
  readonly nodeId: string;
  readonly close: () => void;
}

/**
 * What a frame reads off its session, and the only way it writes to it.
 *
 * `openNodeIds` is the ordered list itself, so a frame derives its own stacking
 * level and whether it is the topmost from the same value the host derives
 * Escape and the scroll lock from. There is no second source and no counter.
 */
interface ModalHostValue {
  readonly openNodeIds: readonly string[];
  readonly open: (nodeId: string, close: () => void) => () => void;
}

/**
 * The absent-host sentinel.
 *
 * A missing host is a renderer composition fault, in the same shape
 * `useOverlayRoot` uses for the same reason: a frame that silently made up its
 * own list would give a page two topmost modals, and the failure would surface
 * as an Escape that closes the wrong dialog rather than as anything naming a
 * cause.
 */
const NO_MODAL_HOST = Symbol("facet.noModalHost");

const ModalHostContext = createContext<ModalHostValue | typeof NO_MODAL_HOST>(NO_MODAL_HOST);

interface BodyScrollLock {
  restore: string;
  count: number;
}

const bodyScrollLocks = new WeakMap<HTMLElement, BodyScrollLock>();

/** Writes the body's `overflow`, never throwing: a page that cannot be locked still renders. */
function setOverflow(body: HTMLElement, value: string): void {
  try {
    body.style.overflow = value;
  } catch {
    // Fail-safe: a frame that threw out of an effect would take a page down from
    // the code that exists to keep it up.
  }
}

/** Acquires the one global body lock without letting independent hosts unlock each other. */
function lockBodyScroll(body: HTMLElement): () => void {
  let state = bodyScrollLocks.get(body);
  if (state === undefined) {
    state = { restore: body.style.overflow, count: 0 };
    bodyScrollLocks.set(body, state);
  }
  state.count += 1;
  setOverflow(body, LOCKED_OVERFLOW);

  let released = false;
  return (): void => {
    if (released) {
      return;
    }
    released = true;
    const current = bodyScrollLocks.get(body);
    if (current === undefined) {
      return;
    }
    current.count -= 1;
    if (current.count <= 0) {
      bodyScrollLocks.delete(body);
      setOverflow(body, current.restore);
      return;
    }
    setOverflow(body, LOCKED_OVERFLOW);
  };
}

/** Runs one close, never throwing out of the listener that called it. */
function closeSafely(modal: OpenModal): void {
  try {
    modal.close();
  } catch {
    // Fail-safe, as above.
  }
}

/**
 * The session's modal host: the ordered open list, and everything derived from
 * it.
 *
 * It renders no element of its own — the overlay root is `containment.ts`'s and
 * the dialog is the frame's — so it can be mounted anywhere above the frames it
 * serves without becoming a layout participant.
 *
 * @internal Not barrel-exported; the renderer composes one per session.
 */
export function ModalHost({ children }: { readonly children?: ReactNode }): ReactNode {
  const [openModals, setOpenModals] = useState<readonly OpenModal[]>([]);

  const open = useCallback((nodeId: string, close: () => void): (() => void) => {
    const entry: OpenModal = { nodeId, close };
    setOpenModals((current) => [...current, entry]);
    return (): void => {
      setOpenModals((current) => current.filter((candidate) => candidate !== entry));
    };
  }, []);

  // Topmost-only Escape. One listener per session, bound to the one modal it may
  // close, so a single keypress can never collapse a stack — and re-bound only
  // when the topmost itself changes.
  const topmost = openModals[openModals.length - 1];
  useEffect(() => {
    if (topmost === undefined) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === ESCAPE_KEY) {
        closeSafely(topmost);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return (): void => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [topmost]);

  // The session asks for a page lock based on its own list's emptiness. The page
  // side effect itself is reference-counted per body so independent renderer
  // sessions cannot restore overflow while another session still has a modal open.
  const locked = openModals.length > 0;
  useEffect(() => {
    if (!locked) {
      return;
    }
    return lockBodyScroll(document.body);
  }, [locked]);

  const openNodeIds = useMemo(() => openModals.map((modal) => modal.nodeId), [openModals]);
  const value = useMemo<ModalHostValue>(() => ({ openNodeIds, open }), [openNodeIds, open]);

  return <ModalHostContext.Provider value={value}>{children}</ModalHostContext.Provider>;
}

/** The session's modal host. A determinate error when there is none above. */
function useModalHost(): ModalHostValue {
  const host = useContext(ModalHostContext);
  if (host === NO_MODAL_HOST) {
    throw new Error("Facet renderer: no modal host is mounted above this component.");
  }
  return host;
}

/**
 * Reads one projected string off a resolved-props record, without trusting the
 * record it came from.
 *
 * Conformance and prop resolution have both already run, so an unusable value
 * here means something upstream failed rather than that an author wrote
 * something odd — and the answer is still `undefined` rather than a throw, since
 * a frame that unwound would take its whole subtree with it.
 */
function readProjected(props: ComponentMountProps["props"], name: string): string | undefined {
  try {
    if (!Object.hasOwn(props, name)) {
      return undefined;
    }
    const value: unknown = props[name];
    return typeof value === "string" && value.trim().length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Moves focus, never throwing: an element that refuses focus is not a page fault. */
function focusElement(element: HTMLElement | null): void {
  try {
    element?.focus();
  } catch {
    // Fail-safe.
  }
}

/** The dialog's own focusable stops, in document order. Total over any DOM. */
function focusableWithin(frame: HTMLElement): readonly HTMLElement[] {
  try {
    return [...frame.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
  } catch {
    return [];
  }
}

/**
 * The dialog's style: the theme projection, then the frame's own chrome, then
 * this dialog's place in the session's stack.
 *
 * The projection is spread onto the same element that references it, which is
 * what makes the portalled dialog themed at all: it sits outside the screen
 * subtree entirely, so nothing above it in the DOM carries the custom properties
 * a registered component would otherwise inherit.
 */
function dialogStyle(themeVars: Readonly<Record<string, string>>, zIndex: number): CSSProperties {
  return { ...themeVars, ...FRAME_STYLE, zIndex };
}

/**
 * The framework's Modal frame: everything about the one sanctioned overlap
 * except what goes inside it.
 *
 * `nodeId` is the modal node's identity, which is what the session's ordered list
 * is keyed by; `props` is that node's resolved props — the frame reads exactly
 * `triggerLabel` and `title` from it; `themeVars` is the session's theme
 * projection, which the frame paints its own chrome from; and `children` is the
 * mounted `Modal` subtree, rendered untouched. The frame injects nothing into
 * that subtree and clones nothing: what the caller mounted is what renders.
 */
export function ModalFrame({
  nodeId,
  props,
  themeVars,
  children,
}: {
  readonly nodeId: string;
  readonly props: ComponentMountProps["props"];
  readonly themeVars: Readonly<Record<string, string>>;
  readonly children?: ReactNode;
}): ReactNode {
  const { openNodeIds, open: enterSession } = useModalHost();
  const overlayRoot = useOverlayRoot();
  const [opened, setOpened] = useState(false);
  const headingId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  const triggerLabel = readProjected(props, TRIGGER_LABEL_PROP);
  const title = readProjected(props, TITLE_PROP);
  const shown = opened && overlayRoot !== null;

  // Idempotent by construction: setting the flag to the value it already holds
  // is a no-op, so Escape, a scrim click, the dismiss control, and any two of
  // them arriving together all leave the same state and run the same single
  // teardown.
  const close = useCallback((): void => {
    setOpened(false);
  }, []);

  // Registration is a layout effect so the session's order is in force before
  // the browser paints: a dialog that appeared for one frame at the wrong level
  // would be a visible flash of the stacking bug this list exists to prevent.
  useLayoutEffect(() => {
    if (!shown) {
      return;
    }
    return enterSession(nodeId, close);
  }, [shown, enterSession, nodeId, close]);

  useEffect(() => {
    if (!shown) {
      return;
    }
    focusElement(frameRef.current);
    return (): void => {
      // Back to the control that opened it, rather than to whatever happened to
      // hold focus at open time: the trigger is the frame's own, it is still
      // mounted, and it is where a visitor expects to land.
      focusElement(triggerRef.current);
    };
  }, [shown]);

  /**
   * The trap. Every Tab is answered here rather than deferred to the browser,
   * so the stop that comes after the last one is the first one and there is no
   * arrangement of content that walks focus out of an open dialog.
   */
  const onFrameKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== TAB_KEY) {
      return;
    }
    event.preventDefault();
    const frame = frameRef.current;
    if (frame === null) {
      return;
    }
    const stops = focusableWithin(frame);
    if (stops.length === 0) {
      // Unreachable while the dismiss control exists, and kept anyway: the trap
      // must be total over whatever DOM the dialog actually holds, and "focus
      // left the dialog" is not a state this file may reach by omission.
      focusElement(frame);
      return;
    }
    const from = stops.indexOf(document.activeElement as HTMLElement);
    const next =
      from === -1
        ? event.shiftKey
          ? stops.length - 1
          : 0
        : (from + (event.shiftKey ? -1 : 1) + stops.length) % stops.length;
    focusElement(stops[next] ?? null);
  }, []);

  // This dialog's place in the session's stack. The one commit before
  // registration lands reads as the base level, which is where a lone modal
  // sits anyway.
  const order = openNodeIds.indexOf(nodeId);
  const level = order === -1 ? 0 : order;
  const isTopmost = order !== -1 && order === openNodeIds.length - 1;

  const onScrimClick = useCallback((): void => {
    // Topmost-only, for the same reason Escape is: a lower scrim is covered by
    // the dialog above it in any real browser, so a click that reached it would
    // be a modal closing from underneath the one in front of it.
    if (isTopmost) {
      close();
    }
  }, [isTopmost, close]);

  if (triggerLabel === undefined) {
    return null;
  }

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      {...{ [MODAL_PART_ATTRIBUTE]: "trigger" }}
      aria-haspopup="dialog"
      aria-expanded={opened}
      onClick={(): void => {
        setOpened(true);
      }}
    >
      {triggerLabel}
    </button>
  );

  if (!shown || overlayRoot === null) {
    return trigger;
  }

  return (
    <>
      {trigger}
      {createPortal(
        <>
          <div
            {...{ [MODAL_PART_ATTRIBUTE]: "scrim" }}
            aria-hidden={true}
            style={{ ...SCRIM_STYLE, zIndex: OVERLAY_Z_BAND.scrim + level * OVERLAY_STACK_STRIDE }}
            onClick={onScrimClick}
          />
          <div
            ref={frameRef}
            {...{ [MODAL_PART_ATTRIBUTE]: "frame" }}
            role="dialog"
            aria-modal={true}
            aria-labelledby={title === undefined ? undefined : headingId}
            tabIndex={-1}
            style={dialogStyle(themeVars, OVERLAY_Z_BAND.frame + level * OVERLAY_STACK_STRIDE)}
            onKeyDown={onFrameKeyDown}
          >
            <div {...{ [MODAL_PART_ATTRIBUTE]: "header" }} style={HEADER_STYLE}>
              {title === undefined ? null : (
                <h2 {...{ [MODAL_PART_ATTRIBUTE]: "title" }} id={headingId} style={TITLE_STYLE}>
                  {title}
                </h2>
              )}
              <button
                type="button"
                {...{ [MODAL_PART_ATTRIBUTE]: "dismiss" }}
                aria-label={DISMISS_NAME}
                style={DISMISS_STYLE}
                onClick={close}
              >
                {DISMISS_GLYPH}
              </button>
            </div>
            {children}
          </div>
        </>,
        overlayRoot,
      )}
    </>
  );
}
