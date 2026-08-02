/**
 * Facet Design Contract v1 metadata and CSS variable naming.
 *
 * This module owns token names, token value categories, and the public helper
 * that trusted components use to reference projected CSS custom properties. It
 * stays React-free and DOM-free: names are plain data, and helpers only build
 * deterministic strings.
 */

export type FacetThemeTokenValueKind =
  | "color"
  | "length"
  | "number"
  | "opacity"
  | "fontFamily"
  | "fontWeight"
  | "lineHeight"
  | "duration"
  | "easing"
  | "shadow"
  | "effect"
  | "text";

export interface FacetThemeTokenSpec {
  readonly name: string;
  readonly kind: FacetThemeTokenValueKind;
}

export interface FacetThemeGroupSpec {
  readonly name: string;
  readonly tokens: readonly FacetThemeTokenSpec[];
}

export const FACET_FOUNDATION_TOKEN_NAMES = {
  palette: [
    "neutral0",
    "neutral50",
    "neutral100",
    "neutral200",
    "neutral300",
    "neutral400",
    "neutral500",
    "neutral600",
    "neutral700",
    "neutral800",
    "neutral900",
    "neutral950",
    "neutral1000",
    "brand50",
    "brand100",
    "brand200",
    "brand300",
    "brand400",
    "brand500",
    "brand600",
    "brand700",
    "brand800",
    "brand900",
    "brand950",
    "accent50",
    "accent100",
    "accent200",
    "accent300",
    "accent400",
    "accent500",
    "accent600",
    "accent700",
    "accent800",
    "accent900",
    "accent950",
    "success50",
    "success100",
    "success200",
    "success300",
    "success400",
    "success500",
    "success600",
    "success700",
    "success800",
    "success900",
    "success950",
    "warning50",
    "warning100",
    "warning200",
    "warning300",
    "warning400",
    "warning500",
    "warning600",
    "warning700",
    "warning800",
    "warning900",
    "warning950",
    "danger50",
    "danger100",
    "danger200",
    "danger300",
    "danger400",
    "danger500",
    "danger600",
    "danger700",
    "danger800",
    "danger900",
    "danger950",
    "info50",
    "info100",
    "info200",
    "info300",
    "info400",
    "info500",
    "info600",
    "info700",
    "info800",
    "info900",
    "info950",
    "categorical1",
    "categorical2",
    "categorical3",
    "categorical4",
    "categorical5",
    "categorical6",
    "categorical7",
    "categorical8",
    "categorical9",
    "categorical10",
    "categorical11",
    "categorical12",
  ],
  typography: [
    "fontFamilySans",
    "fontFamilySerif",
    "fontFamilyMono",
    "fontFamilyDisplay",
    "fontSize2xs",
    "fontSizeXs",
    "fontSizeSm",
    "fontSizeMd",
    "fontSizeLg",
    "fontSizeXl",
    "fontSize2xl",
    "fontSize3xl",
    "fontSize4xl",
    "fontSize5xl",
    "fontSize6xl",
    "fontWeightLight",
    "fontWeightRegular",
    "fontWeightMedium",
    "fontWeightSemibold",
    "fontWeightBold",
    "fontWeightBlack",
    "lineHeightNone",
    "lineHeightTight",
    "lineHeightSnug",
    "lineHeightNormal",
    "lineHeightRelaxed",
    "lineHeightLoose",
    "letterSpacingTight",
    "letterSpacingNormal",
    "letterSpacingWide",
  ],
  space: [
    "none",
    "hairline",
    "micro",
    "tiny",
    "xs",
    "sm",
    "md",
    "lg",
    "xl",
    "xxl",
    "xxxl",
    "jumbo",
    "mega",
  ],
  size: [
    "iconXs",
    "iconSm",
    "iconMd",
    "iconLg",
    "iconXl",
    "controlHeightSm",
    "controlHeightMd",
    "controlHeightLg",
    "controlHeightXl",
    "touchTarget",
    "containerXs",
    "containerSm",
    "containerMd",
    "containerLg",
    "containerXl",
    "contentMeasureSm",
    "contentMeasureMd",
    "contentMeasureLg",
  ],
  radius: ["none", "xs", "sm", "md", "lg", "xl", "xxl", "full"],
  borderWidth: ["none", "hairline", "thin", "medium", "thick"],
  shadow: ["none", "xs", "sm", "md", "lg", "xl", "inner"],
  opacity: ["transparent", "disabled", "muted", "overlay", "visible"],
  motion: [
    "durationInstant",
    "durationFast",
    "durationNormal",
    "durationSlow",
    "durationSlower",
    "easeLinear",
    "easeStandard",
    "easeEnter",
    "easeExit",
    "easeEmphasized",
  ],
  effect: [
    "blurNone",
    "blurSm",
    "blurMd",
    "blurLg",
    "backdropNone",
    "backdropMuted",
    "backdropStrong",
  ],
  breakpoint: ["xs", "sm", "md", "lg", "xl", "xxl"],
  density: ["compact", "comfortable", "spacious", "current"],
} as const;

export const FACET_SEMANTIC_TOKEN_NAMES = {
  canvas: ["background", "muted", "inverse"],
  surface: ["default", "muted", "raised", "sunken", "inverse", "overlay"],
  text: [
    "default",
    "muted",
    "subtle",
    "disabled",
    "inverse",
    "link",
    "linkHover",
    "onAction",
    "onStatus",
  ],
  border: ["default", "muted", "strong", "focus", "danger", "transparent"],
  action: [
    "primaryBg",
    "primaryText",
    "primaryBorder",
    "primaryHoverBg",
    "primaryActiveBg",
    "secondaryBg",
    "secondaryText",
    "secondaryBorder",
    "secondaryHoverBg",
    "tertiaryBg",
    "tertiaryText",
    "tertiaryHoverBg",
    "destructiveBg",
    "destructiveText",
    "destructiveHoverBg",
  ],
  status: [
    "neutralBg",
    "neutralText",
    "neutralBorder",
    "successBg",
    "successText",
    "successBorder",
    "warningBg",
    "warningText",
    "warningBorder",
    "dangerBg",
    "dangerText",
    "dangerBorder",
    "infoBg",
    "infoText",
    "infoBorder",
  ],
  state: ["hoverBg", "activeBg", "selectedBg", "selectedText", "pressedBg"],
  focus: ["ringColor", "ringWidth", "ringOffset", "ringStyle"],
  selection: ["background", "text"],
  disabled: ["background", "text", "border", "opacity"],
  overlay: ["scrim", "backdrop", "surface", "shadow"],
  loading: [
    "skeletonBase",
    "skeletonHighlight",
    "progressTrack",
    "progressFill",
    "shimmerDuration",
  ],
  layer: [
    "baseShadow",
    "raisedShadow",
    "popoverShadow",
    "modalShadow",
    "toastShadow",
    "scrimColor",
  ],
  validation: [
    "validText",
    "validBorder",
    "invalidText",
    "invalidBorder",
    "requiredText",
    "helpText",
    "errorText",
    "warningText",
  ],
} as const;

export type FacetFoundationTheme = FacetThemeTokenTableValues<typeof FACET_FOUNDATION_TOKEN_NAMES>;
export type FacetSemanticTheme = FacetThemeTokenTableValues<typeof FACET_SEMANTIC_TOKEN_NAMES>;
export type FacetThemeTokenValues = Readonly<Record<string, Readonly<Record<string, string>>>>;

export type FacetThemeTokenTableValues<Table extends Readonly<Record<string, readonly string[]>>> =
  {
    readonly [Group in keyof Table]: Readonly<Record<Table[Group][number], string>>;
  };

export type FacetFoundationGroupName = keyof typeof FACET_FOUNDATION_TOKEN_NAMES;
export type FacetSemanticGroupName = keyof typeof FACET_SEMANTIC_TOKEN_NAMES;

export type FacetFoundationTokenRef = {
  readonly [Group in FacetFoundationGroupName]: {
    readonly layer: "foundation";
    readonly group: Group;
    readonly token: (typeof FACET_FOUNDATION_TOKEN_NAMES)[Group][number];
  };
}[FacetFoundationGroupName];

export type FacetSemanticTokenRef = {
  readonly [Group in FacetSemanticGroupName]: {
    readonly layer: "semantic";
    readonly group: Group;
    readonly token: (typeof FACET_SEMANTIC_TOKEN_NAMES)[Group][number];
  };
}[FacetSemanticGroupName];

export interface FacetRecipeTokenRef {
  readonly layer: "recipe";
  readonly namespace: string;
  readonly token: string;
}

export interface FacetExtensionTokenRef {
  readonly layer: "extension";
  readonly namespace: string;
  readonly token: string;
}

export type FacetThemeTokenRef =
  FacetFoundationTokenRef | FacetSemanticTokenRef | FacetRecipeTokenRef | FacetExtensionTokenRef;

export interface FacetThemeContract {
  readonly foundation: readonly FacetThemeGroupSpec[];
  readonly semantic: readonly FacetThemeGroupSpec[];
}

const CSS_VAR_PREFIX = "--facet";

export const FACET_THEME_CONTRACT: FacetThemeContract = Object.freeze({
  foundation: groups(FACET_FOUNDATION_TOKEN_NAMES, foundationKind),
  semantic: groups(FACET_SEMANTIC_TOKEN_NAMES, semanticKind),
});

export function themeTokenVar(ref: FacetThemeTokenRef): string {
  switch (ref.layer) {
    case "foundation":
      return `${CSS_VAR_PREFIX}-foundation-${toKebabCase(ref.group)}-${toKebabCase(ref.token)}`;
    case "semantic":
      return `${CSS_VAR_PREFIX}-semantic-${toKebabCase(ref.group)}-${toKebabCase(ref.token)}`;
    case "recipe":
      return `${CSS_VAR_PREFIX}-recipe-${toKebabCase(ref.namespace)}-${toKebabCase(ref.token)}`;
    case "extension":
      return `${CSS_VAR_PREFIX}-ext-${toKebabCase(ref.namespace)}-${toKebabCase(ref.token)}`;
  }
}

export function themeTokenRef(ref: FacetThemeTokenRef): string {
  return `var(${themeTokenVar(ref)})`;
}

export function facetThemeToKebabCase(name: string): string {
  return toKebabCase(name);
}

function groups<Table extends Readonly<Record<string, readonly string[]>>>(
  table: Table,
  kindFor: (group: string, token: string) => FacetThemeTokenValueKind,
): readonly FacetThemeGroupSpec[] {
  return Object.freeze(
    Object.entries(table).map(([name, tokens]) =>
      Object.freeze({
        name,
        tokens: Object.freeze(
          tokens.map((token) => Object.freeze({ name: token, kind: kindFor(name, token) })),
        ),
      }),
    ),
  );
}

function foundationKind(group: string, token: string): FacetThemeTokenValueKind {
  if (group === "palette") return "color";
  if (group === "shadow") return "shadow";
  if (group === "opacity") return "opacity";
  if (group === "effect") return "effect";
  if (group === "density") return "number";
  if (group === "motion") return token.startsWith("duration") ? "duration" : "easing";
  if (group === "typography") {
    if (token.startsWith("fontFamily")) return "fontFamily";
    if (token.startsWith("fontWeight")) return "fontWeight";
    if (token.startsWith("lineHeight")) return "lineHeight";
    return "length";
  }
  return "length";
}

function semanticKind(group: string, token: string): FacetThemeTokenValueKind {
  if (group === "focus" && (token === "ringWidth" || token === "ringOffset")) return "length";
  if (group === "focus" && token === "ringStyle") return "text";
  if (group === "disabled" && token === "opacity") return "opacity";
  if (group === "overlay" && token === "shadow") return "shadow";
  if (group === "loading" && token === "shimmerDuration") return "duration";
  if (group === "layer" && token.endsWith("Shadow")) return "shadow";
  if (group === "loading" && token === "progressTrack") return "color";
  return "color";
}

function toKebabCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
    .replace(/_/gu, "-")
    .toLowerCase();
}
