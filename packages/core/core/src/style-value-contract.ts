import {
  ALIGNMENTS,
  ASPECT_RATIOS,
  BOOLEAN_VALUES,
  BORDER_WIDTHS,
  CHART_THICKNESSES,
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
  LETTER_SPACINGS,
  LINE_HEIGHTS,
  LOADING_ANIMATIONS,
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
  WIDTHS,
} from "./tokens.js";
import type { BrickStylePropertyContract } from "./brick-contract.js";

export type StyleValue = string | number | boolean;

export interface StyleValueMetadata<T extends StyleValue = StyleValue> {
  readonly name: T;
  readonly description: string;
  readonly useWhen: string;
  readonly avoidWhen?: string;
}

export interface StyleValueDomain<T extends StyleValue = StyleValue> {
  readonly description: string;
  readonly values: readonly StyleValueMetadata<T>[];
}

type MetadataRow<T extends StyleValue> =
  | readonly [name: T, description: string, useWhen: string]
  | readonly [name: T, description: string, useWhen: string, avoidWhen: string];

function defineDomain<const T extends StyleValue>(
  description: string,
  names: readonly T[],
  rows: readonly MetadataRow<T>[],
): StyleValueDomain<T> {
  const values = rows.map((row): StyleValueMetadata<T> => {
    const [name, valueDescription, useWhen, avoidWhen] = row;
    return avoidWhen === undefined
      ? { name, description: valueDescription, useWhen }
      : { name, description: valueDescription, useWhen, avoidWhen };
  });

  if (values.length !== names.length || values.some(({ name }, index) => name !== names[index])) {
    throw new Error(`Style value metadata does not match the ${description} domain.`);
  }

  return { description, values };
}

const sizeRows = <const T extends "sm" | "md" | "lg">(
  names: readonly [T, T, T],
  subject: string,
): readonly MetadataRow<T>[] => [
  [names[0], `Compact ${subject}.`, `Use when ${subject} should consume less visual space.`],
  [names[1], `Standard ${subject}.`, `Use for the normal ${subject} in most interfaces.`],
  [names[2], `Emphasized ${subject}.`, `Use when ${subject} needs stronger visual presence.`],
];

export const TOKEN_STYLE_VALUE_CONTRACT = {
  space: defineDomain("Spacing scale", SPACES, [
    [
      "none",
      "No spacing.",
      "Use when adjacent content must touch or a container should add no inset.",
    ],
    [
      "xs",
      "Smallest nonzero spacing.",
      "Use for very tight relationships between compact elements.",
    ],
    ["sm", "Compact spacing.", "Use within tightly grouped controls or labels."],
    ["md", "Standard spacing.", "Use as the default separation for related content."],
    ["lg", "Comfortable spacing.", "Use between distinct groups within one section."],
    ["xl", "Large section spacing.", "Use to separate major content regions."],
    ["2xl", "Largest standard spacing.", "Use for strong section or page-level separation."],
  ]),
  fontSize: defineDomain("Type size scale", FONT_SIZES, [
    ["xs", "Smallest type size.", "Use for tertiary captions or dense supporting metadata."],
    ["sm", "Compact type size.", "Use for secondary labels and supporting copy."],
    ["md", "Standard body type size.", "Use for normal reading and control labels."],
    ["lg", "Emphasized body type size.", "Use for lead text or small headings."],
    ["xl", "Section-heading type size.", "Use for a clear section title."],
    ["2xl", "Large heading type size.", "Use for prominent titles within a page."],
    ["3xl", "Display type size.", "Use for a primary page or feature heading."],
    ["4xl", "Largest display type size.", "Use sparingly for the strongest page-level message."],
  ]),
  fontFamily: defineDomain("Font family roles", FONT_FAMILIES, [
    ["sans", "Neutral sans-serif family.", "Use for general interface and body text."],
    [
      "serif",
      "Editorial serif family.",
      "Use when long-form or expressive text benefits from an editorial tone.",
    ],
    ["mono", "Monospaced family.", "Use for code, identifiers, or aligned technical values."],
  ]),
  fontWeight: defineDomain("Font weight scale", FONT_WEIGHTS, [
    ["regular", "Normal text emphasis.", "Use for body copy and ordinary labels."],
    ["medium", "Slightly emphasized text.", "Use for controls or labels needing modest emphasis."],
    ["semibold", "Strong text emphasis.", "Use for headings and important labels."],
    ["bold", "Strongest standard weight.", "Use sparingly for primary emphasis."],
  ]),
  radius: defineDomain("Corner radius scale", RADII, [
    ["none", "Square corners.", "Use for flush surfaces or strict geometric treatments."],
    ["sm", "Subtle rounding.", "Use on compact controls and restrained surfaces."],
    ["md", "Standard rounding.", "Use for ordinary panels and controls."],
    ["lg", "Prominent rounding.", "Use for large cards or friendly emphasis."],
    [
      "full",
      "Fully rounded shape.",
      "Use for pills and circular indicators.",
      "Avoid on large text containers.",
    ],
  ]),
  borderWidth: defineDomain("Border thickness scale", BORDER_WIDTHS, [
    ["none", "No visible border.", "Use when separation comes from spacing, fill, or shadow."],
    ["thin", "Subtle border.", "Use for standard outlines and dividers."],
    ["medium", "Emphasized border.", "Use for selected or focused boundaries."],
    ["thick", "Strong border.", "Use sparingly for high-emphasis boundaries."],
  ]),
  aspectRatio: defineDomain("Media aspect ratios", ASPECT_RATIOS, [
    ["auto", "Preserve the content's natural ratio.", "Use when source dimensions should lead."],
    ["square", "Equal width and height.", "Use for avatars, thumbnails, and compact previews."],
    ["landscape", "Standard horizontal frame.", "Use for common landscape imagery."],
    ["portrait", "Vertical frame.", "Use for portrait imagery or poster-like media."],
    ["wide", "Extra-wide horizontal frame.", "Use for banners and cinematic media."],
  ]),
  minHeight: defineDomain("Minimum section height", MIN_HEIGHTS, [
    ["auto", "Content-led minimum height.", "Use for ordinary sections."],
    [
      "half",
      "Substantial partial-screen height.",
      "Use for prominent bands that need breathing room.",
    ],
    ["screen", "Screen-filling minimum height.", "Use for hero or focused landing sections."],
  ]),
  maxWidth: defineDomain("Readable maximum width", MAX_WIDTHS, [
    [
      "none",
      "No named maximum width.",
      "Use when the parent should determine the available width.",
    ],
    ["prose", "Reading-focused width.", "Use for long-form text."],
    ["narrow", "Compact content width.", "Use for forms, dialogs, and focused summaries."],
    ["wide", "Broad bounded width.", "Use for dashboards and multi-column content."],
  ]),
  letterSpacing: defineDomain("Letter spacing scale", LETTER_SPACINGS, [
    ["tight", "Condensed letter spacing.", "Use sparingly for large or dense headings."],
    ["normal", "Default letter spacing.", "Use for most readable text."],
    ["wide", "Expanded letter spacing.", "Use for short labels or deliberate display emphasis."],
  ]),
  lineHeight: defineDomain("Line height scale", LINE_HEIGHTS, [
    ["tight", "Compact line height.", "Use for headings and short labels."],
    ["normal", "Standard line height.", "Use for ordinary interface copy."],
    ["relaxed", "Open line height.", "Use for longer prose or spacious text."],
  ]),
  controlHeight: defineDomain(
    "Control height scale",
    CONTROL_HEIGHTS,
    sizeRows(CONTROL_HEIGHTS, "control height"),
  ),
  indicatorSize: defineDomain(
    "Indicator size scale",
    INDICATOR_SIZES,
    sizeRows(INDICATOR_SIZES, "indicator size"),
  ),
  progressThickness: defineDomain(
    "Progress track thickness",
    PROGRESS_THICKNESSES,
    sizeRows(PROGRESS_THICKNESSES, "progress track"),
  ),
  chartThickness: defineDomain(
    "Chart mark thickness",
    CHART_THICKNESSES,
    sizeRows(CHART_THICKNESSES, "chart mark"),
  ),
  color: defineDomain("Semantic color roles", COLORS, [
    ["background", "Page background role.", "Use for the outermost canvas or page-level surface."],
    ["surface", "Standard raised surface role.", "Use for cards, panels, and controls."],
    ["mutedSurface", "Subdued surface role.", "Use for secondary regions and quiet fills."],
    ["foreground", "Primary foreground role.", "Use for normal high-legibility text and icons."],
    [
      "mutedForeground",
      "Secondary foreground role.",
      "Use for supporting text and lower-emphasis icons.",
    ],
    ["border", "Neutral boundary role.", "Use for ordinary outlines and dividers."],
    ["accent", "Primary brand action role.", "Use for key actions and selected emphasis."],
    ["accentSurface", "Soft accent surface role.", "Use for selected or highlighted backgrounds."],
    [
      "accentForeground",
      "Foreground on accent role.",
      "Use for content placed on a strong accent fill.",
    ],
    ["focusRing", "Keyboard focus indicator role.", "Use for focus borders and rings."],
    ["success", "Positive status role.", "Use for successful outcomes and positive indicators."],
    [
      "successSurface",
      "Soft positive surface role.",
      "Use for success banners or status backgrounds.",
    ],
    [
      "successForeground",
      "Foreground on positive surfaces.",
      "Use for readable content on success fills.",
    ],
    ["warning", "Caution status role.", "Use for conditions requiring attention without failure."],
    [
      "warningSurface",
      "Soft caution surface role.",
      "Use for warning banners or status backgrounds.",
    ],
    [
      "warningForeground",
      "Foreground on caution surfaces.",
      "Use for readable content on warning fills.",
    ],
    [
      "danger",
      "Destructive or error role.",
      "Use for errors, destructive actions, and critical states.",
    ],
    [
      "dangerSurface",
      "Soft danger surface role.",
      "Use for error banners or destructive-state backgrounds.",
    ],
    [
      "dangerForeground",
      "Foreground on danger surfaces.",
      "Use for readable content on danger fills.",
    ],
    ["info", "Informational status role.", "Use for neutral notices and informational indicators."],
    [
      "infoSurface",
      "Soft informational surface role.",
      "Use for informational banners or backgrounds.",
    ],
    [
      "infoForeground",
      "Foreground on informational surfaces.",
      "Use for readable content on information fills.",
    ],
    ["chart1", "First categorical chart role.", "Use for the first data series."],
    ["chart2", "Second categorical chart role.", "Use for the second data series."],
    ["chart3", "Third categorical chart role.", "Use for the third data series."],
    ["chart4", "Fourth categorical chart role.", "Use for the fourth data series."],
    ["chart5", "Fifth categorical chart role.", "Use for the fifth data series."],
    ["chart6", "Sixth categorical chart role.", "Use for the sixth data series."],
    [
      "inherit",
      "Inherit the nearest applicable foreground role.",
      "Use only where the Brick contract explicitly permits color inheritance.",
    ],
  ]),
  shadow: defineDomain("Mode-sensitive elevation", SHADOWS, [
    ["none", "No shadow.", "Use for flat or already separated surfaces."],
    ["sm", "Subtle elevation.", "Use for lightly raised controls or cards."],
    ["md", "Standard elevation.", "Use for prominent panels and floating content."],
    ["lg", "Strong elevation.", "Use sparingly for the highest floating layer."],
  ]),
  gradient: defineDomain("Mode-sensitive semantic gradients", GRADIENTS, [
    ["none", "No gradient.", "Use when a flat background is clearer."],
    ["accent", "Brand-accent gradient.", "Use for primary promotional emphasis."],
    ["success", "Positive-status gradient.", "Use for celebratory positive emphasis."],
    ["warning", "Caution gradient.", "Use sparingly for prominent caution."],
    ["danger", "Critical-status gradient.", "Use sparingly for destructive or error emphasis."],
    ["info", "Informational gradient.", "Use for prominent neutral information."],
  ]),
  scrim: defineDomain("Mode-sensitive backdrop scrims", SCRIMS, [
    ["none", "No backdrop scrim.", "Use when foreground content is already legible."],
    ["soft", "Subtle backdrop scrim.", "Use to improve legibility while preserving the backdrop."],
    [
      "strong",
      "Strong backdrop scrim.",
      "Use when busy media needs decisive foreground separation.",
    ],
  ]),
  highlight: defineDomain("Mode-sensitive text highlights", HIGHLIGHTS, [
    ["none", "No highlight treatment.", "Use for ordinary text."],
    ["accent", "Brand-accent highlight.", "Use for a key phrase or selected text role."],
    ["warning", "Caution highlight.", "Use sparingly for text requiring attention."],
  ]),
} as const;

export const FIXED_STYLE_VALUE_CONTRACT = {
  direction: defineDomain("Flow direction", DIRECTIONS, [
    [
      "row",
      "Lay children along the inline axis.",
      "Use for horizontal groups that may wrap safely.",
    ],
    ["column", "Stack children along the block axis.", "Use for vertical sections and forms."],
  ]),
  alignment: defineDomain("Cross-axis alignment", ALIGNMENTS, [
    ["start", "Align content to the cross-axis start.", "Use for ordinary leading alignment."],
    ["center", "Center content on the cross axis.", "Use for symmetric compact groups."],
    ["end", "Align content to the cross-axis end.", "Use for trailing alignment."],
    [
      "stretch",
      "Stretch content across the cross axis.",
      "Use when siblings should fill the available cross size.",
    ],
  ]),
  justification: defineDomain("Main-axis distribution", JUSTIFICATIONS, [
    ["start", "Pack content at the main-axis start.", "Use for normal sequential flow."],
    ["center", "Center content on the main axis.", "Use for balanced focused groups."],
    ["end", "Pack content at the main-axis end.", "Use for trailing actions or summaries."],
    [
      "between",
      "Distribute free space between items.",
      "Use for separated endpoints such as title and action.",
    ],
    ["around", "Distribute free space around items.", "Use for evenly spaced compact groups."],
  ]),
  boolean: defineDomain("Boolean style switches", BOOLEAN_VALUES, [
    [
      false,
      "Disable the named behavior.",
      "Use when the Brick should keep its ordinary flow behavior.",
    ],
    [
      true,
      "Enable the named behavior.",
      "Use only when the Brick property explicitly offers the switch.",
    ],
  ]),
  width: defineDomain("Bounded width behavior", WIDTHS, [
    ["auto", "Use content or parent-led width.", "Use for ordinary flow sizing."],
    [
      "fit",
      "Use intrinsic content width while staying bounded by the parent.",
      "Use for compact pills, badges, or controls that should not fill a full row.",
    ],
    ["full", "Fill the available parent width.", "Use for full-row controls or sections."],
  ]),
  scroll: defineDomain("Bounded internal scrolling", SCROLLS, [
    ["none", "Do not create an internal scroll region.", "Use for normal document flow."],
    [
      "horizontal",
      "Allow bounded horizontal scrolling.",
      "Use for wide tables or sequences that must stay contained.",
    ],
    [
      "vertical",
      "Allow bounded vertical scrolling.",
      "Use for intentionally bounded long content.",
    ],
  ]),
  columns: defineDomain("Flow-safe column count", COLUMNS, [
    ["none", "Do not create a column grid.", "Use for ordinary row or column flow."],
    [2, "Two equal flow columns.", "Use for paired content with enough available width."],
    [3, "Three equal flow columns.", "Use for compact repeated content on wider surfaces."],
    [4, "Four equal flow columns.", "Use sparingly for dense repeated content on wide surfaces."],
  ]),
  textAlign: defineDomain("Text alignment", TEXT_ALIGNS, [
    ["start", "Align text to the reading start.", "Use for most readable copy."],
    ["center", "Center text lines.", "Use for short, symmetric display copy."],
    ["end", "Align text to the reading end.", "Use for compact trailing values."],
  ]),
  fontStyle: defineDomain("Font posture", FONT_STYLES, [
    ["normal", "Use the normal font posture.", "Use for ordinary text."],
    [
      "italic",
      "Use an italic posture.",
      "Use for short emphasis or conventional secondary notation.",
    ],
  ]),
  objectFit: defineDomain("Media fitting", OBJECT_FITS, [
    [
      "cover",
      "Fill the frame and crop overflow.",
      "Use when the frame shape matters more than showing every edge.",
    ],
    ["contain", "Show the complete media within the frame.", "Use when no content may be cropped."],
  ]),
  objectPosition: defineDomain("Media focal position", OBJECT_POSITIONS, [
    ["center", "Center the media focal area.", "Use as the neutral default."],
    [
      "top",
      "Bias the focal area to the top.",
      "Use when important content sits near the top edge.",
    ],
    [
      "bottom",
      "Bias the focal area to the bottom.",
      "Use when important content sits near the bottom edge.",
    ],
    [
      "start",
      "Bias the focal area to the reading start.",
      "Use when important content sits near the leading edge.",
    ],
    [
      "end",
      "Bias the focal area to the reading end.",
      "Use when important content sits near the trailing edge.",
    ],
  ]),
  enterAnimation: defineDomain("Entry motion", ENTER_ANIMATIONS, [
    ["none", "No entry motion.", "Use for static or frequently changing content."],
    ["fade", "Fade content into view.", "Use for restrained entry emphasis."],
    ["slide", "Slide content into view.", "Use sparingly for stronger directional entry emphasis."],
  ]),
  animation: defineDomain("Loading indicator motion", LOADING_ANIMATIONS, [
    [
      "none",
      "No loading motion.",
      "Use when motion would distract or a static indicator is sufficient.",
    ],
    [
      "pulse",
      "Pulse the loading indicator.",
      "Use for an active waiting state; reduced-motion handling remains renderer-owned.",
    ],
  ]),
} as const;

/** Serializable, CSS-free metadata used by Brick discovery. */
export const STYLE_VALUE_CONTRACT = {
  tokens: TOKEN_STYLE_VALUE_CONTRACT,
  fixed: FIXED_STYLE_VALUE_CONTRACT,
} as const;

const TOKEN_DOMAINS: Readonly<Record<string, StyleValueDomain>> = TOKEN_STYLE_VALUE_CONTRACT;
const FIXED_DOMAINS: Readonly<Record<string, StyleValueDomain>> = FIXED_STYLE_VALUE_CONTRACT;

/** Resolves the closed value domain named by one Brick-owned style property. */
export function styleValueDomainForProperty(
  property: BrickStylePropertyContract,
): StyleValueDomain | undefined {
  return (property.source === "token" ? TOKEN_DOMAINS : FIXED_DOMAINS)[property.domain];
}

/** Returns the exact values valid for one property, including property-specific restrictions. */
export function styleValueChoicesForProperty(
  propertyName: string,
  property: BrickStylePropertyContract,
): readonly StyleValueMetadata[] {
  const values = styleValueDomainForProperty(property)?.values ?? [];
  return propertyName === "color" ? values : values.filter(({ name }) => name !== "inherit");
}

export function styleValueNamesForProperty(
  propertyName: string,
  property: BrickStylePropertyContract,
): readonly StyleValue[] {
  return styleValueChoicesForProperty(propertyName, property).map(({ name }) => name);
}

export function isStyleValueAllowedForProperty(
  propertyName: string,
  property: BrickStylePropertyContract,
  value: unknown,
): value is StyleValue {
  return styleValueChoicesForProperty(propertyName, property).some((candidate) =>
    Object.is(candidate.name, value),
  );
}
