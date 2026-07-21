import { DEFAULT_THEME } from "@facet/assets";
import type { FacetPattern, FacetPreset, FacetTheme } from "@facet/core";

import type { ReferenceBenchmarkCustomAssets } from "./reference-benchmark-custom-assets.js";
import type { ReferenceBenchmarkId } from "./reference-benchmarks.js";

function requiredPreset<T extends FacetPreset>(preset: T | undefined, name: string): T {
  if (preset === undefined) throw new Error(`Missing default preset ${name}`);
  return preset;
}

const DEFAULT_BOX_PRESETS = DEFAULT_THEME.presets?.box;
const DEFAULT_TEXT_PRESETS = DEFAULT_THEME.presets?.text;
const DEFAULT_MEDIA_PRESETS = DEFAULT_THEME.presets?.media;
const DEFAULT_CHART_PRESETS = DEFAULT_THEME.presets?.chart;
const DEFAULT_TABLE_PRESETS = DEFAULT_THEME.presets?.table;
const DEFAULT_LIST_PRESETS = DEFAULT_THEME.presets?.list;

interface RealServiceThemeOptions {
  readonly name: ReferenceBenchmarkId;
  readonly description: string;
  readonly density: "dense" | "roomy";
  readonly colors: {
    readonly background: string;
    readonly surface: string;
    readonly mutedSurface: string;
    readonly foreground: string;
    readonly mutedForeground: string;
    readonly border: string;
    readonly accent: string;
    readonly accentSurface: string;
    readonly accentForeground: string;
    readonly info: string;
    readonly infoSurface: string;
    readonly warning: string;
    readonly success: string;
    readonly chart1: string;
    readonly chart2: string;
    readonly chart3: string;
  };
}

function createRealServiceTheme({
  name,
  description,
  density,
  colors,
}: RealServiceThemeOptions): FacetTheme {
  const dense = density === "dense";
  return {
    ...DEFAULT_THEME,
    name,
    description,
    tokens: {
      ...DEFAULT_THEME.tokens,
      space: {
        ...DEFAULT_THEME.tokens.space,
        xs: dense ? "4px" : "6px",
        sm: dense ? "8px" : "10px",
        md: dense ? "12px" : "16px",
        lg: dense ? "18px" : "24px",
        xl: dense ? "28px" : "36px",
        "2xl": dense ? "44px" : "56px",
      },
      fontSize: {
        ...DEFAULT_THEME.tokens.fontSize,
        xs: dense ? "11px" : "12px",
        sm: dense ? "12px" : "13px",
        md: dense ? "14px" : "15px",
        lg: dense ? "18px" : "20px",
        xl: dense ? "24px" : "26px",
        "2xl": dense ? "32px" : "34px",
        "3xl": dense ? "44px" : "46px",
        "4xl": dense ? "56px" : "60px",
      },
      radius: {
        ...DEFAULT_THEME.tokens.radius,
        sm: dense ? "8px" : "10px",
        md: dense ? "14px" : "18px",
        lg: dense ? "22px" : "28px",
      },
      maxWidth: {
        ...DEFAULT_THEME.tokens.maxWidth,
        narrow: "420px",
        prose: "760px",
        wide: "1440px",
      },
      paint: {
        ...DEFAULT_THEME.tokens.paint,
        light: {
          ...DEFAULT_THEME.tokens.paint.light,
          color: {
            ...DEFAULT_THEME.tokens.paint.light.color,
            background: colors.background,
            surface: colors.surface,
            mutedSurface: colors.mutedSurface,
            foreground: colors.foreground,
            mutedForeground: colors.mutedForeground,
            border: colors.border,
            accent: colors.accent,
            accentSurface: colors.accentSurface,
            accentForeground: colors.accentForeground,
            info: colors.info,
            infoSurface: colors.infoSurface,
            warning: colors.warning,
            success: colors.success,
            chart1: colors.chart1,
            chart2: colors.chart2,
            chart3: colors.chart3,
            focusRing: colors.accent,
          },
          shadow: {
            ...DEFAULT_THEME.tokens.paint.light.shadow,
            sm: "0 1px 4px rgba(15, 23, 42, 0.08)",
            md: "0 12px 32px rgba(15, 23, 42, 0.10)",
            lg: "0 24px 80px rgba(15, 23, 42, 0.14)",
          },
        },
        dark: {
          ...DEFAULT_THEME.tokens.paint.dark,
          color: {
            ...DEFAULT_THEME.tokens.paint.dark.color,
            background: "#111827",
            surface: "#1f2937",
            mutedSurface: "#263244",
            foreground: "#f8fafc",
            mutedForeground: "#cbd5e1",
            border: "#334155",
            accent: colors.accent,
            accentSurface: "#263244",
            accentForeground: "#ffffff",
            chart1: colors.chart1,
            chart2: colors.chart2,
            chart3: colors.chart3,
          },
        },
      },
    },
    defaults: {
      ...DEFAULT_THEME.defaults,
      box: {
        ...DEFAULT_THEME.defaults.box,
        gap: dense ? "sm" : "md",
        padding: "none",
        color: "inherit",
      },
      text: {
        ...DEFAULT_THEME.defaults.text,
        fontSize: "md",
        color: "foreground",
        lineHeight: "normal",
      },
      media: {
        ...DEFAULT_THEME.defaults.media,
        borderRadius: "md",
        width: "full",
        objectFit: "cover",
      },
    },
    presets: {
      box: {
        panel: requiredPreset(DEFAULT_BOX_PRESETS?.panel, "box.panel"),
        inset: requiredPreset(DEFAULT_BOX_PRESETS?.inset, "box.inset"),
        badge: requiredPreset(DEFAULT_BOX_PRESETS?.badge, "box.badge"),
        successBadge: requiredPreset(DEFAULT_BOX_PRESETS?.successBadge, "box.successBadge"),
        warningBadge: requiredPreset(DEFAULT_BOX_PRESETS?.warningBadge, "box.warningBadge"),
        primaryAction: requiredPreset(DEFAULT_BOX_PRESETS?.primaryAction, "box.primaryAction"),
        secondaryAction: requiredPreset(
          DEFAULT_BOX_PRESETS?.secondaryAction,
          "box.secondaryAction",
        ),
        ...(name === "ama2-messages-app" || name === "google-search-console-performance"
          ? {
              sideNav: {
                description: "Tall product navigation rail.",
                useWhen: "Use for app surfaces with a persistent left menu.",
                style: {
                  gap: "lg",
                  padding: "xl",
                  background: "surface",
                  borderColor: "border",
                  borderWidth: "thin",
                  minHeight: "screen",
                },
              },
              threadFilter: {
                description: "Rounded horizontal entity filter.",
                useWhen: "Use for participant filters above an inbox list.",
                style: {
                  direction: "row",
                  gap: "sm",
                  padding: "sm",
                  width: "fit",
                  alignItems: "center",
                  background: "surface",
                  borderColor: "border",
                  borderWidth: "thin",
                  borderRadius: "full",
                },
              },
              avatarChip: {
                description: "Compact circular or pill avatar chip.",
                useWhen: "Use for initials-based avatars when no media avatar is available.",
                style: {
                  direction: "row",
                  gap: "none",
                  padding: "sm",
                  width: "fit",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "accentSurface",
                  borderRadius: "full",
                },
              },
            }
          : {}),
        ...(name === "ama2-messages-app"
          ? {
              messageShell: {
                description: "Two-pane messenger app shell.",
                useWhen: "Use for AMA2-like inbox surfaces with left navigation and thread rows.",
                style: {
                  direction: "row",
                  gap: "none",
                  width: "full",
                  minHeight: "screen",
                  background: "background",
                },
              },
              threadRow: {
                description: "Large rounded message thread row.",
                useWhen: "Use for message preview lists.",
                style: {
                  direction: "row",
                  gap: "md",
                  padding: "lg",
                  width: "full",
                  alignItems: "center",
                  background: "surface",
                  borderRadius: "lg",
                },
              },
            }
          : {}),
        ...(name === "coupang-product-listing"
          ? {
              ecommerceShell: {
                description: "Dense commerce listing shell.",
                useWhen: "Use for product-list pages with search, filter rail, and grid.",
                style: {
                  width: "full",
                  minHeight: "screen",
                  gap: "none",
                  background: "background",
                },
              },
              searchBar: {
                description: "Long bordered commerce search bar.",
                useWhen: "Use for marketplace search headers.",
                style: {
                  direction: "row",
                  gap: "sm",
                  padding: "md",
                  width: "full",
                  alignItems: "center",
                  borderColor: "accent",
                  borderWidth: "medium",
                  background: "surface",
                },
              },
              productCard: {
                description: "Commerce product tile.",
                useWhen: "Use for product-grid listings with media, title, price, and trust cues.",
                style: {
                  gap: "sm",
                  padding: "md",
                  width: "full",
                  background: "surface",
                  borderRadius: "sm",
                },
              },
            }
          : {}),
        ...(name === "linktree-selena-gomez"
          ? {
              creatorPage: {
                description: "Narrow centered creator profile page.",
                useWhen: "Use for mobile-first link-in-bio pages.",
                style: {
                  gap: "md",
                  padding: "lg",
                  width: "full",
                  maxWidth: "narrow",
                  alignItems: "center",
                  background: "mutedSurface",
                  borderRadius: "lg",
                },
              },
              linkButton: {
                description: "Compact full-width creator link button.",
                useWhen: "Use for repeated creator-page links.",
                style: {
                  direction: "row",
                  gap: "sm",
                  padding: "sm",
                  width: "full",
                  alignItems: "center",
                  justifyContent: "between",
                  background: "surface",
                  borderRadius: "sm",
                },
              },
              productTile: {
                description: "Small creator shop tile.",
                useWhen: "Use inside mobile creator product carousels.",
                style: {
                  gap: "xs",
                  padding: "xs",
                  background: "surface",
                  borderRadius: "sm",
                  width: "full",
                },
              },
            }
          : {}),
        ...(name === "google-search-console-performance"
          ? {
              gscShell: {
                description: "Search analytics dashboard shell.",
                useWhen: "Use for Google Search Console-like performance dashboards.",
                style: {
                  direction: "row",
                  gap: "none",
                  width: "full",
                  minHeight: "screen",
                  background: "mutedSurface",
                },
              },
              gscMetricActive: {
                description: "Active colored Search Console metric card.",
                useWhen: "Use for selected comparison metrics.",
                style: {
                  gap: "sm",
                  padding: "lg",
                  background: "accent",
                  color: "accentForeground",
                  borderColor: "accent",
                  borderWidth: "thin",
                },
              },
              gscMetric: {
                description: "Inactive Search Console metric card.",
                useWhen: "Use for unselected metric summary cards.",
                style: {
                  gap: "sm",
                  padding: "lg",
                  background: "surface",
                  borderColor: "border",
                  borderWidth: "thin",
                },
              },
              reportPanel: {
                description: "Large dashboard report panel.",
                useWhen: "Use around charts and data tables.",
                style: {
                  gap: "lg",
                  padding: "lg",
                  width: "full",
                  background: "surface",
                  borderRadius: "lg",
                },
              },
            }
          : {}),
      },
      text: {
        heading: requiredPreset(DEFAULT_TEXT_PRESETS?.heading, "text.heading"),
        subheading: requiredPreset(DEFAULT_TEXT_PRESETS?.subheading, "text.subheading"),
        body: requiredPreset(DEFAULT_TEXT_PRESETS?.body, "text.body"),
        muted: requiredPreset(DEFAULT_TEXT_PRESETS?.muted, "text.muted"),
        badge: requiredPreset(DEFAULT_TEXT_PRESETS?.badge, "text.badge"),
        actionLabel: requiredPreset(DEFAULT_TEXT_PRESETS?.actionLabel, "text.actionLabel"),
        navItem: {
          description: "Application navigation label.",
          useWhen: "Use in sidebars and top navigation rows.",
          style: { fontSize: "lg", fontWeight: "semibold", color: "mutedForeground" },
        },
        threadTitle: {
          description: "Inbox thread title.",
          useWhen: "Use for the first line of message previews.",
          style: { fontSize: "lg", fontWeight: "bold", color: "foreground" },
        },
        threadSnippet: {
          description: "Single-line thread preview.",
          useWhen: "Use below thread titles in inbox rows.",
          style: { fontSize: "md", fontWeight: "medium", color: "mutedForeground" },
        },
        price: {
          description: "Prominent commerce price.",
          useWhen: "Use for marketplace listing prices.",
          style: { fontSize: "xl", fontWeight: "bold", color: "accent", lineHeight: "tight" },
        },
        creatorHandle: {
          description: "Creator profile handle.",
          useWhen: "Use beneath avatar in mobile creator pages.",
          style: { fontSize: "lg", fontWeight: "bold", color: "foreground", textAlign: "center" },
        },
        metricValue: {
          description: "Large analytics metric number.",
          useWhen: "Use inside dashboard metric cards.",
          style: { fontSize: "xl", fontWeight: "bold", lineHeight: "tight" },
        },
        metricLabel: {
          description: "Small analytics metric label.",
          useWhen: "Use above dashboard metric values.",
          style: { fontSize: "sm", fontWeight: "medium", color: "mutedForeground" },
        },
      },
      media: {
        hero: requiredPreset(DEFAULT_MEDIA_PRESETS?.hero, "media.hero"),
        thumbnail: requiredPreset(DEFAULT_MEDIA_PRESETS?.thumbnail, "media.thumbnail"),
        productImage: {
          description: "Clean marketplace product image.",
          useWhen: "Use for commerce grid product photos.",
          style: { width: "full", aspectRatio: "square", objectFit: "cover", borderRadius: "sm" },
        },
        avatar: {
          description: "Circular creator avatar.",
          useWhen: "Use at the top of mobile creator pages.",
          style: { width: "fit", aspectRatio: "square", objectFit: "cover", borderRadius: "full" },
        },
      },
      chart: {
        panel: requiredPreset(DEFAULT_CHART_PRESETS?.panel, "chart.panel"),
        gscComparison: {
          description: "Search Console comparison line chart.",
          useWhen: "Use for search-performance trend comparisons.",
          style: {
            width: "full",
            gap: "sm",
            padding: "md",
            background: "surface",
            plot: { background: "surface", borderColor: "border", borderWidth: "thin" },
            series: { color1: "chart1", color2: "chart2", thickness: "md" },
          },
        },
      },
      table: {
        standard: requiredPreset(DEFAULT_TABLE_PRESETS?.standard, "table.standard"),
        gscQueryTable: {
          description: "Search Console query table.",
          useWhen: "Use below performance charts for query comparison rows.",
          style: {
            width: "full",
            background: "surface",
            borderColor: "border",
            borderWidth: "thin",
            header: { fontSize: "sm", padding: "md", background: "surface" },
            cell: { fontSize: "sm", padding: "md" },
          },
        },
      },
      list: {
        standard: requiredPreset(DEFAULT_LIST_PRESETS?.standard, "list.standard"),
        compact: requiredPreset(DEFAULT_LIST_PRESETS?.compact, "list.compact"),
      },
    },
  };
}

function pattern(name: string, description: string, stylePreset: string): FacetPattern {
  return {
    name,
    description,
    useWhen: "Use as a reference benchmark composition seed.",
    root: `${name}.root`,
    nodes: {
      [`${name}.root`]: {
        id: `${name}.root`,
        type: "box",
        style: { preset: stylePreset },
        children: [`${name}.title`],
      },
      [`${name}.title`]: {
        id: `${name}.title`,
        type: "text",
        value: description,
        style: { preset: "subheading" },
      },
    },
  };
}

export const AMA2_MESSAGES_ASSETS: ReferenceBenchmarkCustomAssets = {
  benchmarkId: "ama2-messages-app",
  theme: createRealServiceTheme({
    name: "ama2-messages-app",
    description: "Lavender two-pane messenger app theme for the AMA2 messages benchmark.",
    density: "roomy",
    colors: {
      background: "#f5f1ff",
      surface: "#fffaff",
      mutedSurface: "#eee7ff",
      foreground: "#21184a",
      mutedForeground: "#737082",
      border: "#d8ceff",
      accent: "#8b5cf6",
      accentSurface: "#eadcff",
      accentForeground: "#ffffff",
      info: "#fca5a5",
      infoSurface: "#ffe4e6",
      warning: "#f59e0b",
      success: "#14b8a6",
      chart1: "#8b5cf6",
      chart2: "#60a5fa",
      chart3: "#fca5a5",
    },
  }),
  patterns: [
    pattern("ama2-message-shell", "AMA2 messages app shell.", "messageShell"),
    pattern("ama2-thread-row", "AMA2 rounded thread preview row.", "threadRow"),
  ],
  density: "roomy",
  notes: [
    "Uses spacious lavender app-shell presets for the private AMA2 messages reference.",
    "Tests whether Box plus Text can approximate persistent side navigation, avatar chips, and rounded inbox rows without a dedicated inbox Brick.",
  ],
};

export const COUPANG_PRODUCT_LISTING_ASSETS: ReferenceBenchmarkCustomAssets = {
  benchmarkId: "coupang-product-listing",
  theme: createRealServiceTheme({
    name: "coupang-product-listing",
    description: "Dense marketplace product-listing theme for the Coupang benchmark.",
    density: "dense",
    colors: {
      background: "#ffffff",
      surface: "#ffffff",
      mutedSurface: "#f5f7fb",
      foreground: "#1f2937",
      mutedForeground: "#6b7280",
      border: "#e5e7eb",
      accent: "#2563eb",
      accentSurface: "#eff6ff",
      accentForeground: "#ffffff",
      info: "#f97316",
      infoSurface: "#fff7ed",
      warning: "#f59e0b",
      success: "#16a34a",
      chart1: "#2563eb",
      chart2: "#ef4444",
      chart3: "#16a34a",
    },
  }),
  patterns: [
    pattern(
      "marketplace-listing-shell",
      "Marketplace listing header, filter, and grid shell.",
      "ecommerceShell",
    ),
    pattern("marketplace-product-card", "Marketplace product tile.", "productCard"),
  ],
  density: "dense",
  notes: [
    "Uses dense marketplace spacing, product-card media, price, delivery, and review presets.",
    "Tests media-grid quality, repeated product cards, search chrome, and filter-rail fidelity.",
  ],
};

export const LINKTREE_SELENA_ASSETS: ReferenceBenchmarkCustomAssets = {
  benchmarkId: "linktree-selena-gomez",
  theme: createRealServiceTheme({
    name: "linktree-selena-gomez",
    description: "Mobile-first creator profile theme for the Selena Gomez Linktree benchmark.",
    density: "roomy",
    colors: {
      background: "#9ca3af",
      surface: "#ffffff",
      mutedSurface: "#edf0f4",
      foreground: "#050505",
      mutedForeground: "#4b5563",
      border: "#e5e7eb",
      accent: "#111827",
      accentSurface: "#f3f4f6",
      accentForeground: "#ffffff",
      info: "#f472b6",
      infoSurface: "#fdf2f8",
      warning: "#f59e0b",
      success: "#22c55e",
      chart1: "#111827",
      chart2: "#f472b6",
      chart3: "#94a3b8",
    },
  }),
  patterns: [
    pattern("creator-profile-page", "Mobile creator profile page.", "creatorPage"),
    pattern("creator-link-button", "Full-width creator link button.", "linkButton"),
  ],
  density: "roomy",
  notes: [
    "Uses narrow centered mobile composition and tight white link cards.",
    "Tests creator-page rhythm, section headers, full-width link buttons, and product carousel approximation.",
  ],
};

export const GOOGLE_SEARCH_CONSOLE_ASSETS: ReferenceBenchmarkCustomAssets = {
  benchmarkId: "google-search-console-performance",
  theme: createRealServiceTheme({
    name: "google-search-console-performance",
    description: "Dense analytics console theme for the Google Search Console benchmark.",
    density: "dense",
    colors: {
      background: "#eef3fb",
      surface: "#ffffff",
      mutedSurface: "#e8eef7",
      foreground: "#3c4043",
      mutedForeground: "#6f7378",
      border: "#dadce0",
      accent: "#4285f4",
      accentSurface: "#d7e7ff",
      accentForeground: "#ffffff",
      info: "#673ab7",
      infoSurface: "#eee7ff",
      warning: "#fbbc04",
      success: "#34a853",
      chart1: "#4285f4",
      chart2: "#673ab7",
      chart3: "#34a853",
    },
  }),
  patterns: [
    pattern("search-console-shell", "Search Console performance shell.", "gscShell"),
    pattern("search-console-report-panel", "Search Console chart and table panel.", "reportPanel"),
  ],
  density: "dense",
  notes: [
    "Uses compact analytics console tokens with Google-like blue and purple metric emphasis.",
    "Tests metric cards, filter chips, comparison line chart, and query table in one dashboard surface.",
  ],
};
