import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { OverlayKind } from "@facet/core";
import { drawerFrameStyle, modalFrameStyle, overlayScrimStyle } from "./layout-contract.js";

// ── Ref-counted body scroll-lock ─────────────────────────────────────────────
// Multiple/nested overlays share ONE lock: the first acquire saves and clears
// `document.body`'s inline overflow, each subsequent acquire only bumps the
// count, and only the LAST release restores the saved value exactly once — so
// two overlays opening and closing in any order never leave the body stuck
// scroll-locked (or restore a value that was itself the lock). Module-level (not
// per-frame) on purpose: the count must be shared across every OverlayFrame.
let scrollLockCount = 0;
let savedBodyOverflow = "";

function acquireScrollLock(): void {
  if (typeof document === "undefined" || document.body === null) {
    return;
  }
  try {
    if (scrollLockCount === 0) {
      savedBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    scrollLockCount += 1;
  } catch {
    // Never throw out of a render effect (fail-safe).
  }
}

function releaseScrollLock(): void {
  if (typeof document === "undefined" || document.body === null) {
    return;
  }
  try {
    if (scrollLockCount === 0) {
      return;
    }
    scrollLockCount -= 1;
    if (scrollLockCount === 0) {
      document.body.style.overflow = savedBodyOverflow;
      savedBodyOverflow = "";
    }
  } catch {
    // Never throw (fail-safe).
  }
}

// ── Topmost-only Esc dispatch ────────────────────────────────────────────────
// Every OverlayFrame shares ONE document keydown listener + a LIFO stack of close
// callbacks, so a single Esc closes ONLY the LAST-MOUNTED overlay — the same
// one-at-a-time semantics as a scrim-click or the close button, and what native
// nested modals do. A per-frame listener would collapse the whole stack on one Esc.
// Module-level on purpose: the stack is shared across every OverlayFrame.
// NOTE: "last-mounted" equals the visually front-most overlay when overlays open in
// tree order (all share OVERLAY_FRAME_Z, so paint order = DOM/tree order). They can
// diverge only if an earlier-in-tree overlay is opened AFTER a later-in-tree one —
// then Esc closes the later-opened (behind) one. Accepted v1 edge (scrim/button
// still close the intended one); a tighter version would key off DOM/tree order.
const escStack: Array<() => void> = [];
let escListenerInstalled = false;

function handleGlobalEsc(event: KeyboardEvent): void {
  if (event.key !== "Escape") {
    return;
  }
  const top = escStack[escStack.length - 1];
  if (top !== undefined) {
    top();
  }
}

/** Push a close callback as the new topmost; returns a remover for unmount. */
function pushEsc(close: () => void): () => void {
  escStack.push(close);
  if (!escListenerInstalled && typeof document !== "undefined") {
    document.addEventListener("keydown", handleGlobalEsc);
    escListenerInstalled = true;
  }
  return () => {
    const index = escStack.lastIndexOf(close);
    if (index !== -1) {
      escStack.splice(index, 1);
    }
    if (escStack.length === 0 && escListenerInstalled && typeof document !== "undefined") {
      document.removeEventListener("keydown", handleGlobalEsc);
      escListenerInstalled = false;
    }
  };
}

// Framework-owned close-button chrome. No author input — the overlay author
// supplies only the `kind`; the renderer owns the scrim, the frame placement,
// AND this close affordance.
const CLOSE_BUTTON_STYLE: CSSProperties = {
  position: "absolute",
  top: "0.5rem",
  right: "0.5rem",
  cursor: "pointer",
  lineHeight: 1,
  border: "none",
  background: "transparent",
};

interface OverlayFrameProps {
  readonly kind: OverlayKind;
  /**
   * The SINGLE close path. Esc, a scrim click, and the framework close button
   * all call it. It maps to StageRenderer's `closeOverlay` — an idempotent
   * set-to-hidden on the overlay box's view.toggled entry (never `onAction`).
   */
  readonly onClose: () => void;
  readonly children: ReactNode;
}

/**
 * Floats a valid-overlay box: a framework scrim behind + a `kind`-preset frame
 * (modal center / drawer end-edge) around the rendered box, plus the client
 * effects a pure renderNode can't host — focus-in on open, an Esc keydown
 * listener, scrim-click, framework close button, and a ref-counted body
 * scroll-lock. Placement/z/scrim/tint are ALL framework constants selected by
 * `kind`; the author supplies no coordinates (DC-002 / DC-004). Fail-safe: every
 * DOM effect is guarded so the frame never throws.
 */
export function OverlayFrame({ kind, onClose, children }: OverlayFrameProps): ReactNode {
  const frameRef = useRef<HTMLDivElement>(null);
  // Latest-close ref: the mount-time listener must call the CURRENT onClose (the
  // parent re-binds it each render), not the one captured at mount.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    // Restore focus to whatever was focused when the overlay opened.
    const previouslyFocused =
      typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
    // Move focus into the frame on open (best-effort; never throw).
    try {
      frameRef.current?.focus();
    } catch {
      // fail-safe
    }
    acquireScrollLock();

    // Register as the new topmost for Esc (calls the CURRENT onClose via the ref).
    const removeEsc = pushEsc((): void => onCloseRef.current());

    return () => {
      removeEsc();
      releaseScrollLock();
      // Restore focus on unmount (best-effort).
      try {
        previouslyFocused?.focus?.();
      } catch {
        // fail-safe
      }
    };
  }, []);

  const frameStyle = kind === "drawer" ? drawerFrameStyle() : modalFrameStyle();

  return (
    <>
      <div aria-hidden={true} style={overlayScrimStyle()} onClick={(): void => onClose()} />
      <div ref={frameRef} role="dialog" aria-modal={true} tabIndex={-1} style={frameStyle}>
        <button
          type="button"
          aria-label="Close"
          style={CLOSE_BUTTON_STYLE}
          onClick={(): void => onClose()}
        >
          {"×"}
        </button>
        {children}
      </div>
    </>
  );
}
