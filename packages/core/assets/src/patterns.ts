import type { FacetPattern } from "@facet/core";
import { CHART_TABLE_VIEW_PATTERN } from "./pattern-chart-table.js";
import { CARD_PATTERN, EMPTY_STATE_PATTERN, SECTION_PATTERN } from "./pattern-containers.js";
import { CONTROL_PATTERNS } from "./pattern-controls.js";
import {
  FAQ_SECTION_PATTERN,
  FEATURE_GRID_PATTERN,
  HERO_PATTERN,
  PRICING_SECTION_PATTERN,
} from "./pattern-marketing.js";
import {
  DASHBOARD_SUMMARY_PATTERN,
  SETTINGS_PANEL_PATTERN,
  SUPPORT_TRIAGE_PATTERN,
} from "./pattern-product.js";

/**
 * Data-only reference trees an agent may inspect and adapt before authoring
 * ordinary Facet bricks. Patterns are not inserted or interpreted at runtime.
 */
export const DEFAULT_PATTERNS: readonly FacetPattern[] = [
  HERO_PATTERN,
  CARD_PATTERN,
  SECTION_PATTERN,
  ...CONTROL_PATTERNS,
  PRICING_SECTION_PATTERN,
  FAQ_SECTION_PATTERN,
  DASHBOARD_SUMMARY_PATTERN,
  SETTINGS_PANEL_PATTERN,
  FEATURE_GRID_PATTERN,
  EMPTY_STATE_PATTERN,
  SUPPORT_TRIAGE_PATTERN,
  CHART_TABLE_VIEW_PATTERN,
];
