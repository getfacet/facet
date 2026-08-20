/** Trusted React implementations for the default content, media, and data components. */

import { BOUNDS, type MountedComponent } from "@facet/core";
import { Children } from "react";
import type { ReactNode } from "react";

import type { FlowStyle } from "./style.js";
import {
  arrayProp,
  countProp,
  enumProp,
  finiteNumberProp,
  flowStyle,
  foundation,
  imageAssetProp,
  mountStyle,
  numberProp,
  recipe,
  semantic,
  stringProp,
  textProp,
} from "./style.js";

const NUMBER_FORMAT = new Intl.NumberFormat("en-US");

const TEXT_VARIANTS = {
  title: {
    fontSize: recipe("text", "titleFontSize"),
    fontWeight: recipe("text", "titleFontWeight"),
    lineHeight: foundation("typography", "lineHeightTight"),
  },
  heading: {
    fontSize: recipe("text", "headingFontSize"),
    fontWeight: recipe("text", "headingFontWeight"),
    lineHeight: foundation("typography", "lineHeightTight"),
  },
  body: {
    fontSize: recipe("text", "bodyFontSize"),
    fontWeight: foundation("typography", "fontWeightRegular"),
    lineHeight: foundation("typography", "lineHeightNormal"),
  },
  caption: {
    fontSize: recipe("text", "captionFontSize"),
    fontWeight: foundation("typography", "fontWeightRegular"),
    lineHeight: foundation("typography", "lineHeightNormal"),
  },
} as const;

const TEXT_VARIANTS_LIST = Object.keys(TEXT_VARIANTS) as readonly (keyof typeof TEXT_VARIANTS)[];

export const Text: MountedComponent<ReactNode, ReactNode> = ({ props, themeVars }) => {
  const value = stringProp(props, "value", "");
  const variant = enumProp(props, "variant", TEXT_VARIANTS_LIST, "body");
  const tone = enumProp(props, "tone", ["default", "muted"] as const, "default");
  const scale = TEXT_VARIANTS[variant];
  const style = mountStyle(themeVars, {
    margin: 0,
    overflowWrap: "anywhere",
    fontFamily: foundation("typography", "fontFamilySans"),
    fontSize: scale.fontSize,
    fontWeight: scale.fontWeight,
    lineHeight: scale.lineHeight,
    color: tone === "muted" ? recipe("text", "mutedText") : recipe("text", "defaultText"),
  });

  if (variant === "title")
    return (
      <h1 data-facet-component="Text" style={style}>
        {value}
      </h1>
    );
  if (variant === "heading")
    return (
      <h2 data-facet-component="Text" style={style}>
        {value}
      </h2>
    );
  return (
    <p data-facet-component="Text" style={style}>
      {value}
    </p>
  );
};

const AVATAR_SIZES = {
  sm: {
    size: foundation("size", "controlHeightSm"),
    fontSize: foundation("typography", "fontSizeXs"),
  },
  md: { size: recipe("avatar", "size"), fontSize: recipe("avatar", "fontSize") },
  lg: {
    size: foundation("size", "controlHeightXl"),
    fontSize: foundation("typography", "fontSize2xl"),
  },
} as const;

const AVATAR_SIZE_LIST = Object.keys(AVATAR_SIZES) as readonly (keyof typeof AVATAR_SIZES)[];

const AVATAR_TONES = {
  neutral: {
    background: semantic("surface", "muted"),
    text: semantic("text", "default"),
    border: semantic("border", "default"),
  },
  accent: {
    background: recipe("avatar", "background"),
    text: recipe("avatar", "text"),
    border: recipe("avatar", "border"),
  },
  warm: {
    background: semantic("status", "warningBg"),
    text: semantic("status", "warningText"),
    border: semantic("status", "warningBorder"),
  },
  cool: {
    background: semantic("status", "infoBg"),
    text: semantic("status", "infoText"),
    border: semantic("status", "infoBorder"),
  },
} as const;

const AVATAR_TONE_LIST = Object.keys(AVATAR_TONES) as readonly (keyof typeof AVATAR_TONES)[];

function firstCharacters(value: string, maximum: number): string {
  return Array.from(value).slice(0, maximum).join("");
}

function avatarInitials(label: string, authored: string | undefined): string {
  const explicit = authored?.replace(/\s+/gu, "").toLocaleUpperCase("en-US");
  if (explicit !== undefined && explicit.length > 0) return firstCharacters(explicit, 3);
  return label
    .trim()
    .split(/\s+/u)
    .filter((part) => part.length > 0)
    .slice(0, 3)
    .map((part) => firstCharacters(part, 1))
    .join("")
    .toLocaleUpperCase("en-US");
}

export const Avatar: MountedComponent<ReactNode, ReactNode> = ({ props, themeVars }) => {
  const label = stringProp(props, "label", "");
  const initials = avatarInitials(label, textProp(props, "initials"));
  const size = AVATAR_SIZES[enumProp(props, "size", AVATAR_SIZE_LIST, "md")];
  const colors = AVATAR_TONES[enumProp(props, "tone", AVATAR_TONE_LIST, "accent")];

  return (
    <span
      data-facet-component="Avatar"
      role="img"
      aria-label={label}
      style={mountStyle(themeVars, {
        display: "inline-flex",
        boxSizing: "border-box",
        flex: "0 0 auto",
        alignItems: "center",
        justifyContent: "center",
        width: size.size,
        height: size.size,
        overflow: "hidden",
        border: `${foundation("borderWidth", "thin")} solid ${colors.border}`,
        borderRadius: recipe("avatar", "radius"),
        background: colors.background,
        color: colors.text,
        fontFamily: foundation("typography", "fontFamilySans"),
        fontSize: size.fontSize,
        fontWeight: recipe("avatar", "fontWeight"),
        lineHeight: 1,
      })}
    >
      <span aria-hidden="true">{initials}</span>
    </span>
  );
};

const ICON_PATHS: Readonly<Record<string, ReactNode>> = Object.freeze({
  check: <path d="m5 12 4 4L19 6" />,
  close: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6" />
      <path d="M12 7h.01" />
    </>
  ),
  warning: (
    <>
      <path d="M12 3 2.5 20h19L12 3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>
  ),
  star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" />,
  heart: (
    <path d="M20.8 5.8a5.4 5.4 0 0 0-7.7 0L12 6.9l-1.1-1.1a5.4 5.4 0 0 0-7.7 7.7L12 22l8.8-8.5a5.4 5.4 0 0 0 0-7.7Z" />
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 10h18" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  message: (
    <>
      <path d="M4 5h16v11H8l-4 4V5Z" />
      <path d="M8 9h8M8 12h5" />
    </>
  ),
  "arrow-right": (
    <>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </>
  ),
});

const ICON_SIZES = {
  sm: foundation("size", "iconSm"),
  md: foundation("size", "iconMd"),
  lg: foundation("size", "iconLg"),
} as const;

const ICON_SIZE_LIST = Object.keys(ICON_SIZES) as readonly (keyof typeof ICON_SIZES)[];

const ICON_TONES = {
  default: recipe("icon", "defaultText"),
  muted: recipe("icon", "mutedText"),
  accent: recipe("icon", "accentText"),
} as const;

const ICON_TONE_LIST = Object.keys(ICON_TONES) as readonly (keyof typeof ICON_TONES)[];

export const Icon: MountedComponent<ReactNode, ReactNode> = ({ props, themeVars }) => {
  const authoredName = stringProp(props, "name", "");
  const path = Object.hasOwn(ICON_PATHS, authoredName) ? ICON_PATHS[authoredName] : undefined;
  const label = textProp(props, "label");
  const size = ICON_SIZES[enumProp(props, "size", ICON_SIZE_LIST, "md")];
  const color = ICON_TONES[enumProp(props, "tone", ICON_TONE_LIST, "default")];

  return (
    <span
      data-facet-component="Icon"
      style={mountStyle(themeVars, {
        display: "inline-flex",
        flex: "0 0 auto",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        color,
      })}
    >
      {path === undefined ? null : (
        <svg
          viewBox="0 0 24 24"
          width={size}
          height={size}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          focusable="false"
          role={label === undefined ? undefined : "img"}
          aria-label={label}
          aria-hidden={label === undefined ? "true" : undefined}
        >
          {path}
        </svg>
      )}
    </span>
  );
};

const IMAGE_ASPECTS = {
  auto: undefined,
  square: "1 / 1",
  portrait: "3 / 4",
  landscape: "4 / 3",
  wide: "16 / 9",
} as const;

const IMAGE_ASPECT_LIST = Object.keys(IMAGE_ASPECTS) as readonly (keyof typeof IMAGE_ASPECTS)[];

export const Image: MountedComponent<ReactNode, ReactNode> = ({ props, themeVars }) => {
  const asset = imageAssetProp(props, "asset");
  const alt = stringProp(props, "alt", "");
  const aspect = enumProp(props, "aspect", IMAGE_ASPECT_LIST, "auto");
  const fit = enumProp(props, "fit", ["cover", "contain"] as const, "cover");
  const ratio = IMAGE_ASPECTS[aspect];

  return (
    <figure
      data-facet-component="Image"
      style={mountStyle(themeVars, {
        display: "block",
        boxSizing: "border-box",
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        margin: 0,
        overflow: "hidden",
        border: `${foundation("borderWidth", "thin")} solid ${recipe("image", "border")}`,
        borderRadius: recipe("image", "radius"),
        background: recipe("image", "background"),
        ...(ratio === undefined ? {} : { aspectRatio: ratio }),
      })}
    >
      {asset === undefined ? null : (
        <img
          src={asset.src}
          alt={alt}
          width={asset.width}
          height={asset.height}
          loading="lazy"
          decoding="async"
          style={flowStyle({
            display: "block",
            width: "100%",
            maxWidth: "100%",
            height: aspect === "auto" ? "auto" : "100%",
            objectFit: fit,
          })}
        />
      )}
    </figure>
  );
};

const BADGE_TONES = {
  neutral: {
    background: recipe("badge", "background"),
    border: recipe("badge", "border"),
    text: recipe("badge", "text"),
  },
  positive: {
    background: semantic("status", "successBg"),
    border: semantic("status", "successBorder"),
    text: semantic("status", "successText"),
  },
  warning: {
    background: semantic("status", "warningBg"),
    border: semantic("status", "warningBorder"),
    text: semantic("status", "warningText"),
  },
  danger: {
    background: semantic("status", "dangerBg"),
    border: semantic("status", "dangerBorder"),
    text: semantic("status", "dangerText"),
  },
} as const;

const BADGE_TONE_LIST = Object.keys(BADGE_TONES) as readonly (keyof typeof BADGE_TONES)[];

export const Badge: MountedComponent<ReactNode, ReactNode> = ({ props, themeVars }) => {
  const label = stringProp(props, "label", "");
  const colors = BADGE_TONES[enumProp(props, "tone", BADGE_TONE_LIST, "neutral")];

  return (
    <span
      data-facet-component="Badge"
      style={mountStyle(themeVars, {
        display: "inline-flex",
        boxSizing: "border-box",
        alignSelf: "flex-start",
        alignItems: "center",
        maxWidth: "100%",
        padding: `${recipe("badge", "paddingBlock")} ${recipe("badge", "paddingInline")}`,
        overflowWrap: "anywhere",
        border: `${foundation("borderWidth", "thin")} solid ${colors.border}`,
        borderRadius: recipe("badge", "radius"),
        background: colors.background,
        color: colors.text,
        fontFamily: foundation("typography", "fontFamilySans"),
        fontSize: foundation("typography", "fontSizeXs"),
        fontWeight: foundation("typography", "fontWeightMedium"),
        lineHeight: foundation("typography", "lineHeightTight"),
      })}
    >
      {label}
    </span>
  );
};

export const Metric: MountedComponent<ReactNode, ReactNode> = ({ props, themeVars }) => {
  const label = stringProp(props, "label", "");
  const rawValue = finiteNumberProp(props, "value");
  const unit = textProp(props, "unit");

  return (
    <dl
      data-facet-component="Metric"
      style={mountStyle(themeVars, {
        display: "flex",
        minWidth: 0,
        boxSizing: "border-box",
        flexDirection: "column",
        gap: foundation("space", "xs"),
        margin: 0,
        fontFamily: foundation("typography", "fontFamilySans"),
      })}
    >
      <dt
        style={flowStyle({
          overflowWrap: "anywhere",
          color: recipe("metric", "labelColor"),
          fontSize: recipe("metric", "labelFontSize"),
          fontWeight: foundation("typography", "fontWeightRegular"),
        })}
      >
        {label}
      </dt>
      <dd
        style={flowStyle({
          display: "flex",
          minWidth: 0,
          alignItems: "baseline",
          gap: foundation("space", "xs"),
          margin: 0,
          overflowWrap: "anywhere",
          color: recipe("metric", "valueColor"),
          fontSize: recipe("metric", "valueFontSize"),
          fontWeight: recipe("metric", "valueFontWeight"),
          lineHeight: foundation("typography", "lineHeightTight"),
        })}
      >
        <span>{rawValue === undefined ? "" : NUMBER_FORMAT.format(rawValue)}</span>
        {unit === undefined ? null : (
          <span
            style={flowStyle({
              color: recipe("metric", "labelColor"),
              fontSize: recipe("metric", "labelFontSize"),
              fontWeight: foundation("typography", "fontWeightMedium"),
            })}
          >
            {unit}
          </span>
        )}
      </dd>
    </dl>
  );
};

const METRIC_GROUP_TONES = {
  neutral: {
    background: recipe("metric-group", "background"),
    border: recipe("metric-group", "border"),
  },
  accent: {
    background: semantic("state", "selectedBg"),
    border: semantic("border", "focus"),
  },
} as const;

const METRIC_GROUP_TONE_LIST = Object.keys(
  METRIC_GROUP_TONES,
) as readonly (keyof typeof METRIC_GROUP_TONES)[];

export const MetricGroup: MountedComponent<ReactNode, ReactNode> = ({
  props,
  children,
  themeVars,
}) => {
  const title = textProp(props, "title");
  const columns = countProp(props, "columns", 1, 4, 3);
  const colors = METRIC_GROUP_TONES[enumProp(props, "tone", METRIC_GROUP_TONE_LIST, "neutral")];
  const gap = recipe("metric-group", "gap");
  const columnShare = `calc((100% - (${columns - 1} * ${gap})) / ${columns})`;

  return (
    <section
      data-facet-component="MetricGroup"
      style={mountStyle(themeVars, {
        minWidth: 0,
        padding: foundation("space", "md"),
        border: `${foundation("borderWidth", "thin")} solid ${colors.border}`,
        borderRadius: recipe("metric-group", "radius"),
        background: colors.background,
      })}
    >
      {title === undefined ? null : (
        <h2
          style={flowStyle({
            margin: `0 0 ${gap}`,
            overflowWrap: "anywhere",
            color: semantic("text", "default"),
            fontFamily: foundation("typography", "fontFamilySans"),
            fontSize: foundation("typography", "fontSizeLg"),
            fontWeight: foundation("typography", "fontWeightSemibold"),
          })}
        >
          {title}
        </h2>
      )}
      <div
        data-facet-content="metrics"
        style={flowStyle({
          display: "grid",
          minWidth: 0,
          gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, max(12rem, ${columnShare})), 1fr))`,
          gap,
        })}
      >
        {children}
      </div>
    </section>
  );
};

function safeOwnValue(row: unknown, key: string): unknown {
  try {
    if (typeof row !== "object" || row === null || Array.isArray(row)) return undefined;
    if (!Object.hasOwn(row, key)) return undefined;
    return (row as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function selectedColumns(value: string | undefined): readonly string[] {
  if (value === undefined) return [];
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const part of value.split(",")) {
    const column = part.trim();
    if (column.length === 0 || seen.has(column)) continue;
    seen.add(column);
    columns.push(column);
    if (columns.length >= BOUNDS.dataModelObjectKeys) break;
  }
  return columns;
}

function deriveColumns(rows: readonly unknown[], authored: string | undefined): readonly string[] {
  const selected = selectedColumns(authored);
  if (selected.length > 0) return selected;
  for (const row of rows) {
    try {
      if (typeof row !== "object" || row === null || Array.isArray(row)) continue;
      const columns = Object.keys(row)
        .slice(0, BOUNDS.dataModelObjectKeys)
        .filter((column) => {
          const value = safeOwnValue(row, column);
          return (
            typeof value === "string" ||
            typeof value === "boolean" ||
            (typeof value === "number" && Number.isFinite(value))
          );
        });
      if (columns.length > 0) return columns;
    } catch {
      continue;
    }
  }
  return [];
}

function cellText(row: unknown, column: string): string {
  const value = safeOwnValue(row, column);
  if (typeof value === "string" || typeof value === "boolean") return String(value);
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function usableTableRow(row: unknown, columns: readonly string[]): boolean {
  if (typeof row !== "object" || row === null || Array.isArray(row)) return false;
  return columns.some((column) => {
    const value = safeOwnValue(row, column);
    return (
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    );
  });
}

export const Table: MountedComponent<ReactNode, ReactNode> = ({ props, themeVars }) => {
  const rows = arrayProp(props, "rows");
  const caption = textProp(props, "caption");
  const columns = deriveColumns(rows, textProp(props, "columns"));
  const usableRows = rows.filter((row) => usableTableRow(row, columns));
  const cellStyle: FlowStyle = {
    maxWidth: foundation("size", "contentMeasureSm"),
    padding: recipe("table", "cellPadding"),
    overflowWrap: "anywhere",
    textAlign: "left",
    borderBottom: `${foundation("borderWidth", "thin")} solid ${recipe("table", "rowBorder")}`,
  };

  return (
    <div
      data-facet-component="Table"
      role="region"
      aria-label={caption ?? "Data table"}
      tabIndex={0}
      style={mountStyle(themeVars, {
        width: "100%",
        boxSizing: "border-box",
        maxWidth: "100%",
        minWidth: 0,
        overflowX: "auto",
        border: `${foundation("borderWidth", "thin")} solid ${recipe("table", "border")}`,
        borderRadius: recipe("table", "radius"),
        background: recipe("table", "background"),
      })}
    >
      <table
        style={flowStyle({
          width: "100%",
          minWidth: columns.length > 3 ? "max-content" : "100%",
          borderCollapse: "collapse",
          color: recipe("table", "text"),
          fontFamily: foundation("typography", "fontFamilySans"),
          fontSize: foundation("typography", "fontSizeSm"),
        })}
      >
        {caption === undefined ? null : (
          <caption
            style={flowStyle({
              padding: `${foundation("space", "sm")} ${foundation("space", "sm")} ${foundation("space", "xs")}`,
              color: recipe("table", "captionText"),
              fontSize: foundation("typography", "fontSizeXs"),
              fontWeight: foundation("typography", "fontWeightMedium"),
              textAlign: "left",
            })}
          >
            {caption}
          </caption>
        )}
        {columns.length === 0 ? null : (
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column}
                  scope="col"
                  style={flowStyle({
                    ...cellStyle,
                    color: recipe("table", "headerText"),
                    background: recipe("table", "headerBg"),
                    fontWeight: foundation("typography", "fontWeightMedium"),
                  })}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {columns.length === 0
            ? null
            : usableRows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {columns.map((column) => (
                    <td key={column} style={flowStyle(cellStyle)}>
                      {cellText(row, column)}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
};

interface ChartPoint {
  readonly label: string;
  readonly value: number;
}

interface PositionedChartPoint extends ChartPoint {
  readonly x: number;
  readonly y: number;
}

const CHART_WIDTH = 640;
const CHART_HEIGHT = 320;
const CHART_LEFT = 36;
const CHART_RIGHT = 16;
const CHART_TOP = 16;
const CHART_BOTTOM = 36;

function chartLabel(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "boolean") return String(value);
  return typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
}

function chartPoints(rows: readonly unknown[], xKey: string, yKey: string): readonly ChartPoint[] {
  if (xKey.length === 0 || yKey.length === 0) return [];
  const points: ChartPoint[] = [];
  for (const row of rows) {
    const label = chartLabel(safeOwnValue(row, xKey));
    const value = safeOwnValue(row, yKey);
    if (label === undefined || typeof value !== "number" || !Number.isFinite(value)) continue;
    points.push({ label, value });
    if (points.length === BOUNDS.renderedCollectionItems) break;
  }
  return points;
}

function positionChartPoints(points: readonly ChartPoint[]): {
  readonly points: readonly PositionedChartPoint[];
  readonly baseline: number;
  readonly plotWidth: number;
  readonly plotHeight: number;
} {
  const plotWidth = CHART_WIDTH - CHART_LEFT - CHART_RIGHT;
  const plotHeight = CHART_HEIGHT - CHART_TOP - CHART_BOTTOM;
  const values = points.map((point) => point.value);
  let minimum = Math.min(0, ...values);
  let maximum = Math.max(0, ...values);
  if (minimum === maximum) {
    minimum -= 1;
    maximum += 1;
  }
  const magnitude = Math.max(1, Math.abs(minimum), Math.abs(maximum));
  minimum /= magnitude;
  maximum /= magnitude;
  const range = maximum - minimum;
  const yFor = (value: number): number =>
    CHART_TOP + ((maximum - value / magnitude) / range) * plotHeight;
  const positioned = points.map((point, index) => ({
    ...point,
    x:
      points.length < 2
        ? CHART_LEFT + plotWidth / 2
        : CHART_LEFT + (index / (points.length - 1)) * plotWidth,
    y: yFor(point.value),
  }));
  return { points: positioned, baseline: yFor(0), plotWidth, plotHeight };
}

function chartPath(points: readonly PositionedChartPoint[]): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
}

function chartMarks(
  type: "bar" | "line" | "area",
  points: readonly PositionedChartPoint[],
  baseline: number,
  plotWidth: number,
): ReactNode {
  if (points.length === 0) return null;
  const path = chartPath(points);
  const pointRadius = Math.max(2, Math.min(4, plotWidth / points.length / 5));

  if (type === "bar") {
    const slotWidth = plotWidth / points.length;
    const barWidth = Math.max(1, slotWidth * 0.68);
    return points.map((point) => (
      <rect
        key={`${point.x}:${point.label}`}
        data-facet-mark="bar"
        data-facet-point=""
        x={point.x - barWidth / 2}
        y={Math.min(point.y, baseline)}
        width={barWidth}
        height={Math.max(1, Math.abs(point.y - baseline))}
        rx="2"
        fill={recipe("chart", "series")}
      />
    ));
  }

  return (
    <>
      {type === "area" ? (
        <path
          data-facet-mark="area"
          d={`M${points[0]!.x.toFixed(2)} ${baseline.toFixed(2)} ${points
            .map((point) => `L${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
            .join(" ")} L${points.at(-1)!.x.toFixed(2)} ${baseline.toFixed(2)} Z`}
          fill={recipe("chart", "fill")}
          stroke={recipe("chart", "series")}
          strokeWidth="2"
        />
      ) : (
        <path
          data-facet-mark="line"
          d={path}
          fill="none"
          stroke={recipe("chart", "series")}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {points.map((point) => (
        <circle
          key={`${point.x}:${point.label}`}
          data-facet-point=""
          cx={point.x}
          cy={point.y}
          r={pointRadius}
          fill={recipe("chart", "series")}
        />
      ))}
    </>
  );
}

export const Chart: MountedComponent<ReactNode, ReactNode> = ({ props, themeVars }) => {
  const rows = arrayProp(props, "data", BOUNDS.dataModelArrayLength);
  const xKey = stringProp(props, "xKey", "");
  const yKey = stringProp(props, "yKey", "");
  const type = enumProp(props, "type", ["bar", "line", "area"] as const, "bar");
  const title = textProp(props, "title");
  const accessibleTitle = title ?? `${yKey || "Value"} by ${xKey || "category"}`;
  const geometry = positionChartPoints(chartPoints(rows, xKey, yKey));
  const labelStep = Math.max(1, Math.ceil(geometry.points.length / 8));

  return (
    <figure
      data-facet-component="Chart"
      style={mountStyle(themeVars, {
        display: "flex",
        boxSizing: "border-box",
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        flexDirection: "column",
        gap: foundation("space", "sm"),
        margin: 0,
        padding: foundation("space", "sm"),
        overflow: "hidden",
        borderRadius: recipe("chart", "radius"),
        background: recipe("chart", "background"),
        color: recipe("chart", "text"),
        fontFamily: foundation("typography", "fontFamilySans"),
      })}
    >
      {title === undefined ? null : (
        <figcaption
          style={flowStyle({
            overflowWrap: "anywhere",
            fontSize: foundation("typography", "fontSizeSm"),
            fontWeight: foundation("typography", "fontWeightSemibold"),
          })}
        >
          {title}
        </figcaption>
      )}
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={accessibleTitle}
        focusable="false"
        style={flowStyle({ display: "block", width: "100%", maxWidth: "100%", height: "auto" })}
      >
        <title>{accessibleTitle}</title>
        <desc>{`${geometry.points.length} usable data points`}</desc>
        <g aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => {
            const y = CHART_TOP + (index / 4) * geometry.plotHeight;
            return (
              <line
                key={index}
                x1={CHART_LEFT}
                x2={CHART_LEFT + geometry.plotWidth}
                y1={y}
                y2={y}
                stroke={recipe("chart", "grid")}
                strokeWidth="1"
              />
            );
          })}
          {chartMarks(type, geometry.points, geometry.baseline, geometry.plotWidth)}
          {geometry.points.map((point, index) =>
            index % labelStep === 0 || index === geometry.points.length - 1 ? (
              <text
                key={`${point.x}:label`}
                x={point.x}
                y={CHART_HEIGHT - 8}
                fill={recipe("chart", "mutedText")}
                fontSize={foundation("typography", "fontSize2xs")}
                textAnchor="middle"
              >
                {point.label}
              </text>
            ) : null,
          )}
        </g>
      </svg>
    </figure>
  );
};

const PROGRESS_TONES = {
  neutral: semantic("text", "muted"),
  accent: recipe("progress", "fill"),
  success: semantic("status", "successText"),
  warning: semantic("status", "warningText"),
} as const;

const PROGRESS_TONE_LIST = Object.keys(PROGRESS_TONES) as readonly (keyof typeof PROGRESS_TONES)[];

export const Progress: MountedComponent<ReactNode, ReactNode> = ({ props, themeVars }) => {
  const label = stringProp(props, "label", "");
  const value = numberProp(props, "value", 0, 100, 0);
  const fill = PROGRESS_TONES[enumProp(props, "tone", PROGRESS_TONE_LIST, "accent")];

  return (
    <div
      data-facet-component="Progress"
      style={mountStyle(themeVars, {
        display: "flex",
        width: "100%",
        minWidth: 0,
        flexDirection: "column",
        gap: foundation("space", "xs"),
        fontFamily: foundation("typography", "fontFamilySans"),
      })}
    >
      <span
        style={flowStyle({
          display: "flex",
          minWidth: 0,
          justifyContent: "space-between",
          gap: foundation("space", "sm"),
          color: recipe("progress", "labelText"),
          fontSize: foundation("typography", "fontSizeSm"),
        })}
      >
        <span style={flowStyle({ overflowWrap: "anywhere" })}>{label}</span>
        <span style={flowStyle({ flex: "0 0 auto", color: recipe("progress", "valueText") })}>
          {NUMBER_FORMAT.format(value)}%
        </span>
      </span>
      <progress
        aria-label={label}
        value={value}
        max={100}
        style={flowStyle({
          display: "block",
          width: "100%",
          height: recipe("progress", "height"),
          overflow: "hidden",
          border: 0,
          borderRadius: recipe("progress", "radius"),
          background: recipe("progress", "track"),
          accentColor: fill,
        })}
      />
    </div>
  );
};

const SEQUENCE_TONES = {
  neutral: {
    markerBackground: semantic("surface", "muted"),
    markerText: recipe("timeline", "markerText"),
  },
  accent: {
    markerBackground: recipe("timeline", "markerBg"),
    markerText: recipe("timeline", "markerText"),
  },
} as const;

const SEQUENCE_TONE_LIST = Object.keys(SEQUENCE_TONES) as readonly (keyof typeof SEQUENCE_TONES)[];

export const Timeline: MountedComponent<ReactNode, ReactNode> = ({
  props,
  children,
  themeVars,
}) => {
  const title = textProp(props, "title");
  const colors = SEQUENCE_TONES[enumProp(props, "tone", SEQUENCE_TONE_LIST, "neutral")];
  const items = Children.toArray(children);

  return (
    <section
      data-facet-component="Timeline"
      style={mountStyle(themeVars, {
        minWidth: 0,
        color: recipe("timeline", "text"),
        fontFamily: foundation("typography", "fontFamilySans"),
      })}
    >
      {title === undefined ? null : (
        <h2
          style={flowStyle({
            margin: `0 0 ${recipe("timeline", "gap")}`,
            overflowWrap: "anywhere",
            color: recipe("timeline", "titleColor"),
            fontSize: foundation("typography", "fontSizeLg"),
            fontWeight: foundation("typography", "fontWeightSemibold"),
          })}
        >
          {title}
        </h2>
      )}
      <ol
        style={flowStyle({
          display: "grid",
          gap: recipe("timeline", "gap"),
          margin: 0,
          padding: 0,
          listStyle: "none",
        })}
      >
        {items.map((item, index) => (
          <li
            key={index}
            style={flowStyle({
              display: "grid",
              minWidth: 0,
              gridTemplateColumns: `${foundation("size", "iconMd")} minmax(0, 1fr)`,
              gap: foundation("space", "sm"),
              alignItems: "start",
              paddingInlineStart: foundation("space", "xs"),
              borderInlineStart: `${foundation("borderWidth", "thin")} solid ${recipe("timeline", "line")}`,
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
                background: colors.markerBackground,
                color: colors.markerText,
                fontSize: foundation("typography", "fontSize2xs"),
                fontWeight: foundation("typography", "fontWeightSemibold"),
              })}
            >
              {index + 1}
            </span>
            <div style={flowStyle({ minWidth: 0, overflowWrap: "anywhere" })}>{item}</div>
          </li>
        ))}
      </ol>
    </section>
  );
};

export const List: MountedComponent<ReactNode, ReactNode> = ({ props, children, themeVars }) => {
  const title = textProp(props, "title");
  const marker = enumProp(props, "marker", ["bullet", "number", "none"] as const, "bullet");
  const density = enumProp(props, "density", ["compact", "comfortable"] as const, "comfortable");
  const items = Children.toArray(children);
  const ListElement = marker === "number" ? "ol" : "ul";
  const gap = density === "compact" ? foundation("space", "xs") : recipe("list", "gap");

  return (
    <section
      data-facet-component="List"
      style={mountStyle(themeVars, {
        minWidth: 0,
        color: recipe("list", "text"),
        fontFamily: foundation("typography", "fontFamilySans"),
      })}
    >
      {title === undefined ? null : (
        <h2
          style={flowStyle({
            margin: `0 0 ${gap}`,
            overflowWrap: "anywhere",
            color: recipe("list", "titleColor"),
            fontSize: foundation("typography", "fontSizeLg"),
            fontWeight: foundation("typography", "fontWeightSemibold"),
          })}
        >
          {title}
        </h2>
      )}
      <ListElement
        style={flowStyle({
          display: "grid",
          gap,
          margin: 0,
          padding: 0,
          listStyle: "none",
        })}
      >
        {items.map((item, index) => (
          <li
            key={index}
            style={flowStyle({
              display: "grid",
              minWidth: 0,
              gridTemplateColumns: marker === "none" ? "minmax(0, 1fr)" : "1.5rem minmax(0, 1fr)",
              gap: foundation("space", "xs"),
              alignItems: "start",
              overflowWrap: "anywhere",
            })}
          >
            {marker === "none" ? null : (
              <span
                aria-hidden="true"
                style={flowStyle({
                  color: recipe("list", "markerText"),
                  fontWeight: foundation("typography", "fontWeightSemibold"),
                  textAlign: "right",
                })}
              >
                {marker === "number" ? `${index + 1}.` : "\u2022"}
              </span>
            )}
            <div style={flowStyle({ minWidth: 0 })}>{item}</div>
          </li>
        ))}
      </ListElement>
    </section>
  );
};
