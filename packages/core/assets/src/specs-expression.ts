import type { ComponentSpec } from "@facet/core";

export const SECTION_SPEC: ComponentSpec = {
  tag: "Section",
  authoringRole: "surface",
  whenToUse: "Group one named part of a page, with optional heading text and normal flow content.",
  props: {
    title: {
      type: "string",
      guidance: "Optional section heading. Omit it when the first child already names the section.",
    },
    description: {
      type: "string",
      guidance: "Optional supporting sentence shown below the section title.",
    },
    tone: {
      type: "string",
      enum: ["neutral", "accent", "muted"],
      default: "neutral",
      guidance: "Visual emphasis for the section: ordinary, brand-accented, or quiet.",
    },
    padding: {
      type: "string",
      enum: ["none", "sm", "md", "lg"],
      default: "md",
      guidance: "Space inside the section, named from the theme's spacing scale.",
    },
  },
  acceptsChildren: true,
  themeRecipe: {
    tokens: {
      background: "color",
      text: "color",
      mutedText: "color",
      border: "color",
      radius: "length",
      padding: "length",
      titleFontSize: "length",
      titleFontWeight: "fontWeight",
    },
  },
};

export const DIVIDER_SPEC: ComponentSpec = {
  tag: "Divider",
  authoringRole: "content",
  whenToUse: "Separate two neighboring sections in the reading flow.",
  props: {
    label: {
      type: "string",
      guidance: "Optional short label shown in the divider gap.",
    },
    emphasis: {
      type: "string",
      enum: ["subtle", "strong"],
      default: "subtle",
      guidance: "How visible the divider should be.",
    },
  },
  acceptsChildren: false,
  themeRecipe: {
    tokens: {
      color: "color",
      text: "color",
      gap: "length",
    },
  },
};

export const HERO_SPEC: ComponentSpec = {
  tag: "Hero",
  authoringRole: "surface",
  whenToUse: "Create the first impression of a page with a headline, supporting copy and actions.",
  props: {
    title: {
      type: "string",
      required: true,
      guidance: "The primary headline for the surface.",
    },
    subtitle: {
      type: "string",
      guidance: "Optional supporting copy under the headline.",
    },
    eyebrow: {
      type: "string",
      guidance: "Optional short line above the headline for category or context.",
    },
    align: {
      type: "string",
      enum: ["start", "center"],
      default: "start",
      guidance: "Whether the hero content starts on the left or centers in the column.",
    },
    tone: {
      type: "string",
      enum: ["neutral", "accent", "inverse"],
      default: "neutral",
      guidance: "The hero's visual mood: neutral, brand-accented, or inverse.",
    },
  },
  acceptsChildren: true,
  themeRecipe: {
    tokens: {
      background: "color",
      text: "color",
      mutedText: "color",
      border: "color",
      radius: "length",
      padding: "length",
      titleFontSize: "length",
      titleFontWeight: "fontWeight",
      subtitleFontSize: "length",
    },
  },
};

export const AVATAR_SPEC: ComponentSpec = {
  tag: "Avatar",
  authoringRole: "content",
  whenToUse:
    "Show a person's or brand's identity with initials, without loading an external image.",
  props: {
    label: {
      type: "string",
      required: true,
      guidance: "Accessible name for the person, brand or profile.",
    },
    initials: {
      type: "string",
      guidance:
        "One to three visible initials. If omitted, the implementation derives them from label.",
    },
    size: {
      type: "string",
      enum: ["sm", "md", "lg"],
      default: "md",
      guidance: "How large the avatar appears.",
    },
    tone: {
      type: "string",
      enum: ["neutral", "accent", "warm", "cool"],
      default: "accent",
      guidance: "Color mood for the initials badge.",
    },
  },
  acceptsChildren: false,
  themeRecipe: {
    tokens: {
      background: "color",
      text: "color",
      border: "color",
      radius: "length",
      size: "length",
      fontSize: "length",
      fontWeight: "fontWeight",
    },
  },
};

export const LINK_LIST_SPEC: ComponentSpec = {
  tag: "LinkList",
  authoringRole: "surface",
  whenToUse: "Stack a set of navigation or agent-action buttons, such as a link-in-bio list.",
  props: {
    title: {
      type: "string",
      guidance: "Optional title for the action list.",
    },
    density: {
      type: "string",
      enum: ["compact", "comfortable"],
      default: "comfortable",
      guidance: "How tightly the child actions are spaced.",
    },
  },
  acceptsChildren: true,
  themeRecipe: {
    tokens: {
      background: "color",
      border: "color",
      radius: "length",
      padding: "length",
      gap: "length",
      titleColor: "color",
    },
  },
};

export const FEATURE_LIST_SPEC: ComponentSpec = {
  tag: "FeatureList",
  authoringRole: "surface",
  whenToUse: "Group feature, service or proof cards in an even marketing/editorial list.",
  props: {
    title: {
      type: "string",
      guidance: "Optional heading for the feature group.",
    },
    columns: {
      type: "number",
      minimum: 1,
      maximum: 4,
      default: 3,
      guidance: "Number of columns on a wide viewport. Use one or two for dense copy.",
    },
  },
  acceptsChildren: true,
  themeRecipe: {
    tokens: {
      gap: "length",
      markerBg: "color",
      markerText: "color",
      titleColor: "color",
    },
  },
};

export const TESTIMONIAL_SPEC: ComponentSpec = {
  tag: "Testimonial",
  authoringRole: "surface",
  whenToUse: "Show one quote or endorsement with its source.",
  props: {
    quote: {
      type: "string",
      required: true,
      guidance: "The quoted endorsement or proof point.",
    },
    source: {
      type: "string",
      guidance: "Name of the person, team or customer behind the quote.",
    },
    role: {
      type: "string",
      guidance: "Optional role, company or context for the source.",
    },
    tone: {
      type: "string",
      enum: ["neutral", "accent"],
      default: "neutral",
      guidance: "Whether the testimonial reads as ordinary proof or a featured quote.",
    },
  },
  acceptsChildren: false,
  themeRecipe: {
    tokens: {
      background: "color",
      text: "color",
      sourceText: "color",
      border: "color",
      radius: "length",
      padding: "length",
      quoteFontSize: "length",
    },
  },
};

export const CTA_SPEC: ComponentSpec = {
  tag: "CTA",
  authoringRole: "surface",
  whenToUse: "End a section or page with a clear call to action and one or more child buttons.",
  props: {
    title: {
      type: "string",
      required: true,
      guidance: "The short action-oriented heading.",
    },
    description: {
      type: "string",
      guidance: "Optional supporting sentence explaining why to act.",
    },
    align: {
      type: "string",
      enum: ["start", "center"],
      default: "start",
      guidance: "Whether the call to action starts on the left or centers in the band.",
    },
    tone: {
      type: "string",
      enum: ["neutral", "accent", "inverse"],
      default: "accent",
      guidance: "Visual emphasis for the call-to-action band.",
    },
  },
  acceptsChildren: true,
  themeRecipe: {
    tokens: {
      background: "color",
      text: "color",
      mutedText: "color",
      border: "color",
      radius: "length",
      padding: "length",
      titleFontSize: "length",
    },
  },
};

export const ALERT_SPEC: ComponentSpec = {
  tag: "Alert",
  authoringRole: "surface",
  whenToUse: "Show one important status, warning or informational message in the flow.",
  props: {
    title: {
      type: "string",
      required: true,
      guidance: "One line naming the message.",
    },
    description: {
      type: "string",
      guidance: "Optional supporting text with detail or next steps.",
    },
    tone: {
      type: "string",
      enum: ["info", "success", "warning", "danger"],
      default: "info",
      guidance: "The message meaning: information, success, warning or danger.",
    },
  },
  acceptsChildren: true,
  themeRecipe: {
    tokens: {
      background: "color",
      text: "color",
      border: "color",
      radius: "length",
      padding: "length",
      titleColor: "color",
    },
  },
};

export const PROGRESS_SPEC: ComponentSpec = {
  tag: "Progress",
  authoringRole: "content",
  whenToUse: "Show bounded completion from zero to one hundred percent.",
  props: {
    label: {
      type: "string",
      required: true,
      guidance: "What is progressing.",
    },
    value: {
      type: "number",
      required: true,
      bindable: true,
      minimum: 0,
      maximum: 100,
      guidance: "Completion as a number from 0 to 100. Bind it to published data when it changes.",
    },
    tone: {
      type: "string",
      enum: ["neutral", "accent", "success", "warning"],
      default: "accent",
      guidance: "Progress meaning or emphasis.",
    },
  },
  acceptsChildren: false,
  themeRecipe: {
    tokens: {
      labelText: "color",
      valueText: "color",
      track: "color",
      fill: "color",
      radius: "length",
      height: "length",
    },
  },
};

export const LOGO_MARK_SPEC: ComponentSpec = {
  tag: "LogoMark",
  authoringRole: "content",
  whenToUse: "Show a compact brand, product or personal mark without loading external media.",
  props: {
    label: {
      type: "string",
      required: true,
      guidance: "Accessible name for the brand, person or product represented by the mark.",
    },
    mark: {
      type: "string",
      guidance: "Optional visible one to three character mark. If omitted, Facet derives initials.",
    },
    size: {
      type: "string",
      enum: ["sm", "md", "lg"],
      default: "md",
      guidance: "How large the mark appears.",
    },
    tone: {
      type: "string",
      enum: ["neutral", "brand", "accent", "inverse"],
      default: "brand",
      guidance: "The mark color mood: quiet, brand-led, accent-led or high contrast.",
    },
    shape: {
      type: "string",
      enum: ["circle", "square", "soft"],
      default: "soft",
      guidance: "The mark shape: round, square, or softly rounded.",
    },
  },
  acceptsChildren: false,
  themeRecipe: {
    tokens: {
      background: "color",
      text: "color",
      border: "color",
      radius: "length",
      size: "length",
      fontSize: "length",
      fontWeight: "fontWeight",
    },
  },
};

export const NAV_SPEC: ComponentSpec = {
  tag: "Nav",
  authoringRole: "surface",
  whenToUse: "Frame a site or product surface with brand text and child navigation actions.",
  props: {
    brand: {
      type: "string",
      required: true,
      guidance: "The visible brand, person, product or service name.",
    },
    mark: {
      type: "string",
      guidance: "Optional one to three character brand mark shown before the brand text.",
    },
    label: {
      type: "string",
      guidance: "Optional small context label beside or below the brand.",
    },
    tone: {
      type: "string",
      enum: ["neutral", "accent", "inverse"],
      default: "neutral",
      guidance: "The navigation mood: ordinary, brand-accented or inverse.",
    },
  },
  acceptsChildren: true,
  themeRecipe: {
    tokens: {
      background: "color",
      text: "color",
      mutedText: "color",
      border: "color",
      radius: "length",
      paddingBlock: "length",
      paddingInline: "length",
      gap: "length",
      markBg: "color",
      markText: "color",
      markSize: "length",
      brandFontSize: "length",
      brandFontWeight: "fontWeight",
    },
  },
};

export const PROFILE_HEADER_SPEC: ComponentSpec = {
  tag: "ProfileHeader",
  authoringRole: "surface",
  whenToUse: "Open a personal profile, resume or bio surface with identity and primary actions.",
  props: {
    name: {
      type: "string",
      required: true,
      guidance: "The visible person or brand name.",
    },
    role: {
      type: "string",
      guidance: "Short role, category or availability line.",
    },
    summary: {
      type: "string",
      guidance: "One or two sentences that explain the profile at a glance.",
    },
    align: {
      type: "string",
      enum: ["start", "center"],
      default: "center",
      guidance: "Whether the identity block starts on the left or centers in the page.",
    },
    tone: {
      type: "string",
      enum: ["neutral", "accent", "inverse"],
      default: "neutral",
      guidance: "The profile mood: ordinary, brand-accented or high contrast.",
    },
  },
  acceptsChildren: true,
  themeRecipe: {
    tokens: {
      background: "color",
      text: "color",
      mutedText: "color",
      border: "color",
      radius: "length",
      padding: "length",
      nameFontSize: "length",
      nameFontWeight: "fontWeight",
      summaryFontSize: "length",
    },
  },
};

export const PRODUCT_SHOWCASE_SPEC: ComponentSpec = {
  tag: "ProductShowcase",
  authoringRole: "surface",
  whenToUse: "Present one product, offer or service with a strong title and supporting actions.",
  props: {
    title: {
      type: "string",
      required: true,
      guidance: "The product, offer or service name.",
    },
    description: {
      type: "string",
      guidance: "Supporting copy explaining the offer or product value.",
    },
    eyebrow: {
      type: "string",
      guidance: "Short category, launch state or collection label above the title.",
    },
    meta: {
      type: "string",
      guidance: "Optional price, date, spec or compact product detail.",
    },
    tone: {
      type: "string",
      enum: ["neutral", "accent", "inverse"],
      default: "accent",
      guidance: "How strongly the product showcase should lead the page.",
    },
  },
  acceptsChildren: true,
  themeRecipe: {
    tokens: {
      background: "color",
      text: "color",
      mutedText: "color",
      border: "color",
      radius: "length",
      padding: "length",
      visualBg: "color",
      titleFontSize: "length",
      titleFontWeight: "fontWeight",
    },
  },
};

export const VISUAL_PANEL_SPEC: ComponentSpec = {
  tag: "VisualPanel",
  authoringRole: "surface",
  whenToUse:
    "Create a graphic color panel with large text, numbers or proof without external media.",
  props: {
    title: {
      type: "string",
      required: true,
      guidance: "The main visible text inside the visual block.",
    },
    value: {
      type: "string",
      guidance: "Optional large value, label or short product signal.",
    },
    caption: {
      type: "string",
      guidance: "Optional supporting caption shown under the main text.",
    },
    tone: {
      type: "string",
      enum: ["brand", "accent", "warm", "inverse"],
      default: "brand",
      guidance: "The visual color mood.",
    },
    scale: {
      type: "string",
      enum: ["compact", "hero"],
      default: "compact",
      guidance: "Whether the block is a small tile or a large first-impression panel.",
    },
  },
  acceptsChildren: true,
  themeRecipe: {
    tokens: {
      background: "color",
      text: "color",
      mutedText: "color",
      border: "color",
      radius: "length",
      padding: "length",
      titleFontSize: "length",
      valueFontSize: "length",
      valueFontWeight: "fontWeight",
    },
  },
};

export const MEDIA_CARD_SPEC: ComponentSpec = {
  tag: "MediaCard",
  authoringRole: "surface",
  whenToUse:
    "Show a visual product, work, article or media item with image-like structure but no external URL.",
  props: {
    title: {
      type: "string",
      required: true,
      guidance: "Visible title for the media, product, article or work item.",
    },
    description: {
      type: "string",
      guidance: "Optional short supporting copy under the title.",
    },
    eyebrow: {
      type: "string",
      guidance: "Optional compact category, collection, status or issue label.",
    },
    meta: {
      type: "string",
      guidance: "Optional small detail such as date, price, medium or edition.",
    },
    tone: {
      type: "string",
      enum: ["neutral", "brand", "accent", "inverse"],
      default: "neutral",
      guidance: "The media card mood: quiet, brand-led, accent-led or high contrast.",
    },
    aspect: {
      type: "string",
      enum: ["wide", "square", "tall"],
      default: "wide",
      guidance: "The visual area ratio: wide, square, or tall editorial framing.",
    },
  },
  acceptsChildren: true,
  themeRecipe: {
    tokens: {
      background: "color",
      text: "color",
      mutedText: "color",
      border: "color",
      radius: "length",
      padding: "length",
      visualBg: "color",
      visualText: "color",
      titleFontSize: "length",
    },
  },
};

export const STAT_STRIP_SPEC: ComponentSpec = {
  tag: "StatStrip",
  authoringRole: "surface",
  whenToUse:
    "Show a horizontal strip of metrics or compact proof points outside card-heavy layouts.",
  props: {
    title: {
      type: "string",
      guidance: "Optional heading for the strip.",
    },
    columns: {
      type: "number",
      minimum: 2,
      maximum: 4,
      default: 3,
      guidance: "Preferred number of columns on a wide viewport.",
    },
    tone: {
      type: "string",
      enum: ["neutral", "accent", "inverse"],
      default: "neutral",
      guidance: "How strongly the strip separates from surrounding content.",
    },
  },
  acceptsChildren: true,
  themeRecipe: {
    tokens: {
      background: "color",
      text: "color",
      border: "color",
      radius: "length",
      padding: "length",
      gap: "length",
      titleColor: "color",
    },
  },
};

export const GALLERY_SPEC: ComponentSpec = {
  tag: "Gallery",
  authoringRole: "surface",
  whenToUse:
    "Arrange selected work, products or media-like cards in a portfolio grid without URLs.",
  props: {
    title: {
      type: "string",
      guidance: "Optional heading for the gallery.",
    },
    columns: {
      type: "number",
      minimum: 2,
      maximum: 4,
      default: 3,
      guidance: "Preferred column count on a wide viewport.",
    },
    rhythm: {
      type: "string",
      enum: ["even", "editorial"],
      default: "editorial",
      guidance: "Whether gallery items read evenly or with a more editorial rhythm.",
    },
  },
  acceptsChildren: true,
  themeRecipe: {
    tokens: {
      background: "color",
      text: "color",
      border: "color",
      radius: "length",
      padding: "length",
      gap: "length",
      titleColor: "color",
    },
  },
};

export const SOCIAL_LINKS_SPEC: ComponentSpec = {
  tag: "SocialLinks",
  authoringRole: "surface",
  whenToUse: "Group social, profile, portfolio or contact actions in a compact link row or stack.",
  props: {
    title: {
      type: "string",
      guidance: "Optional visible label for the social or profile links.",
    },
    align: {
      type: "string",
      enum: ["start", "center"],
      default: "center",
      guidance: "Whether the link group starts on the left or centers in the available width.",
    },
    density: {
      type: "string",
      enum: ["compact", "comfortable"],
      default: "comfortable",
      guidance: "How tightly the child link actions are spaced.",
    },
    tone: {
      type: "string",
      enum: ["neutral", "accent", "inverse"],
      default: "neutral",
      guidance: "The link-group mood: quiet, brand-accented or high contrast.",
    },
  },
  acceptsChildren: true,
  themeRecipe: {
    tokens: {
      background: "color",
      text: "color",
      border: "color",
      radius: "length",
      padding: "length",
      gap: "length",
      titleColor: "color",
    },
  },
};

export const TIMELINE_SPEC: ComponentSpec = {
  tag: "Timeline",
  authoringRole: "surface",
  whenToUse: "Show resume history, process steps or milestones in a clear vertical sequence.",
  props: {
    title: {
      type: "string",
      guidance: "Optional heading for the sequence.",
    },
    tone: {
      type: "string",
      enum: ["neutral", "accent"],
      default: "neutral",
      guidance: "Whether the sequence is quiet or brand-highlighted.",
    },
  },
  acceptsChildren: true,
  themeRecipe: {
    tokens: {
      text: "color",
      mutedText: "color",
      line: "color",
      markerBg: "color",
      markerText: "color",
      gap: "length",
      titleColor: "color",
    },
  },
};

export const SIDE_NAV_SPEC: ComponentSpec = {
  tag: "SideNav",
  authoringRole: "surface",
  whenToUse: "Frame workspace, admin or app screens with a vertical navigation rail.",
  props: {
    title: {
      type: "string",
      guidance: "Optional product, workspace or section title at the top of the rail.",
    },
    label: {
      type: "string",
      guidance: "Optional smaller context label under the title.",
    },
    tone: {
      type: "string",
      enum: ["neutral", "accent", "inverse"],
      default: "neutral",
      guidance: "The side rail mood: quiet, brand-accented or high contrast.",
    },
  },
  acceptsChildren: true,
  themeRecipe: {
    tokens: {
      background: "color",
      text: "color",
      mutedText: "color",
      border: "color",
      radius: "length",
      width: "length",
      padding: "length",
      gap: "length",
      titleFontSize: "length",
    },
  },
};

export const SIDE_NAV_ITEM_SPEC: ComponentSpec = {
  tag: "SideNavItem",
  authoringRole: "interaction",
  whenToUse:
    "Add one row-style destination or command inside a SideNav. Use Button for standalone CTAs.",
  props: {
    label: {
      type: "string",
      required: true,
      guidance: "Visible row label for the navigation destination or command.",
    },
    action: {
      type: "string",
      required: true,
      guidance:
        "What activating it does: `nav:<screen>` to move screens or `agent:<event>` to send an event.",
    },
    mark: {
      type: "string",
      guidance:
        "Optional short icon-like mark shown before the label, such as an initial or number.",
    },
    meta: {
      type: "string",
      guidance: "Optional trailing count, status, or short context label.",
    },
    active: {
      type: "boolean",
      default: false,
      guidance: "Whether this row is the current destination.",
    },
  },
  acceptsChildren: false,
  themeRecipe: {
    tokens: {
      background: "color",
      text: "color",
      mutedText: "color",
      border: "color",
      activeBg: "color",
      activeText: "color",
      activeBorder: "color",
      inverseText: "color",
      inverseMutedText: "color",
      inverseActiveBg: "color",
      inverseActiveText: "color",
      inverseActiveBorder: "color",
      radius: "length",
      paddingBlock: "length",
      paddingInline: "length",
      gap: "length",
      markSize: "length",
    },
  },
};

export const FOOTER_SPEC: ComponentSpec = {
  tag: "Footer",
  authoringRole: "surface",
  whenToUse: "Close a website or app surface with compact identity text and child actions.",
  props: {
    title: {
      type: "string",
      guidance: "Optional closing brand, person or product name.",
    },
    description: {
      type: "string",
      guidance: "Optional short closing line.",
    },
    tone: {
      type: "string",
      enum: ["neutral", "inverse"],
      default: "neutral",
      guidance: "Whether the footer is quiet or high contrast.",
    },
  },
  acceptsChildren: true,
  themeRecipe: {
    tokens: {
      background: "color",
      text: "color",
      mutedText: "color",
      border: "color",
      radius: "length",
      padding: "length",
      titleFontSize: "length",
    },
  },
};

export const EXPRESSION_SPECS: readonly ComponentSpec[] = Object.freeze([
  LOGO_MARK_SPEC,
  NAV_SPEC,
  SIDE_NAV_SPEC,
  SIDE_NAV_ITEM_SPEC,
  SECTION_SPEC,
  DIVIDER_SPEC,
  HERO_SPEC,
  AVATAR_SPEC,
  PROFILE_HEADER_SPEC,
  PRODUCT_SHOWCASE_SPEC,
  VISUAL_PANEL_SPEC,
  MEDIA_CARD_SPEC,
  LINK_LIST_SPEC,
  SOCIAL_LINKS_SPEC,
  FEATURE_LIST_SPEC,
  STAT_STRIP_SPEC,
  GALLERY_SPEC,
  TESTIMONIAL_SPEC,
  TIMELINE_SPEC,
  CTA_SPEC,
  ALERT_SPEC,
  PROGRESS_SPEC,
  FOOTER_SPEC,
]);
