import { DEFAULT_THEME } from "@facet/assets";
import type { FacetPattern, FacetPreset, FacetTheme } from "@facet/core";

import type { ReferenceBenchmarkCustomAssets } from "./reference-benchmark-custom-assets.js";

function requiredPreset<T extends FacetPreset>(preset: T | undefined, name: string): T {
  if (preset === undefined) throw new Error(`Missing default preset ${name}`);
  return preset;
}

const DEFAULT_BOX_PRESETS = DEFAULT_THEME.presets?.box;
const DEFAULT_TEXT_PRESETS = DEFAULT_THEME.presets?.text;
const DEFAULT_MEDIA_PRESETS = DEFAULT_THEME.presets?.media;

export const AMA2_BENCHMARK_THEME: FacetTheme = {
  ...DEFAULT_THEME,
  name: "ama2-public-landing",
  description: "Roomy public landing theme for the AMA2 reference benchmark.",
  tokens: {
    ...DEFAULT_THEME.tokens,
    space: {
      ...DEFAULT_THEME.tokens.space,
      xs: "6px",
      sm: "10px",
      md: "16px",
      lg: "28px",
      xl: "48px",
      "2xl": "64px",
    },
    fontSize: {
      ...DEFAULT_THEME.tokens.fontSize,
      xs: "12px",
      sm: "14px",
      md: "16px",
      lg: "20px",
      xl: "28px",
      "2xl": "40px",
      "3xl": "56px",
      "4xl": "68px",
    },
    radius: {
      ...DEFAULT_THEME.tokens.radius,
      sm: "12px",
      md: "20px",
      lg: "32px",
    },
    maxWidth: {
      ...DEFAULT_THEME.tokens.maxWidth,
      prose: "760px",
      narrow: "860px",
      wide: "1180px",
    },
    paint: {
      ...DEFAULT_THEME.tokens.paint,
      light: {
        ...DEFAULT_THEME.tokens.paint.light,
        color: {
          ...DEFAULT_THEME.tokens.paint.light.color,
          background: "#fff8f2",
          surface: "#fffaf6",
          mutedSurface: "#f6eefc",
          foreground: "#20132d",
          mutedForeground: "#74677e",
          border: "#eaddec",
          accent: "#8b5cf6",
          accentSurface: "#f1e8ff",
          accentForeground: "#ffffff",
          focusRing: "#a78bfa",
          success: "#0f9f6e",
          successSurface: "#dcfce7",
          successForeground: "#064e3b",
          info: "#ef8f74",
          infoSurface: "#fff0e8",
          infoForeground: "#7c2d12",
          chart1: "#8b5cf6",
          chart2: "#ef8f74",
          chart3: "#22c55e",
        },
        gradient: {
          ...DEFAULT_THEME.tokens.paint.light.gradient,
          accent: "linear-gradient(135deg, #8b5cf6 0%, #ef8f74 100%)",
          info: "linear-gradient(135deg, #fff4eb 0%, #f1e8ff 100%)",
        },
        shadow: {
          ...DEFAULT_THEME.tokens.paint.light.shadow,
          sm: "0 8px 24px rgba(139, 92, 246, 0.10)",
          md: "0 24px 70px rgba(139, 92, 246, 0.16)",
          lg: "0 36px 120px rgba(239, 143, 116, 0.22)",
        },
      },
      dark: {
        ...DEFAULT_THEME.tokens.paint.dark,
        color: {
          ...DEFAULT_THEME.tokens.paint.dark.color,
          background: "#17101f",
          surface: "#21172d",
          mutedSurface: "#2d2039",
          foreground: "#fff7ed",
          mutedForeground: "#d7c6d6",
          border: "#453450",
          accent: "#c4b5fd",
          accentSurface: "#3b2765",
          accentForeground: "#1f1330",
          focusRing: "#ddd6fe",
          chart1: "#c4b5fd",
          chart2: "#fdba74",
          chart3: "#86efac",
        },
      },
    },
  },
  defaults: {
    ...DEFAULT_THEME.defaults,
    box: {
      ...DEFAULT_THEME.defaults.box,
      gap: "lg",
      padding: "none",
      color: "foreground",
    },
    text: {
      ...DEFAULT_THEME.defaults.text,
      fontSize: "md",
      color: "foreground",
      lineHeight: "normal",
    },
    media: {
      ...DEFAULT_THEME.defaults.media,
      borderRadius: "lg",
      aspectRatio: "wide",
    },
  },
  presets: {
    box: {
      panel: requiredPreset(DEFAULT_BOX_PRESETS?.panel, "box.panel"),
      inset: requiredPreset(DEFAULT_BOX_PRESETS?.inset, "box.inset"),
      badge: requiredPreset(DEFAULT_BOX_PRESETS?.badge, "box.badge"),
      successBadge: requiredPreset(DEFAULT_BOX_PRESETS?.successBadge, "box.successBadge"),
      primaryAction: requiredPreset(DEFAULT_BOX_PRESETS?.primaryAction, "box.primaryAction"),
      secondaryAction: requiredPreset(DEFAULT_BOX_PRESETS?.secondaryAction, "box.secondaryAction"),
      landingShell: {
        description: "Full landing-page flow with airy vertical rhythm.",
        useWhen: "Use for AMA2-like public marketing pages.",
        style: {
          width: "full",
          minHeight: "screen",
          gap: "none",
          padding: "none",
          background: "background",
        },
      },
      navBar: {
        description: "Slim centered landing navigation.",
        useWhen: "Use at the top of a public landing page.",
        style: {
          direction: "row",
          gap: "sm",
          padding: "sm",
          alignItems: "center",
          justifyContent: "between",
          width: "full",
          maxWidth: "wide",
          wrap: true,
          background: "background",
          borderColor: "border",
          borderWidth: "thin",
        },
      },
      heroBand: {
        description: "Centered first-fold hero region.",
        useWhen: "Use for sparse marketing first folds with a strong headline.",
        style: {
          gap: "lg",
          padding: "xl",
          alignItems: "center",
          justifyContent: "center",
          width: "full",
          minHeight: "half",
          background: "background",
          backgroundGradient: "info",
        },
      },
      sectionBand: {
        description: "Full-width centered public landing section.",
        useWhen: "Use for AMA2 landing sections below the first fold.",
        style: {
          gap: "xl",
          padding: "2xl",
          alignItems: "center",
          width: "full",
          background: "background",
        },
      },
      heroActions: {
        description: "Centered wrapping CTA row for public landing heroes.",
        useWhen: "Use directly under a hero headline or section CTA.",
        style: {
          direction: "row",
          gap: "sm",
          alignItems: "center",
          justifyContent: "center",
          wrap: true,
          width: "full",
        },
      },
      ctaPrimary: {
        description: "Compact pill-shaped primary marketing CTA.",
        useWhen: "Use for the main public landing call to action.",
        style: {
          direction: "row",
          gap: "xs",
          padding: "md",
          alignItems: "center",
          justifyContent: "center",
          width: "fit",
          background: "accent",
          backgroundGradient: "accent",
          color: "accentForeground",
          borderRadius: "full",
          shadow: "md",
        },
      },
      ctaSecondary: {
        description: "Compact secondary marketing CTA.",
        useWhen: "Use beside the primary landing CTA.",
        style: {
          direction: "row",
          gap: "xs",
          padding: "md",
          alignItems: "center",
          justifyContent: "center",
          width: "fit",
          background: "surface",
          color: "foreground",
          borderColor: "border",
          borderWidth: "thin",
          borderRadius: "full",
        },
      },
      featureCard: {
        description: "Soft rounded product feature card.",
        useWhen: "Use below the hero for agent capability explanations.",
        style: {
          gap: "md",
          padding: "lg",
          background: "surface",
          borderColor: "border",
          borderWidth: "thin",
          borderRadius: "lg",
          shadow: "sm",
        },
      },
      showcasePanel: {
        description: "Wide soft product-demo panel for public landing pages.",
        useWhen: "Use for chat, timeline, and product-preview compositions.",
        style: {
          gap: "lg",
          padding: "lg",
          width: "full",
          maxWidth: "wide",
          background: "surface",
          borderColor: "border",
          borderWidth: "thin",
          borderRadius: "lg",
          shadow: "sm",
        },
      },
    },
    text: {
      heading: requiredPreset(DEFAULT_TEXT_PRESETS?.heading, "text.heading"),
      subheading: requiredPreset(DEFAULT_TEXT_PRESETS?.subheading, "text.subheading"),
      body: requiredPreset(DEFAULT_TEXT_PRESETS?.body, "text.body"),
      muted: requiredPreset(DEFAULT_TEXT_PRESETS?.muted, "text.muted"),
      badge: requiredPreset(DEFAULT_TEXT_PRESETS?.badge, "text.badge"),
      successBadge: requiredPreset(DEFAULT_TEXT_PRESETS?.successBadge, "text.successBadge"),
      actionLabel: requiredPreset(DEFAULT_TEXT_PRESETS?.actionLabel, "text.actionLabel"),
      navLink: {
        description: "Compact AMA2 navigation link.",
        useWhen: "Use in the public landing top navigation.",
        style: {
          fontSize: "sm",
          fontWeight: "medium",
          color: "mutedForeground",
          lineHeight: "tight",
        },
      },
      heroKicker: {
        description: "Small uppercase AMA2 hero label.",
        useWhen: "Use above the landing hero headline.",
        style: {
          fontSize: "md",
          fontWeight: "bold",
          color: "accent",
          letterSpacing: "wide",
          textAlign: "center",
        },
      },
      heroBrand: {
        description: "Large lavender AMA2 headline wordmark.",
        useWhen: "Use for the AMA2 label inside a split landing headline.",
        style: {
          fontSize: "3xl",
          fontWeight: "bold",
          color: "accent",
          letterSpacing: "tight",
          lineHeight: "tight",
          textAlign: "center",
        },
      },
      heroTitle: {
        description: "Large centered AMA2 hero headline.",
        useWhen: "Use for the main public landing headline.",
        style: {
          fontSize: "3xl",
          fontWeight: "bold",
          color: "foreground",
          letterSpacing: "tight",
          lineHeight: "tight",
          textAlign: "center",
        },
      },
      sectionTitle: {
        description: "Centered AMA2 section title.",
        useWhen: "Use below the hero for major landing sections.",
        style: {
          fontSize: "2xl",
          fontWeight: "bold",
          color: "foreground",
          letterSpacing: "tight",
          lineHeight: "tight",
          textAlign: "center",
        },
      },
      heroBody: {
        description: "Centered landing hero support copy.",
        useWhen: "Use below a hero headline.",
        style: {
          fontSize: "lg",
          fontWeight: "regular",
          color: "mutedForeground",
          lineHeight: "normal",
          textAlign: "center",
        },
      },
    },
    media: {
      hero: requiredPreset(DEFAULT_MEDIA_PRESETS?.hero, "media.hero"),
      productMock: {
        description: "Rounded landing product mock surface.",
        useWhen: "Use for public landing product preview images.",
        style: { width: "full", aspectRatio: "wide", objectFit: "cover", borderRadius: "lg" },
      },
    },
  },
};

export const AMA2_HERO_PATTERN: FacetPattern = {
  name: "ama2-hero",
  description: "Roomy centered AMA2 first-fold hero with two compact CTA pills.",
  useWhen: "Recreating the public AMA2 landing first fold.",
  root: "ama2-hero.root",
  nodes: {
    "ama2-hero.root": {
      id: "ama2-hero.root",
      type: "box",
      style: { preset: "heroBand" },
      children: ["ama2-hero.kicker", "ama2-hero.title", "ama2-hero.body", "ama2-hero.actions"],
    },
    "ama2-hero.kicker": {
      id: "ama2-hero.kicker",
      type: "text",
      value: "AMA2",
      style: { preset: "heroKicker" },
    },
    "ama2-hero.title": {
      id: "ama2-hero.title",
      type: "text",
      value: "Build an AI messenger your customers can actually use",
      style: { preset: "heroTitle" },
    },
    "ama2-hero.body": {
      id: "ama2-hero.body",
      type: "text",
      value:
        "Launch an agent-owned surface with brand-specific UI, structured flows, and live interaction.",
      style: { preset: "heroBody" },
    },
    "ama2-hero.actions": {
      id: "ama2-hero.actions",
      type: "box",
      style: { preset: "heroActions" },
      children: ["ama2-hero.primary", "ama2-hero.secondary"],
    },
    "ama2-hero.primary": {
      id: "ama2-hero.primary",
      type: "box",
      style: { preset: "ctaPrimary" },
      children: ["ama2-hero.primary-label"],
    },
    "ama2-hero.primary-label": {
      id: "ama2-hero.primary-label",
      type: "text",
      value: "Join beta",
      style: { preset: "actionLabel" },
    },
    "ama2-hero.secondary": {
      id: "ama2-hero.secondary",
      type: "box",
      style: { preset: "ctaSecondary" },
      children: ["ama2-hero.secondary-label"],
    },
    "ama2-hero.secondary-label": {
      id: "ama2-hero.secondary-label",
      type: "text",
      value: "See demo",
      style: { preset: "actionLabel" },
    },
  },
};

export const AMA2_FEATURE_PATTERN: FacetPattern = {
  name: "ama2-feature-card",
  description: "Soft landing feature card with heading and support copy.",
  useWhen: "When an AMA2 landing section explains an agent capability.",
  root: "ama2-feature.root",
  nodes: {
    "ama2-feature.root": {
      id: "ama2-feature.root",
      type: "box",
      style: { preset: "featureCard" },
      children: ["ama2-feature.title", "ama2-feature.body"],
    },
    "ama2-feature.title": {
      id: "ama2-feature.title",
      type: "text",
      value: "Agent-owned pages",
      style: { preset: "subheading" },
    },
    "ama2-feature.body": {
      id: "ama2-feature.body",
      type: "text",
      value:
        "Each visitor gets a live interface assembled from safe Facet bricks and brand assets.",
      style: { preset: "body" },
    },
  },
};

export const AMA2_BENCHMARK_PATTERNS: readonly FacetPattern[] = [
  AMA2_HERO_PATTERN,
  AMA2_FEATURE_PATTERN,
] as const;

export const AMA2_BENCHMARK_ASSETS: ReferenceBenchmarkCustomAssets = {
  benchmarkId: "ama2-public-landing",
  theme: AMA2_BENCHMARK_THEME,
  patterns: AMA2_BENCHMARK_PATTERNS,
  density: "roomy",
  notes: [
    "Uses larger space and display type tokens to test brand landing rhythm.",
    "Keeps hero, CTA, and feature compositions in Patterns rather than adding page-section bricks.",
  ],
};
