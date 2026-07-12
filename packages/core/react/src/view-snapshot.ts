import { useEffect, useState } from "react";
import type { NodeId, Scheme, ViewSnapshot, Viewport } from "@facet/core";

/**
 * Renderer-owned viewport breakpoints. Report-only: they decide which closed
 * `Viewport` class a browser advertises on an event, NEVER how a brick lays
 * itself out (device layout stays the agent's job via patches — RISK-INV-5).
 * narrow < 640px; wide ≥ 1024px; medium is everything between.
 */
const NARROW_MAX_PX = 640;
const WIDE_MIN_PX = 1024;

const NARROW_QUERY = `(max-width: ${String(NARROW_MAX_PX - 1)}px)`;
const WIDE_QUERY = `(min-width: ${String(WIDE_MIN_PX)}px)`;
const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Pure builder for the browser's read-only view snapshot. Maps the renderer's
 * private `currentScreen`/`visibilityOverrides` (plus detected device classes)
 * into the wire-shape `ViewSnapshot`, dropping empty parts so an untouched page
 * reports `{}`. `visibilityOverrides` stores effective visibility (`true` =
 * shown), which becomes the `"shown"`/`"hidden"` value per node id. Never reads
 * `window` or storage — the caller supplies everything.
 */
export function captureViewSnapshot(
  currentScreen: string | undefined,
  visibilityOverrides: ReadonlyMap<NodeId, boolean>,
  viewport?: Viewport,
  scheme?: Scheme,
): ViewSnapshot {
  const snapshot: {
    screen?: string;
    toggled?: Record<string, "shown" | "hidden">;
    viewport?: Viewport;
    scheme?: Scheme;
  } = {};

  if (currentScreen !== undefined) {
    snapshot.screen = currentScreen;
  }

  const toggled: Record<string, "shown" | "hidden"> = {};
  let hasToggled = false;
  for (const [id, visible] of visibilityOverrides) {
    toggled[id] = visible ? "shown" : "hidden";
    hasToggled = true;
  }
  if (hasToggled) {
    snapshot.toggled = toggled;
  }

  if (viewport !== undefined) {
    snapshot.viewport = viewport;
  }
  if (scheme !== undefined) {
    snapshot.scheme = scheme;
  }

  return snapshot;
}

export interface DeviceClasses {
  viewport?: Viewport;
  scheme?: Scheme;
}

/**
 * One synchronous read of the device classes via `matchMedia`. Guarded for SSR
 * and older browsers: returns `{}` when `window`/`matchMedia` is unavailable so
 * an event simply carries no `viewport`/`scheme`.
 */
function detectDeviceClasses(): DeviceClasses {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return {};
  }
  const classes: DeviceClasses = {};
  if (window.matchMedia(NARROW_QUERY).matches) {
    classes.viewport = "narrow";
  } else if (window.matchMedia(WIDE_QUERY).matches) {
    classes.viewport = "wide";
  } else {
    classes.viewport = "medium";
  }
  classes.scheme = window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
  return classes;
}

/**
 * Report-only viewport/scheme detection. Subscribes to the width and
 * color-scheme media queries and mirrors the result in React state; the
 * listeners do NOTHING but call `setState` (they have no transport to reach —
 * DC-006). Returns `{}` when detection is unavailable. This module is fenced
 * out of layout/boxStyle resolution on purpose (RISK-INV-5).
 */
export function useViewportScheme(): DeviceClasses {
  const [classes, setClasses] = useState<DeviceClasses>(detectDeviceClasses);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const update = (): void => setClasses(detectDeviceClasses());
    // Re-read after mount in case the environment changed between the initial
    // render and commit, then keep in sync with the three queries.
    update();
    const queries = [NARROW_QUERY, WIDE_QUERY, DARK_QUERY].map((q) => window.matchMedia(q));
    for (const query of queries) {
      query.addEventListener("change", update);
    }
    return () => {
      for (const query of queries) {
        query.removeEventListener("change", update);
      }
    };
  }, []);

  return classes;
}
