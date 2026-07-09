import type { CSSProperties, ReactNode } from "react";
import {
  FIELD_INPUTS,
  MAX_CHART_POINTS,
  MAX_CHART_SERIES,
  MAX_FIELD_OPTIONS,
  MAX_FIELD_VALUE_CHARS,
  MAX_LIST_ITEMS,
  MAX_NODE_BODY_CHARS,
  MAX_NODE_LABEL_CHARS,
  MAX_TABLE_CELL_CHARS,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  MAX_TABS_ITEMS,
  type BoxStyle,
  type ComponentRecipe,
  type FacetNode,
  type FieldStyle,
  type NodeId,
  type RecipeComponentName,
  type RecipePartName,
  type TextStyle,
} from "@facet/core";
import { boxStyle, fieldStyle, resolveRecipe, textStyle } from "./theme.js";
import type { ResolvedTheme } from "./theme.js";
import { resolveRecipePart } from "./recipe-parts.js";

export interface PressableRenderArgs<Press> {
  readonly press: Press | null;
  readonly hold: Press | null;
  readonly dispatch: (press: Press) => void;
  readonly style: CSSProperties;
  readonly className: string | undefined;
  readonly inert?: boolean;
  readonly disabled?: boolean;
  readonly buttonRole?: boolean;
  readonly children: ReactNode;
}

export interface BrickRenderContext<Press> {
  readonly theme: ResolvedTheme;
  readonly className: string | undefined;
  readonly inert: boolean;
  readonly nodeId: NodeId;
  readonly activeScreen: string | null;
  readonly children?: ReactNode;
  readonly classifyPress: (value: unknown) => Press | null;
  readonly dispatch: (press: Press) => void;
  readonly navigate: (to: string) => void;
  readonly renderPressable: (args: PressableRenderArgs<Press>) => ReactNode;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeOwnValue(record: unknown, key: string): unknown {
  if (!isObjectRecord(record)) return undefined;
  try {
    if (!Object.prototype.hasOwnProperty.call(record, key)) return undefined;
    return record[key];
  } catch {
    return undefined;
  }
}

function cappedArray(value: unknown, max: number): readonly unknown[] {
  if (!Array.isArray(value)) return [];
  try {
    return value.slice(0, max);
  } catch {
    return [];
  }
}

function styleOf<T extends object>(style: unknown): T | undefined {
  return isObjectRecord(style) ? (style as T) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function cappedString(value: unknown, max: number): string | undefined {
  const text = stringValue(value);
  return text === undefined ? undefined : text.slice(0, max);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isFieldInput(input: unknown): input is (typeof FIELD_INPUTS)[number] {
  return typeof input === "string" && (FIELD_INPUTS as readonly string[]).includes(input);
}

function optionsOf(options: unknown): readonly string[] {
  const kept: string[] = [];
  for (const option of cappedArray(options, MAX_FIELD_OPTIONS)) {
    if (typeof option === "string") {
      kept.push(option.slice(0, MAX_FIELD_VALUE_CHARS));
    }
  }
  return kept;
}

function tableCellText(value: unknown): string {
  const text =
    typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : "";
  return text.slice(0, MAX_TABLE_CELL_CHARS);
}

function textAlignStyle(align: unknown): CSSProperties["textAlign"] | undefined {
  switch (align) {
    case "start":
      return "left";
    case "center":
      return "center";
    case "end":
      return "right";
    default:
      return undefined;
  }
}

function clampProgress(value: unknown): number {
  const numeric = finiteNumber(value);
  if (numeric === undefined) return 0;
  return Math.min(100, Math.max(0, numeric));
}

function withInert(style: CSSProperties, inert: boolean): CSSProperties {
  return inert ? { ...style, pointerEvents: "none" } : style;
}

function componentRecipe(
  theme: ResolvedTheme,
  component: RecipeComponentName,
  variant: unknown,
  tone?: unknown,
): ComponentRecipe {
  return resolveRecipe(theme, component, variant, tone);
}

function componentBoxStyle(
  theme: ResolvedTheme,
  recipe: ComponentRecipe,
  defaults: BoxStyle,
): CSSProperties {
  return boxStyle({ ...defaults, ...(recipe.box ?? {}) }, theme);
}

function componentTextStyle(
  theme: ResolvedTheme,
  recipe: ComponentRecipe,
  defaults: TextStyle,
  partName?: RecipePartName,
): CSSProperties {
  const base = textStyle({ ...defaults, ...(recipe.text ?? {}) }, theme);
  if (partName === undefined) return base;
  const part = resolveRecipePart(recipe, partName, theme);
  return part.text === undefined ? base : { ...base, ...part.text };
}

function partBoxStyle(
  theme: ResolvedTheme,
  recipe: ComponentRecipe,
  partName: RecipePartName,
  defaults: BoxStyle = {},
): CSSProperties {
  const base = boxStyle(defaults, theme);
  const part = resolveRecipePart(recipe, partName, theme);
  return part.box === undefined ? base : { ...base, ...part.box };
}

function partTextStyle(
  theme: ResolvedTheme,
  recipe: ComponentRecipe,
  partName: RecipePartName,
  defaults: TextStyle = {},
): CSSProperties {
  const base = textStyle(defaults, theme);
  const part = resolveRecipePart(recipe, partName, theme);
  return part.text === undefined ? base : { ...base, ...part.text };
}

function intrinsicBoxStyle(style: CSSProperties | undefined): CSSProperties {
  if (style === undefined) return {};
  const css: CSSProperties = { ...style };
  delete css.display;
  delete css.flexDirection;
  delete css.flexWrap;
  delete css.gap;
  delete css.alignItems;
  delete css.justifyContent;
  delete css.flexGrow;
  delete css.width;
  delete css.minWidth;
  delete css.maxWidth;
  delete css.overflowX;
  delete css.overflowY;
  delete css.maxHeight;
  delete css.minHeight;
  return css;
}

function fieldControlStyle(theme: ResolvedTheme, recipe: ComponentRecipe): CSSProperties {
  const control = resolveRecipePart(recipe, "control", theme);
  const input = resolveRecipePart(recipe, "input", theme);
  const css: CSSProperties = {
    boxSizing: "border-box",
    background: theme.color.surface,
    color: theme.color.fg,
    border: `1px solid ${theme.color.border}`,
    borderRadius: theme.radius.sm,
    padding: `${theme.space.sm} ${theme.space.md}`,
    font: "inherit",
    lineHeight: 1.4,
    minHeight: "40px",
    outline: "none",
    ...(intrinsicBoxStyle(control.box) ?? {}),
    ...(control.field ?? {}),
    ...(intrinsicBoxStyle(input.box) ?? {}),
    ...(input.field ?? {}),
  };
  return css;
}

function fieldChoiceControlStyle(theme: ResolvedTheme): CSSProperties {
  return {
    accentColor: theme.color.accent,
  };
}

function fieldChoiceOptionStyle(theme: ResolvedTheme): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: theme.space.sm,
    color: theme.color.fg,
    fontFamily: theme.fontFamily.sans,
    fontSize: theme.fontSize.md,
  };
}

interface RenderChartSeries {
  readonly label: string;
  readonly values: readonly number[];
}

function chartSeriesOf(raw: unknown): readonly RenderChartSeries[] {
  const rawSeries = cappedArray(safeOwnValue(raw, "series"), MAX_CHART_SERIES);
  const series: RenderChartSeries[] = [];
  for (const item of rawSeries) {
    if (!isObjectRecord(item)) continue;
    const label = cappedString(safeOwnValue(item, "label"), MAX_NODE_LABEL_CHARS);
    const rawValues = cappedArray(safeOwnValue(item, "values"), MAX_CHART_POINTS);
    if (label === undefined) continue;
    const values: number[] = [];
    for (const value of rawValues) {
      const number = finiteNumber(value);
      if (number !== undefined) values.push(number);
    }
    if (values.length > 0) series.push({ label, values });
  }
  return series;
}

function chartColor(theme: ResolvedTheme, index: number): string {
  return theme.color[`chart-${String((index % 6) + 1)}` as keyof typeof theme.color];
}

function renderChartBars(raw: unknown, theme: ResolvedTheme): ReactNode {
  const series = chartSeriesOf(raw);
  if (series.length === 0) return null;
  const values = series.flatMap((item) => item.values as number[]);
  const max = Math.max(1, ...values.map((value) => Math.abs(value)));
  const barWidth = 24;
  const gap = 10;
  const height = 120;
  let index = 0;
  return series.map((item, seriesIndex) =>
    item.values.map((value) => {
      const barHeight = Math.round((Math.abs(value) / max) * 100);
      const x = index++ * (barWidth + gap);
      const y = height - barHeight;
      return (
        <rect
          key={`${item.label}:${String(index)}`}
          x={x}
          y={y}
          width={barWidth}
          height={barHeight}
          fill={chartColor(theme, seriesIndex)}
        />
      );
    }),
  );
}

function renderChartLines(raw: unknown, theme: ResolvedTheme): ReactNode {
  const series = chartSeriesOf(raw);
  if (series.length === 0) return null;
  const values = series.flatMap((item) => item.values as number[]);
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const range = Math.max(1, max - min);
  const width = 320;
  const top = 12;
  const height = 112;
  return series.map((item, seriesIndex) => {
    const step = item.values.length <= 1 ? 0 : width / (item.values.length - 1);
    const points = item.values
      .map((value, valueIndex) => {
        const x = 20 + valueIndex * step;
        const y = top + height - ((value - min) / range) * height;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
    return (
      <polyline
        key={item.label}
        points={points}
        fill="none"
        stroke={chartColor(theme, seriesIndex)}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  });
}

function renderChartDonut(raw: unknown, theme: ResolvedTheme): ReactNode {
  const slices = chartSeriesOf(raw).flatMap((item) =>
    item.values
      .map((value) => Math.abs(value))
      .filter((value) => value > 0)
      .slice(0, MAX_CHART_POINTS),
  );
  if (slices.length === 0) return null;
  const total = slices.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return null;
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return slices.map((value, index) => {
    const length = (value / total) * circumference;
    const dashOffset = -offset;
    offset += length;
    return (
      <circle
        key={String(index)}
        cx={70}
        cy={70}
        r={radius}
        fill="none"
        stroke={chartColor(theme, index)}
        strokeWidth={20}
        strokeDasharray={`${length.toFixed(2)} ${Math.max(0, circumference - length).toFixed(2)}`}
        strokeDashoffset={dashOffset.toFixed(2)}
        transform="rotate(-90 70 70)"
      />
    );
  });
}

function renderSection<Press>(node: FacetNode, context: BrickRenderContext<Press>): ReactNode {
  const { theme, className, inert } = context;
  const variant = safeOwnValue(node, "variant");
  const recipe = componentRecipe(theme, "section", variant);
  const style = componentBoxStyle(theme, recipe, {
    gap: "md",
    pad: "md",
    width: "full",
  });
  const eyebrow = cappedString(safeOwnValue(node, "eyebrow"), MAX_NODE_LABEL_CHARS);
  const title = cappedString(safeOwnValue(node, "title"), MAX_NODE_LABEL_CHARS);
  const body = cappedString(safeOwnValue(node, "body"), MAX_NODE_BODY_CHARS);
  return (
    <section
      className={className}
      aria-hidden={inert ? true : undefined}
      style={withInert(style, inert)}
    >
      {eyebrow === undefined ? null : (
        <p
          style={componentTextStyle(
            theme,
            recipe,
            { color: "fg-muted", size: "sm", weight: "semibold" },
            "label",
          )}
        >
          {eyebrow}
        </p>
      )}
      {title === undefined ? null : (
        <h2
          style={componentTextStyle(
            theme,
            recipe,
            { color: "fg", size: "xl", weight: "bold" },
            "title",
          )}
        >
          {title}
        </h2>
      )}
      {body === undefined ? null : (
        <p style={componentTextStyle(theme, recipe, { color: "fg" }, "body")}>{body}</p>
      )}
      {context.children}
    </section>
  );
}

function renderCard<Press>(node: FacetNode, context: BrickRenderContext<Press>): ReactNode {
  const { theme, className, inert } = context;
  const variant = safeOwnValue(node, "variant");
  const tone = safeOwnValue(node, "tone");
  const recipe = componentRecipe(theme, "card", variant, tone);
  const style = componentBoxStyle(theme, recipe, {
    gap: "sm",
    pad: "md",
    bg: "surface",
    border: true,
    radius: "md",
  });
  const title = cappedString(safeOwnValue(node, "title"), MAX_NODE_LABEL_CHARS);
  const body = cappedString(safeOwnValue(node, "body"), MAX_NODE_BODY_CHARS);
  const press = context.classifyPress(safeOwnValue(node, "onPress"));
  const hold = context.classifyPress(safeOwnValue(node, "onHold"));
  return context.renderPressable({
    press: inert ? null : press,
    hold: inert ? null : hold,
    dispatch: context.dispatch,
    className,
    style,
    inert,
    children: (
      <>
        {title === undefined && body === undefined ? null : (
          <div style={partBoxStyle(theme, recipe, "header", { gap: "xs" })}>
            {title === undefined ? null : (
              <h3
                style={componentTextStyle(
                  theme,
                  recipe,
                  { color: "fg", size: "lg", weight: "bold" },
                  "title",
                )}
              >
                {title}
              </h3>
            )}
            {body === undefined ? null : (
              <p style={componentTextStyle(theme, recipe, { color: "fg" }, "body")}>{body}</p>
            )}
          </div>
        )}
        {context.children}
      </>
    ),
  });
}

function renderButton<Press>(node: FacetNode, context: BrickRenderContext<Press>): ReactNode {
  const label = cappedString(safeOwnValue(node, "label"), MAX_NODE_LABEL_CHARS);
  if (label === undefined) return null;
  const { theme, className, inert } = context;
  const variant = safeOwnValue(node, "variant");
  const tone = safeOwnValue(node, "tone");
  const disabled = safeOwnValue(node, "disabled") === true;
  const recipe = componentRecipe(theme, "button", variant, tone);
  const style = componentBoxStyle(theme, recipe, {
    direction: "row",
    align: "center",
    justify: "center",
    gap: "sm",
    pad: "sm",
    bg: "accent",
    radius: "md",
  });
  const press = disabled ? null : context.classifyPress(safeOwnValue(node, "onPress"));
  const hold = disabled ? null : context.classifyPress(safeOwnValue(node, "onHold"));
  return context.renderPressable({
    press: inert ? null : press,
    hold: inert ? null : hold,
    dispatch: context.dispatch,
    className,
    style,
    inert,
    disabled,
    buttonRole: true,
    children: (
      <span
        style={componentTextStyle(
          theme,
          recipe,
          { color: "accent-fg", weight: "semibold" },
          "label",
        )}
      >
        {label}
      </span>
    ),
  });
}

function renderTabs<Press>(node: FacetNode, context: BrickRenderContext<Press>): ReactNode {
  const { theme, className, inert } = context;
  const items = cappedArray(safeOwnValue(node, "items"), MAX_TABS_ITEMS).flatMap((item) => {
    const label = cappedString(safeOwnValue(item, "label"), MAX_NODE_LABEL_CHARS);
    const to = stringValue(safeOwnValue(item, "to"));
    return label !== undefined && to !== undefined ? [{ label, to }] : [];
  });
  if (items.length === 0) return null;
  const variant = safeOwnValue(node, "variant");
  const recipe = componentRecipe(theme, "tabs", variant);
  const style = componentBoxStyle(theme, recipe, {
    direction: "row",
    gap: "sm",
    wrap: true,
  });
  const tabPart = resolveRecipePart(recipe, "tab", theme);
  const activeTabPart = resolveRecipePart(recipe, "activeTab", theme);
  const tabText = componentTextStyle(theme, recipe, { color: "fg", weight: "semibold" }, "tab");
  const activeTabText: CSSProperties = { ...tabText, ...(activeTabPart.text ?? {}) };
  return (
    <div
      role="tablist"
      className={className}
      aria-hidden={inert ? true : undefined}
      style={withInert(style, inert)}
    >
      {items.map((item) => {
        const active = context.activeScreen === item.to;
        return (
          <button
            key={`${item.to}:${item.label}`}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={inert ? -1 : undefined}
            disabled={inert ? true : undefined}
            onClick={inert ? undefined : () => context.navigate(item.to)}
            style={{
              ...boxStyle({ pad: "sm", radius: "md", border: true }, theme),
              background: "transparent",
              ...(tabPart.box ?? {}),
              ...(active ? (activeTabPart.box ?? {}) : {}),
              ...(active ? activeTabText : tabText),
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function renderTable<Press>(node: FacetNode, context: BrickRenderContext<Press>): ReactNode {
  const { theme, className, inert } = context;
  const columns = cappedArray(safeOwnValue(node, "columns"), MAX_TABLE_COLUMNS).flatMap(
    (column) => {
      const key = stringValue(safeOwnValue(column, "key"));
      const label = cappedString(safeOwnValue(column, "label"), MAX_NODE_LABEL_CHARS);
      return key !== undefined && label !== undefined
        ? [{ key, label, align: textAlignStyle(safeOwnValue(column, "align")) }]
        : [];
    },
  );
  if (columns.length === 0) return null;
  const rows = cappedArray(safeOwnValue(node, "rows"), MAX_TABLE_ROWS).filter(isObjectRecord);
  const caption = cappedString(safeOwnValue(node, "caption"), MAX_NODE_LABEL_CHARS);
  const variant = safeOwnValue(node, "variant");
  const recipe = componentRecipe(theme, "table", variant);
  const style = componentBoxStyle(theme, recipe, {
    scroll: "x",
    width: "full",
  });
  const tablePart = resolveRecipePart(recipe, "table", theme);
  const captionPart = resolveRecipePart(recipe, "title", theme);
  const headerRowPart = resolveRecipePart(recipe, "headerRow", theme);
  const rowPart = resolveRecipePart(recipe, "row", theme);
  const headerCellPart = resolveRecipePart(recipe, "headerCell", theme);
  const cellPart = resolveRecipePart(recipe, "cell", theme);
  return (
    <div
      className={className}
      aria-hidden={inert ? true : undefined}
      style={withInert(style, inert)}
    >
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          ...intrinsicBoxStyle(tablePart.box),
          ...(tablePart.text ?? {}),
        }}
      >
        {caption === undefined ? null : <caption style={captionPart.text}>{caption}</caption>}
        <thead>
          <tr style={intrinsicBoxStyle(headerRowPart.box)}>
            {columns.map((column) => (
              <th
                key={column.key}
                style={{
                  borderBottom: `1px solid ${theme.color.border}`,
                  color: theme.color["fg-muted"],
                  ...intrinsicBoxStyle(headerCellPart.box),
                  ...(headerCellPart.text ?? {}),
                  textAlign: column.align,
                }}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={String(rowIndex)} style={intrinsicBoxStyle(rowPart.box)}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  style={{
                    borderBottom: `1px solid ${theme.color.border}`,
                    ...intrinsicBoxStyle(cellPart.box),
                    ...(cellPart.text ?? {}),
                    textAlign: column.align,
                  }}
                >
                  {tableCellText(safeOwnValue(row, column.key))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderChart<Press>(node: FacetNode, context: BrickRenderContext<Press>): ReactNode {
  const { theme, className, inert } = context;
  const kind = safeOwnValue(node, "kind");
  if (kind !== "bar" && kind !== "line" && kind !== "donut") return null;
  const chart =
    kind === "bar"
      ? renderChartBars(node, theme)
      : kind === "line"
        ? renderChartLines(node, theme)
        : renderChartDonut(node, theme);
  if (chart === null) return null;
  const title = cappedString(safeOwnValue(node, "title"), MAX_NODE_LABEL_CHARS);
  const variant = safeOwnValue(node, "variant");
  const recipe = componentRecipe(theme, "chart", variant);
  const style = componentBoxStyle(theme, recipe, {
    gap: "sm",
    pad: "sm",
    width: "full",
  });
  const plotPart = resolveRecipePart(recipe, "plot", theme);
  return (
    <figure
      className={className}
      aria-hidden={inert ? true : undefined}
      style={withInert({ ...style, margin: 0, maxWidth: "100%", minWidth: 0 }, inert)}
    >
      {title === undefined ? null : (
        <figcaption style={componentTextStyle(theme, recipe, { weight: "semibold" }, "title")}>
          {title}
        </figcaption>
      )}
      <svg
        role="img"
        aria-label={title ?? "chart"}
        viewBox="0 0 360 140"
        width="100%"
        style={{
          ...intrinsicBoxStyle(plotPart.box),
          display: "block",
          boxSizing: "border-box",
          width: "100%",
          maxWidth: "100%",
          height: "auto",
          overflow: "hidden",
        }}
      >
        {title === undefined ? null : <title>{title}</title>}
        {chart}
      </svg>
    </figure>
  );
}

function renderStat<Press>(node: FacetNode, context: BrickRenderContext<Press>): ReactNode {
  const label = cappedString(safeOwnValue(node, "label"), MAX_NODE_LABEL_CHARS);
  const value = cappedString(safeOwnValue(node, "value"), MAX_NODE_LABEL_CHARS);
  if (label === undefined || value === undefined) return null;
  const { theme, className, inert } = context;
  const variant = safeOwnValue(node, "variant");
  const tone = safeOwnValue(node, "tone");
  const recipe = componentRecipe(theme, "stat", variant, tone);
  const style = componentBoxStyle(theme, recipe, {
    gap: "xs",
    pad: "sm",
    bg: "surface",
    radius: "md",
  });
  const delta = cappedString(safeOwnValue(node, "delta"), MAX_NODE_LABEL_CHARS);
  return (
    <div
      className={className}
      aria-hidden={inert ? true : undefined}
      style={withInert(style, inert)}
    >
      <p style={componentTextStyle(theme, recipe, { color: "fg-muted", size: "sm" }, "label")}>
        {label}
      </p>
      <p
        style={componentTextStyle(
          theme,
          recipe,
          { color: "fg", size: "xl", weight: "bold" },
          "value",
        )}
      >
        {value}
      </p>
      {delta === undefined ? null : (
        <p style={componentTextStyle(theme, recipe, { color: "fg-muted" }, "trend")}>{delta}</p>
      )}
    </div>
  );
}

function renderBadge<Press>(node: FacetNode, context: BrickRenderContext<Press>): ReactNode {
  const label = cappedString(safeOwnValue(node, "label"), MAX_NODE_LABEL_CHARS);
  if (label === undefined) return null;
  const { theme, className, inert } = context;
  const variant = safeOwnValue(node, "variant");
  const tone = safeOwnValue(node, "tone");
  const recipe = componentRecipe(theme, "badge", variant, tone);
  return (
    <span
      className={className}
      aria-hidden={inert ? true : undefined}
      style={withInert(
        componentBoxStyle(theme, recipe, {
          direction: "row",
          pad: "xs",
          radius: "full",
          bg: tone === "success" ? "success" : "surface-2",
        }),
        inert,
      )}
    >
      <span
        style={componentTextStyle(
          theme,
          recipe,
          {
            color: tone === "success" ? "accent-fg" : "fg",
            size: "sm",
            weight: "semibold",
          },
          "label",
        )}
      >
        {label}
      </span>
    </span>
  );
}

function renderProgress<Press>(node: FacetNode, context: BrickRenderContext<Press>): ReactNode {
  const { theme, className, inert } = context;
  const value = clampProgress(safeOwnValue(node, "value"));
  const label = cappedString(safeOwnValue(node, "label"), MAX_NODE_LABEL_CHARS);
  const variant = safeOwnValue(node, "variant");
  const tone = safeOwnValue(node, "tone");
  const recipe = componentRecipe(theme, "progress", variant, tone);
  const style = componentBoxStyle(theme, recipe, {
    gap: "xs",
    width: "full",
  });
  const trackPart = resolveRecipePart(recipe, "track", theme);
  const fillPart = resolveRecipePart(recipe, "fill", theme);
  const trackStyle = intrinsicBoxStyle(trackPart.box);
  const fillStyle = intrinsicBoxStyle(fillPart.box);
  return (
    <label
      className={className}
      aria-hidden={inert ? true : undefined}
      style={withInert(style, inert)}
    >
      {label === undefined ? null : (
        <span style={componentTextStyle(theme, recipe, {}, "label")}>{label}</span>
      )}
      <div
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{
          ...trackStyle,
          display: "block",
          boxSizing: "border-box",
          width: "100%",
          height: theme.space.sm,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            ...fillStyle,
            display: "block",
            boxSizing: "border-box",
            width: `${String(value)}%`,
            height: "100%",
          }}
        />
      </div>
    </label>
  );
}

function renderAlert<Press>(node: FacetNode, context: BrickRenderContext<Press>): ReactNode {
  const body = cappedString(safeOwnValue(node, "body"), MAX_NODE_BODY_CHARS);
  if (body === undefined) return null;
  const { theme, className, inert } = context;
  const variant = safeOwnValue(node, "variant");
  const tone = safeOwnValue(node, "tone");
  const recipe = componentRecipe(theme, "alert", variant, tone);
  const style = componentBoxStyle(theme, recipe, {
    gap: "xs",
    pad: "md",
    bg: "surface",
    border: true,
    radius: "md",
  });
  const title = cappedString(safeOwnValue(node, "title"), MAX_NODE_LABEL_CHARS);
  return (
    <div
      role="alert"
      className={className}
      aria-hidden={inert ? true : undefined}
      style={withInert(style, inert)}
    >
      {title === undefined ? null : (
        <p style={componentTextStyle(theme, recipe, { weight: "bold" }, "title")}>{title}</p>
      )}
      <p style={componentTextStyle(theme, recipe, {}, "body")}>{body}</p>
    </div>
  );
}

function renderList<Press>(node: FacetNode, context: BrickRenderContext<Press>): ReactNode {
  const { theme, className, inert } = context;
  const items = cappedArray(safeOwnValue(node, "items"), MAX_LIST_ITEMS).flatMap((item) => {
    if (typeof item === "string") {
      return [{ title: item.slice(0, MAX_NODE_LABEL_CHARS), body: undefined }];
    }
    const title = cappedString(safeOwnValue(item, "title"), MAX_NODE_LABEL_CHARS);
    if (title === undefined) return [];
    return [{ title, body: cappedString(safeOwnValue(item, "body"), MAX_NODE_BODY_CHARS) }];
  });
  if (items.length === 0) return null;
  const variant = safeOwnValue(node, "variant");
  const recipe = componentRecipe(theme, "list", variant);
  const style = componentBoxStyle(theme, recipe, { gap: "sm" });
  const itemStyle = partBoxStyle(theme, recipe, "item");
  return (
    <ul
      className={className}
      aria-hidden={inert ? true : undefined}
      style={withInert(style, inert)}
    >
      {items.map((item, index) => (
        <li key={`${String(index)}:${item.title}`} style={itemStyle}>
          <span style={partTextStyle(theme, recipe, "itemTitle")}>{item.title}</span>
          {item.body === undefined ? null : (
            <p style={partTextStyle(theme, recipe, "itemText", { color: "fg-muted" })}>
              {item.body}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function renderDivider<Press>(node: FacetNode, context: BrickRenderContext<Press>): ReactNode {
  const { theme, className, inert } = context;
  const variant = safeOwnValue(node, "variant");
  const recipe = componentRecipe(theme, "divider", variant);
  const label = cappedString(safeOwnValue(node, "label"), MAX_NODE_LABEL_CHARS);
  const rulePart = resolveRecipePart(recipe, "rule", theme);
  return (
    <div
      role="separator"
      className={className}
      aria-hidden={inert ? true : undefined}
      style={inert ? { pointerEvents: "none" } : undefined}
    >
      <hr
        style={{
          border: 0,
          borderTop: `1px solid ${theme.color.border}`,
          ...(rulePart.box ?? {}),
        }}
      />
      {label === undefined ? null : (
        <span style={componentTextStyle(theme, recipe, {}, "label")}>{label}</span>
      )}
    </div>
  );
}

interface FieldRenderModel {
  readonly className: string | undefined;
  readonly inert: boolean;
  readonly wrapperStyle: CSSProperties;
  readonly label: ReactNode;
  readonly fieldId: NodeId | undefined;
  readonly controlName: string | undefined;
  readonly inertControlProps: { readonly disabled?: true; readonly tabIndex?: -1 };
  readonly controlStyle: CSSProperties;
  readonly choiceControlStyle: CSSProperties;
  readonly choiceOptionStyle: CSSProperties;
  readonly options: readonly string[];
  readonly placeholder: string | undefined;
}

function renderSelectField(model: FieldRenderModel): ReactNode {
  return (
    <label
      className={model.className}
      aria-hidden={model.inert ? true : undefined}
      style={model.wrapperStyle}
    >
      {model.label}
      <select
        name={model.controlName}
        data-facet-field-id={model.fieldId}
        style={model.controlStyle}
        {...model.inertControlProps}
      >
        {model.options.map((option, index) => (
          <option key={`${String(index)}:${option}`} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function renderRadioField(model: FieldRenderModel): ReactNode {
  return (
    <div
      className={model.className}
      aria-hidden={model.inert ? true : undefined}
      style={model.wrapperStyle}
    >
      {model.label}
      {model.options.map((option, index) => (
        <label key={`${String(index)}:${option}`} style={model.choiceOptionStyle}>
          <input
            type="radio"
            name={model.controlName}
            value={option}
            data-facet-field-id={model.fieldId}
            style={model.choiceControlStyle}
            {...model.inertControlProps}
          />
          {option}
        </label>
      ))}
    </div>
  );
}

function renderBooleanField(model: FieldRenderModel, role?: "switch"): ReactNode {
  return (
    <label
      className={model.className}
      aria-hidden={model.inert ? true : undefined}
      style={model.wrapperStyle}
    >
      {model.label}
      <input
        type="checkbox"
        role={role}
        name={model.controlName}
        data-facet-field-id={model.fieldId}
        style={model.choiceControlStyle}
        {...model.inertControlProps}
      />
    </label>
  );
}

function renderTextField(
  model: FieldRenderModel,
  input: Exclude<(typeof FIELD_INPUTS)[number], "checkbox" | "radio" | "select" | "switch">,
): ReactNode {
  return (
    <label
      className={model.className}
      aria-hidden={model.inert ? true : undefined}
      style={model.wrapperStyle}
    >
      {model.label}
      <input
        type={input}
        name={model.controlName}
        placeholder={model.placeholder}
        data-facet-field-id={model.fieldId}
        style={model.controlStyle}
        {...model.inertControlProps}
      />
    </label>
  );
}

function renderField<Press>(node: FacetNode, context: BrickRenderContext<Press>): ReactNode {
  const { theme, className, inert, nodeId } = context;
  const rawInput = safeOwnValue(node, "input");
  const input = isFieldInput(rawInput) ? rawInput : "text";
  const name = cappedString(safeOwnValue(node, "name"), MAX_FIELD_VALUE_CHARS);
  const placeholder = cappedString(safeOwnValue(node, "placeholder"), MAX_NODE_LABEL_CHARS);
  const options = optionsOf(safeOwnValue(node, "options"));
  const variant = safeOwnValue(node, "variant");
  const recipe = componentRecipe(theme, "field", variant);
  const wrapperStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    ...fieldStyle(
      {
        ...(recipe.field ?? {}),
        ...(styleOf<FieldStyle>(safeOwnValue(node, "style")) ?? {}),
      },
      theme,
    ),
    ...(inert ? { pointerEvents: "none" } : {}),
  };
  const fieldLabel = cappedString(safeOwnValue(node, "label"), MAX_NODE_LABEL_CHARS);
  const label =
    fieldLabel === undefined ? null : (
      <span style={componentTextStyle(theme, recipe, {}, "label")}>{fieldLabel}</span>
    );
  const model: FieldRenderModel = {
    className,
    inert,
    wrapperStyle,
    label,
    fieldId: inert ? undefined : nodeId,
    controlName: inert ? undefined : name,
    inertControlProps: inert ? { disabled: true, tabIndex: -1 } : {},
    controlStyle: fieldControlStyle(theme, recipe),
    choiceControlStyle: fieldChoiceControlStyle(theme),
    choiceOptionStyle: fieldChoiceOptionStyle(theme),
    options,
    placeholder,
  };
  if (input === "select") {
    return renderSelectField(model);
  }
  if (input === "radio") {
    return renderRadioField(model);
  }
  if (input === "checkbox") {
    return renderBooleanField(model);
  }
  if (input === "switch") {
    return renderBooleanField(model, "switch");
  }
  return renderTextField(model, input);
}

export function renderBrickNode<Press>(
  node: FacetNode,
  context: BrickRenderContext<Press>,
): ReactNode {
  switch (node.type) {
    case "section":
      return renderSection(node, context);
    case "card":
      return renderCard(node, context);
    case "button":
      return renderButton(node, context);
    case "tabs":
      return renderTabs(node, context);
    case "table":
      return renderTable(node, context);
    case "chart":
      return renderChart(node, context);
    case "stat":
      return renderStat(node, context);
    case "badge":
      return renderBadge(node, context);
    case "progress":
      return renderProgress(node, context);
    case "alert":
      return renderAlert(node, context);
    case "list":
      return renderList(node, context);
    case "divider":
      return renderDivider(node, context);
    case "field":
      return renderField(node, context);
    default:
      return null;
  }
}
