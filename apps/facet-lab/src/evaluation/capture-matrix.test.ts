import { describe, expect, it } from "vitest";

import { CAPTURE_MATRIX } from "./capture-matrix.js";

describe("capture matrix", () => {
  it("captures or explicitly marks all six conditions unavailable", () => {
    expect(CAPTURE_MATRIX).toEqual([
      { id: "mobile-light", viewport: "mobile", colorMode: "light", width: 390, height: 844 },
      { id: "mobile-dark", viewport: "mobile", colorMode: "dark", width: 390, height: 844 },
      { id: "tablet-light", viewport: "tablet", colorMode: "light", width: 820, height: 1180 },
      { id: "tablet-dark", viewport: "tablet", colorMode: "dark", width: 820, height: 1180 },
      {
        id: "desktop-light",
        viewport: "desktop",
        colorMode: "light",
        width: 1440,
        height: 900,
      },
      {
        id: "desktop-dark",
        viewport: "desktop",
        colorMode: "dark",
        width: 1440,
        height: 900,
      },
    ]);
    expect(new Set(CAPTURE_MATRIX.map(({ id }) => id))).toHaveLength(6);
    expect(Object.isFrozen(CAPTURE_MATRIX)).toBe(true);
    expect(CAPTURE_MATRIX.every(Object.isFrozen)).toBe(true);
  });
});
