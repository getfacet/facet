import type { Color, FacetTheme, Space } from "@facet/core";
import { validateTheme } from "@facet/core";
import { describe, expect, it } from "vitest";
import { COLOR, DEFAULT_THEME } from "./theme.js";

// COLOR is the single source of truth for the palette (ChatDock consumes it via
// the renderer re-export), so its values are pinned here — byte-identical to the
// values @facet/react shipped before the data moved into @facet/assets.
describe("COLOR", () => {
  it("is exported with a pinned palette", () => {
    expect(COLOR.border).toBe("#e2e5ea");
    expect(COLOR.fg).toBe("#1a1d23");
    expect(COLOR.bg).toBe("#ffffff");
    expect(COLOR.accent).toBe("#4f46e5");
    expect(COLOR["fg-muted"]).toBe("#6b7280");
    expect(COLOR["surface-2"]).toBe("#eceef1");
    expect(COLOR["accent-fg"]).toBe("#ffffff");
  });

  it("is a null-prototype map so a hostile token name resolves to nothing", () => {
    expect(Object.getPrototypeOf(COLOR)).toBeNull();
    expect(COLOR["constructor" as Color]).toBeUndefined();
    expect(COLOR["__proto__" as Color]).toBeUndefined();
  });
});

// DEFAULT_THEME is today's values expressed as an operator FacetTheme document.
// It must round-trip through core's validator with no errors so operators can
// copy it as a starting point and hosts can register it by name.
describe("DEFAULT_THEME", () => {
  it("passes validateTheme with zero issues", () => {
    const result = validateTheme(DEFAULT_THEME);
    expect(result.theme).toBeDefined();
    expect(result.issues).toEqual([]);
  });

  // Pinned shape: exactly the name + the six token groups, nothing else.
  it("keeps exactly the name + six token groups", () => {
    expect(Object.keys(DEFAULT_THEME).sort()).toEqual(
      ["color", "fontSize", "fontWeight", "name", "radius", "ratio", "space"].sort(),
    );
  });

  it('is named "default" and covers every token group with the pinned values', () => {
    expect(DEFAULT_THEME.name).toBe("default");
    expect(DEFAULT_THEME.color?.bg).toBe("#ffffff");
    expect(DEFAULT_THEME.space?.md).toBe("16px");
    expect(DEFAULT_THEME.fontSize?.md).toBe("16px");
    expect(DEFAULT_THEME.fontWeight?.bold).toBe(700);
    expect(DEFAULT_THEME.radius?.md).toBe("10px");
    expect(DEFAULT_THEME.ratio?.wide).toBe("16 / 9");
  });

  it("uses null-prototype group maps (hostile token names resolve to nothing)", () => {
    const theme = DEFAULT_THEME as Required<
      Pick<FacetTheme, "color" | "space" | "fontSize" | "fontWeight" | "radius" | "ratio">
    >;
    expect(Object.getPrototypeOf(theme.color)).toBeNull();
    expect(Object.getPrototypeOf(theme.space)).toBeNull();
    expect(Object.getPrototypeOf(theme.fontSize)).toBeNull();
    expect(Object.getPrototypeOf(theme.fontWeight)).toBeNull();
    expect(Object.getPrototypeOf(theme.radius)).toBeNull();
    expect(Object.getPrototypeOf(theme.ratio)).toBeNull();
    expect(theme.space["__proto__" as Space]).toBeUndefined();
  });
});
