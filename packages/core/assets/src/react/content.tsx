/**
 * The trusted React implementations of the content components: `Text`,
 * `Metric`, `Badge` and `Table`.
 *
 * These are the other half of the trust boundary. The catalog says a tag exists
 * and what its props mean; this module says what that tag *is* in the browser,
 * and the host registers it before bootstrap. Nothing an agent writes reaches
 * this file except as a resolved prop value — which is why the components can be
 * ordinary React and still carry no authoring escape hatch.
 *
 * Three rules shape every implementation here.
 *
 * **Props are read defensively even though they arrive validated.** The renderer
 * checks each value against the declared schema before mounting, so a wrong type
 * should be impossible; reading through a typed guard anyway costs one line and
 * turns "impossible" into "renders the declared default". A trusted component
 * that unwound on a surprising value would trip a subtree boundary and blank a
 * region of the page for a reason the visitor cannot act on.
 *
 * **Styling is token names and nothing else.** Each root carries the active
 * theme's custom properties — `themeVars` is that projection, ready to put on a
 * style attribute — and every declaration references a token by name through
 * `token()` rather than reading its value out. Referencing keeps the cascade
 * live: the same component mounted inside the Modal frame's portal, which has
 * no Screen ancestor to inherit from, still resolves every name it uses. There
 * is no raw CSS, no class name reaching for a stylesheet this package does not
 * own, and — deliberately — no `position` and no `z-index`: the `FlowStyle`
 * type the shared helpers accept makes that structural rather than a promise,
 * because a component that positioned itself would be the escape hatch the
 * layout invariant exists to refuse.
 *
 * **Presentation decisions live here, not in the catalog.** `Metric.value` is
 * declared a number precisely so the host publishes `42000000` and this file
 * decides how it reads. That keeps formatting out of every host's publish path.
 * `Table.rows` is likewise already resolved from the bounded data model before
 * it arrives here; the implementation only derives display columns from the
 * published records and never fetches or accepts inline row literals.
 *
 * The module is **private**: it is not barrel-exported and is not a package
 * entry point. `react.tsx` composes these into the one default registry.
 */

import type { ComponentMountProps, MountedComponent } from "@facet/core";
import type { ReactNode } from "react";

import type { FlowStyle } from "./style.js";
import { flowStyle, foundation, mountStyle, recipe, semantic } from "./style.js";

/** What one of these components is handed. React supplies both element types. */
type Mount = ComponentMountProps<ReactNode>;

/**
 * Reads a declared string prop, falling back when the value is anything else.
 * `Object`-shaped and numeric values cannot arrive here through validation; the
 * guard is what makes that guarantee unnecessary to trust.
 */
function readString(mount: Mount, name: string, fallback: string): string {
  const value = mount.props[name];
  return typeof value === "string" ? value : fallback;
}

/**
 * Reads a declared prop whose domain is a closed enum, falling back to the
 * catalog's own default when the value is outside it. The allowed list is
 * passed in rather than inferred so each component states its own domain beside
 * the styles it maps to.
 */
function readEnum<Value extends string>(
  mount: Mount,
  name: string,
  allowed: readonly Value[],
  fallback: Value,
): Value {
  const value = mount.props[name];
  return allowed.find((candidate) => candidate === value) ?? fallback;
}

/**
 * The typographic role each `Text` variant plays, as the token references it
 * paints with.
 *
 * The map is the whole of the variant vocabulary: a value outside it never
 * reaches a style, because `readEnum` folds it back to `body` first. Each entry
 * is built by `token()`, so a scale step the theme contract does not declare is
 * a type error in this table rather than a variable that resolves to nothing.
 */
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

const TEXT_VARIANT_NAMES = Object.keys(TEXT_VARIANTS) as readonly (keyof typeof TEXT_VARIANTS)[];

/**
 * A line or a paragraph of prose.
 *
 * The variant chooses the element as well as the type scale, so a title is an
 * `h1` and a heading is an `h2`: the document outline a screen reader announces
 * follows the role the author named, rather than being flattened into styled
 * paragraphs. `caption` stays a paragraph — it is small print, not a level in
 * the outline.
 */
export const Text: MountedComponent<ReactNode, ReactNode> = (mount) => {
  const value = readString(mount, "value", "");
  const variant = readEnum(mount, "variant", TEXT_VARIANT_NAMES, "body");
  const muted = readEnum(mount, "tone", ["default", "muted"] as const, "default") === "muted";
  const scale = TEXT_VARIANTS[variant];

  const style = mountStyle(mount.themeVars, {
    margin: 0,
    fontFamily: foundation("typography", "fontFamilySans"),
    fontSize: scale.fontSize,
    fontWeight: scale.fontWeight,
    lineHeight: scale.lineHeight,
    color: muted ? recipe("text", "mutedText") : recipe("text", "defaultText"),
  });

  if (variant === "title") return <h1 style={style}>{value}</h1>;
  if (variant === "heading") return <h2 style={style}>{value}</h2>;
  return <p style={style}>{value}</p>;
};

/**
 * How a `Metric` number reads.
 *
 * The locale is pinned rather than taken from the visitor's environment so the
 * default catalog renders the same figure everywhere, including in tests and in
 * server-rendered output where "the environment" is the machine's. A host whose
 * audience needs another locale registers its own `Metric` — that is what the
 * registry is for — and this default stays one predictable thing.
 */
const NUMBER_FORMAT = new Intl.NumberFormat("en-US");

/**
 * One headline number and the label that says what it measures.
 *
 * A value that is not a finite number renders as nothing at all rather than as
 * `NaN` or `Infinity`: the label still says what is being measured, and the
 * figure is simply absent, which is the honest reading of a number that failed
 * to arrive.
 */
export const Metric: MountedComponent<ReactNode, ReactNode> = (mount) => {
  const label = readString(mount, "label", "");
  const raw = mount.props["value"];
  const value = typeof raw === "number" && Number.isFinite(raw) ? NUMBER_FORMAT.format(raw) : "";
  const unit = readString(mount, "unit", "");

  const rootStyle: FlowStyle = {
    display: "flex",
    flexDirection: "column",
    gap: foundation("space", "xs"),
    fontFamily: foundation("typography", "fontFamilySans"),
  };
  const labelStyle: FlowStyle = {
    fontSize: recipe("metric", "labelFontSize"),
    fontWeight: foundation("typography", "fontWeightRegular"),
    color: recipe("metric", "labelColor"),
  };
  const valueStyle: FlowStyle = {
    display: "flex",
    alignItems: "baseline",
    gap: foundation("space", "xs"),
    fontSize: recipe("metric", "valueFontSize"),
    fontWeight: recipe("metric", "valueFontWeight"),
    lineHeight: foundation("typography", "lineHeightTight"),
    color: recipe("metric", "valueColor"),
  };
  const unitStyle: FlowStyle = {
    fontSize: recipe("metric", "labelFontSize"),
    fontWeight: foundation("typography", "fontWeightMedium"),
    color: recipe("metric", "labelColor"),
  };

  return (
    <div style={mountStyle(mount.themeVars, rootStyle)}>
      <span style={flowStyle(labelStyle)}>{label}</span>
      <span style={flowStyle(valueStyle)}>
        <span>{value}</span>
        {unit === "" ? null : <span style={flowStyle(unitStyle)}>{unit}</span>}
      </span>
    </div>
  );
};

/** The colour system each `Badge` tone borrows from the semantic status roles. */
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

const BADGE_TONE_NAMES = Object.keys(BADGE_TONES) as readonly (keyof typeof BADGE_TONES)[];

/** A short status word, marked so it reads as a status rather than as copy. */
export const Badge: MountedComponent<ReactNode, ReactNode> = (mount) => {
  const label = readString(mount, "label", "");
  const tone = readEnum(mount, "tone", BADGE_TONE_NAMES, "neutral");
  const colors = BADGE_TONES[tone];

  const style: FlowStyle = {
    display: "inline-flex",
    alignSelf: "flex-start",
    alignItems: "center",
    gap: foundation("space", "xs"),
    padding: `${recipe("badge", "paddingBlock")} ${recipe("badge", "paddingInline")}`,
    borderRadius: recipe("badge", "radius"),
    border: `${foundation("borderWidth", "thin")} solid ${colors.border}`,
    background: colors.background,
    color: colors.text,
    fontFamily: foundation("typography", "fontFamilySans"),
    fontSize: foundation("typography", "fontSizeXs"),
    fontWeight: foundation("typography", "fontWeightMedium"),
    lineHeight: foundation("typography", "lineHeightTight"),
  };

  return <span style={mountStyle(mount.themeVars, style)}>{label}</span>;
};

/**
 * Reads one own property of a candidate row without trusting it.
 *
 * Inherited keys do not stand in for declared ones, and a throwing accessor
 * reads as absent rather than propagating: published data is the host's, and a
 * single hostile getter must not be able to unwind the table it appears in.
 */
function safeOwnValue(row: unknown, key: string): unknown {
  try {
    if (typeof row !== "object" || row === null || Array.isArray(row)) return undefined;
    if (!Object.hasOwn(row, key)) return undefined;
    return (row as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/**
 * The columns a bound collection shows: the own keys of the first row that is a
 * record.
 *
 * The catalog declares no `columns` prop, so the shape of the published records
 * is the only statement of what a table's columns are. Taking the *first*
 * record — rather than the union of every row's keys — keeps the header stable
 * and ordered as the host published it; a later row carrying an extra key
 * contributes nothing rather than widening the table halfway down.
 */
function deriveColumns(rows: readonly unknown[]): readonly string[] {
  for (const row of rows) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) continue;
    try {
      return Object.keys(row);
    } catch {
      return [];
    }
  }
  return [];
}

/** What one cell shows. Only scalars render; a structure degrades to a blank. */
function cellText(row: unknown, column: string): string {
  const value = safeOwnValue(row, column);
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return String(value);
  return "";
}

/** A published collection of records, as rows and columns. */
export const Table: MountedComponent<ReactNode, ReactNode> = (mount) => {
  const raw = mount.props["rows"];
  const rows: readonly unknown[] = Array.isArray(raw) ? raw : [];
  const caption = readString(mount, "caption", "");
  const columns = deriveColumns(rows);

  const rootStyle: FlowStyle = {
    minWidth: 0,
    overflowX: "auto",
    borderRadius: recipe("table", "radius"),
    border: `${foundation("borderWidth", "thin")} solid ${recipe("table", "border")}`,
    background: recipe("table", "background"),
  };
  const tableStyle: FlowStyle = {
    width: "100%",
    borderCollapse: "collapse",
    fontFamily: foundation("typography", "fontFamilySans"),
    fontSize: foundation("typography", "fontSizeSm"),
    color: recipe("table", "text"),
  };
  const captionStyle: FlowStyle = {
    textAlign: "left",
    padding: `${foundation("space", "sm")} ${foundation("space", "sm")} ${foundation("space", "xs")}`,
    color: recipe("table", "captionText"),
    fontSize: foundation("typography", "fontSizeXs"),
    fontWeight: foundation("typography", "fontWeightMedium"),
  };
  const cellStyle: FlowStyle = {
    textAlign: "left",
    padding: recipe("table", "cellPadding"),
    borderBottom: `${foundation("borderWidth", "thin")} solid ${recipe("table", "rowBorder")}`,
  };
  const headerStyle: FlowStyle = {
    ...cellStyle,
    fontWeight: foundation("typography", "fontWeightMedium"),
    color: recipe("table", "headerText"),
    background: recipe("table", "headerBg"),
  };

  return (
    <div data-facet-component="Table" style={mountStyle(mount.themeVars, rootStyle)}>
      <table style={flowStyle(tableStyle)}>
        {caption === "" ? null : <caption style={flowStyle(captionStyle)}>{caption}</caption>}
        {columns.length === 0 ? null : (
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column} scope="col" style={flowStyle(headerStyle)}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {columns.length === 0
            ? null
            : rows.map((row, index) => (
                // Published rows carry no identity of their own, so position in the
                // bound collection is the only honest key.
                <tr key={index}>
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
