import { validatePattern, validateTheme } from "@facet/core";
import { describe, expect, it } from "vitest";
import * as assets from "./index.js";

describe("@facet/assets public surface", () => {
  it("exports Theme and Patterns only", () => {
    expect(Object.keys(assets).sort()).toEqual(["DEFAULT_PATTERNS", "DEFAULT_THEME"]);

    const theme = validateTheme(assets.DEFAULT_THEME);
    expect(theme.issues).toEqual([]);

    expect(assets.DEFAULT_PATTERNS.length).toBeGreaterThan(0);
    for (const pattern of assets.DEFAULT_PATTERNS) {
      const result = validatePattern(pattern, assets.DEFAULT_THEME);
      expect(result.issues).toEqual([]);
      expect(result.pattern).toEqual(pattern);
    }

    expect(assets).not.toHaveProperty(["DEFAULT", "CATALOG"].join("_"));
    expect(assets).not.toHaveProperty(["DEFAULT", "COMPOSITIONS"].join("_"));
  });
});
