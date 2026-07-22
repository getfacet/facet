import { DEFAULT_THEME } from "@facet/assets";
import type { FacetPattern, FacetPreset, FacetTheme } from "@facet/core";

import type { ReferenceBenchmarkCustomAssets } from "./reference-benchmark-custom-assets.js";

function requiredPreset<T extends FacetPreset>(preset: T | undefined, name: string): T {
  if (preset === undefined) throw new Error(`Missing default preset ${name}`);
  return preset;
}

const DEFAULT_BOX_PRESETS = DEFAULT_THEME.presets?.box;
const DEFAULT_TEXT_PRESETS = DEFAULT_THEME.presets?.text;
const DEFAULT_RICHTEXT_PRESETS = DEFAULT_THEME.presets?.richtext;
const DEFAULT_TABLE_PRESETS = DEFAULT_THEME.presets?.table;

export const SUPABASE_BENCHMARK_THEME: FacetTheme = {
  ...DEFAULT_THEME,
  name: "supabase-table-editor",
  description:
    "Dense administrative console theme for the Supabase Table Editor reference benchmark.",
  tokens: {
    ...DEFAULT_THEME.tokens,
    space: {
      ...DEFAULT_THEME.tokens.space,
      xs: "4px",
      sm: "6px",
      md: "10px",
      lg: "14px",
      xl: "20px",
      "2xl": "32px",
    },
    fontSize: {
      ...DEFAULT_THEME.tokens.fontSize,
      xs: "11px",
      sm: "12px",
      md: "13px",
      lg: "15px",
      xl: "18px",
      "2xl": "22px",
      "3xl": "28px",
      "4xl": "36px",
    },
    radius: {
      ...DEFAULT_THEME.tokens.radius,
      sm: "4px",
      md: "6px",
      lg: "10px",
    },
    controlHeight: {
      ...DEFAULT_THEME.tokens.controlHeight,
      sm: "28px",
      md: "34px",
      lg: "40px",
    },
    paint: {
      ...DEFAULT_THEME.tokens.paint,
      light: {
        ...DEFAULT_THEME.tokens.paint.light,
        color: {
          ...DEFAULT_THEME.tokens.paint.light.color,
          background: "#ffffff",
          surface: "#fbfbfa",
          mutedSurface: "#f4f6f4",
          foreground: "#1f2a24",
          mutedForeground: "#5f6f66",
          border: "#d9e1dc",
          accent: "#22c55e",
          accentSurface: "#e9f9ef",
          accentForeground: "#06351d",
          focusRing: "#2dd47f",
          success: "#16a34a",
          successSurface: "#dcfce7",
          successForeground: "#14532d",
          chart1: "#3ecf8e",
          chart2: "#1f2937",
          chart3: "#6b7280",
        },
        shadow: {
          ...DEFAULT_THEME.tokens.paint.light.shadow,
          sm: "0 1px 2px rgba(17, 24, 39, 0.06)",
          md: "0 8px 18px rgba(17, 24, 39, 0.10)",
          lg: "0 18px 42px rgba(17, 24, 39, 0.14)",
        },
      },
      dark: {
        ...DEFAULT_THEME.tokens.paint.dark,
        color: {
          ...DEFAULT_THEME.tokens.paint.dark.color,
          background: "#0f1411",
          surface: "#151b17",
          mutedSurface: "#1f2a24",
          foreground: "#ecfdf3",
          mutedForeground: "#a7b9ae",
          border: "#2d3a32",
          accent: "#3ecf8e",
          accentSurface: "#113b27",
          accentForeground: "#071b11",
          focusRing: "#5ee2a3",
          chart1: "#3ecf8e",
          chart2: "#94a3b8",
          chart3: "#cbd5e1",
        },
      },
    },
  },
  defaults: {
    ...DEFAULT_THEME.defaults,
    box: {
      ...DEFAULT_THEME.defaults.box,
      gap: "xs",
      padding: "none",
      color: "foreground",
    },
    text: {
      ...DEFAULT_THEME.defaults.text,
      fontSize: "sm",
      color: "foreground",
      lineHeight: "normal",
    },
    table: {
      ...DEFAULT_THEME.defaults.table,
      background: "background",
      borderRadius: "none",
      shadow: "none",
      header: {
        ...DEFAULT_THEME.defaults.table.header,
        fontSize: "xs",
        padding: "xs",
        background: "surface",
        color: "mutedForeground",
      },
      cell: {
        ...DEFAULT_THEME.defaults.table.cell,
        fontSize: "xs",
        padding: "xs",
      },
    },
  },
  presets: {
    box: {
      panel: requiredPreset(DEFAULT_BOX_PRESETS?.panel, "box.panel"),
      badge: requiredPreset(DEFAULT_BOX_PRESETS?.badge, "box.badge"),
      successBadge: requiredPreset(DEFAULT_BOX_PRESETS?.successBadge, "box.successBadge"),
      warningBadge: requiredPreset(DEFAULT_BOX_PRESETS?.warningBadge, "box.warningBadge"),
      primaryAction: requiredPreset(DEFAULT_BOX_PRESETS?.primaryAction, "box.primaryAction"),
      secondaryAction: requiredPreset(DEFAULT_BOX_PRESETS?.secondaryAction, "box.secondaryAction"),
      appShell: {
        description: "Full-width dense app shell for database console benchmarks.",
        useWhen: "Use for Supabase-like admin surfaces with navigation and data regions.",
        style: {
          width: "full",
          minHeight: "screen",
          gap: "none",
          background: "background",
          borderColor: "border",
          borderWidth: "thin",
          borderRadius: "none",
        },
      },
      topbar: {
        description: "Thin administrative top navigation bar.",
        useWhen: "Use for dense product chrome above a data workspace.",
        style: {
          direction: "row",
          gap: "sm",
          padding: "sm",
          alignItems: "center",
          justifyContent: "between",
          width: "full",
          background: "surface",
          borderColor: "border",
          borderWidth: "thin",
        },
      },
      sidebar: {
        description: "Compact table-list sidebar surface.",
        useWhen: "Use for database table navigation and filter lists.",
        style: {
          gap: "xs",
          padding: "sm",
          background: "surface",
          borderColor: "border",
          borderWidth: "thin",
          width: "full",
        },
      },
      toolbar: {
        description: "Dense row of table editor controls.",
        useWhen: "Use above a data grid for filters, sort, role, and insert controls.",
        style: {
          direction: "row",
          gap: "xs",
          padding: "xs",
          alignItems: "center",
          justifyContent: "between",
          width: "full",
          background: "background",
          borderColor: "border",
          borderWidth: "thin",
        },
      },
      controlPill: {
        description: "Small bordered console control.",
        useWhen: "Use for table toolbar buttons and role selectors.",
        style: {
          direction: "row",
          gap: "xs",
          padding: "xs",
          alignItems: "center",
          justifyContent: "center",
          width: "fit",
          background: "surface",
          borderColor: "border",
          borderWidth: "thin",
          borderRadius: "sm",
        },
      },
    },
    text: {
      subheading: requiredPreset(DEFAULT_TEXT_PRESETS?.subheading, "text.subheading"),
      muted: requiredPreset(DEFAULT_TEXT_PRESETS?.muted, "text.muted"),
      badge: requiredPreset(DEFAULT_TEXT_PRESETS?.badge, "text.badge"),
      actionLabel: requiredPreset(DEFAULT_TEXT_PRESETS?.actionLabel, "text.actionLabel"),
      successBadge: requiredPreset(DEFAULT_TEXT_PRESETS?.successBadge, "text.successBadge"),
      warningBadge: requiredPreset(DEFAULT_TEXT_PRESETS?.warningBadge, "text.warningBadge"),
      consoleLabel: {
        description: "Small muted console label.",
        useWhen: "Use for table names, schema labels, and chrome labels.",
        style: { fontSize: "xs", fontWeight: "medium", color: "mutedForeground" },
      },
      consoleStrong: {
        description: "Compact emphasized console text.",
        useWhen: "Use for selected table names or primary toolbar labels.",
        style: { fontSize: "sm", fontWeight: "semibold", color: "foreground" },
      },
    },
    richtext: {
      compact: requiredPreset(DEFAULT_RICHTEXT_PRESETS?.compact, "richtext.compact"),
    },
    table: {
      standard: requiredPreset(DEFAULT_TABLE_PRESETS?.standard, "table.standard"),
      dataGrid: {
        description: "Dense Supabase-like table grid chrome.",
        useWhen: "Use for administrative empty or populated data grids.",
        style: {
          width: "full",
          background: "background",
          borderRadius: "none",
          shadow: "none",
          dividers: "grid",
          stickyHeader: true,
          header: { fontSize: "xs", padding: "xs", background: "surface", borderWidth: "thin" },
          cell: { fontSize: "xs", padding: "xs", borderWidth: "thin" },
        },
      },
    },
  },
};

export const SUPABASE_SHELL_PATTERN: FacetPattern = {
  name: "supabase-shell",
  description: "Dense database editor shell with topbar, sidebar, toolbar, and grid.",
  useWhen: "Recreating Supabase-like administrative database screens.",
  root: "supabase-shell.root",
  nodes: {
    "supabase-shell.root": {
      id: "supabase-shell.root",
      type: "box",
      style: { preset: "appShell" },
      children: ["supabase-shell.topbar", "supabase-shell.body"],
    },
    "supabase-shell.topbar": {
      id: "supabase-shell.topbar",
      type: "box",
      style: { preset: "topbar" },
      children: ["supabase-shell.project", "supabase-shell.actions"],
    },
    "supabase-shell.project": {
      id: "supabase-shell.project",
      type: "text",
      value: "ama2-dev / main",
      style: { preset: "consoleStrong" },
    },
    "supabase-shell.actions": {
      id: "supabase-shell.actions",
      type: "box",
      style: { direction: "row", gap: "xs", width: "fit" },
      children: ["supabase-shell.connect", "supabase-shell.insert"],
    },
    "supabase-shell.connect": {
      id: "supabase-shell.connect",
      type: "box",
      style: { preset: "controlPill" },
      children: ["supabase-shell.connect-label"],
    },
    "supabase-shell.connect-label": {
      id: "supabase-shell.connect-label",
      type: "text",
      value: "Connect",
      style: { preset: "consoleLabel" },
    },
    "supabase-shell.insert": {
      id: "supabase-shell.insert",
      type: "box",
      style: { preset: "successBadge" },
      children: ["supabase-shell.insert-label"],
    },
    "supabase-shell.insert-label": {
      id: "supabase-shell.insert-label",
      type: "text",
      value: "Insert",
      style: { preset: "successBadge" },
    },
    "supabase-shell.body": {
      id: "supabase-shell.body",
      type: "box",
      style: { direction: "row", gap: "none", width: "full", grow: true },
      children: ["supabase-shell.sidebar", "supabase-shell.workspace"],
    },
    "supabase-shell.sidebar": {
      id: "supabase-shell.sidebar",
      type: "box",
      style: { preset: "sidebar" },
      children: ["supabase-shell.schema", "supabase-shell.table"],
    },
    "supabase-shell.schema": {
      id: "supabase-shell.schema",
      type: "text",
      value: "schema public",
      style: { preset: "consoleLabel" },
    },
    "supabase-shell.table": {
      id: "supabase-shell.table",
      type: "text",
      value: "advertisements",
      style: { preset: "consoleStrong" },
    },
    "supabase-shell.workspace": {
      id: "supabase-shell.workspace",
      type: "box",
      style: { gap: "xs", padding: "sm", width: "full", grow: true },
      children: ["supabase-shell.toolbar", "supabase-shell.grid"],
    },
    "supabase-shell.toolbar": {
      id: "supabase-shell.toolbar",
      type: "box",
      style: { preset: "toolbar" },
      children: ["supabase-shell.filter", "supabase-shell.sort"],
    },
    "supabase-shell.filter": {
      id: "supabase-shell.filter",
      type: "text",
      value: "Filter by id, video_id, product_name…",
      style: { preset: "consoleLabel" },
    },
    "supabase-shell.sort": {
      id: "supabase-shell.sort",
      type: "text",
      value: "Sort",
      style: { preset: "consoleStrong" },
    },
    "supabase-shell.grid": {
      id: "supabase-shell.grid",
      type: "table",
      style: { preset: "dataGrid" },
      columns: [
        { key: "id", label: "id" },
        { key: "video_id", label: "video_id" },
        { key: "product_name", label: "product_name" },
      ],
      rows: [],
    },
  },
};

export const SUPABASE_TOOLBAR_PATTERN: FacetPattern = {
  name: "supabase-toolbar",
  description: "Compact editor toolbar with filter, sort, role, and insert controls.",
  useWhen: "When a table-editor benchmark needs dense product chrome.",
  root: "supabase-toolbar.root",
  nodes: {
    "supabase-toolbar.root": {
      id: "supabase-toolbar.root",
      type: "box",
      style: { preset: "toolbar" },
      children: [
        "supabase-toolbar.filter",
        "supabase-toolbar.sort",
        "supabase-toolbar.role",
        "supabase-toolbar.insert",
      ],
    },
    "supabase-toolbar.filter": {
      id: "supabase-toolbar.filter",
      type: "text",
      value: "Filter by id…",
      style: { preset: "consoleLabel" },
    },
    "supabase-toolbar.sort": {
      id: "supabase-toolbar.sort",
      type: "box",
      style: { preset: "controlPill" },
      children: ["supabase-toolbar.sort-label"],
    },
    "supabase-toolbar.sort-label": {
      id: "supabase-toolbar.sort-label",
      type: "text",
      value: "Sort",
      style: { preset: "consoleLabel" },
    },
    "supabase-toolbar.role": {
      id: "supabase-toolbar.role",
      type: "box",
      style: { preset: "controlPill" },
      children: ["supabase-toolbar.role-label"],
    },
    "supabase-toolbar.role-label": {
      id: "supabase-toolbar.role-label",
      type: "text",
      value: "Role postgres",
      style: { preset: "consoleLabel" },
    },
    "supabase-toolbar.insert": {
      id: "supabase-toolbar.insert",
      type: "box",
      style: { preset: "successBadge" },
      children: ["supabase-toolbar.insert-label"],
    },
    "supabase-toolbar.insert-label": {
      id: "supabase-toolbar.insert-label",
      type: "text",
      value: "Insert",
      style: { preset: "successBadge" },
    },
  },
};

export const SUPABASE_BENCHMARK_PATTERNS: readonly FacetPattern[] = [
  SUPABASE_SHELL_PATTERN,
  SUPABASE_TOOLBAR_PATTERN,
] as const;

export const SUPABASE_BENCHMARK_ASSETS: ReferenceBenchmarkCustomAssets = {
  benchmarkId: "supabase-table-editor",
  theme: SUPABASE_BENCHMARK_THEME,
  patterns: SUPABASE_BENCHMARK_PATTERNS,
  density: "dense",
  notes: [
    "Uses tighter space, smaller type, flatter shadows, and thin grid chrome.",
    "Keeps app-shell behavior in Patterns and Theme/Preset data, not new Core layout fields.",
  ],
};
