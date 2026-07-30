/**
 * The default design system: one coherent light theme filling `@facet/core`'s
 * token-name contract.
 *
 * Core owns the **names** and this module owns the **values**. Every name the
 * contract declares is supplied here and nothing else is, because the contract
 * is closed in both directions — a missing token and an invented one are both
 * rejections, not warnings. A host reskins Facet by handing over a different
 * theme with these same names; it never adds a name.
 *
 * The values are chosen as one system rather than as thirty-seven independent
 * picks: a single neutral ramp from background through border to muted and full
 * text, one accent that carries white on it, three status hues at the same
 * darkness as each other, a 4px-derived spacing rhythm, and a type scale whose
 * steps stay distinguishable at small sizes. Every value stays inside the token
 * value grammar, so projecting one into a stylesheet can only ever set the
 * property it was written for.
 *
 * This module is plain data. It holds no framework, no browser global, and no
 * ambient read of any kind, which is what lets the default theme sit in the
 * dependency-free half of the graph and be shared by a server render and a
 * browser render without either one changing it.
 */

import type { FacetTheme } from "@facet/core";

/**
 * The default theme, frozen group by group.
 *
 * Freezing is not decoration: the theme is read on every render and shared
 * across sessions, so a value that could be reassigned anywhere would make two
 * renders of the same page legitimately differ. Frozen data with no accessor on
 * it reads byte-identically forever.
 */
export const DEFAULT_THEME: FacetTheme = Object.freeze({
  /**
   * One neutral ramp plus one accent plus three status hues. The neutrals are
   * ordered background - surface - border - textMuted - text, so a component can
   * pick any two adjacent steps and still separate visually; `onAccent` is the
   * only paint intended to sit on top of `accent`.
   */
  color: Object.freeze({
    background: "#ffffff",
    surface: "#f5f7fa",
    border: "#dde2e9",
    text: "#101418",
    textMuted: "#5b6673",
    accent: "#3454d1",
    onAccent: "#ffffff",
    success: "#0f7b4f",
    warning: "#96590b",
    danger: "#b42318",
  }),
  /** A 4px-derived rhythm: 4, 8, 16, 24, 40. Gaps and padding both read it. */
  space: Object.freeze({
    xs: "0.25rem",
    sm: "0.5rem",
    md: "1rem",
    lg: "1.5rem",
    xl: "2.5rem",
  }),
  /** Rounding, from a control's corner up to the pill `full`. */
  radius: Object.freeze({
    sm: "0.25rem",
    md: "0.5rem",
    lg: "0.875rem",
    full: "9999px",
  }),
  /** Two weights only: a hairline separator and a deliberate emphasis edge. */
  borderWidth: Object.freeze({
    thin: "1px",
    thick: "2px",
  }),
  /** Elevation tinted with the text neutral rather than pure black, so it reads as depth. */
  shadow: Object.freeze({
    sm: "0 1px 2px rgba(16, 20, 24, 0.06)",
    md: "0 4px 12px rgba(16, 20, 24, 0.1)",
    lg: "0 16px 40px rgba(16, 20, 24, 0.16)",
  }),
  /** System-first stacks, so a page paints correctly before any font loads. */
  fontFamily: Object.freeze({
    sans: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    mono: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace",
  }),
  /** A type scale that stays legible at `xs` and still steps clearly to `xl`. */
  fontSize: Object.freeze({
    xs: "0.75rem",
    sm: "0.875rem",
    md: "1rem",
    lg: "1.25rem",
    xl: "1.75rem",
  }),
  /** CSS-ready weight strings; a weight is text here, never a number. */
  fontWeight: Object.freeze({
    regular: "400",
    medium: "500",
    bold: "700",
  }),
  /** Unitless leading, so it scales with whatever size it lands on. */
  lineHeight: Object.freeze({
    tight: "1.25",
    normal: "1.55",
    relaxed: "1.75",
  }),
});
