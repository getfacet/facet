import type { ColorMode, ViewportName } from "../shared/run-contract.js";

export interface CaptureCondition {
  readonly id: `${ViewportName}-${ColorMode}`;
  readonly viewport: ViewportName;
  readonly colorMode: ColorMode;
  readonly width: number;
  readonly height: number;
}

const VIEWPORT_DIMENSIONS: Readonly<Record<ViewportName, readonly [number, number]>> = {
  mobile: [390, 844],
  tablet: [820, 1180],
  desktop: [1440, 900],
};

const VIEWPORT_ORDER = ["mobile", "tablet", "desktop"] as const;
const COLOR_MODE_ORDER = ["light", "dark"] as const;

/** Stable exhaustive responsive/color matrix shared by capture and presenters. */
export const CAPTURE_MATRIX: readonly CaptureCondition[] = Object.freeze(
  VIEWPORT_ORDER.flatMap((viewport) =>
    COLOR_MODE_ORDER.map((colorMode) => {
      const [width, height] = VIEWPORT_DIMENSIONS[viewport];
      return Object.freeze({
        id: `${viewport}-${colorMode}`,
        viewport,
        colorMode,
        width,
        height,
      });
    }),
  ),
);
