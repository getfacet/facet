/** Trusted React implementations for the default task surfaces. */

import type { ComponentMountProps, MountedComponent } from "@facet/core";
import type { ReactNode } from "react";

import type { FlowStyle } from "./style.js";
import {
  countProp,
  enumProp,
  flowStyle,
  foundation,
  mountStyle,
  recipe,
  semantic,
  textProp,
} from "./style.js";

type Mount = ComponentMountProps<ReactNode>;

const ALIGNMENTS = ["start", "center"] as const;
const HEADER_TONES = ["neutral", "accent", "inverse"] as const;
const TASK_TONES = ["neutral", "accent"] as const;
const COLLECTION_LAYOUTS = ["grid", "list"] as const;
const PROPERTY_TONES = ["default", "muted"] as const;
const CALENDAR_VIEWS = ["month", "agenda"] as const;
const RESULT_TONES = ["neutral", "success", "warning", "danger"] as const;
const ALERT_TONES = ["info", "success", "warning", "danger"] as const;

const ROOT_BOUNDS: FlowStyle = Object.freeze({
  boxSizing: "border-box",
  width: "100%",
  minWidth: 0,
  maxWidth: "100%",
});

function regionStyle(extra: FlowStyle = {}): ReturnType<typeof flowStyle> {
  return flowStyle({
    boxSizing: "border-box",
    minWidth: 0,
    maxWidth: "100%",
    ...extra,
  });
}

function headingStyle(color: string, level: "primary" | "secondary" = "secondary") {
  return flowStyle({
    margin: 0,
    minWidth: 0,
    maxWidth: "100%",
    overflowWrap: "anywhere",
    color,
    fontFamily: foundation("typography", "fontFamilySans"),
    fontSize:
      level === "primary"
        ? foundation("typography", "fontSizeXl")
        : foundation("typography", "fontSizeLg"),
    fontWeight: foundation("typography", "fontWeightMedium"),
    lineHeight: foundation("typography", "lineHeightTight"),
  });
}

function copyStyle(color: string): ReturnType<typeof flowStyle> {
  return flowStyle({
    margin: 0,
    minWidth: 0,
    maxWidth: "100%",
    overflowWrap: "anywhere",
    color,
    fontFamily: foundation("typography", "fontFamilySans"),
    fontSize: foundation("typography", "fontSizeSm"),
    lineHeight: foundation("typography", "lineHeightNormal"),
  });
}

function hasContent(content: ReactNode): boolean {
  return content !== undefined && content !== null && content !== false;
}

function optionalRegion(name: string, content: ReactNode, style: FlowStyle = {}): ReactNode {
  return hasContent(content) ? (
    <div data-facet-slot={name} style={regionStyle(style)}>
      {content}
    </div>
  ) : null;
}

function responsiveGridMaxWidth(columns: number, gap: string): string {
  const track = foundation("size", "containerXs");
  if (columns <= 1) return track;
  return `calc(${[
    ...Array.from({ length: columns }, () => track),
    ...Array.from({ length: columns - 1 }, () => gap),
  ].join(" + ")})`;
}

function taskColors(namespace: string, tone: (typeof TASK_TONES)[number]) {
  return tone === "accent"
    ? {
        background: semantic("state", "selectedBg"),
        text: semantic("state", "selectedText"),
        border: semantic("action", "primaryBorder"),
        title: semantic("state", "selectedText"),
      }
    : {
        background: recipe(namespace, "background"),
        text: recipe(namespace, "text"),
        border: recipe(namespace, "border"),
        title: recipe(namespace, "titleColor"),
      };
}

function statusColors(
  namespace: string,
  tone: "neutral" | "info" | "success" | "warning" | "danger",
) {
  if (tone === "neutral") {
    return {
      background: recipe(namespace, "background"),
      text: recipe(namespace, "text"),
      border: recipe(namespace, "border"),
      title: recipe(namespace, "titleColor"),
    };
  }
  return {
    background: semantic("status", `${tone}Bg`),
    text: semantic("status", `${tone}Text`),
    border: semantic("status", `${tone}Border`),
    title: semantic("status", `${tone}Text`),
  } as const;
}

/** A page or record heading with explicit leading, metadata, action, and media regions. */
export const Header: MountedComponent<ReactNode, ReactNode> = ({
  props,
  slots,
  themeVars,
}: Mount): ReactNode => {
  const title = textProp(props, "title") ?? "";
  const description = textProp(props, "description");
  const eyebrow = textProp(props, "eyebrow");
  const align = enumProp(props, "align", ALIGNMENTS, "start");
  const tone = enumProp(props, "tone", HEADER_TONES, "neutral");
  const centered = align === "center";
  const colors =
    tone === "accent"
      ? {
          background: semantic("state", "selectedBg"),
          text: semantic("state", "selectedText"),
          muted: semantic("state", "selectedText"),
          border: semantic("action", "primaryBorder"),
        }
      : tone === "inverse"
        ? {
            background: semantic("surface", "inverse"),
            text: semantic("text", "inverse"),
            muted: semantic("text", "inverse"),
            border: semantic("border", "strong"),
          }
        : {
            background: recipe("header", "background"),
            text: recipe("header", "text"),
            muted: recipe("header", "mutedText"),
            border: recipe("header", "border"),
          };

  return (
    <header
      data-facet-component="Header"
      data-facet-header-align={align}
      data-facet-header-tone={tone}
      style={mountStyle(themeVars, {
        ...ROOT_BOUNDS,
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(min(${foundation(
          "size",
          "containerXs",
        )}, 100%), 1fr))`,
        alignItems: "center",
        gap: recipe("header", "gap"),
        padding: recipe("header", "padding"),
        border: `${foundation("borderWidth", "thin")} solid ${colors.border}`,
        background: colors.background,
        color: colors.text,
        textAlign: centered ? "center" : "left",
      })}
    >
      <div
        data-facet-header="identity"
        style={regionStyle({
          display: "flex",
          flexDirection: centered ? "column" : "row",
          flexWrap: "wrap",
          alignItems: centered ? "center" : "flex-start",
          gap: recipe("header", "gap"),
        })}
      >
        {optionalRegion("leading", slots["leading"], { flex: "0 1 auto" })}
        <div
          data-facet-header="copy"
          style={regionStyle({
            display: "flex",
            flex: "1 1 0",
            flexDirection: "column",
            alignItems: centered ? "center" : "flex-start",
            gap: foundation("space", "xs"),
          })}
        >
          {eyebrow === undefined ? null : <p style={copyStyle(colors.muted)}>{eyebrow}</p>}
          <h1
            style={flowStyle({
              ...headingStyle(colors.text, "primary"),
              fontSize: recipe("header", "titleFontSize"),
              fontWeight: recipe("header", "titleFontWeight"),
            })}
          >
            {title}
          </h1>
          {description === undefined ? null : <p style={copyStyle(colors.muted)}>{description}</p>}
          {optionalRegion("meta", slots["meta"], {
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: centered ? "center" : "flex-start",
            gap: foundation("space", "sm"),
          })}
        </div>
      </div>
      {optionalRegion("media", slots["media"], { width: "100%", overflow: "hidden" })}
      {optionalRegion("actions", slots["actions"], {
        display: "flex",
        gridColumn: "1 / -1",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: centered ? "center" : "flex-start",
        gap: foundation("space", "sm"),
      })}
    </header>
  );
};

/** A responsive list or grid of records with named controls and actions. */
export const Collection: MountedComponent<ReactNode, ReactNode> = ({
  props,
  slots,
  themeVars,
}: Mount): ReactNode => {
  const title = textProp(props, "title");
  const description = textProp(props, "description");
  const layout = enumProp(props, "layout", COLLECTION_LAYOUTS, "grid");
  const columns = countProp(props, "columns", 1, 4, 3);

  return (
    <section
      data-facet-component="Collection"
      data-facet-collection-layout={layout}
      data-facet-collection-columns={columns}
      style={mountStyle(themeVars, {
        ...ROOT_BOUNDS,
        display: "flex",
        flexDirection: "column",
        gap: recipe("collection", "gap"),
        color: recipe("collection", "text"),
      })}
    >
      {title === undefined && description === undefined ? null : (
        <div
          data-facet-collection="heading"
          style={regionStyle({
            display: "flex",
            flexDirection: "column",
            gap: foundation("space", "xs"),
          })}
        >
          {title === undefined ? null : (
            <h2 style={headingStyle(recipe("collection", "titleColor"))}>{title}</h2>
          )}
          {description === undefined ? null : (
            <p style={copyStyle(recipe("collection", "mutedText"))}>{description}</p>
          )}
        </div>
      )}
      {optionalRegion("controls", slots["controls"], {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "end",
        gap: recipe("collection", "itemGap"),
      })}
      <div
        data-facet-slot="items"
        style={regionStyle({
          display: layout === "grid" ? "grid" : "flex",
          width: "100%",
          maxWidth:
            layout === "grid"
              ? responsiveGridMaxWidth(columns, recipe("collection", "itemGap"))
              : "100%",
          gridTemplateColumns:
            layout === "grid"
              ? `repeat(auto-fit, minmax(min(${foundation("size", "containerXs")}, 100%), 1fr))`
              : undefined,
          flexDirection: layout === "list" ? "column" : undefined,
          gap: recipe("collection", "itemGap"),
        })}
      >
        {slots["items"] ?? null}
      </div>
      {optionalRegion("actions", slots["actions"], {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: recipe("collection", "itemGap"),
      })}
    </section>
  );
};

/** One bounded collection item with media, supporting content, and action regions. */
export const ItemCard: MountedComponent<ReactNode, ReactNode> = ({
  props,
  slots,
  themeVars,
}: Mount): ReactNode => {
  const title = textProp(props, "title") ?? "";
  const description = textProp(props, "description");
  const eyebrow = textProp(props, "eyebrow");
  const meta = textProp(props, "meta");
  const tone = enumProp(props, "tone", TASK_TONES, "neutral");
  const colors = taskColors("item-card", tone);

  return (
    <article
      data-facet-component="ItemCard"
      data-facet-item-card-tone={tone}
      style={mountStyle(themeVars, {
        ...ROOT_BOUNDS,
        display: "flex",
        flexDirection: "column",
        gap: recipe("item-card", "gap"),
        padding: recipe("item-card", "padding"),
        border: `${foundation("borderWidth", "thin")} solid ${colors.border}`,
        borderRadius: recipe("item-card", "radius"),
        background: colors.background,
        color: colors.text,
        overflow: "hidden",
      })}
    >
      {optionalRegion("media", slots["media"], { width: "100%", overflow: "hidden" })}
      <div
        data-facet-item-card="copy"
        style={regionStyle({
          display: "flex",
          flexDirection: "column",
          gap: foundation("space", "xs"),
        })}
      >
        {eyebrow === undefined ? null : (
          <p style={copyStyle(recipe("item-card", "mutedText"))}>{eyebrow}</p>
        )}
        <h2 style={headingStyle(colors.title)}>{title}</h2>
        {description === undefined ? null : (
          <p style={copyStyle(recipe("item-card", "mutedText"))}>{description}</p>
        )}
        {meta === undefined ? null : (
          <p style={copyStyle(recipe("item-card", "mutedText"))}>{meta}</p>
        )}
      </div>
      {optionalRegion("content", slots["content"], {
        display: "flex",
        flexDirection: "column",
        gap: recipe("item-card", "gap"),
      })}
      {optionalRegion("actions", slots["actions"], {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: foundation("space", "sm"),
        marginBlockStart: "auto",
      })}
    </article>
  );
};

/** An in-depth record surface with explicit summary and detail regions. */
export const Detail: MountedComponent<ReactNode, ReactNode> = ({
  props,
  slots,
  themeVars,
}: Mount): ReactNode => {
  const title = textProp(props, "title") ?? "";
  const description = textProp(props, "description");
  const eyebrow = textProp(props, "eyebrow");
  const meta = textProp(props, "meta");
  const tone = enumProp(props, "tone", TASK_TONES, "neutral");
  const colors = taskColors("detail", tone);

  return (
    <article
      data-facet-component="Detail"
      data-facet-detail-tone={tone}
      style={mountStyle(themeVars, {
        ...ROOT_BOUNDS,
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(min(${foundation(
          "size",
          "containerXs",
        )}, 100%), 1fr))`,
        gap: recipe("detail", "gap"),
        padding: recipe("detail", "padding"),
        border: `${foundation("borderWidth", "thin")} solid ${colors.border}`,
        borderRadius: recipe("detail", "radius"),
        background: colors.background,
        color: colors.text,
      })}
    >
      {optionalRegion("media", slots["media"], { width: "100%", overflow: "hidden" })}
      <div
        data-facet-detail="content"
        style={regionStyle({
          display: "flex",
          flexDirection: "column",
          gap: recipe("detail", "gap"),
        })}
      >
        <div
          data-facet-detail="heading"
          style={regionStyle({
            display: "flex",
            flexDirection: "column",
            gap: foundation("space", "xs"),
          })}
        >
          {eyebrow === undefined ? null : (
            <p style={copyStyle(recipe("detail", "mutedText"))}>{eyebrow}</p>
          )}
          <h1 style={headingStyle(colors.title, "primary")}>{title}</h1>
          {description === undefined ? null : (
            <p style={copyStyle(recipe("detail", "mutedText"))}>{description}</p>
          )}
          {meta === undefined ? null : (
            <p style={copyStyle(recipe("detail", "mutedText"))}>{meta}</p>
          )}
        </div>
        {optionalRegion("summary", slots["summary"], {
          display: "flex",
          flexWrap: "wrap",
          gap: recipe("detail", "gap"),
        })}
        {optionalRegion("details", slots["details"], {
          display: "flex",
          flexDirection: "column",
          gap: recipe("detail", "gap"),
        })}
        {optionalRegion("actions", slots["actions"], {
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: foundation("space", "sm"),
        })}
      </div>
    </article>
  );
};

/** A responsive set of label-value properties. */
export const PropertyList: MountedComponent<ReactNode, ReactNode> = ({
  props,
  slots,
  themeVars,
}: Mount): ReactNode => {
  const title = textProp(props, "title");
  const columns = countProp(props, "columns", 1, 3, 1);

  return (
    <section
      data-facet-component="PropertyList"
      data-facet-property-list-columns={columns}
      style={mountStyle(themeVars, {
        ...ROOT_BOUNDS,
        display: "flex",
        flexDirection: "column",
        gap: recipe("property-list", "gap"),
        color: recipe("property-list", "text"),
      })}
    >
      {title === undefined ? null : (
        <h2 style={headingStyle(recipe("property-list", "text"))}>{title}</h2>
      )}
      <dl
        data-facet-slot="items"
        style={regionStyle({
          display: "grid",
          width: "100%",
          maxWidth: responsiveGridMaxWidth(columns, recipe("property-list", "gap")),
          gridTemplateColumns: `repeat(auto-fit, minmax(min(${foundation(
            "size",
            "containerXs",
          )}, 100%), 1fr))`,
          gap: recipe("property-list", "gap"),
          margin: 0,
          padding: 0,
        })}
      >
        {slots["items"] ?? null}
      </dl>
    </section>
  );
};

/** One semantic term-value pair. */
export const Property: MountedComponent<ReactNode, ReactNode> = ({
  props,
  themeVars,
}: Mount): ReactNode => {
  const label = textProp(props, "label") ?? "";
  const value = textProp(props, "value") ?? "";
  const tone = enumProp(props, "tone", PROPERTY_TONES, "default");

  return (
    <div
      data-facet-component="Property"
      data-facet-property-tone={tone}
      style={mountStyle(themeVars, {
        ...ROOT_BOUNDS,
        display: "flex",
        flexDirection: "column",
        gap: recipe("property", "gap"),
        paddingBlock: foundation("space", "xs"),
        borderBottom: `${foundation("borderWidth", "thin")} solid ${semantic("border", "muted")}`,
      })}
    >
      <dt style={copyStyle(recipe("property", "labelText"))}>{label}</dt>
      <dd
        style={flowStyle({
          ...copyStyle(recipe("property", "valueText")),
          margin: 0,
          color: tone === "muted" ? semantic("text", "muted") : recipe("property", "valueText"),
        })}
      >
        {value}
      </dd>
    </div>
  );
};

/** A horizontally scrollable set of bounded workflow columns. */
export const Board: MountedComponent<ReactNode, ReactNode> = ({
  props,
  slots,
  themeVars,
}: Mount): ReactNode => {
  const title = textProp(props, "title");

  return (
    <section
      data-facet-component="Board"
      style={mountStyle(themeVars, {
        ...ROOT_BOUNDS,
        display: "flex",
        flexDirection: "column",
        gap: recipe("board", "gap"),
        color: recipe("board", "text"),
      })}
    >
      {title === undefined ? null : (
        <h2 style={headingStyle(recipe("board", "titleColor"))}>{title}</h2>
      )}
      <div
        data-facet-slot="columns"
        style={regionStyle({
          display: "grid",
          gridAutoFlow: "column",
          gridAutoColumns: `minmax(min(100%, ${foundation("size", "containerXs")}), 1fr)`,
          gap: recipe("board", "gap"),
          overflowX: "auto",
          overscrollBehaviorInline: "contain",
          paddingBlockEnd: foundation("space", "xs"),
        })}
      >
        {slots["columns"] ?? null}
      </div>
    </section>
  );
};

/** One normal-flow board column. */
export const BoardColumn: MountedComponent<ReactNode, ReactNode> = ({
  props,
  children,
  themeVars,
}: Mount): ReactNode => {
  const title = textProp(props, "title") ?? "";
  const description = textProp(props, "description");
  const tone = enumProp(props, "tone", TASK_TONES, "neutral");
  const colors = taskColors("board-column", tone);

  return (
    <section
      data-facet-component="BoardColumn"
      data-facet-board-column-tone={tone}
      style={mountStyle(themeVars, {
        ...ROOT_BOUNDS,
        display: "flex",
        flexDirection: "column",
        gap: recipe("board-column", "gap"),
        padding: recipe("board-column", "padding"),
        border: `${foundation("borderWidth", "thin")} solid ${colors.border}`,
        borderRadius: recipe("board-column", "radius"),
        background: colors.background,
        color: colors.text,
      })}
    >
      <div
        data-facet-board-column="heading"
        style={regionStyle({
          display: "flex",
          flexDirection: "column",
          gap: foundation("space", "xs"),
        })}
      >
        <h3 style={headingStyle(colors.text)}>{title}</h3>
        {description === undefined ? null : (
          <p style={copyStyle(recipe("board-column", "mutedText"))}>{description}</p>
        )}
      </div>
      <div
        data-facet-board-column="items"
        style={regionStyle({
          display: "flex",
          flexDirection: "column",
          gap: recipe("board-column", "gap"),
        })}
      >
        {children}
      </div>
    </section>
  );
};

interface CalendarEvent {
  readonly id: string;
  readonly title: string;
  readonly start: string;
  readonly end?: string;
  readonly tone?: string;
}

function ownString(record: unknown, name: string): string | undefined {
  try {
    if (typeof record !== "object" || record === null || Array.isArray(record)) return undefined;
    if (!Object.hasOwn(record, name)) return undefined;
    const value = (record as Readonly<Record<string, unknown>>)[name];
    return typeof value === "string" && value.trim().length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function calendarEvents(props: Mount["props"]): readonly CalendarEvent[] {
  let raw: unknown;
  try {
    raw = props["events"];
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((candidate): readonly CalendarEvent[] => {
    const id = ownString(candidate, "id");
    const title = ownString(candidate, "title");
    const start = ownString(candidate, "start");
    if (id === undefined || title === undefined || start === undefined) return [];
    const end = ownString(candidate, "end");
    const tone = ownString(candidate, "tone");
    return [
      {
        id,
        title,
        start,
        ...(end === undefined ? {} : { end }),
        ...(tone === undefined ? {} : { tone }),
      },
    ];
  });
}

/** A bounded event calendar that reports the selected event through Facet collection. */
export const Calendar: MountedComponent<ReactNode, ReactNode> = ({
  props,
  themeVars,
  onValueChange,
}: Mount): ReactNode => {
  const title = textProp(props, "title");
  const value = typeof props["value"] === "string" ? props["value"] : "";
  const view = enumProp(props, "view", CALENDAR_VIEWS, "month");
  const events = calendarEvents(props);

  return (
    <section
      data-facet-component="Calendar"
      data-facet-calendar-view={view}
      aria-label={title ?? "Calendar"}
      style={mountStyle(themeVars, {
        ...ROOT_BOUNDS,
        display: "flex",
        flexDirection: "column",
        gap: recipe("calendar", "gap"),
        padding: foundation("space", "sm"),
        border: `${foundation("borderWidth", "thin")} solid ${recipe("calendar", "border")}`,
        borderRadius: recipe("calendar", "radius"),
        background: recipe("calendar", "background"),
        color: recipe("calendar", "text"),
        overflow: "hidden",
      })}
    >
      {title === undefined ? null : (
        <h2 style={headingStyle(recipe("calendar", "text"))}>{title}</h2>
      )}
      <ol
        style={regionStyle({
          display: view === "month" ? "grid" : "flex",
          gridTemplateColumns:
            view === "month"
              ? `repeat(auto-fit, minmax(min(${foundation("size", "containerXs")}, 100%), 1fr))`
              : undefined,
          flexDirection: view === "agenda" ? "column" : undefined,
          gap: recipe("calendar", "gap"),
          margin: 0,
          padding: 0,
          listStyle: "none",
        })}
      >
        {events.map((event, index) => {
          const selected = value === event.id;
          const accent = event.tone === "accent" || selected;
          return (
            <li key={`${event.id}-${index}`} style={regionStyle()}>
              <button
                type="button"
                aria-pressed={selected}
                data-facet-calendar-event-tone={accent ? "accent" : "neutral"}
                style={flowStyle({
                  ...ROOT_BOUNDS,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: foundation("space", "xs"),
                  minHeight: foundation("size", "touchTarget"),
                  padding: foundation("space", "sm"),
                  border: `${foundation("borderWidth", "thin")} solid ${
                    accent ? recipe("calendar", "accent") : recipe("calendar", "border")
                  }`,
                  borderRadius: recipe("calendar", "radius"),
                  background: accent ? semantic("state", "selectedBg") : "transparent",
                  color: accent ? semantic("state", "selectedText") : recipe("calendar", "text"),
                  textAlign: "left",
                  overflowWrap: "anywhere",
                  cursor: "pointer",
                })}
                onClick={() => {
                  onValueChange?.(event.id);
                }}
              >
                <strong>{event.title}</strong>
                <span style={copyStyle(recipe("calendar", "mutedText"))}>
                  <time dateTime={event.start}>{event.start}</time>
                  {event.end === undefined ? null : (
                    <>
                      {" - "}
                      <time dateTime={event.end}>{event.end}</time>
                    </>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
};

function outcomeSurface(
  mount: Mount,
  options: {
    readonly component: "Result" | "Empty" | "Alert";
    readonly namespace: "result" | "empty" | "alert";
    readonly tone: "neutral" | "info" | "success" | "warning" | "danger";
    readonly detailSlot: "details" | "body";
    readonly summarySlot?: "summary";
    readonly role?: "alert" | "status";
  },
): ReactNode {
  const { props, slots, themeVars } = mount;
  const title = textProp(props, "title") ?? "";
  const description = textProp(props, "description");
  const colors = statusColors(options.namespace, options.tone);

  return (
    <section
      data-facet-component={options.component}
      data-facet-outcome-tone={options.tone}
      role={options.role}
      style={mountStyle(themeVars, {
        ...ROOT_BOUNDS,
        display: "flex",
        flexDirection: "column",
        alignItems: options.component === "Empty" ? "center" : "stretch",
        gap: foundation("space", "sm"),
        padding: recipe(options.namespace, "padding"),
        border: `${foundation("borderWidth", "thin")} solid ${colors.border}`,
        borderRadius: recipe(options.namespace, "radius"),
        background: colors.background,
        color: colors.text,
        textAlign: options.component === "Empty" ? "center" : "left",
      })}
    >
      <h2 style={headingStyle(colors.title)}>{title}</h2>
      {description === undefined ? null : <p style={copyStyle(colors.text)}>{description}</p>}
      {options.summarySlot === undefined
        ? null
        : optionalRegion(options.summarySlot, slots[options.summarySlot], {
            display: "flex",
            flexWrap: "wrap",
            justifyContent: options.component === "Empty" ? "center" : "flex-start",
            gap: foundation("space", "sm"),
          })}
      {optionalRegion(options.detailSlot, slots[options.detailSlot], {
        display: "flex",
        flexDirection: "column",
        gap: foundation("space", "sm"),
      })}
      {optionalRegion("actions", slots["actions"], {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: options.component === "Empty" ? "center" : "flex-start",
        gap: foundation("space", "sm"),
      })}
    </section>
  );
}

/** A semantic operation or search outcome. */
export const Result: MountedComponent<ReactNode, ReactNode> = (mount): ReactNode => {
  const tone = enumProp(mount.props, "tone", RESULT_TONES, "neutral");
  return outcomeSurface(mount, {
    component: "Result",
    namespace: "result",
    tone,
    summarySlot: "summary",
    detailSlot: "details",
    role: "status",
  });
};

/** A centered empty-state surface with guidance and action regions. */
export const Empty: MountedComponent<ReactNode, ReactNode> = (mount): ReactNode =>
  outcomeSurface(mount, {
    component: "Empty",
    namespace: "empty",
    tone: "neutral",
    detailSlot: "body",
  });

/** An important semantic message with supporting body and actions. */
export const Alert: MountedComponent<ReactNode, ReactNode> = (mount): ReactNode => {
  const tone = enumProp(mount.props, "tone", ALERT_TONES, "info");
  return outcomeSurface(mount, {
    component: "Alert",
    namespace: "alert",
    tone,
    detailSlot: "body",
    role: "alert",
  });
};
