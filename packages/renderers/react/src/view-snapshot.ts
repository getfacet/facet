import { useEffect, useState } from "react";
import type {
  ColorMode,
  ColorModePreference,
  NodeId,
  SortDirection,
  ViewSnapshot,
  Viewport,
} from "@facet/core";

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
 * private `currentScreen`/`visibilityOverrides`/`sortOverrides` (plus detected
 * device classes) into the wire-shape `ViewSnapshot`, dropping empty parts so an
 * untouched page reports `{}`. `visibilityOverrides` stores effective visibility
 * (`true` = shown), which becomes the `"shown"`/`"hidden"` value per node id;
 * `sortOverrides` maps a locally-sorted table node id to its active
 * column/direction, emitted as `sort` (omitted when the holder is empty, exactly
 * like `toggled`). Never reads `window` or storage — the caller supplies
 * everything.
 */
export function captureViewSnapshot(
  currentScreen: string | undefined,
  visibilityOverrides: ReadonlyMap<NodeId, boolean>,
  viewport?: Viewport,
  colorMode?: ColorMode,
  sortOverrides?: ReadonlyMap<NodeId, { column: string; direction: SortDirection }>,
): ViewSnapshot {
  const snapshot: {
    screen?: string;
    toggled?: Record<string, "shown" | "hidden">;
    sort?: Record<string, { column: string; direction: SortDirection }>;
    viewport?: Viewport;
    colorMode?: ColorMode;
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

  if (sortOverrides !== undefined) {
    const sort: Record<string, { column: string; direction: SortDirection }> = {};
    let hasSort = false;
    for (const [id, spec] of sortOverrides) {
      sort[id] = { column: spec.column, direction: spec.direction };
      hasSort = true;
    }
    if (hasSort) {
      snapshot.sort = sort;
    }
  }

  if (viewport !== undefined) {
    snapshot.viewport = viewport;
  }
  if (colorMode !== undefined) {
    snapshot.colorMode = colorMode;
  }

  return snapshot;
}

export interface DeviceClasses {
  viewport?: Viewport;
  /** Effective mode only; the host's `system` preference never enters a snapshot. */
  colorMode: ColorMode;
}

function colorModePreference(value: unknown): ColorModePreference {
  return value === "light" || value === "dark" ? value : "system";
}

/**
 * One synchronous read of the device classes via `matchMedia`. Guarded for SSR
 * and older browsers: viewport is omitted and `system` resolves to light until
 * browser detection is available.
 */
function detectDeviceClasses(preference: ColorModePreference): DeviceClasses {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return { colorMode: preference === "dark" ? "dark" : "light" };
  }
  const classes: DeviceClasses = {
    colorMode:
      preference === "system"
        ? window.matchMedia(DARK_QUERY).matches
          ? "dark"
          : "light"
        : preference,
  };
  if (window.matchMedia(NARROW_QUERY).matches) {
    classes.viewport = "narrow";
  } else if (window.matchMedia(WIDE_QUERY).matches) {
    classes.viewport = "wide";
  } else {
    classes.viewport = "medium";
  }
  return classes;
}

/**
 * Report-only viewport/effective-color-mode detection. Subscribes to width and,
 * only for `system`, color-scheme media queries and mirrors the result in React state; the
 * listeners do NOTHING but call `setState` (they have no transport to reach —
 * DC-006). This module is fenced out of layout resolution except for returning
 * the paint-only effective mode to StageRenderer (RISK-INV-5).
 */
export function useViewportColorMode(rawPreference: unknown = "system"): DeviceClasses {
  const preference = colorModePreference(rawPreference);
  const [classes, setClasses] = useState<DeviceClasses>(() => detectDeviceClasses(preference));

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      setClasses(detectDeviceClasses(preference));
      return;
    }
    const update = (): void => setClasses(detectDeviceClasses(preference));
    // Re-read after mount in case the environment changed between the initial
    // render and commit, then keep in sync with the three queries.
    update();
    const queryNames =
      preference === "system" ? [NARROW_QUERY, WIDE_QUERY, DARK_QUERY] : [NARROW_QUERY, WIDE_QUERY];
    const queries = queryNames.map((query) => window.matchMedia(query));
    for (const query of queries) {
      query.addEventListener("change", update);
    }
    return () => {
      for (const query of queries) {
        query.removeEventListener("change", update);
      }
    };
  }, [preference]);

  return classes;
}
