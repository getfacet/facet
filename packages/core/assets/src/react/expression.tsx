import type { ComponentMountProps, MountedComponent } from "@facet/core";
import { Children, createContext, useContext } from "react";
import type { CSSProperties, ReactNode } from "react";

import {
  countProp,
  enumProp,
  flagProp,
  flowStyle,
  foundation,
  mountStyle,
  recipe,
  semantic,
  space,
  textProp,
} from "./style.js";
import type { FlowStyle, SpaceName } from "./style.js";

type Mount = ComponentMountProps<ReactNode>;

const SECTION_TONES = ["neutral", "accent", "muted"] as const;
const HERO_TONES = ["neutral", "accent", "inverse"] as const;
const HERO_ALIGNMENTS = ["start", "center"] as const;
const AVATAR_TONES = ["neutral", "accent", "warm", "cool"] as const;
const AVATAR_SIZES = ["sm", "md", "lg"] as const;
const LINK_LIST_DENSITIES = ["compact", "comfortable"] as const;
const CTA_TONES = ["neutral", "accent", "inverse"] as const;
const ALERT_TONES = ["info", "success", "warning", "danger"] as const;
const PROGRESS_TONES = ["neutral", "accent", "success", "warning"] as const;
const SECTION_PADDINGS = ["none", "sm", "md", "lg"] as const;
const LOGO_MARK_TONES = ["neutral", "brand", "accent", "inverse"] as const;
const LOGO_MARK_SIZES = ["sm", "md", "lg"] as const;
const LOGO_MARK_SHAPES = ["circle", "square", "soft"] as const;
const NAV_TONES = ["neutral", "accent", "inverse"] as const;
const SIDE_NAV_TONES = ["neutral", "accent", "inverse"] as const;
type SideNavTone = (typeof SIDE_NAV_TONES)[number];
const PROFILE_TONES = ["neutral", "accent", "inverse"] as const;
const PRODUCT_TONES = ["neutral", "accent", "inverse"] as const;
const VISUAL_PANEL_TONES = ["brand", "accent", "warm", "inverse"] as const;
const VISUAL_PANEL_SCALES = ["compact", "hero"] as const;
const MEDIA_CARD_TONES = ["neutral", "brand", "accent", "inverse"] as const;
const MEDIA_CARD_ASPECTS = ["wide", "square", "tall"] as const;
const STAT_STRIP_TONES = ["neutral", "accent", "inverse"] as const;
const GALLERY_RHYTHMS = ["even", "editorial"] as const;
const SOCIAL_LINK_ALIGNMENTS = ["start", "center"] as const;
const SOCIAL_LINK_DENSITIES = ["compact", "comfortable"] as const;
const SOCIAL_LINK_TONES = ["neutral", "accent", "inverse"] as const;
const TIMELINE_TONES = ["neutral", "accent"] as const;
const FOOTER_TONES = ["neutral", "inverse"] as const;

const TEXT_ALIGNMENTS = {
  start: "start",
  center: "center",
} as const;

const SECTION_BACKGROUND = {
  neutral: recipe("section", "background"),
  accent: semantic("state", "selectedBg"),
  muted: semantic("surface", "muted"),
} as const;

const HERO_BACKGROUND = {
  neutral: recipe("hero", "background"),
  accent: semantic("selection", "background"),
  inverse: semantic("surface", "inverse"),
} as const;

const HERO_TEXT = {
  neutral: recipe("hero", "text"),
  accent: recipe("hero", "text"),
  inverse: semantic("text", "inverse"),
} as const;

const HERO_MUTED_TEXT = {
  neutral: recipe("hero", "mutedText"),
  accent: recipe("hero", "mutedText"),
  inverse: semantic("text", "inverse"),
} as const;

const AVATAR_BACKGROUND = {
  neutral: semantic("status", "neutralBg"),
  accent: recipe("avatar", "background"),
  warm: foundation("palette", "accent500"),
  cool: foundation("palette", "brand300"),
} as const;

const AVATAR_TEXT = {
  neutral: semantic("status", "neutralText"),
  accent: recipe("avatar", "text"),
  warm: semantic("text", "default"),
  cool: semantic("text", "default"),
} as const;

const AVATAR_SIZE = {
  sm: foundation("size", "controlHeightMd"),
  md: recipe("avatar", "size"),
  lg: foundation("size", "controlHeightXl"),
} as const;

const CTA_BACKGROUND = {
  neutral: semantic("surface", "default"),
  accent: recipe("cta", "background"),
  inverse: semantic("surface", "inverse"),
} as const;

const CTA_TEXT = {
  neutral: semantic("text", "default"),
  accent: recipe("cta", "text"),
  inverse: semantic("text", "inverse"),
} as const;

const CTA_MUTED_TEXT = {
  neutral: semantic("text", "muted"),
  accent: recipe("cta", "mutedText"),
  inverse: semantic("text", "inverse"),
} as const;

const ALERT_COLORS = {
  info: {
    background: semantic("status", "infoBg"),
    text: semantic("status", "infoText"),
    border: semantic("status", "infoBorder"),
  },
  success: {
    background: semantic("status", "successBg"),
    text: semantic("status", "successText"),
    border: semantic("status", "successBorder"),
  },
  warning: {
    background: semantic("status", "warningBg"),
    text: semantic("status", "warningText"),
    border: semantic("status", "warningBorder"),
  },
  danger: {
    background: semantic("status", "dangerBg"),
    text: semantic("status", "dangerText"),
    border: semantic("status", "dangerBorder"),
  },
} as const;

const PROGRESS_FILL = {
  neutral: semantic("text", "muted"),
  accent: recipe("progress", "fill"),
  success: semantic("status", "successText"),
  warning: semantic("status", "warningText"),
} as const;

const LOGO_MARK_BACKGROUND = {
  neutral: semantic("status", "neutralBg"),
  brand: recipe("logo-mark", "background"),
  accent: foundation("palette", "accent400"),
  inverse: semantic("surface", "inverse"),
} as const;

const LOGO_MARK_TEXT = {
  neutral: semantic("status", "neutralText"),
  brand: recipe("logo-mark", "text"),
  accent: semantic("text", "default"),
  inverse: semantic("text", "inverse"),
} as const;

const LOGO_MARK_SIZE = {
  sm: foundation("size", "iconXl"),
  md: recipe("logo-mark", "size"),
  lg: foundation("size", "controlHeightXl"),
} as const;

const LOGO_MARK_RADIUS = {
  circle: foundation("radius", "full"),
  square: foundation("radius", "xs"),
  soft: recipe("logo-mark", "radius"),
} as const;

const NAV_BACKGROUND = {
  neutral: recipe("nav", "background"),
  accent: semantic("selection", "background"),
  inverse: semantic("surface", "inverse"),
} as const;

const NAV_TEXT = {
  neutral: recipe("nav", "text"),
  accent: recipe("nav", "text"),
  inverse: semantic("text", "inverse"),
} as const;

const NAV_MUTED_TEXT = {
  neutral: recipe("nav", "mutedText"),
  accent: recipe("nav", "mutedText"),
  inverse: semantic("text", "inverse"),
} as const;

const SIDE_NAV_BACKGROUND = {
  neutral: recipe("side-nav", "background"),
  accent: semantic("selection", "background"),
  inverse: semantic("surface", "inverse"),
} as const;

const SIDE_NAV_TEXT = {
  neutral: recipe("side-nav", "text"),
  accent: recipe("side-nav", "text"),
  inverse: semantic("text", "inverse"),
} as const;

const SIDE_NAV_MUTED_TEXT = {
  neutral: recipe("side-nav", "mutedText"),
  accent: recipe("side-nav", "mutedText"),
  inverse: semantic("text", "inverse"),
} as const;

const SideNavItemContext = createContext<SideNavTone>("neutral");

const SIDE_NAV_ITEM_BACKGROUND = {
  neutral: recipe("side-nav-item", "background"),
  accent: recipe("side-nav-item", "background"),
  inverse: recipe("side-nav-item", "background"),
} as const;

const SIDE_NAV_ITEM_TEXT = {
  neutral: recipe("side-nav-item", "text"),
  accent: recipe("side-nav-item", "text"),
  inverse: recipe("side-nav-item", "inverseText"),
} as const;

const SIDE_NAV_ITEM_MUTED_TEXT = {
  neutral: recipe("side-nav-item", "mutedText"),
  accent: recipe("side-nav-item", "mutedText"),
  inverse: recipe("side-nav-item", "inverseMutedText"),
} as const;

const SIDE_NAV_ITEM_BORDER = {
  neutral: recipe("side-nav-item", "border"),
  accent: recipe("side-nav-item", "border"),
  inverse: recipe("side-nav-item", "border"),
} as const;

const SIDE_NAV_ITEM_ACTIVE_BACKGROUND = {
  neutral: recipe("side-nav-item", "activeBg"),
  accent: recipe("side-nav-item", "activeBg"),
  inverse: recipe("side-nav-item", "inverseActiveBg"),
} as const;

const SIDE_NAV_ITEM_ACTIVE_TEXT = {
  neutral: recipe("side-nav-item", "activeText"),
  accent: recipe("side-nav-item", "activeText"),
  inverse: recipe("side-nav-item", "inverseActiveText"),
} as const;

const SIDE_NAV_ITEM_ACTIVE_BORDER = {
  neutral: recipe("side-nav-item", "activeBorder"),
  accent: recipe("side-nav-item", "activeBorder"),
  inverse: recipe("side-nav-item", "inverseActiveBorder"),
} as const;

const PROFILE_BACKGROUND = {
  neutral: recipe("profile-header", "background"),
  accent: semantic("selection", "background"),
  inverse: semantic("surface", "inverse"),
} as const;

const PROFILE_TEXT = {
  neutral: recipe("profile-header", "text"),
  accent: recipe("profile-header", "text"),
  inverse: semantic("text", "inverse"),
} as const;

const PROFILE_MUTED_TEXT = {
  neutral: recipe("profile-header", "mutedText"),
  accent: recipe("profile-header", "mutedText"),
  inverse: semantic("text", "inverse"),
} as const;

const PRODUCT_BACKGROUND = {
  neutral: recipe("product-showcase", "background"),
  accent: semantic("selection", "background"),
  inverse: semantic("surface", "inverse"),
} as const;

const PRODUCT_TEXT = {
  neutral: recipe("product-showcase", "text"),
  accent: recipe("product-showcase", "text"),
  inverse: semantic("text", "inverse"),
} as const;

const PRODUCT_MUTED_TEXT = {
  neutral: recipe("product-showcase", "mutedText"),
  accent: recipe("product-showcase", "mutedText"),
  inverse: semantic("text", "inverse"),
} as const;

const VISUAL_PANEL_BACKGROUND = {
  brand: recipe("visual-panel", "background"),
  accent: foundation("palette", "accent300"),
  warm: foundation("palette", "accent100"),
  inverse: semantic("surface", "inverse"),
} as const;

const VISUAL_PANEL_TEXT = {
  brand: recipe("visual-panel", "text"),
  accent: semantic("text", "default"),
  warm: semantic("text", "default"),
  inverse: semantic("text", "inverse"),
} as const;

const VISUAL_PANEL_MUTED_TEXT = {
  brand: recipe("visual-panel", "mutedText"),
  accent: semantic("text", "muted"),
  warm: semantic("text", "muted"),
  inverse: semantic("text", "inverse"),
} as const;

const MEDIA_CARD_BACKGROUND = {
  neutral: recipe("media-card", "background"),
  brand: semantic("selection", "background"),
  accent: foundation("palette", "accent100"),
  inverse: semantic("surface", "inverse"),
} as const;

const MEDIA_CARD_TEXT = {
  neutral: recipe("media-card", "text"),
  brand: recipe("media-card", "text"),
  accent: recipe("media-card", "text"),
  inverse: semantic("text", "inverse"),
} as const;

const MEDIA_CARD_MUTED_TEXT = {
  neutral: recipe("media-card", "mutedText"),
  brand: recipe("media-card", "mutedText"),
  accent: recipe("media-card", "mutedText"),
  inverse: semantic("text", "inverse"),
} as const;

const MEDIA_CARD_VISUAL_BG = {
  neutral: recipe("media-card", "visualBg"),
  brand: foundation("palette", "brand600"),
  accent: foundation("palette", "accent300"),
  inverse: semantic("surface", "default"),
} as const;

const MEDIA_CARD_VISUAL_TEXT = {
  neutral: recipe("media-card", "visualText"),
  brand: semantic("text", "inverse"),
  accent: semantic("text", "default"),
  inverse: semantic("text", "default"),
} as const;

const MEDIA_CARD_ASPECT_RATIO = {
  wide: "16 / 10",
  square: "1 / 1",
  tall: "4 / 5",
} as const;

const STAT_STRIP_BACKGROUND = {
  neutral: recipe("stat-strip", "background"),
  accent: semantic("selection", "background"),
  inverse: semantic("surface", "inverse"),
} as const;

const STAT_STRIP_TEXT = {
  neutral: recipe("stat-strip", "text"),
  accent: recipe("stat-strip", "text"),
  inverse: semantic("text", "inverse"),
} as const;

const SOCIAL_LINK_BACKGROUND = {
  neutral: recipe("social-links", "background"),
  accent: semantic("selection", "background"),
  inverse: semantic("surface", "inverse"),
} as const;

const SOCIAL_LINK_TEXT = {
  neutral: recipe("social-links", "text"),
  accent: recipe("social-links", "text"),
  inverse: semantic("text", "inverse"),
} as const;

const FOOTER_BACKGROUND = {
  neutral: recipe("footer", "background"),
  inverse: semantic("surface", "inverse"),
} as const;

const FOOTER_TEXT = {
  neutral: recipe("footer", "text"),
  inverse: semantic("text", "inverse"),
} as const;

const FOOTER_MUTED_TEXT = {
  neutral: recipe("footer", "mutedText"),
  inverse: semantic("text", "inverse"),
} as const;

function headingStyle(color: string, size: string, weight: string): FlowStyle {
  return {
    margin: 0,
    color,
    fontFamily: foundation("typography", "fontFamilySans"),
    fontSize: size,
    fontWeight: weight,
    lineHeight: foundation("typography", "lineHeightTight"),
  };
}

function paragraphStyle(
  color: string,
  size: string = foundation("typography", "fontSizeMd"),
): FlowStyle {
  return {
    margin: 0,
    color,
    fontFamily: foundation("typography", "fontFamilySans"),
    fontSize: size,
    lineHeight: foundation("typography", "lineHeightNormal"),
  };
}

function frameStyle(themeVars: Readonly<Record<string, string>>, base: FlowStyle): CSSProperties {
  return mountStyle(themeVars, {
    boxSizing: "border-box",
    minWidth: 0,
    ...base,
  });
}

function gridTracks(columns: number, gap: string, minWidth: string): string {
  return `repeat(auto-fit, minmax(max(${minWidth}, calc((100% - (${gap} * ${
    columns - 1
  })) / ${columns})), 1fr))`;
}

function initialsFor(label: string, explicit: string | undefined): string {
  const raw = explicit ?? label;
  const words = raw
    .trim()
    .split(/\s+/u)
    .filter((part) => part.length > 0);
  const initials =
    words.length > 1
      ? words
          .slice(0, 2)
          .map((part) => part[0] ?? "")
          .join("")
      : (words[0] ?? "").slice(0, 2);
  return initials.toUpperCase();
}

function markFor(label: string, explicit: string | undefined): string {
  return initialsFor(label, explicit).slice(0, 3);
}

export const LogoMark: MountedComponent<ReactNode, ReactNode> = ({
  props,
  themeVars,
}: Mount): ReactNode => {
  const label = textProp(props, "label") ?? "";
  const mark = markFor(label, textProp(props, "mark"));
  const size = enumProp(props, "size", LOGO_MARK_SIZES, "md");
  const tone = enumProp(props, "tone", LOGO_MARK_TONES, "brand");
  const shape = enumProp(props, "shape", LOGO_MARK_SHAPES, "soft");

  return (
    <div
      data-facet-component="LogoMark"
      data-facet-logo-mark-tone={tone}
      role="img"
      aria-label={label}
      style={frameStyle(themeVars, {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        width: LOGO_MARK_SIZE[size],
        height: LOGO_MARK_SIZE[size],
        borderRadius: LOGO_MARK_RADIUS[shape],
        border: `${foundation("borderWidth", "thin")} solid ${recipe("logo-mark", "border")}`,
        background: LOGO_MARK_BACKGROUND[tone],
        color: LOGO_MARK_TEXT[tone],
        fontFamily: foundation("typography", "fontFamilySans"),
        fontSize: recipe("logo-mark", "fontSize"),
        fontWeight: recipe("logo-mark", "fontWeight"),
        lineHeight: foundation("typography", "lineHeightNone"),
      })}
    >
      {mark}
    </div>
  );
};

export const Nav: MountedComponent<ReactNode, ReactNode> = ({
  props,
  children,
  themeVars,
}: Mount): ReactNode => {
  const brand = textProp(props, "brand") ?? "";
  const mark = textProp(props, "mark");
  const label = textProp(props, "label");
  const tone = enumProp(props, "tone", NAV_TONES, "neutral");

  return (
    <nav
      data-facet-component="Nav"
      data-facet-nav-tone={tone}
      aria-label={brand}
      style={frameStyle(themeVars, {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: recipe("nav", "gap"),
        padding: `${recipe("nav", "paddingBlock")} ${recipe("nav", "paddingInline")}`,
        border: `${foundation("borderWidth", "thin")} solid ${recipe("nav", "border")}`,
        borderRadius: recipe("nav", "radius"),
        background: NAV_BACKGROUND[tone],
        color: NAV_TEXT[tone],
        fontFamily: foundation("typography", "fontFamilySans"),
      })}
    >
      <div
        style={flowStyle({
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: foundation("space", "sm"),
        })}
      >
        {mark === undefined ? null : (
          <span
            aria-hidden="true"
            style={flowStyle({
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              width: recipe("nav", "markSize"),
              height: recipe("nav", "markSize"),
              borderRadius: foundation("radius", "full"),
              background: recipe("nav", "markBg"),
              color: recipe("nav", "markText"),
              fontSize: foundation("typography", "fontSizeXs"),
              fontWeight: foundation("typography", "fontWeightBlack"),
              lineHeight: foundation("typography", "lineHeightNone"),
            })}
          >
            {mark.slice(0, 3)}
          </span>
        )}
        <span
          style={flowStyle({
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: foundation("space", "micro"),
          })}
        >
          <span
            style={flowStyle({
              color: NAV_TEXT[tone],
              fontSize: recipe("nav", "brandFontSize"),
              fontWeight: recipe("nav", "brandFontWeight"),
              lineHeight: foundation("typography", "lineHeightTight"),
            })}
          >
            {brand}
          </span>
          {label === undefined ? null : (
            <span
              style={flowStyle({
                color: NAV_MUTED_TEXT[tone],
                fontSize: foundation("typography", "fontSizeXs"),
                fontWeight: foundation("typography", "fontWeightMedium"),
                lineHeight: foundation("typography", "lineHeightTight"),
              })}
            >
              {label}
            </span>
          )}
        </span>
      </div>
      <div
        style={flowStyle({
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          flexWrap: "wrap",
          gap: foundation("space", "xs"),
        })}
      >
        {children}
      </div>
    </nav>
  );
};

export const SideNav: MountedComponent<ReactNode, ReactNode> = ({
  props,
  children,
  themeVars,
}: Mount): ReactNode => {
  const title = textProp(props, "title");
  const label = textProp(props, "label");
  const tone = enumProp(props, "tone", SIDE_NAV_TONES, "neutral");

  return (
    <nav
      data-facet-component="SideNav"
      data-facet-side-nav-tone={tone}
      aria-label={title ?? label ?? "Side navigation"}
      style={frameStyle(themeVars, {
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignSelf: "stretch",
        flexShrink: 0,
        width: recipe("side-nav", "width"),
        gap: recipe("side-nav", "gap"),
        padding: recipe("side-nav", "padding"),
        border: `${foundation("borderWidth", "thin")} solid ${recipe("side-nav", "border")}`,
        borderRadius: recipe("side-nav", "radius"),
        background: SIDE_NAV_BACKGROUND[tone],
        color: SIDE_NAV_TEXT[tone],
        fontFamily: foundation("typography", "fontFamilySans"),
      })}
    >
      {title === undefined && label === undefined ? null : (
        <div
          style={flowStyle({
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: foundation("space", "micro"),
            paddingBlockEnd: foundation("space", "sm"),
            borderBottom: `${foundation("borderWidth", "thin")} solid ${recipe(
              "side-nav",
              "border",
            )}`,
          })}
        >
          {title === undefined ? null : (
            <span
              style={flowStyle({
                color: SIDE_NAV_TEXT[tone],
                fontSize: recipe("side-nav", "titleFontSize"),
                fontWeight: foundation("typography", "fontWeightBlack"),
                lineHeight: foundation("typography", "lineHeightTight"),
              })}
            >
              {title}
            </span>
          )}
          {label === undefined ? null : (
            <span
              style={flowStyle({
                color: SIDE_NAV_MUTED_TEXT[tone],
                fontSize: foundation("typography", "fontSizeXs"),
                fontWeight: foundation("typography", "fontWeightMedium"),
                lineHeight: foundation("typography", "lineHeightTight"),
              })}
            >
              {label}
            </span>
          )}
        </div>
      )}
      <SideNavItemContext.Provider value={tone}>
        <div
          style={flowStyle({
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: foundation("space", "xs"),
          })}
        >
          {children}
        </div>
      </SideNavItemContext.Provider>
    </nav>
  );
};

export const SideNavItem: MountedComponent<ReactNode, ReactNode> = ({
  props,
  onAction,
  themeVars,
}: Mount): ReactNode => {
  const label = textProp(props, "label") ?? "";
  const mark = textProp(props, "mark");
  const meta = textProp(props, "meta");
  const active = flagProp(props, "active", false);
  const tone = useContext(SideNavItemContext);
  const text = active ? SIDE_NAV_ITEM_ACTIVE_TEXT[tone] : SIDE_NAV_ITEM_TEXT[tone];
  const border = active ? SIDE_NAV_ITEM_ACTIVE_BORDER[tone] : SIDE_NAV_ITEM_BORDER[tone];
  const background = active
    ? SIDE_NAV_ITEM_ACTIVE_BACKGROUND[tone]
    : SIDE_NAV_ITEM_BACKGROUND[tone];

  return (
    <button
      type="button"
      data-facet-component="SideNavItem"
      data-facet-side-nav-item-active={active ? "true" : "false"}
      style={frameStyle(themeVars, {
        width: "100%",
        minHeight: foundation("size", "controlHeightMd"),
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: recipe("side-nav-item", "gap"),
        padding: `${recipe("side-nav-item", "paddingBlock")} ${recipe(
          "side-nav-item",
          "paddingInline",
        )}`,
        border: `${foundation("borderWidth", "thin")} solid ${border}`,
        borderRadius: recipe("side-nav-item", "radius"),
        background,
        color: text,
        fontFamily: foundation("typography", "fontFamilySans"),
        fontSize: foundation("typography", "fontSizeSm"),
        fontWeight: active
          ? foundation("typography", "fontWeightBold")
          : foundation("typography", "fontWeightMedium"),
        lineHeight: foundation("typography", "lineHeightTight"),
        textAlign: "left",
        cursor: "pointer",
      })}
      onClick={() => {
        onAction("action");
      }}
    >
      <span
        style={flowStyle({
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: recipe("side-nav-item", "gap"),
        })}
      >
        {mark === undefined ? null : (
          <span
            aria-hidden="true"
            style={flowStyle({
              width: recipe("side-nav-item", "markSize"),
              height: recipe("side-nav-item", "markSize"),
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              borderRadius: foundation("radius", "sm"),
              background: active ? SIDE_NAV_ITEM_ACTIVE_BORDER[tone] : "transparent",
              color: active ? SIDE_NAV_ITEM_ACTIVE_TEXT[tone] : SIDE_NAV_ITEM_MUTED_TEXT[tone],
              fontSize: foundation("typography", "fontSizeXs"),
              fontWeight: foundation("typography", "fontWeightBlack"),
              lineHeight: foundation("typography", "lineHeightNone"),
            })}
          >
            {mark.slice(0, 3)}
          </span>
        )}
        <span
          style={flowStyle({
            minWidth: 0,
            overflowWrap: "anywhere",
          })}
        >
          {label}
        </span>
      </span>
      {meta === undefined ? null : (
        <span
          style={flowStyle({
            flexShrink: 0,
            color: active ? SIDE_NAV_ITEM_ACTIVE_TEXT[tone] : SIDE_NAV_ITEM_MUTED_TEXT[tone],
            fontSize: foundation("typography", "fontSizeXs"),
            fontWeight: foundation("typography", "fontWeightBold"),
            lineHeight: foundation("typography", "lineHeightTight"),
          })}
        >
          {meta}
        </span>
      )}
    </button>
  );
};

export const Section: MountedComponent<ReactNode, ReactNode> = ({
  props,
  children,
  themeVars,
}: Mount): ReactNode => {
  const title = textProp(props, "title");
  const description = textProp(props, "description");
  const tone = enumProp(props, "tone", SECTION_TONES, "neutral");
  const padding: SpaceName = enumProp(props, "padding", SECTION_PADDINGS, "md");

  return (
    <section
      data-facet-component="Section"
      data-facet-section-tone={tone}
      style={frameStyle(themeVars, {
        display: "flex",
        flexDirection: "column",
        gap: foundation("space", "md"),
        padding: padding === "md" ? recipe("section", "padding") : space(padding),
        border: `${foundation("borderWidth", "thin")} solid ${recipe("section", "border")}`,
        borderRadius: recipe("section", "radius"),
        background: SECTION_BACKGROUND[tone],
        color: recipe("section", "text"),
      })}
    >
      {title === undefined ? null : (
        <h2
          style={flowStyle({
            ...headingStyle(
              recipe("section", "text"),
              recipe("section", "titleFontSize"),
              recipe("section", "titleFontWeight"),
            ),
            minWidth: 0,
            maxWidth: "100%",
            overflowWrap: "anywhere",
          })}
        >
          {title}
        </h2>
      )}
      {description === undefined ? null : (
        <p
          style={flowStyle({
            ...paragraphStyle(recipe("section", "mutedText")),
            minWidth: 0,
            maxWidth: "100%",
            overflowWrap: "anywhere",
          })}
        >
          {description}
        </p>
      )}
      {children}
    </section>
  );
};

export const Divider: MountedComponent<ReactNode, ReactNode> = ({ props, themeVars }: Mount) => {
  const label = textProp(props, "label");
  const emphasis = enumProp(props, "emphasis", ["subtle", "strong"] as const, "subtle");
  const line: FlowStyle = {
    flex: 1,
    minWidth: 0,
    borderTopStyle: "solid",
    borderTopWidth:
      emphasis === "strong"
        ? foundation("borderWidth", "medium")
        : foundation("borderWidth", "thin"),
    borderTopColor: recipe("divider", "color"),
  };

  return (
    <div
      data-facet-component="Divider"
      style={frameStyle(themeVars, {
        display: "flex",
        alignItems: "center",
        gap: recipe("divider", "gap"),
        color: recipe("divider", "text"),
      })}
    >
      <span style={flowStyle(line)} />
      {label === undefined ? null : (
        <span
          style={flowStyle({
            fontFamily: foundation("typography", "fontFamilySans"),
            fontSize: foundation("typography", "fontSizeXs"),
            fontWeight: foundation("typography", "fontWeightMedium"),
            lineHeight: foundation("typography", "lineHeightTight"),
          })}
        >
          {label}
        </span>
      )}
      <span style={flowStyle(line)} />
    </div>
  );
};

export const Hero: MountedComponent<ReactNode, ReactNode> = ({
  props,
  children,
  themeVars,
}: Mount): ReactNode => {
  const title = textProp(props, "title") ?? "";
  const subtitle = textProp(props, "subtitle");
  const eyebrow = textProp(props, "eyebrow");
  const align = enumProp(props, "align", HERO_ALIGNMENTS, "start");
  const tone = enumProp(props, "tone", HERO_TONES, "neutral");

  return (
    <section
      data-facet-component="Hero"
      data-facet-hero-tone={tone}
      style={frameStyle(themeVars, {
        display: "flex",
        flexDirection: "column",
        containerType: "inline-size",
        alignItems: align === "center" ? "center" : "flex-start",
        gap: foundation("space", "lg"),
        padding: recipe("hero", "padding"),
        border: `${foundation("borderWidth", "thin")} solid ${recipe("hero", "border")}`,
        borderRadius: recipe("hero", "radius"),
        background: HERO_BACKGROUND[tone],
        color: HERO_TEXT[tone],
        textAlign: TEXT_ALIGNMENTS[align],
      })}
    >
      {eyebrow === undefined ? null : (
        <p
          style={flowStyle({
            ...paragraphStyle(HERO_MUTED_TEXT[tone], foundation("typography", "fontSizeSm")),
            fontWeight: foundation("typography", "fontWeightBold"),
            textTransform: "uppercase",
            letterSpacing: foundation("typography", "letterSpacingWide"),
          })}
        >
          {eyebrow}
        </p>
      )}
      <h1
        style={flowStyle({
          ...headingStyle(
            HERO_TEXT[tone],
            `clamp(${foundation("typography", "fontSize2xl")}, 8cqi, ${recipe("hero", "titleFontSize")})`,
            recipe("hero", "titleFontWeight"),
          ),
          minWidth: 0,
          maxWidth: "100%",
          overflowWrap: "anywhere",
        })}
      >
        {title}
      </h1>
      {subtitle === undefined ? null : (
        <p
          style={flowStyle(
            paragraphStyle(HERO_MUTED_TEXT[tone], recipe("hero", "subtitleFontSize")),
          )}
        >
          {subtitle}
        </p>
      )}
      {children}
    </section>
  );
};

export const Avatar: MountedComponent<ReactNode, ReactNode> = ({ props, themeVars }: Mount) => {
  const label = textProp(props, "label") ?? "";
  const initials = initialsFor(label, textProp(props, "initials"));
  const size = enumProp(props, "size", AVATAR_SIZES, "md");
  const tone = enumProp(props, "tone", AVATAR_TONES, "accent");

  return (
    <div
      data-facet-component="Avatar"
      role="img"
      aria-label={label}
      style={frameStyle(themeVars, {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: AVATAR_SIZE[size],
        height: AVATAR_SIZE[size],
        borderRadius: recipe("avatar", "radius"),
        border: `${foundation("borderWidth", "thin")} solid ${recipe("avatar", "border")}`,
        background: AVATAR_BACKGROUND[tone],
        color: AVATAR_TEXT[tone],
        fontFamily: foundation("typography", "fontFamilySans"),
        fontSize: recipe("avatar", "fontSize"),
        fontWeight: recipe("avatar", "fontWeight"),
        lineHeight: foundation("typography", "lineHeightNone"),
      })}
    >
      {initials}
    </div>
  );
};

export const ProfileHeader: MountedComponent<ReactNode, ReactNode> = ({
  props,
  children,
  themeVars,
}: Mount): ReactNode => {
  const name = textProp(props, "name") ?? "";
  const role = textProp(props, "role");
  const summary = textProp(props, "summary");
  const align = enumProp(props, "align", HERO_ALIGNMENTS, "center");
  const tone = enumProp(props, "tone", PROFILE_TONES, "neutral");

  return (
    <header
      data-facet-component="ProfileHeader"
      data-facet-profile-header-tone={tone}
      style={frameStyle(themeVars, {
        display: "flex",
        flexDirection: "column",
        alignItems: align === "center" ? "center" : "flex-start",
        gap: foundation("space", "lg"),
        padding: recipe("profile-header", "padding"),
        border: `${foundation("borderWidth", "thin")} solid ${recipe("profile-header", "border")}`,
        borderRadius: recipe("profile-header", "radius"),
        background: PROFILE_BACKGROUND[tone],
        color: PROFILE_TEXT[tone],
        textAlign: TEXT_ALIGNMENTS[align],
      })}
    >
      {role === undefined ? null : (
        <p
          style={flowStyle({
            ...paragraphStyle(PROFILE_MUTED_TEXT[tone], foundation("typography", "fontSizeSm")),
            fontWeight: foundation("typography", "fontWeightBold"),
            textTransform: "uppercase",
            letterSpacing: foundation("typography", "letterSpacingWide"),
          })}
        >
          {role}
        </p>
      )}
      <h1
        style={flowStyle(
          headingStyle(
            PROFILE_TEXT[tone],
            recipe("profile-header", "nameFontSize"),
            recipe("profile-header", "nameFontWeight"),
          ),
        )}
      >
        {name}
      </h1>
      {summary === undefined ? null : (
        <p
          style={flowStyle(
            paragraphStyle(PROFILE_MUTED_TEXT[tone], recipe("profile-header", "summaryFontSize")),
          )}
        >
          {summary}
        </p>
      )}
      {children}
    </header>
  );
};

export const ProductShowcase: MountedComponent<ReactNode, ReactNode> = ({
  props,
  children,
  themeVars,
}: Mount): ReactNode => {
  const title = textProp(props, "title") ?? "";
  const description = textProp(props, "description");
  const eyebrow = textProp(props, "eyebrow");
  const meta = textProp(props, "meta");
  const tone = enumProp(props, "tone", PRODUCT_TONES, "accent");

  return (
    <section
      data-facet-component="ProductShowcase"
      data-facet-product-showcase-tone={tone}
      style={frameStyle(themeVars, {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(16rem, 100%), 1fr))",
        maxWidth: "100%",
        alignItems: "stretch",
        gap: foundation("space", "xl"),
        padding: `min(${recipe("product-showcase", "padding")}, 8%)`,
        border: `${foundation("borderWidth", "thin")} solid ${recipe(
          "product-showcase",
          "border",
        )}`,
        borderRadius: recipe("product-showcase", "radius"),
        background: PRODUCT_BACKGROUND[tone],
        color: PRODUCT_TEXT[tone],
      })}
    >
      <div
        style={flowStyle({
          boxSizing: "border-box",
          minWidth: 0,
          maxWidth: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: foundation("space", "lg"),
        })}
      >
        {eyebrow === undefined ? null : (
          <p
            style={flowStyle({
              ...paragraphStyle(PRODUCT_MUTED_TEXT[tone], foundation("typography", "fontSizeSm")),
              fontWeight: foundation("typography", "fontWeightBold"),
              textTransform: "uppercase",
              letterSpacing: foundation("typography", "letterSpacingWide"),
              minWidth: 0,
              maxWidth: "100%",
              overflowWrap: "anywhere",
            })}
          >
            {eyebrow}
          </p>
        )}
        <h1
          style={flowStyle({
            ...headingStyle(
              PRODUCT_TEXT[tone],
              recipe("product-showcase", "titleFontSize"),
              recipe("product-showcase", "titleFontWeight"),
            ),
            minWidth: 0,
            maxWidth: "100%",
            overflowWrap: "anywhere",
          })}
        >
          {title}
        </h1>
        {description === undefined ? null : (
          <p
            style={flowStyle({
              ...paragraphStyle(PRODUCT_MUTED_TEXT[tone], foundation("typography", "fontSizeLg")),
              minWidth: 0,
              maxWidth: "100%",
              overflowWrap: "anywhere",
            })}
          >
            {description}
          </p>
        )}
        {children}
      </div>
      <div
        aria-label={meta ?? title}
        style={flowStyle({
          boxSizing: "border-box",
          minWidth: 0,
          width: "100%",
          maxWidth: "100%",
          minHeight: "16rem",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          gap: foundation("space", "xl"),
          padding: foundation("space", "xl"),
          borderRadius: recipe("product-showcase", "radius"),
          background:
            tone === "inverse"
              ? semantic("surface", "default")
              : recipe("product-showcase", "visualBg"),
          color: tone === "inverse" ? semantic("text", "default") : PRODUCT_TEXT[tone],
        })}
      >
        <span
          style={flowStyle({
            minWidth: 0,
            maxWidth: "100%",
            overflowWrap: "anywhere",
            color: tone === "inverse" ? semantic("text", "muted") : PRODUCT_MUTED_TEXT[tone],
            fontFamily: foundation("typography", "fontFamilyMono"),
            fontSize: foundation("typography", "fontSizeSm"),
            fontWeight: foundation("typography", "fontWeightMedium"),
            lineHeight: foundation("typography", "lineHeightTight"),
          })}
        >
          {meta ?? "selected surface"}
        </span>
        <span
          style={flowStyle({
            minWidth: 0,
            maxWidth: "min(12ch, 100%)",
            overflowWrap: "anywhere",
            color: tone === "inverse" ? semantic("text", "default") : PRODUCT_TEXT[tone],
            fontFamily: foundation("typography", "fontFamilySans"),
            fontSize: foundation("typography", "fontSize4xl"),
            fontWeight: foundation("typography", "fontWeightBlack"),
            lineHeight: foundation("typography", "lineHeightTight"),
          })}
        >
          {title}
        </span>
      </div>
    </section>
  );
};

export const VisualPanel: MountedComponent<ReactNode, ReactNode> = ({
  props,
  children,
  themeVars,
}: Mount): ReactNode => {
  const title = textProp(props, "title") ?? "";
  const value = textProp(props, "value");
  const caption = textProp(props, "caption");
  const tone = enumProp(props, "tone", VISUAL_PANEL_TONES, "brand");
  const scale = enumProp(props, "scale", VISUAL_PANEL_SCALES, "compact");

  return (
    <section
      data-facet-component="VisualPanel"
      data-facet-visual-panel-tone={tone}
      style={frameStyle(themeVars, {
        height: "100%",
        minHeight: scale === "hero" ? "20rem" : "12rem",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: foundation("space", "lg"),
        padding: recipe("visual-panel", "padding"),
        border: `${foundation("borderWidth", "thin")} solid ${recipe("visual-panel", "border")}`,
        borderRadius: recipe("visual-panel", "radius"),
        background: VISUAL_PANEL_BACKGROUND[tone],
        color: VISUAL_PANEL_TEXT[tone],
      })}
    >
      <h2
        style={flowStyle(
          headingStyle(
            VISUAL_PANEL_TEXT[tone],
            scale === "hero"
              ? foundation("typography", "fontSize5xl")
              : recipe("visual-panel", "titleFontSize"),
            foundation("typography", "fontWeightBlack"),
          ),
        )}
      >
        {title}
      </h2>
      <div
        style={flowStyle({
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: foundation("space", "sm"),
        })}
      >
        {value === undefined ? null : (
          <span
            style={flowStyle({
              color: VISUAL_PANEL_TEXT[tone],
              fontFamily: foundation("typography", "fontFamilySans"),
              fontSize: recipe("visual-panel", "valueFontSize"),
              fontWeight: recipe("visual-panel", "valueFontWeight"),
              lineHeight: foundation("typography", "lineHeightTight"),
            })}
          >
            {value}
          </span>
        )}
        {caption === undefined ? null : (
          <p style={flowStyle(paragraphStyle(VISUAL_PANEL_MUTED_TEXT[tone]))}>{caption}</p>
        )}
        {children}
      </div>
    </section>
  );
};

export const MediaCard: MountedComponent<ReactNode, ReactNode> = ({
  props,
  children,
  themeVars,
}: Mount): ReactNode => {
  const title = textProp(props, "title") ?? "";
  const description = textProp(props, "description");
  const eyebrow = textProp(props, "eyebrow");
  const meta = textProp(props, "meta");
  const tone = enumProp(props, "tone", MEDIA_CARD_TONES, "neutral");
  const aspect = enumProp(props, "aspect", MEDIA_CARD_ASPECTS, "wide");

  return (
    <article
      data-facet-component="MediaCard"
      data-facet-media-card-tone={tone}
      style={frameStyle(themeVars, {
        height: "100%",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: foundation("space", "md"),
        padding: recipe("media-card", "padding"),
        border: `${foundation("borderWidth", "thin")} solid ${recipe("media-card", "border")}`,
        borderRadius: recipe("media-card", "radius"),
        background: MEDIA_CARD_BACKGROUND[tone],
        color: MEDIA_CARD_TEXT[tone],
      })}
    >
      <div
        aria-label={meta ?? title}
        style={flowStyle({
          boxSizing: "border-box",
          minWidth: 0,
          width: "100%",
          flexShrink: 0,
          aspectRatio: MEDIA_CARD_ASPECT_RATIO[aspect],
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          gap: foundation("space", "lg"),
          padding: foundation("space", "lg"),
          borderRadius: recipe("media-card", "radius"),
          background: MEDIA_CARD_VISUAL_BG[tone],
          color: MEDIA_CARD_VISUAL_TEXT[tone],
        })}
      >
        {eyebrow === undefined ? null : (
          <span
            style={flowStyle({
              minWidth: 0,
              maxWidth: "100%",
              color: MEDIA_CARD_VISUAL_TEXT[tone],
              fontFamily: foundation("typography", "fontFamilyMono"),
              fontSize: foundation("typography", "fontSize2xs"),
              fontWeight: foundation("typography", "fontWeightBold"),
              lineHeight: foundation("typography", "lineHeightTight"),
              overflowWrap: "anywhere",
              textTransform: "uppercase",
              letterSpacing: foundation("typography", "letterSpacingWide"),
            })}
          >
            {eyebrow}
          </span>
        )}
        <span
          style={flowStyle({
            minWidth: 0,
            color: MEDIA_CARD_VISUAL_TEXT[tone],
            fontFamily: foundation("typography", "fontFamilySans"),
            fontSize: foundation("typography", "fontSize2xl"),
            fontWeight: foundation("typography", "fontWeightBlack"),
            lineHeight: foundation("typography", "lineHeightTight"),
            maxWidth: "min(10ch, 100%)",
            overflowWrap: "anywhere",
          })}
        >
          {meta ?? title}
        </span>
      </div>
      <div
        style={flowStyle({
          minWidth: 0,
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-start",
          gap: foundation("space", "xs"),
        })}
      >
        <h3
          style={flowStyle(
            headingStyle(
              MEDIA_CARD_TEXT[tone],
              recipe("media-card", "titleFontSize"),
              foundation("typography", "fontWeightBlack"),
            ),
          )}
        >
          {title}
        </h3>
        {description === undefined ? null : (
          <p style={flowStyle(paragraphStyle(MEDIA_CARD_MUTED_TEXT[tone]))}>{description}</p>
        )}
        {children}
      </div>
    </article>
  );
};

export const LinkList: MountedComponent<ReactNode, ReactNode> = ({
  props,
  children,
  themeVars,
}: Mount): ReactNode => {
  const title = textProp(props, "title");
  const density = enumProp(props, "density", LINK_LIST_DENSITIES, "comfortable");

  return (
    <section
      data-facet-component="LinkList"
      style={frameStyle(themeVars, {
        display: "flex",
        flexDirection: "column",
        gap: density === "compact" ? foundation("space", "xs") : recipe("link-list", "gap"),
        padding: recipe("link-list", "padding"),
        border: `${foundation("borderWidth", "thin")} solid ${recipe("link-list", "border")}`,
        borderRadius: recipe("link-list", "radius"),
        background: recipe("link-list", "background"),
      })}
    >
      {title === undefined ? null : (
        <h2
          style={flowStyle(
            headingStyle(
              recipe("link-list", "titleColor"),
              foundation("typography", "fontSizeLg"),
              foundation("typography", "fontWeightBold"),
            ),
          )}
        >
          {title}
        </h2>
      )}
      {children}
    </section>
  );
};

export const SocialLinks: MountedComponent<ReactNode, ReactNode> = ({
  props,
  children,
  themeVars,
}: Mount): ReactNode => {
  const title = textProp(props, "title");
  const align = enumProp(props, "align", SOCIAL_LINK_ALIGNMENTS, "center");
  const density = enumProp(props, "density", SOCIAL_LINK_DENSITIES, "comfortable");
  const tone = enumProp(props, "tone", SOCIAL_LINK_TONES, "neutral");

  return (
    <section
      data-facet-component="SocialLinks"
      data-facet-social-links-tone={tone}
      style={frameStyle(themeVars, {
        display: "flex",
        flexDirection: "column",
        alignItems: align === "center" ? "center" : "flex-start",
        gap: density === "compact" ? foundation("space", "xs") : recipe("social-links", "gap"),
        padding: recipe("social-links", "padding"),
        border: `${foundation("borderWidth", "thin")} solid ${recipe("social-links", "border")}`,
        borderRadius: recipe("social-links", "radius"),
        background: SOCIAL_LINK_BACKGROUND[tone],
        color: SOCIAL_LINK_TEXT[tone],
        textAlign: TEXT_ALIGNMENTS[align],
      })}
    >
      {title === undefined ? null : (
        <h2
          style={flowStyle(
            headingStyle(
              tone === "inverse"
                ? semantic("text", "inverse")
                : recipe("social-links", "titleColor"),
              foundation("typography", "fontSizeMd"),
              foundation("typography", "fontWeightBold"),
            ),
          )}
        >
          {title}
        </h2>
      )}
      <div
        style={flowStyle({
          minWidth: 0,
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: align === "center" ? "center" : "flex-start",
          flexWrap: "wrap",
          gap: density === "compact" ? foundation("space", "xs") : recipe("social-links", "gap"),
        })}
      >
        {children}
      </div>
    </section>
  );
};

export const FeatureList: MountedComponent<ReactNode, ReactNode> = ({
  props,
  children,
  themeVars,
}: Mount): ReactNode => {
  const title = textProp(props, "title");
  const columns = countProp(props, "columns", 1, 4, 3);
  const gap = recipe("feature-list", "gap");
  const tracks = columns === 1 ? "minmax(0, 1fr)" : gridTracks(columns, gap, "12rem");

  return (
    <section
      data-facet-component="FeatureList"
      style={frameStyle(themeVars, {
        display: "flex",
        flexDirection: "column",
        gap,
      })}
    >
      {title === undefined ? null : (
        <h2
          style={flowStyle(
            headingStyle(
              recipe("feature-list", "titleColor"),
              foundation("typography", "fontSize2xl"),
              foundation("typography", "fontWeightBold"),
            ),
          )}
        >
          {title}
        </h2>
      )}
      <div
        style={flowStyle({
          display: "grid",
          gap,
          gridTemplateColumns: tracks,
        })}
      >
        {children}
      </div>
    </section>
  );
};

export const StatStrip: MountedComponent<ReactNode, ReactNode> = ({
  props,
  children,
  themeVars,
}: Mount): ReactNode => {
  const title = textProp(props, "title");
  const columns = countProp(props, "columns", 2, 4, 3);
  const tone = enumProp(props, "tone", STAT_STRIP_TONES, "neutral");
  const gap = recipe("stat-strip", "gap");

  return (
    <section
      data-facet-component="StatStrip"
      data-facet-stat-strip-tone={tone}
      style={frameStyle(themeVars, {
        display: "flex",
        flexDirection: "column",
        gap,
        padding: recipe("stat-strip", "padding"),
        border: `${foundation("borderWidth", "thin")} solid ${recipe("stat-strip", "border")}`,
        borderRadius: recipe("stat-strip", "radius"),
        background: STAT_STRIP_BACKGROUND[tone],
        color: STAT_STRIP_TEXT[tone],
      })}
    >
      {title === undefined ? null : (
        <h2
          style={flowStyle(
            headingStyle(
              tone === "inverse" ? semantic("text", "inverse") : recipe("stat-strip", "titleColor"),
              foundation("typography", "fontSizeLg"),
              foundation("typography", "fontWeightBold"),
            ),
          )}
        >
          {title}
        </h2>
      )}
      <div
        style={flowStyle({
          display: "grid",
          gap,
          gridTemplateColumns: gridTracks(columns, gap, "9rem"),
        })}
      >
        {children}
      </div>
    </section>
  );
};

export const Gallery: MountedComponent<ReactNode, ReactNode> = ({
  props,
  children,
  themeVars,
}: Mount): ReactNode => {
  const title = textProp(props, "title");
  const columns = countProp(props, "columns", 2, 4, 3);
  const rhythm = enumProp(props, "rhythm", GALLERY_RHYTHMS, "editorial");
  const gap = recipe("gallery", "gap");

  return (
    <section
      data-facet-component="Gallery"
      data-facet-gallery-rhythm={rhythm}
      style={frameStyle(themeVars, {
        display: "flex",
        flexDirection: "column",
        gap,
        padding: recipe("gallery", "padding"),
        border: `${foundation("borderWidth", "thin")} solid ${recipe("gallery", "border")}`,
        borderRadius: recipe("gallery", "radius"),
        background: recipe("gallery", "background"),
        color: recipe("gallery", "text"),
      })}
    >
      {title === undefined ? null : (
        <h2
          style={flowStyle(
            headingStyle(
              recipe("gallery", "titleColor"),
              foundation("typography", "fontSize2xl"),
              foundation("typography", "fontWeightBlack"),
            ),
          )}
        >
          {title}
        </h2>
      )}
      <div
        style={flowStyle({
          display: "grid",
          alignItems: rhythm === "even" ? "stretch" : "start",
          gap,
          gridTemplateColumns: gridTracks(columns, gap, "12rem"),
        })}
      >
        {children}
      </div>
    </section>
  );
};

export const Testimonial: MountedComponent<ReactNode, ReactNode> = ({
  props,
  themeVars,
}: Mount): ReactNode => {
  const quote = textProp(props, "quote") ?? "";
  const source = textProp(props, "source");
  const role = textProp(props, "role");
  const tone = enumProp(props, "tone", ["neutral", "accent"] as const, "neutral");

  return (
    <figure
      data-facet-component="Testimonial"
      data-facet-testimonial-tone={tone}
      style={frameStyle(themeVars, {
        display: "flex",
        flexDirection: "column",
        gap: foundation("space", "sm"),
        margin: 0,
        padding: recipe("testimonial", "padding"),
        border: `${foundation("borderWidth", "thin")} solid ${
          tone === "accent" ? semantic("action", "primaryBorder") : recipe("testimonial", "border")
        }`,
        borderRadius: recipe("testimonial", "radius"),
        background:
          tone === "accent"
            ? semantic("selection", "background")
            : recipe("testimonial", "background"),
        color: recipe("testimonial", "text"),
      })}
    >
      <blockquote
        style={flowStyle({
          ...paragraphStyle(recipe("testimonial", "text"), recipe("testimonial", "quoteFontSize")),
          margin: 0,
          fontWeight: foundation("typography", "fontWeightSemibold"),
        })}
      >
        {quote}
      </blockquote>
      {source === undefined ? null : (
        <figcaption
          style={flowStyle(
            paragraphStyle(
              recipe("testimonial", "sourceText"),
              foundation("typography", "fontSizeSm"),
            ),
          )}
        >
          {role === undefined ? source : `${source}, ${role}`}
        </figcaption>
      )}
    </figure>
  );
};

export const Timeline: MountedComponent<ReactNode, ReactNode> = ({
  props,
  children,
  themeVars,
}: Mount): ReactNode => {
  const title = textProp(props, "title");
  const tone = enumProp(props, "tone", TIMELINE_TONES, "neutral");
  const items = Children.toArray(children);

  return (
    <section
      data-facet-component="Timeline"
      data-facet-timeline-tone={tone}
      style={frameStyle(themeVars, {
        display: "flex",
        flexDirection: "column",
        gap: recipe("timeline", "gap"),
        color: recipe("timeline", "text"),
      })}
    >
      {title === undefined ? null : (
        <h2
          style={flowStyle(
            headingStyle(
              recipe("timeline", "titleColor"),
              foundation("typography", "fontSize2xl"),
              foundation("typography", "fontWeightBold"),
            ),
          )}
        >
          {title}
        </h2>
      )}
      <div
        style={flowStyle({
          display: "flex",
          flexDirection: "column",
          gap: foundation("space", "sm"),
          borderLeft: `${foundation("borderWidth", "medium")} solid ${
            tone === "accent" ? recipe("timeline", "markerBg") : recipe("timeline", "line")
          }`,
          paddingLeft: foundation("space", "md"),
        })}
      >
        {items.map((item, index) => (
          <div
            key={index}
            style={flowStyle({
              display: "grid",
              gridTemplateColumns: "auto minmax(0, 1fr)",
              gap: foundation("space", "sm"),
              alignItems: "start",
            })}
          >
            <span
              aria-hidden="true"
              style={flowStyle({
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: foundation("size", "iconMd"),
                height: foundation("size", "iconMd"),
                borderRadius: foundation("radius", "full"),
                background: recipe("timeline", "markerBg"),
                color: recipe("timeline", "markerText"),
                fontFamily: foundation("typography", "fontFamilySans"),
                fontSize: foundation("typography", "fontSize2xs"),
                fontWeight: foundation("typography", "fontWeightBold"),
                lineHeight: foundation("typography", "lineHeightNone"),
              })}
            >
              {index + 1}
            </span>
            <div style={flowStyle({ minWidth: 0 })}>{item}</div>
          </div>
        ))}
      </div>
    </section>
  );
};

export const CTA: MountedComponent<ReactNode, ReactNode> = ({
  props,
  children,
  themeVars,
}: Mount): ReactNode => {
  const title = textProp(props, "title") ?? "";
  const description = textProp(props, "description");
  const align = enumProp(props, "align", HERO_ALIGNMENTS, "start");
  const tone = enumProp(props, "tone", CTA_TONES, "accent");

  return (
    <section
      data-facet-component="CTA"
      data-facet-cta-tone={tone}
      style={frameStyle(themeVars, {
        display: "flex",
        flexDirection: "column",
        alignItems: align === "center" ? "center" : "flex-start",
        gap: foundation("space", "md"),
        padding: recipe("cta", "padding"),
        border: `${foundation("borderWidth", "thin")} solid ${recipe("cta", "border")}`,
        borderRadius: recipe("cta", "radius"),
        background: CTA_BACKGROUND[tone],
        color: CTA_TEXT[tone],
        textAlign: TEXT_ALIGNMENTS[align],
      })}
    >
      <h2
        style={flowStyle(
          headingStyle(
            CTA_TEXT[tone],
            recipe("cta", "titleFontSize"),
            foundation("typography", "fontWeightBlack"),
          ),
        )}
      >
        {title}
      </h2>
      {description === undefined ? null : (
        <p style={flowStyle(paragraphStyle(CTA_MUTED_TEXT[tone]))}>{description}</p>
      )}
      {children}
    </section>
  );
};

export const Alert: MountedComponent<ReactNode, ReactNode> = ({
  props,
  children,
  themeVars,
}: Mount): ReactNode => {
  const title = textProp(props, "title") ?? "";
  const description = textProp(props, "description");
  const tone = enumProp(props, "tone", ALERT_TONES, "info");
  const colors = ALERT_COLORS[tone];

  return (
    <section
      data-facet-component="Alert"
      data-facet-alert-tone={tone}
      style={frameStyle(themeVars, {
        display: "flex",
        flexDirection: "column",
        gap: foundation("space", "xs"),
        padding: recipe("alert", "padding"),
        border: `${foundation("borderWidth", "thin")} solid ${colors.border}`,
        borderRadius: recipe("alert", "radius"),
        background: colors.background,
        color: colors.text,
      })}
    >
      <h2
        style={flowStyle(
          headingStyle(
            colors.text,
            foundation("typography", "fontSizeMd"),
            foundation("typography", "fontWeightBold"),
          ),
        )}
      >
        {title}
      </h2>
      {description === undefined ? null : (
        <p style={flowStyle(paragraphStyle(colors.text, foundation("typography", "fontSizeSm")))}>
          {description}
        </p>
      )}
      {children}
    </section>
  );
};

export const Progress: MountedComponent<ReactNode, ReactNode> = ({
  props,
  themeVars,
}: Mount): ReactNode => {
  const label = textProp(props, "label") ?? "";
  const value = countProp(props, "value", 0, 100, 0);
  const tone = enumProp(props, "tone", PROGRESS_TONES, "accent");

  return (
    <div
      data-facet-component="Progress"
      style={frameStyle(themeVars, {
        display: "flex",
        flexDirection: "column",
        gap: foundation("space", "xs"),
        fontFamily: foundation("typography", "fontFamilySans"),
      })}
    >
      <div
        style={flowStyle({
          display: "flex",
          justifyContent: "space-between",
          gap: foundation("space", "md"),
          color: recipe("progress", "labelText"),
          fontSize: foundation("typography", "fontSizeSm"),
          fontWeight: foundation("typography", "fontWeightMedium"),
          lineHeight: foundation("typography", "lineHeightTight"),
        })}
      >
        <span style={flowStyle({ minWidth: 0 })}>{label}</span>
        <span
          style={flowStyle({
            flexShrink: 0,
            whiteSpace: "nowrap",
            color: recipe("progress", "valueText"),
          })}
        >
          {value}%
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-label={label}
        style={flowStyle({
          overflow: "hidden",
          width: "100%",
          height: recipe("progress", "height"),
          borderRadius: recipe("progress", "radius"),
          background: recipe("progress", "track"),
        })}
      >
        <div
          style={flowStyle({
            width: `${value}%`,
            height: "100%",
            borderRadius: recipe("progress", "radius"),
            background: PROGRESS_FILL[tone],
          })}
        />
      </div>
    </div>
  );
};

export const Footer: MountedComponent<ReactNode, ReactNode> = ({
  props,
  children,
  themeVars,
}: Mount): ReactNode => {
  const title = textProp(props, "title");
  const description = textProp(props, "description");
  const tone = enumProp(props, "tone", FOOTER_TONES, "neutral");

  return (
    <footer
      data-facet-component="Footer"
      data-facet-footer-tone={tone}
      style={frameStyle(themeVars, {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: foundation("space", "lg"),
        padding: recipe("footer", "padding"),
        border: `${foundation("borderWidth", "thin")} solid ${recipe("footer", "border")}`,
        borderRadius: recipe("footer", "radius"),
        background: FOOTER_BACKGROUND[tone],
        color: FOOTER_TEXT[tone],
      })}
    >
      <div
        style={flowStyle({
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: foundation("space", "xs"),
        })}
      >
        {title === undefined ? null : (
          <h2
            style={flowStyle(
              headingStyle(
                FOOTER_TEXT[tone],
                recipe("footer", "titleFontSize"),
                foundation("typography", "fontWeightBlack"),
              ),
            )}
          >
            {title}
          </h2>
        )}
        {description === undefined ? null : (
          <p style={flowStyle(paragraphStyle(FOOTER_MUTED_TEXT[tone]))}>{description}</p>
        )}
      </div>
      <div
        style={flowStyle({
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          flexWrap: "wrap",
          gap: foundation("space", "xs"),
        })}
      >
        {children}
      </div>
    </footer>
  );
};
