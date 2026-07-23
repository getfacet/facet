import { describe, expect, it } from "vitest";

import * as coreBarrel from "./index.js";
import * as tokenModule from "./tokens.js";
import {
  ALIGNMENTS,
  ASPECT_RATIOS,
  BORDER_WIDTHS,
  CHART_THICKNESSES,
  COLLAPSES,
  COLORS,
  COLUMNS,
  CONTROL_HEIGHTS,
  DIRECTIONS,
  ENTER_ANIMATIONS,
  FONT_FAMILIES,
  FONT_SIZES,
  FONT_STYLES,
  FONT_WEIGHTS,
  GRADIENTS,
  HIGHLIGHTS,
  INDICATOR_SIZES,
  JUSTIFICATIONS,
  LAYOUT_WIDTHS,
  LINE_CLAMPS,
  LETTER_SPACINGS,
  LINE_HEIGHTS,
  LINE_STYLES,
  LOADING_ANIMATIONS,
  MAX_HEIGHTS,
  MAX_WIDTHS,
  MIN_HEIGHTS,
  OBJECT_FITS,
  OBJECT_POSITIONS,
  PROGRESS_THICKNESSES,
  RADII,
  SCRIMS,
  SCROLLS,
  SHADOWS,
  SPACES,
  TEXT_ALIGNS,
  TEXT_WRAPS,
  WIDTHS,
} from "./tokens.js";

describe("Core style value domains", () => {
  it("locks the complete token and fixed-choice domains", () => {
    expect({
      space: SPACES,
      fontSize: FONT_SIZES,
      fontFamily: FONT_FAMILIES,
      fontWeight: FONT_WEIGHTS,
      radius: RADII,
      borderWidth: BORDER_WIDTHS,
      aspectRatio: ASPECT_RATIOS,
      minHeight: MIN_HEIGHTS,
      maxWidth: MAX_WIDTHS,
      layoutWidth: LAYOUT_WIDTHS,
      maxHeight: MAX_HEIGHTS,
      letterSpacing: LETTER_SPACINGS,
      lineHeight: LINE_HEIGHTS,
      controlHeight: CONTROL_HEIGHTS,
      indicatorSize: INDICATOR_SIZES,
      progressThickness: PROGRESS_THICKNESSES,
      chartThickness: CHART_THICKNESSES,
      color: COLORS,
      shadow: SHADOWS,
      gradient: GRADIENTS,
      scrim: SCRIMS,
      highlight: HIGHLIGHTS,
    }).toEqual({
      space: ["none", "xs", "sm", "md", "lg", "xl", "2xl"],
      fontSize: ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl"],
      fontFamily: ["sans", "serif", "mono"],
      fontWeight: ["regular", "medium", "semibold", "bold"],
      radius: ["none", "sm", "md", "lg", "full"],
      borderWidth: ["none", "thin", "medium", "thick"],
      aspectRatio: ["auto", "square", "landscape", "portrait", "wide"],
      minHeight: ["auto", "half", "screen"],
      maxWidth: ["none", "prose", "narrow", "wide"],
      layoutWidth: ["xs", "sm", "md", "lg"],
      maxHeight: ["none", "half", "screen"],
      letterSpacing: ["tight", "normal", "wide"],
      lineHeight: ["tight", "normal", "relaxed"],
      controlHeight: ["sm", "md", "lg"],
      indicatorSize: ["sm", "md", "lg"],
      progressThickness: ["sm", "md", "lg"],
      chartThickness: ["sm", "md", "lg"],
      color: [
        "background",
        "surface",
        "mutedSurface",
        "foreground",
        "mutedForeground",
        "border",
        "accent",
        "accentSurface",
        "accentForeground",
        "focusRing",
        "success",
        "successSurface",
        "successForeground",
        "warning",
        "warningSurface",
        "warningForeground",
        "danger",
        "dangerSurface",
        "dangerForeground",
        "info",
        "infoSurface",
        "infoForeground",
        "chart1",
        "chart2",
        "chart3",
        "chart4",
        "chart5",
        "chart6",
        "inherit",
      ],
      shadow: ["none", "sm", "md", "lg"],
      gradient: ["none", "accent", "success", "warning", "danger", "info"],
      scrim: ["none", "soft", "strong"],
      highlight: ["none", "accent", "warning"],
    });

    expect({
      direction: DIRECTIONS,
      alignment: ALIGNMENTS,
      justification: JUSTIFICATIONS,
      width: WIDTHS,
      scroll: SCROLLS,
      columns: COLUMNS,
      collapse: COLLAPSES,
      textAlign: TEXT_ALIGNS,
      fontStyle: FONT_STYLES,
      textWrap: TEXT_WRAPS,
      lineClamp: LINE_CLAMPS,
      lineStyle: LINE_STYLES,
      objectFit: OBJECT_FITS,
      objectPosition: OBJECT_POSITIONS,
      enterAnimation: ENTER_ANIMATIONS,
      animation: LOADING_ANIMATIONS,
    }).toEqual({
      direction: ["row", "column"],
      alignment: ["start", "center", "end", "stretch"],
      justification: ["start", "center", "end", "between", "around"],
      width: ["auto", "fit", "full"],
      scroll: ["none", "horizontal", "vertical"],
      columns: ["none", 2, 3, 4, "auto"],
      collapse: ["none", "stack"],
      textAlign: ["start", "center", "end"],
      fontStyle: ["normal", "italic"],
      textWrap: ["wrap", "nowrap", "balance"],
      lineClamp: ["none", 1, 2, 3, 4],
      lineStyle: ["solid", "dashed", "dotted"],
      objectFit: ["cover", "contain"],
      objectPosition: ["center", "top", "bottom", "start", "end"],
      enterAnimation: ["none", "fade", "slide"],
      animation: ["none", "pulse"],
    });
  });

  it("keeps width fit as a closed fixed choice between auto and full", () => {
    expect(WIDTHS).toEqual(["auto", "fit", "full"]);
  });

  it("does not export retired style value domains", () => {
    for (const retiredExport of [
      "ALIGNS",
      "JUSTIFIES",
      "SIZINGS",
      "RATIOS",
      "SCROLL_AXES",
      "APPEARS",
      "TRACKINGS",
      "LEADINGS",
      "COLOR_SCHEMES",
    ]) {
      expect(tokenModule).not.toHaveProperty(retiredExport);
    }

    expect(FONT_SIZES).not.toContain("5xl");
    expect(FONT_SIZES).not.toContain("6xl");
    expect(COLORS).not.toEqual(expect.arrayContaining(["fg", "bg", "surface-2", "chart-1"])); // style-hard-cut: allowed-negative
    expect(GRADIENTS).not.toEqual(expect.arrayContaining(["dusk", "dawn"]));
    expect(SCRIMS).not.toEqual(expect.arrayContaining(["light", "dark"]));
    expect(HIGHLIGHTS).not.toContain("band");
  });
});

describe("analytics-data-surface closed unions", () => {
  it("locks the chart axis, column width, and table dividers unions", () => {
    expect(tokenModule.CHART_AXES).toEqual(["primary", "secondary"]);
    expect(tokenModule.COLUMN_WIDTHS).toEqual(["auto", "narrow", "medium", "wide"]);
    expect(tokenModule.TABLE_DIVIDERS).toEqual(["none", "rows", "grid"]);
  });

  it("keeps the column width union a distinct domain from box widths and columns", () => {
    expect(tokenModule.COLUMN_WIDTHS).not.toEqual(WIDTHS);
    expect(tokenModule.COLUMN_WIDTHS).not.toEqual(COLUMNS);
  });

  it("exports the new unions through the @facet/core barrel", () => {
    expect(coreBarrel.CHART_AXES).toBe(tokenModule.CHART_AXES);
    expect(coreBarrel.COLUMN_WIDTHS).toBe(tokenModule.COLUMN_WIDTHS);
    expect(coreBarrel.TABLE_DIVIDERS).toBe(tokenModule.TABLE_DIVIDERS);
  });
});
