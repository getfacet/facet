import type { FacetTheme } from "@facet/core";
import { DEFAULT_THEME } from "@facet/assets";
import { describe, expect, it } from "vitest";
import {
  INTERACTION_CLASS,
  INTERACTION_CSS,
  interactionClass,
  interactionVariable,
} from "./interaction-style.js";
import { resolveBrickStyle } from "./style-resolver.js";
import { resolveTheme } from "./theme.js";

function precedenceTheme(): FacetTheme {
  return {
    ...DEFAULT_THEME,
    defaults: {
      ...DEFAULT_THEME.defaults,
      box: {
        ...DEFAULT_THEME.defaults.box,
        gap: "xs",
        background: "surface",
        hover: { background: "mutedSurface", borderColor: "border" },
      },
    },
    presets: {
      ...DEFAULT_THEME.presets,
      box: {
        ...DEFAULT_THEME.presets?.box,
        base: {
          description: "Base precedence fixture.",
          useWhen: "Use to exercise base Preset resolution.",
          style: {
            gap: "sm",
            background: "accentSurface",
            hover: { background: "successSurface" },
          },
        },
        active: {
          description: "Active precedence fixture.",
          useWhen: "Use to exercise active Preset resolution.",
          style: {
            gap: "lg",
            background: "dangerSurface",
            hover: { background: "danger", shadow: "lg" },
          },
        },
      },
    },
  };
}

describe("resolveBrickStyle", () => {
  it("resolves default Preset direct active and state order", () => {
    const resolved = resolveBrickStyle(
      resolveTheme(precedenceTheme()),
      "box",
      {
        preset: "base",
        gap: "md",
        background: "warningSurface",
        hover: { borderColor: "warning" },
        active: {
          preset: "active",
          gap: "xl",
          background: "infoSurface",
        },
      },
      { active: true },
    );

    expect(resolved).toMatchObject({
      gap: "xl",
      background: "infoSurface",
      hover: {
        background: "danger",
        borderColor: "warning",
        shadow: "lg",
      },
    });
  });

  it("keeps the Theme default and valid direct style when a Preset is missing", () => {
    const resolved = resolveBrickStyle(resolveTheme(precedenceTheme()), "box", {
      preset: "missing",
      gap: "2xl",
    });

    expect(resolved.gap).toBe("2xl");
    expect(resolved.background).toBe("surface");
  });

  it("never recursively resolves active or Preset-owned selectors", () => {
    const raw = {
      preset: "base",
      active: {
        preset: "active",
        gap: "lg",
        hover: { background: "danger" },
        active: { gap: "2xl" },
      },
    };

    const resolved = resolveBrickStyle(resolveTheme(precedenceTheme()), "box", raw, {
      active: true,
    });

    expect(resolved.gap).toBe("lg");
    expect(resolved.hover?.background).toBe("danger");
    expect(resolved).not.toHaveProperty("active");
    expect(resolved).not.toHaveProperty("preset");
  });

  it("merges nested target properties without retaining unknown raw keys", () => {
    const resolved = resolveBrickStyle(resolveTheme(), "input", {
      control: {
        color: "success",
        hover: { background: "successSurface" },
        cssText: "position:absolute",
      },
      arbitraryTarget: { color: "danger" },
    });

    expect(resolved.control).toMatchObject({
      color: "success",
      hover: { background: "successSurface" },
    });
    expect(resolved.control).not.toHaveProperty("cssText");
    expect(resolved).not.toHaveProperty("arbitraryTarget");
  });
});

describe("renderer-owned interaction contract", () => {
  it("uses fixed classes and variables instead of agent-provided selectors", () => {
    expect(INTERACTION_CLASS).toBe("facet-interaction");
    expect(interactionClass("hover", "background")).toBe("facet-hover-background");
    expect(interactionVariable("hover", "background")).toBe("--facet-hover-background");
    expect(INTERACTION_CSS).toContain(".facet-hover-background:hover");
    expect(INTERACTION_CSS).toContain("var(--facet-hover-background)");
    expect(INTERACTION_CSS).not.toMatch(/url\(|attr\(|data-facet/);
  });
});
